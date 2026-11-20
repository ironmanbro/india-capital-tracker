-- Baseline snapshot of production tables. Reference only; see README.md.
-- Identity columns are noted in comments and must be declared GENERATED ALWAYS AS IDENTITY when applying.

create table if not exists public.app_admins (
  user_id uuid not null,
  constraint app_admins_pkey primary key (user_id)
);
create table if not exists public.app_secrets (
  name text not null,
  value text not null,
  constraint app_secrets_pkey primary key (name)
);
create table if not exists public.backfill_weeks (
  start date not null,
  done boolean default false not null,
  found integer,
  inserted integer,
  ran_at timestamp with time zone,
  constraint backfill_weeks_pkey primary key (start)
);
create table if not exists public.ccil_fpi (
  day date not null,
  limits jsonb,
  securities jsonb,
  fetched_at timestamp with time zone,
  constraint ccil_fpi_pkey primary key (day)
);
create table if not exists public.corp_actions (
  symbol text not null,
  ex_date date not null,
  subject text not null,
  company text,
  isin text,
  record_date date,
  series text,
  fetched_at timestamp with time zone default now(),
  constraint corp_actions_pkey primary key (symbol, ex_date, subject)
);
create table if not exists public.directory_state (
  key text not null,
  value text,
  updated_at timestamp with time zone default now(),
  constraint directory_state_pkey primary key (key)
);
create table if not exists public.dpiit_fdi (
  kind text not null,
  name text not null,
  fy text not null,
  inr_cr numeric,
  usd_m numeric,
  edition text not null,
  source_url text,
  updated_at timestamp with time zone default now() not null,
  constraint dpiit_fdi_pkey primary key (kind, name, fy),
  constraint dpiit_fdi_kind_check check (kind = any (array['country','sector','state','annual']))
);
create table if not exists public.entity_group (
  id bigint not null, -- identity always
  canonical text not null,
  kind text default 'investor' not null,
  note text,
  decided_at timestamp with time zone default now() not null,
  symbol text,
  isin text,
  constraint entity_group_id_kind unique (id, kind),
  constraint entity_group_kind_canonical_key unique (kind, canonical),
  constraint entity_group_pkey primary key (id),
  constraint entity_group_canonical_check check (char_length(canonical) between 1 and 200),
  constraint entity_group_isin_check check (isin is null or isin ~ '^IN[A-Z0-9]{10}$'),
  constraint entity_group_kind_check check (kind = any (array['investor','company'])),
  constraint entity_group_note_check check (char_length(note) <= 500),
  constraint entity_group_symbol_check check (symbol is null or char_length(symbol) between 1 and 40)
);
create table if not exists public.entity_alias (
  id bigint not null, -- identity always
  group_id bigint not null,
  alias text not null,
  alias_key text not null,
  relation text not null,
  status text default 'confirmed' not null,
  rule text,
  decided_at timestamp with time zone default now() not null,
  kind text default 'investor' not null,
  constraint entity_alias_pkey primary key (id),
  constraint entity_alias_alias_check check (char_length(alias) between 1 and 300),
  constraint entity_alias_alias_key_check check (alias_key <> ''),
  constraint entity_alias_kind_check check (kind = any (array['investor','company'])),
  constraint entity_alias_relation_check check (relation = any (array['same','fund_of','vehicle_of','related','part_of'])),
  constraint entity_alias_rule_check check (char_length(rule) <= 200),
  constraint entity_alias_status_check check (status = any (array['confirmed','rejected']))
);
create table if not exists public.events (
  id bigint not null, -- identity always
  dedup_key text not null,
  title_key text,
  source text not null,
  source_name text,
  url text,
  title text not null,
  summary text,
  published_at timestamp with time zone,
  fetched_at timestamp with time zone default now() not null,
  event_type text default 'other' not null,
  investor text,
  investor_type text,
  investor_country text,
  origin_jurisdiction text,
  target text,
  sector text,
  amount_usd_m numeric,
  amount_text text,
  priority smallint default 0 not null,
  confidence real,
  classifier text default 'rules' not null,
  query_tag text,
  status text default 'new' not null,
  notes text,
  raw jsonb,
  duplicate_of bigint,
  dedup_checked boolean default false not null,
  dedup_by text,
  event_types text[],
  parties jsonb,
  deal_stage text,
  flow_kind text,
  llm_at timestamp with time zone,
  region text,
  regulator text,
  instruments text[],
  doc_type text,
  issued_on date,
  effective_on date,
  reg_doc_id bigint,
  constraint events_dedup_key_key unique (dedup_key),
  constraint events_pkey primary key (id),
  constraint events_deal_stage_check check (deal_stage = any (array['plan','talks','agreed','completed'])),
  constraint events_flow_kind_check check (flow_kind = any (array['capital','presence']))
);
create table if not exists public.feed_records (
  dataset text not null,
  key text not null,
  as_of text, -- MIXED FORMATS (ISO, DD-Mon-YYYY, null); see M1 data-quality notes
  data jsonb not null,
  loaded_at timestamp with time zone default now() not null,
  constraint feed_records_pkey primary key (dataset, key)
);
create table if not exists public.foreign_investment (
  period text not null,
  kind text not null,
  start_date date not null,
  code text not null,
  label text not null,
  usd_m numeric,
  provisional boolean default false not null,
  bulletin text,
  fetched_at timestamp with time zone default now() not null,
  constraint foreign_investment_pkey primary key (period, code)
);
create table if not exists public.fpi_flows (
  day date not null,
  segment text not null,
  route text not null,
  gross_buy numeric,
  gross_sell numeric,
  net_cr numeric,
  net_usd_m numeric,
  fx numeric,
  fetched_at timestamp with time zone default now() not null,
  constraint fpi_flows_pkey primary key (day, segment, route)
);
create table if not exists public.fpi_limits (
  id bigserial primary key,
  list text not null,
  as_of date,
  company text,
  isin text,
  limit_text text,
  holding_text text,
  raw jsonb
);
create table if not exists public.fpi_monthly (
  month date not null,
  segment text not null,
  net_cr numeric,
  fetched_at timestamp with time zone default now() not null,
  constraint fpi_monthly_pkey primary key (month, segment)
);
create table if not exists public.fpi_registry (
  reg_no text not null,
  name text not null,
  address text,
  country text,
  valid_upto date,
  reg_year integer,
  source text default 'cdsl' not null,
  first_seen timestamp with time zone default now() not null,
  last_seen timestamp with time zone default now() not null,
  country_code text,
  letter text,
  category text,
  sub_category text,
  status text,
  serial integer,
  -- STORED GENERATED column in production (attgenerated='s'): registration date derived from valid_upto - 3 years + 1 day when its year equals reg_year
  registered_on date generated always as (case
    when reg_year is not null and valid_upto is not null
     and extract(year from ((valid_upto - interval '3 years') + interval '1 day')) = reg_year::numeric
    then (((valid_upto - interval '3 years') + interval '1 day'))::date end) stored,
  constraint fpi_registry_pkey primary key (reg_no)
);
create table if not exists public.fx_fwd (
  day date not null,
  tenor text not null,
  premia_pct numeric,
  premia_rs numeric,
  settle date,
  constraint fx_fwd_pkey primary key (day, tenor)
);
create table if not exists public.fx_ref (
  day date not null,
  ccy text not null,
  rate numeric not null,
  constraint fx_ref_pkey primary key (day, ccy)
);
create table if not exists public.fx_reserves (
  week date not null,
  issue_date date,
  src_id bigint,
  total_cr numeric,
  total_usd_m numeric,
  wk_change_usd_m numeric,
  fca_usd_m numeric,
  gold_usd_m numeric,
  sdr_usd_m numeric,
  imf_usd_m numeric,
  constraint fx_reserves_pkey primary key (week)
);
create table if not exists public.ifsca_entities (
  enc_id text not null,
  name text not null,
  category text,
  sub_category text,
  reg_no text,
  reg_date date,
  address text,
  website text,
  first_seen timestamp with time zone default now() not null,
  last_seen timestamp with time zone default now() not null,
  detail_at timestamp with time zone,
  constraint ifsca_entities_pkey primary key (enc_id)
);
create table if not exists public.ifsca_contacts (
  enc_id text not null,
  contact_name text,
  phone text,
  email text,
  remarks text,
  updated_at timestamp with time zone default now() not null,
  constraint ifsca_contacts_pkey primary key (enc_id)
);
create table if not exists public.index_events (
  id bigserial primary key,
  day date not null,
  provider text not null,
  index_name text,
  event text not null,
  est_flow_usd_m numeric,
  url text,
  source text,
  constraint index_events_day_provider_event_key unique (day, provider, event)
);
create table if not exists public.investor_enrichment (
  holder text not null,
  wikidata_id text,
  total_assets_usd numeric,
  employees integer,
  ceo text,
  chair text,
  founders text[],
  headquarters text,
  checked_at timestamp with time zone default now() not null,
  constraint investor_enrichment_pkey primary key (holder)
);
create table if not exists public.investor_facts (
  holder_key text not null,
  fund_size_usd_m numeric,
  key_people text,
  website text,
  background text,
  not_applicable text[] default '{}' not null,
  updated_at timestamp with time zone default now() not null,
  constraint investor_facts_pkey primary key (holder_key),
  constraint investor_facts_background_check check (char_length(background) <= 2000),
  constraint investor_facts_fund_size_usd_m_check check (fund_size_usd_m >= 0),
  constraint investor_facts_holder_key_check check (char_length(holder_key) between 1 and 200),
  constraint investor_facts_key_people_check check (char_length(key_people) <= 1000),
  constraint investor_facts_website_check check (char_length(website) <= 300 and website ~* '^https?://')
);
create table if not exists public.investor_notes (
  user_id uuid default auth.uid() not null,
  holder_key text not null,
  contact_name text, contact_role text, email text, phone text,
  last_meeting date, next_step text, intro_path text, notes text,
  updated_at timestamp with time zone default now() not null,
  constraint investor_notes_pkey primary key (user_id, holder_key),
  constraint investor_notes_contact_name_check check (char_length(contact_name) <= 200),
  constraint investor_notes_contact_role_check check (char_length(contact_role) <= 200),
  constraint investor_notes_email_check check (char_length(email) <= 200),
  constraint investor_notes_holder_key_check check (char_length(holder_key) between 1 and 200),
  constraint investor_notes_intro_path_check check (char_length(intro_path) <= 1000),
  constraint investor_notes_next_step_check check (char_length(next_step) <= 1000),
  constraint investor_notes_notes_check check (char_length(notes) <= 8000),
  constraint investor_notes_phone_check check (char_length(phone) <= 60)
);
create table if not exists public.investor_profiles (
  holder text not null,
  wikidata_id text, label text, description text, country text, headquarters text,
  inception date, parent text, owner text, website text, summary text, wikipedia_url text,
  checked_at timestamp with time zone default now() not null,
  site_title text, site_description text, site_founded text, site_address text,
  site_links jsonb, site_checked_at timestamp with time zone,
  constraint investor_profiles_pkey primary key (holder)
);
create table if not exists public.issues (
  symbol text not null, company text, kind text not null, open_date date, close_date date,
  price_band text, issue_size text, status text,
  fetched_at timestamp with time zone default now(),
  constraint issues_pkey primary key (symbol, kind)
);
create table if not exists public.mkt_holidays (
  day date not null, segment text not null, description text,
  constraint mkt_holidays_pkey primary key (day, segment)
);
create table if not exists public.odi_deals (
  month date not null, sr integer not null, indian_party text,
  is_individual boolean default false not null,
  jv_name text, jv_type text, country text, activity text,
  equity numeric, loan numeric, guarantee numeric, total numeric, source_url text,
  constraint odi_deals_pkey primary key (month, sr)
);
create table if not exists public.odi_monthly (
  month date not null, equity numeric, loan numeric, guarantee numeric, total numeric,
  deals integer, source_url text, released_on date,
  constraint odi_monthly_pkey primary key (month)
);
create table if not exists public.runs (
  id bigint not null, -- identity always
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  source text not null,
  ok boolean,
  items_found integer default 0,
  items_new integer default 0, -- NOTE: several collectors write rows upserted here, not rows that are new
  error text,
  constraint runs_pkey primary key (id)
);
create table if not exists public.shareholdings (
  id bigint not null, -- identity always
  company text not null, symbol text,
  period_end date not null, -- MIXED semantics: quarter-ends and ad hoc filing dates
  holder text not null, category text, shares numeric,
  pct numeric not null,
  source_file text,
  source text default 'upload' not null,
  added_at timestamp with time zone default now() not null,
  constraint shareholdings_company_period_end_holder_key unique (company, period_end, holder),
  constraint shareholdings_pkey primary key (id),
  constraint shareholdings_pct_check check (pct >= 0 and pct <= 100)
);
create table if not exists public.shp_filings (
  link text not null, company text, xbrl text, filed_at timestamp with time zone,
  status text not null, rows integer default 0 not null,
  read_at timestamp with time zone default now() not null,
  constraint shp_filings_pkey primary key (link)
);
create table if not exists public.site_visits (
  id bigserial primary key,
  at timestamp with time zone default now() not null,
  visitor text not null
);
create table if not exists public.source_registry (
  id text not null, category text, name text, url text not null, format text, priority text,
  verdict text, http_status integer, content_type text, feed_url text, feed_items integer,
  robots text, note text, collected integer default 0 not null,
  tested_at timestamp with time zone, collected_at timestamp with time zone,
  constraint source_registry_pkey primary key (id)
);
create table if not exists public.user_activity (
  id bigint not null, -- identity always
  user_id uuid default auth.uid() not null,
  at timestamp with time zone default now() not null,
  kind text not null, page text not null, detail text, device text,
  constraint user_activity_pkey primary key (id),
  constraint user_activity_detail_check check (char_length(detail) <= 120),
  constraint user_activity_device_check check (device = any (array['phone','tablet','laptop'])),
  constraint user_activity_kind_check check (kind = any (array['view','open','search','signin'])),
  constraint user_activity_page_check check (char_length(page) <= 40)
);

