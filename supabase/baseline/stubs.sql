-- Minimal stand-ins for Supabase-managed schemas/roles so the baseline can be built in plain Postgres (CI and local checks only).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz, last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create schema net; create function net.http_post(url text default null, body jsonb default null, headers jsonb default null, timeout_milliseconds int default null) returns bigint language sql as $$ select 1::bigint $$;
create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
