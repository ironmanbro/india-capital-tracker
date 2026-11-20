-- Baseline snapshot of production views, functions and triggers. Reference only; see README.md.
-- NOTE: `stories` and `directory_stats` are SECURITY DEFINER (no security_invoker) ON PURPOSE: anon has no grant on `events`,
-- and `stories` is the only public window onto reviewed events. Keep that design, but test it (Milestone 1 CI check).

-- ===== Functions (order: helpers first) =====
create or replace function public.norm_name(t text) returns text language sql immutable set search_path to 'public' as $function$
  select btrim(regexp_replace(regexp_replace(lower(regexp_replace(t,'[^a-zA-Z0-9]+',' ','g')),
    '\m(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\M',' ','g'),'\s+',' ','g')) $function$;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from public.app_admins where user_id = auth.uid()) $function$;

create or replace function public.source_rank(n text) returns integer language sql immutable set search_path to 'public' as $function$
  select case
    when n is null then 2
    when n ~* '^(reuters|bloomberg|the economic times|economic times|business standard|livemint|mint|moneycontrol|wsj|the wall street journal|financial times|nikkei asia|the financial express|businessline|the hindu businessline|cnbc tv18|cnbc-tv18|cnbc|ndtv profit|vccircle|dealstreetasia|entrackr|inc42|the hindu|business today|fortune india|forbes|forbes india|the times of india|the indian express|hindustan times|et now|bw businessworld|the ken|the arc|mergermarket|private equity international|pei private equity)'
      or n ~* '^et [a-z]' or n ~* 'economictimes' then 1
    when n ~* '(scanx|upstox|tradingview|yahoo finance|hdfc sky|^sahi$|univest|linkedin|instagram|facebook|twitter|^x$|youtube|kalkine|trade brains|niftytrader|alice blue|biggo|traders union|lavx|briefs finance|tracxn|dealroom|equitybulls|rediff|inventiva|siliconindia|indian startup news|prop news time|press insider|investing\.com|motley fool|stocktwits|groww|angel one|5paisa|^https?://)' then 3
    else 2 end
$function$;

create or replace function public.guess_flow(t text, src text) returns text language sql immutable set search_path to 'public' as $function$
  select case
    when src like 'nse%' then 'capital'
    when t ~* '(stake|acquir|buys|bought|shares|IPO|anchor|fund\M|funds\M|block deal|bulk deal|QIP|equity|buyout|portfolio|series [a-f]\M|round|valuation|merger|takeover|holding)' then 'capital'
    when t ~* '(set up|sets up|setting up|plant|factory|facility|facilities|manufactur|unit in|campus|office|centre in|center in|hub\M|footprint|presence|operations|expansion|expand|data cent|capacity|shuts?\M|shut down|exits india|exit india|leaves india|winds? down|stores?\M|outlets?|R&D|GCC|capability cent|production|build)' then 'presence'
    else 'capital' end
$function$;

create or replace function public.guess_stage(t text, src text) returns text language sql immutable set search_path to 'public' as $function$
  select case
    when src like 'nse%' then 'completed'
    when t ~* '\m(in talks|talks with|talks to|eyes|eyeing|mulls|weighs|considers|considering|explores|exploring|in race|race to|frontrunner|front-runner|bids? for|shortlists?|picks? advis|said to|likely to|may |could |seeks|sale process|looking to|in advanced talks|scouting)' then 'talks'
    when t ~* '\m(plans?|planning|will invest|to invest|commits?|committed|pledges?|proposes?|proposed|aims to|targets|set to invest|outlay|over \d+ years|by 20\d\d|announces? .*invest|lines? up|earmarks?)\M' then 'plan'
    when t ~* '\m(to acquire|to buy|to sell|agrees?|signs?|inks|deal to|approves?|approval|clears|cleared|nod|definitive|to pick up|to take .*stake|wins? .*bid)\M' then 'agreed'
    when t ~* '\m(acquires|acquired|buys|bought|sells|sold|completes?|completed|closes|closed|invests|invested|raises|raised|picks up|exits|exited|offloads|offloaded|divests|block deal|bulk deal|anchor|bags|leads|participates|secures|first close|final close|crosses|launches|launched|introduces|shifts|moved|relocates|redomicil)' then 'completed'
    else 'agreed' end
