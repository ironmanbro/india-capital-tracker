-- Already applied to the live project. Facts the owner enters by hand for an investor profile: everyone can read them,
-- only the owner (is_admin) can write. not_applicable lists meter items that do not apply, so they count as complete.
create table if not exists public.investor_facts (
  holder_key text primary key check (char_length(holder_key) between 1 and 200),
  fund_size_usd_m numeric check (fund_size_usd_m >= 0),
  key_people text check (char_length(key_people) <= 1000),
  website text check (char_length(website) <= 300 and website ~* '^https?://'),
  background text check (char_length(background) <= 2000),
  not_applicable text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.investor_facts enable row level security;
create policy "read facts" on public.investor_facts for select to anon, authenticated using (true);
create policy "owner inserts facts" on public.investor_facts for insert to authenticated with check (public.is_admin());
create policy "owner updates facts" on public.investor_facts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "owner deletes facts" on public.investor_facts for delete to authenticated using (public.is_admin());
revoke all on public.investor_facts from anon, authenticated;
grant select on public.investor_facts to anon, authenticated;
grant insert, update, delete on public.investor_facts to authenticated;
