-- Private per-user investor notes (owner-only via RLS) and public Wikidata enrichment. Already applied to the live project.
create table if not exists public.investor_notes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  holder_key text not null check (char_length(holder_key) between 1 and 200),
  contact_name text check (char_length(contact_name) <= 200), contact_role text check (char_length(contact_role) <= 200),
  email text check (char_length(email) <= 200), phone text check (char_length(phone) <= 60),
  last_meeting date, next_step text check (char_length(next_step) <= 1000), intro_path text check (char_length(intro_path) <= 1000),
  notes text check (char_length(notes) <= 8000), updated_at timestamptz not null default now(),
  primary key (user_id, holder_key)
);
alter table public.investor_notes enable row level security;
create policy "own notes read" on public.investor_notes for select to authenticated using (user_id = auth.uid());
create policy "own notes insert" on public.investor_notes for insert to authenticated with check (user_id = auth.uid());
create policy "own notes update" on public.investor_notes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notes delete" on public.investor_notes for delete to authenticated using (user_id = auth.uid());
revoke all on public.investor_notes from anon, authenticated;
grant select, insert, update, delete on public.investor_notes to authenticated;

create table if not exists public.investor_enrichment (
  holder text primary key, wikidata_id text, total_assets_usd numeric, employees integer,
  ceo text, chair text, founders text[], headquarters text, checked_at timestamptz not null default now()
);
alter table public.investor_enrichment enable row level security;
create policy "public read enrichment" on public.investor_enrichment for select to anon, authenticated using (true);
revoke all on public.investor_enrichment from anon, authenticated;
grant select on public.investor_enrichment to anon, authenticated;