$function$;

create or replace function public.fill_stage_flow() returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.deal_stage is null then new.deal_stage := public.guess_stage(new.title, new.source); end if;
  if new.flow_kind is null then new.flow_kind := public.guess_flow(new.title, new.source); end if;
  return new;
end $function$;

create or replace function public.mark_exchange_deal_duplicate() returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
begin
  if new.duplicate_of is null and new.source in ('nse_bulk','nse_block','bse_bulk','bse_block') then
    select id into new.duplicate_of from events
    where duplicate_of is null and source in ('nse_bulk','nse_block','bse_bulk','bse_block') and left(source, 3) = left(new.source, 3)
      and published_at::date = new.published_at::date and investor is not distinct from new.investor and target is not distinct from new.target
      and amount_text is not distinct from new.amount_text and event_type = new.event_type
    order by id limit 1;
  end if;
  return new;
end $function$;

create or replace function public.entity_of(p_name text, p_kind text default 'investor')
 returns table(group_id bigint, canonical text, relation text, symbol text, isin text) language sql stable set search_path to 'public' as $function$
  select g.id, g.canonical, a.relation, g.symbol, g.isin
  from entity_alias a join entity_group g on g.id = a.group_id
  where a.status = 'confirmed' and a.kind = p_kind and a.alias_key = norm_name(p_name) and norm_name(p_name) <> ''
$function$;

create or replace function public.private_deal_investors(n integer default 120) returns table(name text) language sql stable set search_path to 'public' as $function$
  select investor from events
  where investor is not null and investor_type in ('pe_vc','sovereign','family_office','asset_manager','hedge_fund','pension')
  group by investor order by count(*) desc, investor limit n
$function$;

create or replace function public.registry_bump(p_id text, p_n integer) returns void language sql set search_path to 'public' as $function$
  update source_registry set collected = collected + p_n, collected_at = now() where id = p_id $function$;

create or replace function public.purge_old_activity() returns void language sql security definer set search_path to 'public' as $function$
  delete from public.user_activity where at < now() - interval '12 months' $function$;

create or replace function public.record_visit(p_visitor text) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v text := left(coalesce(nullif(p_visitor, ''), 'unknown'), 64);
begin
  if not exists (select 1 from site_visits where visitor = v and at > now() - interval '1 minute')
     and (select count(*) from site_visits where at > now() - interval '1 minute') < 120 then
    insert into site_visits (visitor) values (v);
  end if;
  return (select jsonb_build_object(
    'visitors', count(distinct visitor) filter (where at >= now() - interval '24 hours'),
    'page_views', count(*) filter (where at >= now() - interval '24 hours'),
    'total_visitors', count(distinct visitor), 'total_views', count(*), 'since', min(at))
    from site_visits);
end $function$;

create or replace function public.set_event_status(p_id bigint, p_status text, p_notes text, p_key text) returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_key is distinct from (select value from app_secrets where name = 'edit_key') then
    raise exception 'invalid edit key';
  end if;
  if p_status not in ('new','target','contacted','ignored') then
    raise exception 'invalid status';
  end if;
  update events set status = p_status, notes = coalesce(p_notes, notes) where id = p_id;
end $function$;

