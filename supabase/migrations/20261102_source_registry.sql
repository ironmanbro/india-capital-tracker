-- Sources from the Source Registry workbook, with the result of testing each one.
create table if not exists source_registry (
  id text primary key, category text, name text, url text not null, format text, priority text,
  verdict text, http_status int, content_type text, feed_url text, feed_items int, robots text, note text,
  collected int not null default 0, tested_at timestamptz, collected_at timestamptz
);
alter table source_registry enable row level security;
create policy source_registry_read on source_registry for select using (true);
revoke all on source_registry from anon, authenticated;
grant select on source_registry to anon, authenticated;
create or replace function public.registry_bump(p_id text, p_n int) returns void language sql security invoker set search_path = public as $$
  update source_registry set collected = collected + p_n, collected_at = now() where id = p_id $$;
revoke execute on function public.registry_bump(text, int) from public, anon, authenticated;
grant execute on function public.registry_bump(text, int) to service_role;
