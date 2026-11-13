-- SEND IT 2.8: the host also learns whether the joining player is an admin, so it only passes on helicopter bombs and grabs from admins
create or replace function public.si_check_ticket(p_token text, p_code text, p_ticket text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare u uuid := si__uid(p_token); k si_tickets; r si_rooms;
begin
  select * into r from si_rooms where code = p_code and host_id = u;
  if r.code is null then return jsonb_build_object('ok', false, 'why', 'not_host'); end if;
  delete from si_tickets where ticket = p_ticket and code = p_code and created_at > now() - interval '5 minutes' returning * into k;
  if k.ticket is null then return jsonb_build_object('ok', false, 'why', 'bad_ticket'); end if;
  if r.private and not si__are_friends(u, k.user_id) and not exists(select 1 from si_invites where to_id = k.user_id and code = p_code) then return jsonb_build_object('ok', false, 'why', 'friends_only'); end if;
  return jsonb_build_object('ok', true, 'role', (select role from si_users where id = k.user_id)) || si__card(k.user_id);
end $function$;
