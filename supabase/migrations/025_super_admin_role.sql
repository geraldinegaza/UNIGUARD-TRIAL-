-- ============================================================================
--  UniGuard · 025 · Super Admin role
--
--  Additive and re-runnable. Adds the 'super_admin' account role and gives it
--  read access across the system for its overview console: every account,
--  every report, SOS call, responder, assignment and the audit log. Existing
--  policies are left as they are; these are extra policies that only match
--  super admin accounts. Changing roles and settings comes in a later step.
-- ============================================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('citizen', 'barangay_official', 'lgu_ldrrmc', 'dispatch_team', 'super_admin'));

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'super_admin';
$$;

drop policy if exists profiles_read_super_admin on public.profiles;
create policy profiles_read_super_admin on public.profiles
  for select to authenticated using (public.is_super_admin());

drop policy if exists reports_read_super_admin on public.reports;
create policy reports_read_super_admin on public.reports
  for select to authenticated using (public.is_super_admin());

drop policy if exists sos_log_read_super_admin on public.sos_log;
create policy sos_log_read_super_admin on public.sos_log
  for select to authenticated using (public.is_super_admin());

drop policy if exists responders_read_super_admin on public.responders;
create policy responders_read_super_admin on public.responders
  for select to authenticated using (public.is_super_admin());

drop policy if exists assignments_read_super_admin on public.report_assignments;
create policy assignments_read_super_admin on public.report_assignments
  for select to authenticated using (public.is_super_admin());

drop policy if exists audit_read_super_admin on public.audit_log;
create policy audit_read_super_admin on public.audit_log
  for select to authenticated using (public.is_super_admin());
