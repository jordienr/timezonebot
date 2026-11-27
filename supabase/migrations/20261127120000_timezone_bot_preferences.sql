create table public.timezone_bot_preferences (
  team_id text not null check (team_id ~ '^T[A-Z0-9]{8,}$'),
  user_id text not null check (user_id ~ '^[UWB][A-Z0-9]{8,}$'),
  primary key (team_id, user_id)
);

alter table public.timezone_bot_preferences enable row level security;

revoke all on table public.timezone_bot_preferences from public, anon, authenticated;
revoke all on table public.timezone_bot_preferences from service_role;
grant select, insert, delete on table public.timezone_bot_preferences to service_role;