create or replace function public.activity_summary(days integer default 30) returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $function$
declare since timestamptz := now() - make_interval(days => greatest(1, least(days, 365)));
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users_total', (select count(*) from auth.users),
    'users_active', (select count(distinct user_id) from public.user_activity where at >= since),
    'events', (select count(*) from public.user_activity where at >= since),
    'per_page', coalesce((select jsonb_agg(x) from (select page, count(*) n from public.user_activity where kind = 'view' and at >= since group by page order by n desc) x), '[]'),
    'per_day', coalesce((select jsonb_agg(x order by x.day) from (select to_char(date_trunc('day', at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as day, count(*) n from public.user_activity where at >= since group by 1) x), '[]'),
    'top_open', coalesce((select jsonb_agg(x) from (select detail, count(*) n from public.user_activity where kind in ('open') and detail is not null and at >= since group by detail order by n desc limit 15) x), '[]'),
    'top_search', coalesce((select jsonb_agg(x) from (select lower(detail) as detail, count(*) n from public.user_activity where kind = 'search' and detail is not null and at >= since group by 1 order by n desc limit 15) x), '[]'),
    'devices', coalesce((select jsonb_agg(x) from (select coalesce(device, 'unknown') device, count(*) n from public.user_activity where at >= since group by 1 order by n desc) x), '[]')
  );
end $function$;

create or replace function public.activity_timeline(uid uuid, lim integer default 200) returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $function$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x) from (select at, kind, page, detail, device from public.user_activity where user_id = uid order by at desc limit greatest(1, least(lim, 1000))) x), '[]');
end $function$;

create or replace function public.activity_users() returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $function$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.last_seen desc nulls last) from (
    select u.id, u.email, u.raw_user_meta_data ->> 'name' as name, u.created_at, u.last_sign_in_at,
           (select count(*) from public.user_activity a where a.user_id = u.id) as events,
           (select max(at) from public.user_activity a where a.user_id = u.id) as last_seen
    from auth.users u) x), '[]');
end $function$;

create or replace function public._probe(body jsonb) returns bigint language sql as $function$
  select net.http_post(url:='https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/desk-probe', body:=body, headers:=jsonb_build_object('x-ingest-key',(select value from app_secrets where name='ingest_key'),'content-type','application/json'), timeout_milliseconds:=180000) $function$;
-- ADVISOR: _probe has a mutable search_path (set search_path to 'public' when promoting). Consider dropping it with desk-probe.

create or replace function public.apply_review_stage(p_items jsonb) returns void language sql set search_path to 'public' as $function$
  update public.events e set
    deal_stage = coalesce(nullif(it->>'deal_stage', ''), e.deal_stage),
    flow_kind = coalesce(nullif(it->>'flow_kind', ''), e.flow_kind)
  from jsonb_array_elements(p_items) it
  where e.id = (it->>'id')::bigint
    and coalesce(it->>'deal_stage', '') in ('', 'plan', 'talks', 'agreed', 'completed')
    and coalesce(it->>'flow_kind', '') in ('', 'capital', 'presence');
$function$;

create or replace function public.apply_review(p_items jsonb) returns jsonb language plpgsql set search_path to 'public' as $function$
declare
  it jsonb; v_id bigint; v_types text[]; v_type text; v_root bigint; v_rel boolean;
  n_kept int := 0; n_dropped int := 0; n_dup int := 0;
  v_started timestamptz := clock_timestamp();
