-- SEND IT v1.4b: invites, picture avatars, Discord linking / sign-in
alter table public.si_users add column if not exists discord_id text unique;
alter table public.si_users add column if not exists discord_name text;
alter table public.si_users add column if not exists discord_avatar text;

create table if not exists public.si_invites (
  id bigserial primary key,
  from_id uuid not null references public.si_users(id) on delete cascade,
  to_id uuid not null references public.si_users(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  unique (from_id, to_id, code)
);
create index if not exists si_invites_to on public.si_invites(to_id);
create table if not exists public.si_oauth (
  state text primary key,
  kind text not null check (kind in ('link', 'login')),
  user_id uuid references public.si_users(id) on delete cascade,
  done boolean not null default false,
  token text,
  error text,
  created_at timestamptz not null default now()
);
alter table public.si_invites enable row level security;
alter table public.si_oauth enable row level security;
revoke all on public.si_invites, public.si_oauth from anon, authenticated;

-- avatars may carry a small picture: an uploaded data: image or a Discord CDN link
create or replace function public.si__avatar_ok(a jsonb) returns boolean
language sql immutable as $$
  select a is null or (pg_column_size(a) <= 24000 and (
    a->>'img' is null or a->>'img' ~ '^(data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+|https://cdn\.discordapp\.com/[A-Za-z0-9_./?=-]+)$'));
$$;

create or replace function public.si__profile(u uuid) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object('id', id, 'username', username, 'avatar', avatar, 'save', save, 'coins_total', coins_total, 'created_at', created_at,
    'discord', case when discord_id is null then null else jsonb_build_object('name', discord_name, 'avatar', discord_avatar) end)
  from si_users where id = u;
$$;
create or replace function public.si__card(u uuid) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object('username', username, 'avatar', avatar, 'discord', discord_name,
    'online', last_seen > now() - interval '75 seconds')
  from si_users where id = u;
$$;

create or replace function public.si_signup(p_username text, p_password text, p_avatar jsonb default '{}'::jsonb, p_save jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u uuid; t text;
begin
  p_username := btrim(coalesce(p_username, ''));
  if p_username !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'bad_username' using errcode = 'P0001'; end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then raise exception 'bad_password' using errcode = 'P0001'; end if;
  if exists(select 1 from si_users where uname = lower(p_username)) then raise exception 'username_taken' using errcode = 'P0001'; end if;
  if not si__avatar_ok(p_avatar) or pg_column_size(p_save) > 30000 then raise exception 'too_big' using errcode = 'P0001'; end if;
  insert into si_users(username, uname, pass_hash, avatar, save)
    values (p_username, lower(p_username), crypt(p_password, gen_salt('bf', 8)), coalesce(p_avatar, '{}'), coalesce(p_save, '{}'))
    returning id into u;
  t := si__new_token();
  insert into si_sessions(token, user_id) values (t, u);
  return jsonb_build_object('token', t, 'profile', si__profile(u));
end $$;

create or replace function public.si_save(p_token text, p_save jsonb default null, p_avatar jsonb default null, p_coins_earned bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); tot bigint;
begin
  if p_save is not null and pg_column_size(p_save) > 30000 then raise exception 'too_big' using errcode = 'P0001'; end if;
  if p_avatar is not null and not si__avatar_ok(p_avatar) then raise exception 'bad_avatar' using errcode = 'P0001'; end if;
  update si_users set
    save = coalesce(p_save, save),
    avatar = coalesce(p_avatar, avatar),
    coins_total = coins_total + greatest(0, least(coalesce(p_coins_earned, 0), 200000))
  where id = u returning coins_total into tot;
  insert into si_scores(user_id, board, value) values (u, 'coins', tot)
    on conflict (user_id, board) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'coins_total', tot);
end $$;

-- invites ---------------------------------------------------------------
-- invite a friend to the server you're on; the invite also lets them into a friends-only server
create or replace function public.si_invite(p_token text, p_username text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); v uuid; r si_rooms;
begin
  select id into v from si_users where uname = lower(btrim(coalesce(p_username, '')));
  if v is null then raise exception 'no_such_user' using errcode = 'P0001'; end if;
  if not si__are_friends(u, v) then raise exception 'not_friends' using errcode = 'P0001'; end if;
  select * into r from si_rooms where code = upper(p_code) and heartbeat > now() - interval '45 seconds';
  if r.code is null then raise exception 'no_such_server' using errcode = 'P0001'; end if;
  if r.host_id <> u and not exists(select 1 from si_users where id = u and room = r.code) then raise exception 'not_in_server' using errcode = 'P0001'; end if;
  insert into si_invites(from_id, to_id, code) values (u, v, r.code)
    on conflict (from_id, to_id, code) do update set created_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.si_invite_dismiss(p_token text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token);
begin delete from si_invites where id = p_id and to_id = u; end $$;

create or replace function public.si__invited(u uuid, c text) returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from si_invites where to_id = u and code = c and created_at > now() - interval '30 minutes');
$$;

