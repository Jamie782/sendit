-- SEND IT 2.8.1: admins can set a player's coins to an exact amount
alter table public.si_grants add column if not exists set_to bigint;

create or replace function public.si_admin_setcoins(p_token text, p_username text, p_amount bigint)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a si_users := si__admin(p_token); t si_users := si__target(a, p_username, false);
begin
  if p_amount is null or p_amount < 0 or p_amount > 1000000000 then raise exception 'bad_amount' using errcode = 'P0001'; end if;
  -- online: their game picks this up within 15 seconds; offline: it's already in their save for next time they sign in
  insert into si_grants(user_id, amount, by_id, set_to) values (t.id, 0, a.id, p_amount);
  update si_users set save = jsonb_set(coalesce(save, '{}'::jsonb), '{cash}', to_jsonb(p_amount)) where id = t.id;
  insert into si_admin_log(by_id, action, target, detail) values (a.id, 'setcoins', t.id, jsonb_build_object('amount', p_amount));
  return jsonb_build_object('ok', true, 'username', t.username);
end $function$;
revoke all on function public.si_admin_setcoins(text, text, bigint) from public;
grant execute on function public.si_admin_setcoins(text, text, bigint) to anon, authenticated;

-- si_heartbeat: the newest "set coins" wins and is returned as setcoins; gifts after it still add on top (gold)
create or replace function public.si_heartbeat(p_token text, p_room text default null::text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare u uuid := si__uid(p_token); g bigint; k boolean; rl text; sid bigint; sto bigint;
begin
  update si_users set last_seen = now(), room = nullif(p_room, '') where id = u;
  delete from si_invites where created_at < now() - interval '30 minutes';
  select id, set_to into sid, sto from si_grants where user_id = u and not claimed and set_to is not null order by id desc limit 1;
  with c as (update si_grants set claimed = true where user_id = u and not claimed returning id, amount)
    select coalesce(sum(amount) filter (where sid is null or id > sid), 0) into g from c;
  select kick_at is not null and kick_at > now() - interval '2 minutes', role into k, rl from si_users where id = u;
  if k then update si_users set kick_at = null where id = u; end if;
  return jsonb_build_object(
    'requests', (select count(*) from si_friends where b = u and not accepted),
    'gold', g, 'setcoins', sto, 'kicked', k, 'role', rl,
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'from', f.username, 'avatar', f.avatar, 'code', r.code, 'name', r.name, 'players', r.players, 'max', r.max_players) order by i.created_at desc)
      from si_invites i join si_users f on f.id = i.from_id join si_rooms r on r.code = i.code and r.heartbeat > now() - interval '45 seconds'
      where i.to_id = u and coalesce(nullif(p_room, ''), '') <> i.code), '[]'::jsonb));
end $function$;
