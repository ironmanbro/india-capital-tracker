-- Read-only checks to run in the Supabase SQL editor AFTER applying the two migrations (and again after loading the exported SQL).
-- Every query only reads. The "expect" line says what a correct result looks like.

-- 1. The three objects exist; both tables have row-level security on.
-- expect: entity_alias | table | true ; entity_alias_confirmed | view | false ; entity_group | table | true
select c.relname as object, case c.relkind when 'r' then 'table' when 'v' then 'view' end as kind, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('entity_group', 'entity_alias', 'entity_alias_confirmed') order by 1;

-- 2. What the public (anon) and signed-in (authenticated) roles may do.
-- expect: anon has SELECT only, on all three. authenticated has DELETE, INSERT, SELECT, UPDATE on the two tables and SELECT on the view.
select c.relname as object, coalesce(r.rolname, 'public') as role, string_agg(a.privilege_type, ', ' order by a.privilege_type) as privileges
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public' and c.relname in ('entity_group', 'entity_alias', 'entity_alias_confirmed')
  and coalesce(r.rolname, 'public') in ('anon', 'authenticated', 'public')
group by 1, 2 order by 1, 2;

-- 3. The same question as three yes/no answers.
-- expect: false | false | false
select has_table_privilege('anon', 'public.entity_group', 'INSERT') as anon_can_insert_group,
       has_table_privilege('anon', 'public.entity_alias', 'INSERT,UPDATE,DELETE') as anon_can_change_aliases,
       has_table_privilege('anon', 'public.entity_alias_confirmed', 'INSERT,UPDATE,DELETE') as anon_can_change_view;

-- 4. Row-level security policies.
-- expect 4 rows: entity_alias "owner writes aliases" (ALL, authenticated) and "read confirmed aliases" (SELECT, anon+authenticated);
--                entity_group "owner writes groups" (ALL, authenticated) and "read groups" (SELECT, anon+authenticated)
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename like 'entity\_%' order by 1, 2;

-- 5. The new function and view run with the caller's rights, so they add no "security definer" findings.
-- expect: entity_of(text,text) | false ; entity_alias_confirmed | {security_invoker=true}
select p.oid::regprocedure::text as function, p.prosecdef as security_definer from pg_proc p where p.proname = 'entity_of';
select relname, reloptions from pg_class where relname = 'entity_alias_confirmed' and relkind = 'v';

-- 6. The names you loaded. Only meaningful after the exported SQL has run.
-- expect: confirmed and rejected counts equal the export bar on the review page (a spelling pair with the same key counts once)
select kind, status, count(*) from public.entity_alias group by 1, 2 order by 1, 2;
select kind, count(*) as groups, count(symbol) as with_symbol, count(isin) as with_isin from public.entity_group group by 1 order by 1;

-- 7. The database and the site must compute the same key for a name. Replace the sample with a name you confirmed.
-- expect: the key shown by the site (lower case, legal and fund words removed)
select public.norm_name('Goldman Sachs Bank Europe SE') as key_for_sample;
