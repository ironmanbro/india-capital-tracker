-- Watchlist alerts (Web Push). One row per browser that opted in.
-- Nobody can read or write this table through the public API: RLS is on and there is no policy. Only the edge function
-- push-subscribe and the alert sender (both with the service role) touch it. Not applied automatically: run it yourself.
create table if not exists public.push_subscriptions (
  endpoint    text primary key check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh      text not null check (length(p256dh) <= 200),
  auth        text not null check (length(auth) <= 100),
  follows     jsonb not null default '[]'::jsonb,   -- [{k,key,label}] copied from the visitor's watchlist
  baselined   jsonb not null default '[]'::jsonb,   -- follows already compared once, so a new follow does not flood the first alert
  sent        jsonb not null default '[]'::jsonb,   -- ids of items already notified (newest last, capped by the sender)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  failed_at   timestamptz
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
comment on table public.push_subscriptions is 'Opt-in Web Push subscriptions for watchlist alerts. Service role only.';