-- Foreign keys
alter table events add constraint events_duplicate_of_fkey foreign key (duplicate_of) references events(id) on delete set null;
alter table ifsca_contacts add constraint ifsca_contacts_enc_id_fkey foreign key (enc_id) references ifsca_entities(enc_id) on delete cascade;
alter table user_activity add constraint user_activity_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table app_admins add constraint app_admins_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table investor_notes add constraint investor_notes_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table entity_alias add constraint entity_alias_group_kind foreign key (group_id, kind) references entity_group(id, kind) on delete cascade;

-- Indexes (non-constraint)
create index entity_alias_group on public.entity_alias using btree (group_id);
create unique index entity_alias_kind_key on public.entity_alias using btree (kind, alias_key);
create unique index entity_group_company_isin on public.entity_group using btree (isin) where kind = 'company' and isin is not null;
create unique index entity_group_company_symbol on public.entity_group using btree (symbol) where kind = 'company' and symbol is not null;
create index events_dedup_pending_idx on public.events using btree (dedup_checked) where dedup_checked = false;
create index events_duplicate_of_idx on public.events using btree (duplicate_of);
create index events_event_types_idx on public.events using gin (event_types);
create index events_investor_idx on public.events using btree (lower(investor));
create index events_llm_at_idx on public.events using btree (llm_at) where llm_at is not null;
create index events_published_idx on public.events using btree (published_at desc);
create index events_regulation on public.events using btree (issued_on desc) where event_type = 'regulation';
create index events_stories_idx on public.events using btree (published_at desc) where duplicate_of is null and event_type = any (array['entry','exit','fund_launch','relocation','outbound','regulation']);
create unique index events_title_key_uq on public.events using btree (title_key) where title_key is not null;
create index events_type_idx on public.events using btree (event_type);
create index feed_records_asof_idx on public.feed_records using btree (dataset, as_of);
create index fpi_registry_first_seen on public.fpi_registry using btree (first_seen);
create index fpi_registry_first_seen_idx on public.fpi_registry using btree (first_seen desc);
create index fpi_registry_name_idx on public.fpi_registry using btree (name);
create index fpi_registry_newest_idx on public.fpi_registry using btree (reg_year desc, serial desc);
create index fpi_registry_reg_year on public.fpi_registry using btree (reg_year);
create index fpi_registry_registered_on_idx on public.fpi_registry using btree (registered_on desc nulls last);
create index ifsca_entities_reg_date_idx on public.ifsca_entities using btree (reg_date desc nulls last);
create index odi_deals_country on public.odi_deals using btree (country, month);
create index odi_deals_total on public.odi_deals using btree (month, total desc);
create index runs_started_idx on public.runs using btree (started_at desc);
create index site_visits_at on public.site_visits using btree (at);
create index user_activity_at on public.user_activity using btree (at desc);
create index user_activity_user_at on public.user_activity using btree (user_id, at desc);
