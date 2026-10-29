-- What an investor says about itself on its own website (found through Wikidata's "official website").
alter table investor_profiles
  add column if not exists site_title text, add column if not exists site_description text, add column if not exists site_founded text,
  add column if not exists site_address text, add column if not exists site_links jsonb, add column if not exists site_checked_at timestamptz;
