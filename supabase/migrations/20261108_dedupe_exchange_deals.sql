-- Already applied to the live project. The same exchange deal reached `events` under different keys (live ingest and the daily
-- loader), and NSE lists some trades as both bulk and block. Repeats are marked duplicate_of the earliest row (the stories view
-- hides them and counts them as reports), once now and on every future insert.
with ranked as (
  select id, first_value(id) over (partition by left(source, 3), published_at::date, investor, target, amount_text, event_type order by id) keep
  from events where source in ('nse_bulk','nse_block','bse_bulk','bse_block') and duplicate_of is null
)
update events e set duplicate_of = r.keep from ranked r where e.id = r.id and r.keep <> r.id;

create or replace function public.mark_exchange_deal_duplicate() returns trigger language plpgsql as $$
begin
  if new.duplicate_of is null and new.source in ('nse_bulk','nse_block','bse_bulk','bse_block') then
    select id into new.duplicate_of from events
    where duplicate_of is null and source in ('nse_bulk','nse_block','bse_bulk','bse_block') and left(source, 3) = left(new.source, 3)
      and published_at::date = new.published_at::date and investor is not distinct from new.investor and target is not distinct from new.target
      and amount_text is not distinct from new.amount_text and event_type = new.event_type
    order by id limit 1;
  end if;
  return new;
end $$;
drop trigger if exists exchange_deal_duplicate on public.events;
create trigger exchange_deal_duplicate before insert on public.events for each row execute function public.mark_exchange_deal_duplicate();
