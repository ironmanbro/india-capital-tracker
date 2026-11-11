-- Market desk data: FBIL FX, NSE calendar, NSDL limit lists, RBI reserves, CCIL FPI debt, index events,
-- plus the read RPCs used by the front end. Mirrors what is deployed; safe to re-run.

create table if not exists public.fx_ref (day date not null, ccy text not null, rate numeric not null, primary key (day, ccy));
create table if not exists public.fx_fwd (day date not null, tenor text not null, premia_pct numeric, premia_rs numeric, settle date, primary key (day, tenor));
create table if not exists public.mkt_holidays (day date not null, segment text not null, description text, primary key (day, segment));
create table if not exists public.corp_actions (
  symbol text not null, ex_date date not null, subject text not null, company text, isin text,
  record_date date, series text, fetched_at timestamptz default now(), primary key (symbol, ex_date, subject));
create table if not exists public.issues (
  symbol text not null, company text, kind text not null, open_date date, close_date date, price_band text,
  issue_size text, status text, fetched_at timestamptz default now(), primary key (symbol, kind));
create table if not exists public.fpi_limits (
  id bigserial primary key, list text not null, as_of date, company text, isin text,
  limit_text text, holding_text text, raw jsonb);
create table if not exists public.fx_reserves (
  week date primary key, issue_date date, src_id bigint, total_cr numeric, total_usd_m numeric, wk_change_usd_m numeric,
  fca_usd_m numeric, gold_usd_m numeric, sdr_usd_m numeric, imf_usd_m numeric);
create table if not exists public.ccil_fpi (day date primary key, limits jsonb, securities jsonb, fetched_at timestamptz);
create table if not exists public.index_events (
  id bigserial primary key, day date not null, provider text not null, index_name text, event text not null,
  est_flow_usd_m numeric, url text, source text, unique (day, provider, event));

do $$
declare t text; p text;
begin
  for t, p in select * from (values ('fx_ref','fx_ref_read'),('fx_fwd','fx_fwd_read'),('mkt_holidays','mh_read'),('corp_actions','ca_read'),
    ('issues','is_read'),('fpi_limits','fl_read'),('fx_reserves','fr_read'),('ccil_fpi','cf_read'),('index_events','ie_read')) v loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=p) then
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)', p, t);
    end if;
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.home_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
 'fpi_by_year', (select jsonb_agg(jsonb_build_object('y', y, 'cr', cr, 'months', m) order by y) from (select extract(year from month)::int y, round(sum(net_cr)) cr, count(*) m from fpi_monthly where segment='Total' group by 1) t),
 'odi_by_year', (select jsonb_agg(jsonb_build_object('y', y, 'usd_m', u, 'months', m) order by y) from (select extract(year from month)::int y, round(sum(total)) u, count(distinct month) m from odi_deals group by 1) t),
 'odi_top_country', (select jsonb_agg(jsonb_build_object('c', country, 'usd_m', u) order by u desc) from (select country, round(sum(total)) u from odi_deals where month >= date_trunc('year', now()) and country is not null group by 1 order by 2 desc limit 5) t),
 'reg_total', (select count(*) from fpi_registry),
 'reg_by_cat', (select jsonb_object_agg(coalesce(category,'?'), n) from (select category, count(*) n from fpi_registry group by 1) t),
 'reg_by_year', (select jsonb_agg(jsonb_build_object('y', y, 'n', n) order by y) from (select extract(year from registered_on)::int y, count(*) n from fpi_registry where registered_on >= '2015-01-01' group by 1) t),
 'reg_by_country', (select jsonb_agg(jsonb_build_object('c', country, 'n', n) order by n desc) from (select country, count(*) n from fpi_registry where country is not null group by 1 order by 2 desc limit 8) t),
 'gift_total', (select count(*) from ifsca_entities),
 'gift_by_cat', (select jsonb_agg(jsonb_build_object('c', category, 'n', n) order by n desc) from (select category, count(*) n from ifsca_entities group by 1 order by 2 desc limit 8) t),
 'gift_by_year', (select jsonb_agg(jsonb_build_object('y', y, 'n', n) order by y) from (select extract(year from reg_date)::int y, count(*) n from ifsca_entities where reg_date is not null group by 1) t),
 'rules_by_year', (select jsonb_agg(jsonb_build_object('y', y, 'n', n) order by y) from (select extract(year from coalesce(issued_on, published_at))::int y, count(*) n from stories where event_type='regulation' group by 1) t)
) $function$;

