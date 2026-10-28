-- Public readers get SELECT only; the pages never write to these tables.
revoke all on table shareholdings, shp_filings, investor_profiles, holder_registry from anon, authenticated;
grant select on table shareholdings, investor_profiles, holder_registry to anon, authenticated;
alter view holder_registry set (security_invoker = true);
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;

alter function norm_name(text) set search_path = public;
alter function private_deal_investors(int) set search_path = public;
revoke execute on function private_deal_investors(int) from public, anon, authenticated;

-- Visit counts (last 24 hours and all time). A flood of made-up visitor ids cannot grow the table without
-- limit: at most 120 new rows a minute.
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
revoke execute on function public.record_visit(text) from public, authenticated;
grant execute on function public.record_visit(text) to anon;
