-- Named shareholders holding 1% or more of a listed company, from its quarterly shareholding-pattern filing
-- (SEBI requires these names since the June 2022 circular). The site owner adds rows through the holdings
-- function after reviewing each file; nothing is collected automatically from the exchanges.
create table if not exists public.shareholdings (
  id bigint generated always as identity primary key,
  company text not null,
  symbol text,
  period_end date not null,
  holder text not null,
  category text,
  shares numeric,
  pct numeric not null check (pct >= 0 and pct <= 100),
  source_file text,
  added_at timestamptz not null default now(),
  unique (company, period_end, holder)
);
alter table public.shareholdings enable row level security;
create policy "shareholdings are public" on public.shareholdings for select using (true);