CREATE OR REPLACE FUNCTION public.data_coverage()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select jsonb_agg(jsonb_build_object('k', k, 'src', src, 'a', a, 'b', b, 'n', n, 'note', note) order by ord) from (
 select 1 ord, 'Deal news' k, 'News reports, reviewed' src, min(published_at)::date::text a, max(published_at)::date::text b, count(*) n, null note from stories where source='news'
 union all select 2, 'SEBI and RBI rule changes', 'SEBI, RBI', min(coalesce(issued_on,published_at::date))::text, max(coalesce(issued_on,published_at::date))::text, count(*), null from stories where event_type='regulation'
 union all select 3, 'NSE bulk and block deals', 'NSE', min(published_at)::date::text, max(published_at)::date::text, count(*), 'NSE does not publish older history' from stories where source like 'nse%'
 union all select 4, 'FPI flows, monthly', 'NSDL', min(month)::text, max(month)::text, count(*), null from fpi_monthly where segment='Total'
 union all select 5, 'FPI flows, daily', 'NSDL', min(day)::text, max(day)::text, count(distinct day), 'NSDL publishes daily figures for recent weeks only' from fpi_flows
 union all select 6, 'Indian investment abroad', 'RBI', min(month)::text, max(month)::text, count(*), 'RBI publishes with a lag of about two months' from odi_deals
 union all select 7, 'FDI by financial year', 'DPIIT', '2000-04-01', null, count(*), 'Yearly since 2000-01, from the latest DPIIT fact sheet' from dpiit_fdi
 union all select 8, 'FPI register', 'NSDL', null, max(last_seen)::date::text, count(*), 'Current register; registration dates from 2023' from fpi_registry
 union all select 9, 'GIFT City register', 'IFSCA', min(reg_date)::text, max(reg_date)::text, count(*), null from ifsca_entities
 union all select 10, 'Shareholdings of 1% or more', 'NSE filings', min(period_end)::text, max(period_end)::text, count(*), 'Recent quarters only' from shareholdings
) t $function$;

CREATE OR REPLACE FUNCTION public.fpi_watch()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with mx as (select max(last_seen) m from fpi_registry),
r as (select name, reg_no, country, category, sub_category, status, valid_upto, registered_on, last_seen from fpi_registry)
select jsonb_build_object(
 'expiring', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valid_upto), '[]') from (select name, reg_no, country, category, sub_category, valid_upto from r where status='Registered' and valid_upto between current_date and current_date + 90) x),
 'late_fee', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valid_upto), '[]') from (select name, reg_no, country, category, sub_category, valid_upto from r where status='On Late Fee Window') x),
 'invalid', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valid_upto desc), '[]') from (select name, reg_no, country, category, sub_category, valid_upto from r where status='Invalid') x),
 'dropped', (select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen desc), '[]') from (select name, reg_no, country, category, sub_category, valid_upto, last_seen::date last_seen from r, mx where last_seen < mx.m - interval '3 days') x),
 'new', (select coalesce(jsonb_agg(to_jsonb(x) order by x.registered_on desc), '[]') from (select name, reg_no, country, category, sub_category, registered_on, valid_upto from r where registered_on >= current_date - 30) x)
) $function$;

CREATE OR REPLACE FUNCTION public.country_brief(c text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with f as (select * from fpi_registry where upper(country) = upper(c) or upper(country) = upper(case c when 'United States' then 'UNITED STATES OF AMERICA' when 'UAE' then 'UNITED ARAB EMIRATES' when 'UK' then 'UNITED KINGDOM' else c end))
select jsonb_build_object(
 'fpis', (select count(*) from f),
 'cat', (select jsonb_object_agg(coalesce(category,'?'), n) from (select category, count(*) n from f group by 1) t),
 'types', (select jsonb_agg(jsonb_build_object('t', sub_category, 'n', n) order by n desc) from (select sub_category, count(*) n from f where sub_category is not null group by 1 order by 2 desc limit 6) t),
 'new_12m', (select count(*) from f where registered_on >= current_date - 365),
 'expiring_90', (select count(*) from f where status='Registered' and valid_upto between current_date and current_date + 90),
 'odi_12m', (select round(sum(total)) from odi_deals where upper(country) = upper(case c when 'United States' then 'UNITED STATES OF AMERICA' when 'UAE' then 'UNITED ARAB EMIRATES' when 'UK' then 'UNITED KINGDOM' else c end) and month >= current_date - 365),
 'odi_top', (select jsonb_agg(jsonb_build_object('p', indian_party, 'usd_m', u) order by u desc) from (select indian_party, round(sum(total)) u from odi_deals where upper(country) = upper(case c when 'United States' then 'UNITED STATES OF AMERICA' when 'UAE' then 'UNITED ARAB EMIRATES' when 'UK' then 'UNITED KINGDOM' else c end) and month >= current_date - 365 group by 1 order by 2 desc limit 5) t)
) $function$;

grant execute on function public.home_summary(), public.data_coverage(), public.fpi_watch(), public.country_brief(text) to anon, authenticated;

-- Exploration helper that called the desk-probe function; not used by the app.
drop function if exists public._probe(jsonb);
