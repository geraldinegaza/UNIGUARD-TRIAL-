-- ============================================================================
--  UniGuard · 024 · Dispatch Team role
--
--  Additive and re-runnable. Adds the 'dispatch_team' account role and gives it
--  read access to what the dispatch console shows: every report, every SOS
--  call, the responder roster and current assignments. Existing policies are
--  left as they are; these are extra policies that only match dispatch accounts.
--  Writing (assigning units, changing status) comes in a later step.
-- ============================================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('citizen', 'barangay_official', 'lgu_ldrrmc', 'dispatch_team'));

create or replace function public.is_dispatch()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'dispatch_team';
$$;

drop policy if exists reports_read_dispatch on public.reports;
create policy reports_read_dispatch on public.reports
  for select to authenticated using (public.is_dispatch());

drop policy if exists sos_log_read_dispatch on public.sos_log;
create policy sos_log_read_dispatch on public.sos_log
  for select to authenticated using (public.is_dispatch());

drop policy if exists responders_read_dispatch on public.responders;
create policy responders_read_dispatch on public.responders
  for select to authenticated using (public.is_dispatch());

drop policy if exists assignments_read_dispatch on public.report_assignments;
create policy assignments_read_dispatch on public.report_assignments
  for select to authenticated using (public.is_dispatch());
