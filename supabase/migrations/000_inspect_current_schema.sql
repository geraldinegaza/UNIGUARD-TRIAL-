-- ============================================================================
--  UniGuard · 000 · Inspect the current schema  (READ ONLY)
--
--  Run this first in the Supabase SQL editor and compare the output with the
--  assumptions listed in README.md. Nothing here writes anything.
-- ============================================================================

-- 1. which of the expected tables already exist
select t.table_name,
       (select count(*) from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t.table_name) as column_count
  from (values ('profiles'),('reports'),('barangays'),('advisories'),
               ('emergency_hotlines'),('evacuation_centers'),
               ('report_corroborations'),('report_status_history'),
               ('notifications'),('push_subscriptions'),('audit_log'))
       as t(table_name)
  left join information_schema.tables it
         on it.table_schema = 'public' and it.table_name = t.table_name
 order by t.table_name;

-- 2. full column inventory for the core tables
select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('profiles','reports','barangays','advisories',
                      'emergency_hotlines','evacuation_centers')
 order by table_name, ordinal_position;

-- 3. constraints and check definitions
select rel.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
 where ns.nspname = 'public'
 order by rel.relname, con.conname;

-- 4. is row level security already on, and which policies exist
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       coalesce(p.polname, '(none)') as policy,
       coalesce(pg_get_expr(p.polqual, p.polrelid), '') as using_expr
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname, p.polname;

-- 5. functions and triggers already present
select n.nspname as schema, p.proname as function_name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 order by p.proname;

select event_object_table as table_name, trigger_name, action_timing, event_manipulation
  from information_schema.triggers
 where trigger_schema in ('public','auth')
 order by event_object_table, trigger_name;

-- 6. storage buckets
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by name;
