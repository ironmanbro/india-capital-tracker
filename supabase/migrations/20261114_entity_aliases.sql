-- NOT YET APPLIED to the live project. Review, then run in the Supabase SQL editor.
--
-- Which names are the same investor, or its funds and vehicles. Only the owner's DECISIONS are stored here;
-- proposals stay in pipeline/aliases/candidates.json until the owner confirms them in the review queue.
-- Names are compared with norm_name() (already in the project), so every alias also matches its spelling variants.
--
-- Reading: everyone sees confirmed aliases. Writing: only the owner (is_admin), as for investor_facts.

create table if not exists public.entity_group (
  id bigint generated always as identity primary key,
  canonical text not null check (char_length(canonical) between 1 and 200),
  kind text not null default 'investor' check (kind in ('investor', 'company')),
  note text check (char_length(note) <= 500),
  decided_at timestamptz not null default now(),
  unique (kind, canonical)
);

create table if not exists public.entity_alias (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.entity_group(id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 300),
  alias_key text not null check (alias_key <> ''),           -- norm_name(alias); one alias belongs to one group
  relation text not null check (relation in ('same', 'fund_of', 'vehicle_of', 'related')),
  status text not null default 'confirmed' check (status in ('confirmed', 'rejected')),  -- rejected = do not propose again
  rule text check (char_length(rule) <= 200),                 -- how it was proposed, for the audit trail
  decided_at timestamptz not null default now(),
  unique (alias_key)
);
create index if not exists entity_alias_group on public.entity_alias (group_id);

alter table public.entity_group enable row level security;
alter table public.entity_alias enable row level security;
-- a group is visible only once it has a confirmed alias, so rejected proposals are never published
drop policy if exists "read groups" on public.entity_group;
create policy "read groups" on public.entity_group for select to anon, authenticated
  using (public.is_admin() or exists (select 1 from public.entity_alias a where a.group_id = entity_group.id and a.status = 'confirmed'));
drop policy if exists "read confirmed aliases" on public.entity_alias;
create policy "read confirmed aliases" on public.entity_alias for select to anon, authenticated using (status = 'confirmed' or public.is_admin());
drop policy if exists "owner writes groups" on public.entity_group;
create policy "owner writes groups" on public.entity_group for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "owner writes aliases" on public.entity_alias;
create policy "owner writes aliases" on public.entity_alias for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.entity_group, public.entity_alias from anon, authenticated;
grant select on public.entity_group, public.entity_alias to anon, authenticated;
grant insert, update, delete on public.entity_group, public.entity_alias to authenticated;

-- The group a name belongs to, if the owner has confirmed one. Used to join stories, filings and the register.
create or replace function public.entity_of(p_name text) returns table (group_id bigint, canonical text, relation text)
language sql stable set search_path = public as $$
  select g.id, g.canonical, a.relation
  from entity_alias a join entity_group g on g.id = a.group_id
  where a.status = 'confirmed' and a.alias_key = norm_name(p_name) and norm_name(p_name) <> ''
$$;
grant execute on function public.entity_of(text) to anon, authenticated;