begin
  for it in select * from jsonb_array_elements(p_items) loop
    v_id := (it->>'id')::bigint;
    v_rel := coalesce((it->>'relevant')::boolean, false);
    select array_agg(distinct t order by t) into v_types
      from jsonb_array_elements_text(coalesce(it->'event_types', jsonb_build_array(it->>'event_type'))) t
      where t in ('entry','exit','fund_launch','relocation','outbound','regulation');
    if not v_rel then v_types := null; end if;
    -- The primary category is the strongest lead among them.
    v_type := case when v_types is null then 'irrelevant'
                   when 'regulation' = any(v_types) then 'regulation'
                   when 'relocation' = any(v_types) then 'relocation'
                   when 'fund_launch' = any(v_types) then 'fund_launch'
                   when 'entry' = any(v_types) then 'entry'
                   when 'exit' = any(v_types) then 'exit' else 'outbound' end;
    v_root := null;
    if v_type <> 'irrelevant' and nullif(it->>'same_as', '') is not null then
      select coalesce(duplicate_of, id) into v_root from events
        where id = (it->>'same_as')::bigint and id <> v_id;
    end if;

    update events set
      event_type = v_type,
      event_types = v_types,
      parties = case when v_type in ('irrelevant','regulation') then null else it->'parties' end,
      priority = case v_type when 'relocation' then 5 when 'fund_launch' then 4
                             when 'entry' then 3 when 'regulation' then 3 when 'exit' then 2 when 'outbound' then 2 else 0 end,
      investor = case when v_type in ('irrelevant','regulation') then null
                      else coalesce(nullif(it->>'investor', ''), it->'parties'->0->>'name') end,
      investor_type = nullif(it->>'investor_type', ''),
      investor_country = nullif(it->>'investor_country', ''),
      target = nullif(it->>'target', ''),
      amount_usd_m = nullif(it->>'amount_usd_m', '')::numeric,
      origin_jurisdiction = nullif(it->>'origin_jurisdiction', ''),
      summary = coalesce(nullif(it->>'summary', ''), summary),
      regulator = coalesce(nullif(it->>'regulator', ''), regulator),
      instruments = coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(it->'instruments') = 'array' then it->'instruments' else '[]' end) x
                              where x in ('FPI','FDI','FVCI','ODI','GIFT City')), instruments),
      doc_type = coalesce(nullif(it->>'doc_type', ''), doc_type),
      issued_on = coalesce(nullif(it->>'issued_on', '')::date, issued_on),
      effective_on = nullif(it->>'effective_on', '')::date,
      reg_doc_id = case when v_type = 'irrelevant' then null
                        else (select id from events where id = nullif(it->>'reg_doc_id', '')::bigint and event_type = 'regulation') end,
      classifier = 'review',
      duplicate_of = v_root,
      dedup_checked = true,
      dedup_by = 'review'
    where id = v_id and source in ('news','sebi','rbi');

    if v_root is not null then
      update events set duplicate_of = v_root where duplicate_of = v_id;
    elsif v_type = 'irrelevant' then
      update events set duplicate_of = null, dedup_checked = false where duplicate_of = v_id;
    end if;

    if v_type = 'irrelevant' then n_dropped := n_dropped + 1;
    elsif v_root is not null then n_dup := n_dup + 1;
    else n_kept := n_kept + 1; end if;
  end loop;

  perform public.apply_review_stage(p_items);
  insert into runs (source, started_at, finished_at, ok, items_found, items_new)
    values ('review', v_started, clock_timestamp(), true, jsonb_array_length(p_items), n_kept);
  return jsonb_build_object('kept', n_kept, 'duplicates', n_dup, 'dropped', n_dropped);
end $function$;

create or replace function public.review_queue(p_limit integer default 80) returns jsonb language sql stable set search_path to 'public' as $function$
  -- Fresh news first; the old-history recheck backlog only fills what is left of each batch.
  with q as (
    select * from events
    where source in ('news','sebi','rbi') and classifier = 'rules'
      and (coalesce(published_at, fetched_at) >= now() - interval '10 days' or event_type <> 'irrelevant')
  ), b as (
    select * from q
    order by (event_type = 'recheck'), (coalesce(published_at, fetched_at) < now() - interval '7 days'), coalesce(published_at, fetched_at) desc
    limit p_limit
  )
  select jsonb_build_object(
    'pending', coalesce((
      select jsonb_agg(p order by p.seen) from (
        select id, coalesce(published_at, fetched_at) as seen, title,
               nullif(trim(replace(left(coalesce(summary, ''), 300), '&nbsp;', ' ')), '') as summary,
               source_name, source, region, event_type as rules_guess
        from b) p), '[]'::jsonb),
    'pending_total', (select count(*) from q),
    -- Reviewed stories within 7 days of any item in this batch, for duplicate matching.
    'recent_stories', coalesce((
      select jsonb_agg(s order by s.seen) from (
        select e.id, coalesce(e.published_at, e.fetched_at) as seen, e.event_type, e.title
        from events e
        where e.duplicate_of is null and e.classifier <> 'rules'
          and e.event_type in ('entry','exit','fund_launch','relocation','outbound','regulation')
          and exists (select 1 from b where abs(extract(epoch from
                coalesce(e.published_at, e.fetched_at) - coalesce(b.published_at, b.fetched_at))) <= 7 * 86400)
        order by coalesce(e.published_at, e.fetched_at) desc
        limit 300) s), '[]'::jsonb)
  );
