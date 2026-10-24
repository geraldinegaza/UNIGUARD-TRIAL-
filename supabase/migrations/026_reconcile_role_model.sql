-- ============================================================================
--  UniGuard · 026 · Reconcile roles with the upstream schema (run before 122)
--
--  Migrations 122-148 are the upstream UniGuard schema (folder migrations
--  022-048, renumbered +100 so they sort after this project's own 001-025).
--  Upstream models the Super Admin as a FLAG on an LGU account
--  (profiles.is_super_admin, migration 143), not as a role key, so the ~60
--  policies that check lgu_ldrrmc keep working. Migration 025 in this project
--  had added a separate 'super_admin' role; this file folds it into the
--  upstream model before 138 narrows the role list again:
--
--    · accounts with role 'super_admin' become lgu_ldrrmc + is_super_admin
--    · the role list goes back to the four upstream keys
--    · the broad read policies from 024 / 025 are removed; 138 / 143 install
--      the upstream, properly scoped ones (a dispatch account reads only what
--      is addressed to its unit)
--    · the auto-verify trigger from this project's 023 is retired; upstream
--      122 / 125 install the evaluator that replaces it
--
--  Additive where possible, idempotent, safe to re-run.
-- ============================================================================
alter table public.profiles add column if not exists is_super_admin boolean not null default false;

-- fold the role into the flag (the guard trigger is bypassed for this one
-- statement because the SQL editor carries no auth.uid())
update public.profiles
   set role = 'lgu_ldrrmc', is_super_admin = true
 where role = 'super_admin';

-- upstream (138) requires every dispatch_team account to belong to a dispatch
-- unit, and units only exist from 138 on. Accounts given the role by 024 have
-- no unit, so they return to citizen here (logged below) and are re-invited
-- into a real unit from the Dispatch Units screen afterwards.
insert into public.audit_log (actor_id, action, entity, entity_id, meta)
select null, 'profile.dispatch_role_reset', 'profiles', p.id,
       jsonb_build_object('reason', 'dispatch_team without a unit before migration 138', 'email', p.email)
  from public.profiles p
 where p.role = 'dispatch_team'
   and not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'profiles' and column_name = 'dispatch_unit_id');
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'dispatch_unit_id') then
    update public.profiles set role = 'citizen' where role = 'dispatch_team';
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('citizen', 'barangay_official', 'lgu_ldrrmc', 'dispatch_team'));

-- broad read policies from 024 / 025 (upstream installs scoped ones)
drop policy if exists reports_read_dispatch       on public.reports;
drop policy if exists sos_log_read_dispatch       on public.sos_log;
drop policy if exists responders_read_dispatch    on public.responders;
drop policy if exists assignments_read_dispatch   on public.report_assignments;
drop policy if exists profiles_read_super_admin   on public.profiles;
drop policy if exists reports_read_super_admin    on public.reports;
drop policy if exists sos_log_read_super_admin    on public.sos_log;
drop policy if exists responders_read_super_admin on public.responders;
drop policy if exists assignments_read_super_admin on public.report_assignments;
drop policy if exists audit_read_super_admin      on public.audit_log;

-- this project's 023 trigger; 122 installs reports_verify with the same job
drop trigger if exists reports_auto_verify on public.reports;
