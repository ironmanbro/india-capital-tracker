-- Names compared without punctuation, case or legal words ("Ltd", "Fund", "PCC" ...).
create or replace function norm_name(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(regexp_replace(t,'[^a-zA-Z0-9]+',' ','g')),
    '\m(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\M',' ','g'),'\s+',' ','g')) $$;

-- Each holder named in a shareholding filing that is also on the SEBI/NSDL FPI register.
create or replace view holder_registry as
select distinct on (h.holder) h.holder, r.name as registry_name, r.country, r.category, r.sub_category, r.reg_no, r.reg_year, r.valid_upto, r.status
from (select distinct holder from shareholdings) h
join fpi_registry r on norm_name(r.name) = norm_name(h.holder) and norm_name(h.holder) <> ''
order by h.holder, r.reg_year nulls last;
grant select on holder_registry to anon, authenticated;

-- Facts from Wikidata / Wikipedia for the best-known holders, each with its source link.
create table if not exists investor_profiles (
  holder text primary key,
  wikidata_id text, label text, description text, country text, headquarters text, inception date,
  parent text, owner text, website text, summary text, wikipedia_url text,
  checked_at timestamptz not null default now()
);
alter table investor_profiles enable row level security;
create policy investor_profiles_read on investor_profiles for select using (true);