$function$;

create or replace function public.country_brief(c text) returns jsonb language sql stable security definer set search_path to 'public' as $function$
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

create or replace function public.fpi_watch() returns jsonb language sql stable security definer set search_path to 'public' as $function$
with mx as (select max(last_seen) m from fpi_registry),
r as (select name, reg_no, country, category, sub_category, status, valid_upto, registered_on, last_seen from fpi_registry)
select jsonb_build_object(
 'expiring', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valid_upto), '[]') from (select name, reg_no, country, category, sub_category, valid_upto from r where status='Registered' and valid_upto between current_date and current_date + 90) x),
 'late_fee', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valid_upto), '[]') from (select name, reg_no, country, category, sub_category, valid_upto from r where status='On Late Fee Window') x),
 'invalid', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valid_upto desc), '[]') from (select name, reg_no, country, category, sub_category, valid_upto from r where status='Invalid') x),
 'dropped', (select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen desc), '[]') from (select name, reg_no, country, category, sub_category, valid_upto, last_seen::date last_seen from r, mx where last_seen < mx.m - interval '3 days') x),
 'new', (select coalesce(jsonb_agg(to_jsonb(x) order by x.registered_on desc), '[]') from (select name, reg_no, country, category, sub_category, registered_on, valid_upto from r where registered_on >= current_date - 30) x)
) $function$;

-- ===== Triggers (on public.events) =====
create trigger events_fill_stage_flow before insert on public.events for each row execute function fill_stage_flow();
create trigger exchange_deal_duplicate before insert on public.events for each row execute function mark_exchange_deal_duplicate();

-- ===== Views =====
create or replace view public.directory_stats as
 with f as (
   select count(*)::integer as fpis,
     count(*) filter (where category = 'I')::integer as fpi_cat1,
     count(*) filter (where category = 'II')::integer as fpi_cat2,
     count(*) filter (where reg_year::numeric = extract(year from now()))::integer as fpi_this_year,
     count(*) filter (where country ilike 'INDIA IFSC%')::integer as fpi_gift,
     count(*) filter (where first_seen > greatest(now() - interval '7 days', timestamptz '2026-10-27 00:00:00+00'))::integer as fpi_new_7d,
     max(last_seen) as fpi_updated,
     count(*) filter (where registered_on > (current_date - 30))::integer as fpi_new_30d
   from fpi_registry
 ), i as (
   select count(*)::integer as ifsca,
     count(*) filter (where category = 'Fund Management')::integer as ifsca_funds,
     count(*) filter (where detail_at is not null)::integer as ifsca_detailed,
     count(*) filter (where reg_date > (current_date - 30))::integer as ifsca_new_30d,
     max(last_seen) as ifsca_updated
   from ifsca_entities
 )
 select f.fpis, f.fpi_cat1, f.fpi_cat2, f.fpi_this_year, f.fpi_gift, f.fpi_new_7d, f.fpi_updated,
        i.ifsca, i.ifsca_funds, i.ifsca_detailed, i.ifsca_new_30d, i.ifsca_updated, f.fpi_new_30d
 from f, i;

create or replace view public.entity_alias_confirmed with (security_invoker=true) as
 select a.kind, a.alias_key, a.relation, g.canonical, g.symbol, g.isin
 from entity_alias a join entity_group g on g.id = a.group_id where a.status = 'confirmed';

create or replace view public.fpi_country_counts with (security_invoker=true) as
 select country, count(*)::integer as n from fpi_registry group by country;

create or replace view public.fpi_recent with (security_invoker=true) as
 with base as (select min(first_seen) + interval '06:00:00' as after_baseline from fpi_registry)
 select r.reg_no, r.name, r.address, r.country, r.valid_upto, r.reg_year, r.first_seen,
   substring(r.reg_no from 3 for 2) as country_code,
   case when r.valid_upto is not null and (extract(year from r.valid_upto)::integer - 3) = r.reg_year then (r.valid_upto - interval '3 years')::date else null::date end as registered_on,
   r.first_seen > b.after_baseline as new_listing
 from fpi_registry r, base b
 where r.reg_year >= (extract(year from now())::integer - 1) or r.first_seen > b.after_baseline;

