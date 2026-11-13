-- SEND IT 2.7.2: settings the server functions share (the Discord invite link and server ID, written by si-discord-setup)
create table if not exists public.si_settings (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.si_settings enable row level security;
revoke all on public.si_settings from anon, authenticated;
-- the game and website can read the Discord invite link (public anyway), nothing else
create or replace function public.si_discord_invite() returns text language sql stable security definer set search_path = public as $$
  select value from public.si_settings where key = 'discord_invite'
$$;
revoke all on function public.si_discord_invite() from public;
grant execute on function public.si_discord_invite() to anon, authenticated;
