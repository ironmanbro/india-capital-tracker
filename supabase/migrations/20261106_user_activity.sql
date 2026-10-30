-- What each signed-in person opens on the site. Each person can read and delete only their own rows;
-- only accounts listed in app_admins (the owner) can read everyone's, and only through the functions below.
-- Already applied to the live project on 2026-10-31.
create table if not exists public.user_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('view', 'open', 'search', 'signin')),
  page text not null check (char_length(page) <= 40),
  detail text check (char_length(detail) <= 120),
  device text check (device in ('phone', 'tablet', 'laptop'))
);
create index if not exists user_activity_user_at on public.user_activity (user_id, at desc);
create index if not exists user_activity_at on public.user_activity (at desc);
alter table public.user_activity enable row level security;
create policy "insert own activity" on public.user_activity for insert to authenticated with check (user_id = auth.uid());
create policy "read own activity" on public.user_activity for select to authenticated using (user_id = auth.uid());
create policy "delete own activity" on public.user_activity for delete to authenticated using (user_id = auth.uid());
revoke all on public.user_activity from anon, authenticated;
grant select, insert, delete on public.user_activity to authenticated;

create table if not exists public.app_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
-- To make someone the owner (after they have signed up):
--   insert into public.app_admins select id from auth.users where lower(email) = '<owner email>';

-- Functions: is_admin(), activity_summary(days), activity_users(), activity_timeline(uid, lim) (owner only), and
-- purge_old_activity() (deletes rows older than 12 months; scheduled daily with pg_cron as job 'purge-user-activity').
-- See the applied migration "user_activity" in the Supabase project for their bodies.
