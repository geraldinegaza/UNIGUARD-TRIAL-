-- ============================================================================
--  UniGuard · 022 · Realtime publication
--
--  Additive and re-runnable. The app keeps every role in sync through Supabase
--  Realtime (postgres_changes). A table only emits those events when it belongs
--  to the supabase_realtime publication, which no earlier migration set up.
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'reports', 'advisories', 'notifications', 'evacuation_centers', 'emergency_hotlines',
    'relief_distributions', 'authorized_beneficiaries', 'preparedness_guides', 'faqs',
    'road_work_posts', 'road_status', 'sos_log'
  ] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = t)
       and not exists (select 1 from pg_publication_tables
                        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
