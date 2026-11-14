-- NOT YET APPLIED to the live project. Run AFTER 20261114_entity_aliases.sql.
--
-- Adds companies to the alias tables:
--   * a company group carries its NSE symbol and ISIN (certain identifiers, not guesses);
--   * an alias is unique per KIND, so an investor "Amazon" and a company "Amazon" can both exist;
--   * a new relation, part_of, for a unit or subsidiary named in the news ("Pricol unit");
--   * entity_of(name, kind) looks a name up for either kind.
-- Matching by symbol or ISIN is done in the tables that already hold them (shareholdings, corp_actions, deals, limits);
-- only names that have no identifier need an alias.

alter table public.entity_group
  add column if not exists symbol text check (symbol is null or char_length(symbol) between 1 and 40),
  add column if not exists isin text check (isin is null or isin ~ '^IN[A-Z0-9]{10}$');
create unique index if not exists entity_group_company_symbol on public.entity_group (symbol) where kind = 'company' and symbol is not null;
create unique index if not exists entity_group_company_isin on public.entity_group (isin) where kind = 'company' and isin is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'entity_group_id_kind' and conrelid = 'public.entity_group'::regclass) then
    alter table public.entity_group add constraint entity_group_id_kind unique (id, kind);
  end if;
end $$;

alter table public.entity_alias add column if not exists kind text not null default 'investor' check (kind in ('investor', 'company'));
-- an alias must be of the same kind as its group
alter table public.entity_alias drop constraint if exists entity_alias_group_id_fkey;
alter table public.entity_alias drop constraint if exists entity_alias_group_kind;
alter table public.entity_alias add constraint entity_alias_group_kind foreign key (group_id, kind) references public.entity_group (id, kind) on delete cascade;
-- one alias belongs to one group, within its kind
alter table public.entity_alias drop constraint if exists entity_alias_alias_key_key;
create unique index if not exists entity_alias_kind_key on public.entity_alias (kind, alias_key);
alter table public.entity_alias drop constraint if exists entity_alias_relation_check;
alter table public.entity_alias add constraint entity_alias_relation_check check (relation in ('same', 'fund_of', 'vehicle_of', 'related', 'part_of'));

drop function if exists public.entity_of(text);
create or replace function public.entity_of(p_name text, p_kind text default 'investor')
returns table (group_id bigint, canonical text, relation text, symbol text, isin text)
language sql stable set search_path = public as $$
  select g.id, g.canonical, a.relation, g.symbol, g.isin
  from entity_alias a join entity_group g on g.id = a.group_id
  where a.status = 'confirmed' and a.kind = p_kind and a.alias_key = norm_name(p_name) and norm_name(p_name) <> ''
$$;
grant execute on function public.entity_of(text, text) to anon, authenticated;

-- One flat list of the confirmed aliases, for the site to load in a few requests and resolve names in the browser
-- (mockups/v2/resolver.js). Runs as the caller, so row-level security still applies.
create or replace view public.entity_alias_confirmed with (security_invoker = true) as
select a.kind, a.alias_key, a.relation, g.canonical, g.symbol, g.isin
from public.entity_alias a join public.entity_group g on g.id = a.group_id
where a.status = 'confirmed';
grant select on public.entity_alias_confirmed to anon, authenticated;
