-- Output of pipeline/nse_master.py: filing manifest, named holders (>=1%) per filing, and period-over-period
-- changes. Loaded by pipeline/load_supabase.py with the service-role key; the site only reads.
create table if not exists public.nse_filings (
  url text primary key,
  segment text, symbol text, isin text, company_name text,
  reporting_period text, filing_date text, doc_id text,
  retrieved_at timestamptz, http_status int, download_status text,
  file_type text, size bigint, sha256 text, error text,
  parser_status text, parsed_records int, parser_version text,
  loaded_at timestamptz not null default now()
);
create table if not exists public.nse_holdings (
  id bigint generated always as identity primary key,
  exchange text not null default 'NSE',
  symbol text not null, company_name text,
  reporting_period date not null, filing_date text,
  investor_category text, investor_name text not null,
  shares_held numeric, percentage_held numeric not null check (percentage_held >= 0 and percentage_held <= 100),
  foreign_flag boolean not null default false,   -- heuristic from the parser, not a confirmed foreign investor
  source_url text not null, source_document_hash text not null, parser_version text,
  loaded_at timestamptz not null default now(),
  unique (symbol, reporting_period, investor_name, source_document_hash)
);
create index if not exists nse_holdings_symbol_idx on public.nse_holdings (symbol, reporting_period desc);
create table if not exists public.nse_ownership_changes (
  id bigint generated always as identity primary key,
  symbol text not null, holder text not null, category text, foreign_flag boolean not null default false,
  previous_period date not null, latest_period date not null,
  previous_pct numeric, latest_pct numeric, previous_shares numeric, latest_shares numeric,
  pct_point_change numeric, shares_change numeric,
  status text not null check (status in ('comparable', 'entered_list', 'left_list')),
  loaded_at timestamptz not null default now(),
  unique (symbol, holder, previous_period, latest_period)
);
alter table public.nse_filings enable row level security;
alter table public.nse_holdings enable row level security;
alter table public.nse_ownership_changes enable row level security;
create policy "nse_filings are public" on public.nse_filings for select using (true);
create policy "nse_holdings are public" on public.nse_holdings for select using (true);
create policy "nse_changes are public" on public.nse_ownership_changes for select using (true);
revoke all on table nse_filings, nse_holdings, nse_ownership_changes from anon, authenticated;
grant select on table nse_filings, nse_holdings, nse_ownership_changes to anon, authenticated;
