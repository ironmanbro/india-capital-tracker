-- Link each ownership change to the two filings it compares.
alter table public.nse_ownership_changes add column if not exists previous_source_url text, add column if not exists latest_source_url text;
