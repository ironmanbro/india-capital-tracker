-- Speed: the site's first load timed out (8 s API limit) on a cold database.
-- 1. directory_stats: one pass over each table instead of ten separate scans. Same columns, same order, same values
--    (checked against the old view: identical output).
-- 2. a partial index so the stories view does not read ~13 rows to keep 1 (the newest-first scan rejected 93% of rows).
create or replace view public.directory_stats as
with f as (
  select count(*)::integer fpis,
         (count(*) filter (where category = 'I'))::integer fpi_cat1,
         (count(*) filter (where category = 'II'))::integer fpi_cat2,
         (count(*) filter (where reg_year::numeric = extract(year from now())))::integer fpi_this_year,
         (count(*) filter (where country ilike 'INDIA IFSC%'))::integer fpi_gift,
         (count(*) filter (where first_seen > greatest(now() - interval '7 days', timestamptz '2026-10-27 00:00:00+00')))::integer fpi_new_7d,
         max(last_seen) fpi_updated,
         (count(*) filter (where registered_on > current_date - 30))::integer fpi_new_30d
  from public.fpi_registry),
i as (
  select count(*)::integer ifsca,
         (count(*) filter (where category = 'Fund Management'))::integer ifsca_funds,
         (count(*) filter (where detail_at is not null))::integer ifsca_detailed,
         (count(*) filter (where reg_date > current_date - 30))::integer ifsca_new_30d,
         max(last_seen) ifsca_updated
  from public.ifsca_entities)
select f.fpis, f.fpi_cat1, f.fpi_cat2, f.fpi_this_year, f.fpi_gift, f.fpi_new_7d, f.fpi_updated,
       i.ifsca, i.ifsca_funds, i.ifsca_detailed, i.ifsca_new_30d, i.ifsca_updated, f.fpi_new_30d
from f, i;

create index if not exists events_stories_idx on public.events (published_at desc)
  where duplicate_of is null
    and event_type in ('entry','exit','fund_launch','relocation','outbound','regulation');
analyze public.events;