create or replace view public.fpi_stats with (security_invoker=true) as
 select count(*)::integer as total,
   count(*) filter (where valid_upto >= current_date)::integer as active,
   count(*) filter (where reg_year = extract(year from now())::integer)::integer as this_year,
   max(last_seen) as last_checked
 from fpi_registry;

create or replace view public.holder_registry with (security_invoker=true) as
 select distinct on (h.holder) h.holder, r.name as registry_name, r.country, r.category, r.sub_category, r.reg_no, r.reg_year, r.valid_upto, r.status
 from (select distinct holder from shareholdings) h
 join fpi_registry r on norm_name(r.name) = norm_name(h.holder) and norm_name(h.holder) <> ''
 order by h.holder, r.reg_year;

create or replace view public.ifsca_type_counts with (security_invoker=true) as
 select category, sub_category, count(*)::integer as n, count(reg_date)::integer as with_date, max(reg_date) as latest
 from ifsca_entities group by category, sub_category;

create or replace view public.investors with (security_invoker=true) as
 select min(investor) as investor, lower(investor) as investor_key, count(*) as signals, max(priority) as top_priority,
   array_agg(distinct event_type) as event_types, max(coalesce(published_at, fetched_at)) as last_seen,
   max(investor_country) as investor_country, max(investor_type) as investor_type
 from events where investor is not null and investor <> '' and status <> 'ignored' group by lower(investor);

create or replace view public.runs_latest with (security_invoker=true) as
 select distinct on (source) source, finished_at, ok from runs where ok order by source, finished_at desc;

create or replace view public.stories as
 select e.id, e.source,
   coalesce(b.source_name, e.source_name) as source_name,
   coalesce(b.url, e.url) as url,
   coalesce(b.title, e.title) as title,
   e.summary, e.published_at, e.fetched_at, e.event_type, e.investor, e.investor_type, e.investor_country,
   e.origin_jurisdiction, e.target, e.amount_usd_m, e.amount_text, e.priority, e.classifier, e.status,
   null::text as notes,
   ((select count(*) from events d where d.duplicate_of = e.id))::integer + 1 as reports,
   coalesce(e.event_types, array[e.event_type]) as event_types,
   coalesce(e.parties, case when nullif(e.investor, '') is not null then jsonb_build_array(jsonb_build_object('name', e.investor, 'role',
        case e.event_type when 'exit' then 'seller' when 'entry' then 'investor' else 'fund' end, 'type', e.investor_type)) else null::jsonb end) as parties,
   e.deal_stage, e.flow_kind, e.region, e.regulator, e.instruments, e.doc_type, e.issued_on, e.effective_on, e.reg_doc_id,
   r.url as reg_doc_url, r.title as reg_doc_title
 from events e
 left join lateral (select d.source_name, d.url, d.title from events d
    where d.duplicate_of = e.id and d.url is not null and source_rank(d.source_name) < source_rank(e.source_name)
    order by source_rank(d.source_name), d.published_at limit 1) b on true
 left join events r on r.id = e.reg_doc_id
 where e.duplicate_of is null
   and e.event_type = any (array['entry','exit','fund_launch','relocation','outbound','regulation'])
   and (e.source <> all (array['news','sebi','rbi']) or e.classifier = 'review')
   and (e.source not like 'nse%' or coalesce(e.amount_usd_m, 0) >= 2.84);

create or replace view public.story_counts with (security_invoker=true) as
 select event_type, count(*)::integer as total,
   count(*) filter (where coalesce(published_at, fetched_at) >= (now() - interval '7 days'))::integer as last_7d
 from stories where status <> 'ignored' group by event_type;

-- ===== Functions that read the `stories` view (must follow the views) =====
create or replace function public.data_coverage() returns jsonb language sql stable security definer set search_path to 'public' as $function$
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

create or replace function public.home_summary() returns jsonb language sql stable security definer set search_path to 'public' as $function$
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