create or replace function public.si_heartbeat(p_token text, p_room text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token);
begin
  update si_users set last_seen = now(), room = nullif(p_room, '') where id = u;
  delete from si_invites where created_at < now() - interval '30 minutes';
  return jsonb_build_object(
    'requests', (select count(*) from si_friends where b = u and not accepted),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'from', f.username, 'avatar', f.avatar, 'code', r.code, 'name', r.name, 'players', r.players, 'max', r.max_players) order by i.created_at desc)
      from si_invites i join si_users f on f.id = i.from_id join si_rooms r on r.code = i.code and r.heartbeat > now() - interval '45 seconds'
      where i.to_id = u and coalesce(nullif(p_room, ''), '') <> i.code), '[]'::jsonb));
end $$;

create or replace function public.si_ticket(p_token text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); r si_rooms; t text;
begin
  select * into r from si_rooms where code = upper(p_code) and heartbeat > now() - interval '45 seconds';
  if r.code is null then raise exception 'no_such_server' using errcode = 'P0001'; end if;
  if r.private and r.host_id <> u and not si__are_friends(u, r.host_id) and not si__invited(u, r.code) then raise exception 'friends_only' using errcode = 'P0001'; end if;
  if r.players >= r.max_players then raise exception 'server_full' using errcode = 'P0001'; end if;
  delete from si_tickets where created_at < now() - interval '5 minutes';
  t := si__new_token();
  insert into si_tickets(ticket, user_id, code) values (t, u, r.code);
  delete from si_invites where to_id = u and code = r.code and created_at < now() - interval '1 minute';
  return jsonb_build_object('ticket', t, 'private', r.private, 'name', r.name);
end $$;

create or replace function public.si_check_ticket(p_token text, p_code text, p_ticket text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); k si_tickets; r si_rooms;
begin
  select * into r from si_rooms where code = p_code and host_id = u;
  if r.code is null then return jsonb_build_object('ok', false, 'why', 'not_host'); end if;
  delete from si_tickets where ticket = p_ticket and code = p_code and created_at > now() - interval '5 minutes' returning * into k;
  if k.ticket is null then return jsonb_build_object('ok', false, 'why', 'bad_ticket'); end if;
  if r.private and not si__are_friends(u, k.user_id) and not exists(select 1 from si_invites where to_id = k.user_id and code = p_code) then return jsonb_build_object('ok', false, 'why', 'friends_only'); end if;
  return jsonb_build_object('ok', true) || si__card(k.user_id);
end $$;

