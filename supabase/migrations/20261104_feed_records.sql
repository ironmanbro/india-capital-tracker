-- Raw JSON from the pipeline/collectors scripts. One row per (dataset, key); snapshots overwrite, time series keep the date in the key.
create table if not exists public.feed_records (
  dataset text not null, key text not null, as_of text, data jsonb not null, loaded_at timestamptz not null default now(),
  primary key (dataset, key)
);
create index if not exists feed_records_asof_idx on public.feed_records (dataset, as_of);
alter table public.feed_records enable row level security;
create policy "feed_records are public" on public.feed_records for select using (true);
revoke all on table feed_records from anon, authenticated;
grant select on table feed_records to anon, authenticated;
