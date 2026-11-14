-- Undoes supabase/migrations/20261114_entity_aliases.sql and 20261115_entity_companies.sql. Touches no other object.
-- Dropping the tables deletes every stored decision. Keep the JSON export from the review page first (it can rebuild them):
-- see pipeline/aliases/ROLLOUT.md, "Rollback". Run in the SQL editor.
begin;
drop view if exists public.entity_alias_confirmed;
drop function if exists public.entity_of(text, text);
drop function if exists public.entity_of(text);
-- one statement: the group's read policy refers to the alias table and the alias table refers to the group
drop table if exists public.entity_alias, public.entity_group;
commit;