-- Discord -----------------------------------------------------------------
-- the game asks for a state, opens the browser at the si-discord edge function, then polls
create or replace function public.si_discord_begin(p_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; s text := si__new_token();
begin
  if p_token is not null and p_token <> '' then u := si__uid(p_token); end if;
  delete from si_oauth where created_at < now() - interval '15 minutes';
  insert into si_oauth(state, kind, user_id) values (s, case when u is null then 'login' else 'link' end, u);
  return jsonb_build_object('state', s);
end $$;

create or replace function public.si_discord_poll(p_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o si_oauth;
begin
  select * into o from si_oauth where state = p_state and created_at > now() - interval '15 minutes';
  if o.state is null then return jsonb_build_object('status', 'expired'); end if;
  if not o.done then return jsonb_build_object('status', 'pending'); end if;
  delete from si_oauth where state = p_state;
  if o.error is not null then return jsonb_build_object('status', 'error', 'error', o.error); end if;
  if o.kind = 'login' then
    return jsonb_build_object('status', 'ok', 'token', o.token, 'profile', si__profile((select user_id from si_sessions where token = o.token)));
  end if;
  return jsonb_build_object('status', 'ok', 'profile', si__profile(o.user_id));
end $$;

-- called only by the si-discord edge function (service role), after it has checked the user with Discord
create or replace function public.si_discord_complete(p_state text, p_id text, p_name text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare o si_oauth; other uuid; u uuid; base text; nm text; n int := 0; t text;
begin
  select * into o from si_oauth where state = p_state and not done and created_at > now() - interval '15 minutes';
  if o.state is null then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  select id into other from si_users where discord_id = p_id;
  if o.kind = 'link' then
    if other is not null and other <> o.user_id then
      update si_oauth set done = true, error = 'discord_in_use' where state = p_state;
      return jsonb_build_object('ok', false, 'error', 'discord_in_use');
    end if;
    update si_users set discord_id = p_id, discord_name = left(p_name, 40), discord_avatar = p_avatar where id = o.user_id;
    update si_oauth set done = true where state = p_state;
    return jsonb_build_object('ok', true, 'kind', 'link', 'username', (select username from si_users where id = o.user_id));
  end if;
  -- sign in with Discord: use the linked account, or make one named after the Discord user
  u := other;
  if u is null then
    base := left(regexp_replace(coalesce(p_name, 'rider'), '[^A-Za-z0-9_]', '', 'g'), 12);
    if length(base) < 3 then base := 'rider' || base; end if;
    nm := base;
    while exists(select 1 from si_users where uname = lower(nm)) loop n := n + 1; nm := left(base, 12) || (floor(random() * 9000) + 1000)::int::text; exit when n > 20; end loop;
    insert into si_users(username, uname, pass_hash, discord_id, discord_name, discord_avatar, avatar)
      values (nm, lower(nm), crypt(si__new_token(), gen_salt('bf', 8)), p_id, left(p_name, 40), p_avatar,
              case when p_avatar is not null then jsonb_build_object('img', p_avatar) else '{}'::jsonb end)
      returning id into u;
  else
    update si_users set discord_name = left(p_name, 40), discord_avatar = p_avatar where id = u;
  end if;
  t := si__new_token();
  insert into si_sessions(token, user_id) values (t, u);
  update si_oauth set done = true, token = t, user_id = u where state = p_state;
  return jsonb_build_object('ok', true, 'kind', 'login', 'username', (select username from si_users where id = u));
end $$;

create or replace function public.si_discord_unlink(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token);
begin
  update si_users set discord_id = null, discord_name = null, discord_avatar = null where id = u;
  return si__profile(u);
end $$;

-- accounts made with Discord can also set a password, so they can sign in without Discord
create or replace function public.si_set_password(p_token text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u uuid := si__uid(p_token);
begin
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then raise exception 'bad_password' using errcode = 'P0001'; end if;
  update si_users set pass_hash = crypt(p_password, gen_salt('bf', 8)) where id = u;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.si__avatar_ok(jsonb), public.si__invited(uuid, text) from public, anon, authenticated;
revoke execute on function public.si_discord_complete(text, text, text, text) from public, anon, authenticated;
grant execute on function public.si_discord_complete(text, text, text, text) to service_role;
