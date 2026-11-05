-- RBI monthly Overseas Direct Investment (outbound FDI): one row per Indian party / overseas JV or WOS.
create table if not exists public.odi_deals (
  month date not null,
  sr int not null,
  indian_party text,            -- null when the investor is an individual (names not published here)
  is_individual boolean not null default false,
  jv_name text,
  jv_type text,                 -- JV or WOS
  country text,
  activity text,
  equity numeric, loan numeric, guarantee numeric, total numeric,   -- USD million
  source_url text,
  primary key (month, sr)
);
create table if not exists public.odi_monthly (
  month date primary key,
  equity numeric, loan numeric, guarantee numeric, total numeric,
  deals int, source_url text, released_on date
);
alter table public.odi_deals enable row level security;
alter table public.odi_monthly enable row level security;
create policy "public read odi_deals" on public.odi_deals for select using (true);
create policy "public read odi_monthly" on public.odi_monthly for select using (true);
revoke insert, update, delete, truncate on public.odi_deals, public.odi_monthly from anon, authenticated;
create index if not exists odi_deals_country on public.odi_deals (country, month);
create index if not exists odi_deals_total on public.odi_deals (month, total desc);

-- New story category "outbound": an Indian company investing abroad. Added to the stories view's and the
-- review functions' lists of in-scope event types (applied with a replace over their current definitions).

-- Daily check for a new RBI release (06:30 UTC); a rerun of a month already loaded just replaces it.
-- Created paused, like the other jobs at the time.
-- select cron.schedule('odi-monthly', '30 6 * * *', $$select net.http_post('https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/odi', headers:=jsonb_build_object('x-ingest-key',(select value from public.app_secrets where name='ingest_key'),'content-type','application/json'), body:='{}'::jsonb, timeout_milliseconds:=300000)$$);
