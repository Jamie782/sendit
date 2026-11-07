-- SEND IT game backend. Everything is prefixed si_ and only reachable through the si_ RPC functions.
create table if not exists public.si_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  uname text not null unique,
  pass_hash text not null,
  avatar jsonb not null default '{}'::jsonb,
  save jsonb not null default '{}'::jsonb,
  coins_total bigint not null default 0,
  room text,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.si_sessions (
  token text primary key,
  user_id uuid not null references public.si_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);
create index if not exists si_sessions_user on public.si_sessions(user_id);
create table if not exists public.si_friends (
  a uuid not null references public.si_users(id) on delete cascade,
  b uuid not null references public.si_users(id) on delete cascade,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a <> b)
);
create index if not exists si_friends_b on public.si_friends(b);
create table if not exists public.si_scores (
  user_id uuid not null references public.si_users(id) on delete cascade,
  board text not null,
  value double precision not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, board)
);
create index if not exists si_scores_board on public.si_scores(board, value);
create table if not exists public.si_rooms (
  code text primary key,
  host_id uuid not null references public.si_users(id) on delete cascade,
  name text not null,
  private boolean not null default false,
  zone text not null default 'street',
  players int not null default 1,
  max_players int not null default 8,
  heartbeat timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.si_tickets (
  ticket text primary key,
  user_id uuid not null references public.si_users(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);

alter table public.si_users enable row level security;
alter table public.si_sessions enable row level security;
alter table public.si_friends enable row level security;
alter table public.si_scores enable row level security;
alter table public.si_rooms enable row level security;
alter table public.si_tickets enable row level security;
revoke all on public.si_users, public.si_sessions, public.si_friends, public.si_scores, public.si_rooms, public.si_tickets from anon, authenticated;

-- helpers -------------------------------------------------------------
create or replace function public.si__uid(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select user_id into u from si_sessions where token = p_token and expires_at > now();
  if u is null then raise exception 'not_logged_in' using errcode = 'P0001'; end if;
  update si_users set last_seen = now() where id = u and last_seen < now() - interval '20 seconds';
  return u;
end $$;

create or replace function public.si__profile(u uuid) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object('id', id, 'username', username, 'avatar', avatar, 'save', save, 'coins_total', coins_total, 'created_at', created_at)
  from si_users where id = u;
$$;

create or replace function public.si__card(u uuid) returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object('username', username, 'avatar', avatar,
    'online', last_seen > now() - interval '75 seconds')
  from si_users where id = u;
$$;

create or replace function public.si__new_token() returns text
language sql volatile set search_path = public, extensions as $$
  select encode(extensions.gen_random_bytes(24), 'hex');
$$;

create or replace function public.si__are_friends(x uuid, y uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from si_friends where accepted and ((a = x and b = y) or (a = y and b = x)));
$$;

-- accounts ------------------------------------------------------------
create or replace function public.si_signup(p_username text, p_password text, p_avatar jsonb default '{}'::jsonb, p_save jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u uuid; t text;
begin
  p_username := btrim(coalesce(p_username, ''));
  if p_username !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'bad_username' using errcode = 'P0001'; end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then raise exception 'bad_password' using errcode = 'P0001'; end if;
  if exists(select 1 from si_users where uname = lower(p_username)) then raise exception 'username_taken' using errcode = 'P0001'; end if;
  if pg_column_size(p_avatar) > 4000 or pg_column_size(p_save) > 30000 then raise exception 'too_big' using errcode = 'P0001'; end if;
  insert into si_users(username, uname, pass_hash, avatar, save)
    values (p_username, lower(p_username), crypt(p_password, gen_salt('bf', 8)), coalesce(p_avatar, '{}'), coalesce(p_save, '{}'))
    returning id into u;
  t := si__new_token();
  insert into si_sessions(token, user_id) values (t, u);
  return jsonb_build_object('token', t, 'profile', si__profile(u));
end $$;

create or replace function public.si_login(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r si_users; t text;
begin
  select * into r from si_users where uname = lower(btrim(coalesce(p_username, '')));
  if r.id is null or r.pass_hash <> crypt(coalesce(p_password, ''), r.pass_hash) then
    perform pg_sleep(0.4);
    raise exception 'wrong_login' using errcode = 'P0001';
  end if;
  delete from si_sessions where user_id = r.id and expires_at < now();
  t := si__new_token();
  insert into si_sessions(token, user_id) values (t, r.id);
  update si_users set last_seen = now() where id = r.id;
  return jsonb_build_object('token', t, 'profile', si__profile(r.id));
end $$;

create or replace function public.si_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin return si__profile(si__uid(p_token)); end $$;

create or replace function public.si_logout(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from si_sessions where token = p_token;
$$;

create or replace function public.si_save(p_token text, p_save jsonb default null, p_avatar jsonb default null, p_coins_earned bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); tot bigint;
begin
  if p_save is not null and pg_column_size(p_save) > 30000 then raise exception 'too_big' using errcode = 'P0001'; end if;
  if p_avatar is not null and pg_column_size(p_avatar) > 4000 then raise exception 'too_big' using errcode = 'P0001'; end if;
  update si_users set
    save = coalesce(p_save, save),
    avatar = coalesce(p_avatar, avatar),
    coins_total = coins_total + greatest(0, least(coalesce(p_coins_earned, 0), 200000))
  where id = u returning coins_total into tot;
  insert into si_scores(user_id, board, value) values (u, 'coins', tot)
    on conflict (user_id, board) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'coins_total', tot);
end $$;

-- leaderboards ----------------------------------------------------------
create or replace function public.si_submit(p_token text, p_board text, p_value double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); low boolean; best double precision; improved boolean := false;
begin
  if p_board not in ('combo', 'attack', 'hill', 'air') then raise exception 'bad_board' using errcode = 'P0001'; end if;
  if p_value is null or p_value <> p_value then raise exception 'bad_value' using errcode = 'P0001'; end if;
  if p_board = 'hill' and (p_value < 10 or p_value > 600) then raise exception 'bad_value' using errcode = 'P0001'; end if;
  if p_board in ('combo', 'attack') and (p_value < 0 or p_value > 5000000) then raise exception 'bad_value' using errcode = 'P0001'; end if;
  if p_board = 'air' and (p_value < 0 or p_value > 120) then raise exception 'bad_value' using errcode = 'P0001'; end if;
  low := p_board = 'hill';
  select value into best from si_scores where user_id = u and board = p_board;
  if best is null or (low and p_value < best) or (not low and p_value > best) then
    insert into si_scores(user_id, board, value) values (u, p_board, p_value)
      on conflict (user_id, board) do update set value = excluded.value, updated_at = now();
    improved := true; best := p_value;
  end if;
  return jsonb_build_object('improved', improved, 'best', best);
end $$;

create or replace function public.si_leaderboard(p_board text, p_scope text default 'all', p_token text default null, p_limit int default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid; low boolean := p_board = 'hill'; rows jsonb; mine jsonb;
begin
  if p_token is not null and p_token <> '' then
    select user_id into me from si_sessions where token = p_token and expires_at > now();
  end if;
  if p_scope = 'friends' and me is null then return jsonb_build_object('rows', '[]'::jsonb, 'me', null); end if;
  with pool as (
    select s.user_id, s.value, s.updated_at from si_scores s
    where s.board = p_board
      and (p_scope <> 'friends' or s.user_id = me or si__are_friends(s.user_id, me))
  ), ranked as (
    select user_id, value, updated_at,
      rank() over (order by case when low then value end asc, case when not low then value end desc) as rk
    from pool
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', r.rk, 'username', us.username, 'avatar', us.avatar, 'value', r.value, 'me', r.user_id = me) order by r.rk), '[]'::jsonb)
    into rows
    from (select * from ranked order by rk limit greatest(1, least(p_limit, 100))) r join si_users us on us.id = r.user_id;
  if me is not null then
    with pool as (
      select s.user_id, s.value from si_scores s where s.board = p_board
        and (p_scope <> 'friends' or s.user_id = me or si__are_friends(s.user_id, me))
    ), ranked as (
      select user_id, value, rank() over (order by case when low then value end asc, case when not low then value end desc) as rk from pool
    )
    select jsonb_build_object('rank', rk, 'value', value) into mine from ranked where user_id = me;
  end if;
  return jsonb_build_object('rows', rows, 'me', mine);
end $$;

-- friends ---------------------------------------------------------------
create or replace function public.si_friend_add(p_token text, p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); v uuid; existing si_friends;
begin
  select id into v from si_users where uname = lower(btrim(coalesce(p_username, '')));
  if v is null then raise exception 'no_such_user' using errcode = 'P0001'; end if;
  if v = u then raise exception 'thats_you' using errcode = 'P0001'; end if;
  select * into existing from si_friends where (a = u and b = v) or (a = v and b = u);
  if existing.a is null then
    insert into si_friends(a, b) values (u, v);
    return jsonb_build_object('status', 'sent');
  end if;
  if existing.accepted then return jsonb_build_object('status', 'already_friends'); end if;
  if existing.a = v then  -- they already asked me: accept
    update si_friends set accepted = true where a = v and b = u;
    return jsonb_build_object('status', 'accepted');
  end if;
  return jsonb_build_object('status', 'already_sent');
end $$;

create or replace function public.si_friend_respond(p_token text, p_username text, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); v uuid;
begin
  select id into v from si_users where uname = lower(btrim(coalesce(p_username, '')));
  if v is null then raise exception 'no_such_user' using errcode = 'P0001'; end if;
  if p_accept then
    update si_friends set accepted = true where a = v and b = u;
  else
    delete from si_friends where a = v and b = u and not accepted;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.si_friend_remove(p_token text, p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); v uuid;
begin
  select id into v from si_users where uname = lower(btrim(coalesce(p_username, '')));
  delete from si_friends where (a = u and b = v) or (a = v and b = u);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.si_friends_list(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token);
begin
  return coalesce((
    select jsonb_agg(x order by (x->>'online')::boolean desc, x->>'username')
    from (
      select si__card(case when f.a = u then f.b else f.a end)
        || jsonb_build_object(
          'status', case when f.accepted then 'friend' when f.a = u then 'outgoing' else 'incoming' end,
          'room', case when f.accepted and o.room is not null and o.last_seen > now() - interval '75 seconds'
                     then (select jsonb_build_object('code', r.code, 'name', r.name, 'private', r.private, 'players', r.players, 'max', r.max_players)
                           from si_rooms r where r.code = o.room and r.heartbeat > now() - interval '45 seconds') end
        ) as x
      from si_friends f
      join si_users o on o.id = case when f.a = u then f.b else f.a end
      where f.a = u or f.b = u
    ) t
  ), '[]'::jsonb);
end $$;

-- presence + servers ------------------------------------------------------
create or replace function public.si_heartbeat(p_token text, p_room text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token);
begin
  update si_users set last_seen = now(), room = nullif(p_room, '') where id = u;
  return jsonb_build_object('requests', (select count(*) from si_friends where b = u and not accepted));
end $$;

create or replace function public.si_room_open(p_token text, p_code text, p_name text, p_private boolean, p_zone text default 'street', p_max int default 8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token);
begin
  if p_code !~ '^[A-Z0-9]{4,8}$' then raise exception 'bad_code' using errcode = 'P0001'; end if;
  delete from si_rooms where heartbeat < now() - interval '10 minutes' or host_id = u;
  if exists(select 1 from si_rooms where code = p_code) then raise exception 'code_taken' using errcode = 'P0001'; end if;
  insert into si_rooms(code, host_id, name, private, zone, max_players)
    values (p_code, u, left(coalesce(nullif(btrim(p_name), ''), 'Server'), 28), coalesce(p_private, false), left(coalesce(p_zone, 'street'), 12), greatest(2, least(coalesce(p_max, 8), 12)));
  update si_users set room = p_code, last_seen = now() where id = u;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.si_room_beat(p_token text, p_code text, p_players int, p_zone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); n int;
begin
  update si_rooms set heartbeat = now(), players = greatest(1, least(coalesce(p_players, 1), 12)), zone = coalesce(left(p_zone, 12), zone)
    where code = p_code and host_id = u;
  get diagnostics n = row_count;
  update si_users set last_seen = now(), room = p_code where id = u;
  return jsonb_build_object('ok', n > 0);
end $$;

create or replace function public.si_room_close(p_token text, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token);
begin
  delete from si_rooms where code = p_code and host_id = u;
  update si_users set room = null where id = u and room = p_code;
end $$;

create or replace function public.si_rooms_list(p_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  if p_token is not null and p_token <> '' then
    select user_id into me from si_sessions where token = p_token and expires_at > now();
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'private', r.private, 'zone', r.zone,
      'players', r.players, 'max', r.max_players, 'host', h.username, 'host_avatar', h.avatar,
      'friend', me is not null and si__are_friends(me, r.host_id), 'mine', r.host_id = me)
      order by (me is not null and si__are_friends(me, r.host_id)) desc, r.players desc, r.created_at desc)
    from si_rooms r join si_users h on h.id = r.host_id
    where r.heartbeat > now() - interval '45 seconds'
      and (not r.private or r.host_id = me or (me is not null and si__are_friends(me, r.host_id)))
  ), '[]'::jsonb);
end $$;

-- join tickets: the joiner asks for one, the host checks it, so private servers stay friends-only
create or replace function public.si_ticket(p_token text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := si__uid(p_token); r si_rooms; t text;
begin
  select * into r from si_rooms where code = upper(p_code) and heartbeat > now() - interval '45 seconds';
  if r.code is null then raise exception 'no_such_server' using errcode = 'P0001'; end if;
  if r.private and r.host_id <> u and not si__are_friends(u, r.host_id) then raise exception 'friends_only' using errcode = 'P0001'; end if;
  if r.players >= r.max_players then raise exception 'server_full' using errcode = 'P0001'; end if;
  delete from si_tickets where created_at < now() - interval '5 minutes';
  t := si__new_token();
  insert into si_tickets(ticket, user_id, code) values (t, u, r.code);
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
  if r.private and not si__are_friends(u, k.user_id) then return jsonb_build_object('ok', false, 'why', 'friends_only'); end if;
  return jsonb_build_object('ok', true) || si__card(k.user_id);
end $$;

create or replace function public.si_profile(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from si_users where uname = lower(btrim(coalesce(p_username, '')));
  if v is null then raise exception 'no_such_user' using errcode = 'P0001'; end if;
  return si__card(v) || jsonb_build_object('coins_total', (select coins_total from si_users where id = v),
    'scores', coalesce((select jsonb_object_agg(board, value) from si_scores where user_id = v), '{}'::jsonb));
end $$;

-- only the public si_ functions are callable from the game; helpers stay private
revoke execute on function public.si__uid(text), public.si__profile(uuid), public.si__card(uuid), public.si__new_token(), public.si__are_friends(uuid, uuid) from public, anon, authenticated;
