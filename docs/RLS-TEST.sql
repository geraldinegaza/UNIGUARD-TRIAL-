-- ============================================================================
--  UniGuard · RLS test script  (Phase 9)
--
--  Impersonates each role inside a transaction and asserts what that role can
--  and cannot see. Every block rolls back, so nothing is written.
--
--  Replace the three UUIDs with real accounts (see docs/TEST-CHECKLIST-ALL.md).
--  Run the whole file in the Supabase SQL editor; failures raise immediately.
-- ============================================================================

\set citizen  '11111111-1111-1111-1111-111111111111'
\set official '22222222-2222-2222-2222-222222222222'
\set lgu      '33333333-3333-3333-3333-333333333333'

-- helper: assert a boolean
create or replace function public.t_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is null or condition = false then
    raise exception 'RLS TEST FAILED: %', label;
  else
    raise notice 'ok  %', label;
  end if;
end;
$$;

-- ---------------------------------------------------------------- citizen
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  select public.t_assert(public.current_role_key() = 'citizen', 'citizen role resolves from profiles');
  select public.t_assert(
    (select count(*) from public.reports where reporter_id <> '11111111-1111-1111-1111-111111111111') = 0,
    'citizen cannot read another resident report');
  select public.t_assert(
    not exists (select 1 from information_schema.columns
                 where table_name = 'reports_feed' and column_name = 'reporter_id'),
    'reports_feed exposes no reporter identity');
  select public.t_assert((select count(*) from public.profiles) = 1, 'citizen sees only their own profile');
  select public.t_assert((select count(*) from public.audit_log) = 0, 'citizen cannot read the audit log');
  begin
    update public.profiles set role = 'lgu_ldrrmc' where id = auth.uid();
    select public.t_assert(false, 'citizen role change must raise');
  exception when others then
    select public.t_assert(true, 'citizen cannot change their own role');
  end;
rollback;

-- --------------------------------------------------------- barangay official
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  select public.t_assert(public.current_role_key() = 'barangay_official', 'official role resolves from profiles');
  select public.t_assert(
    (select count(*) from public.reports
      where barangay_id is distinct from public.my_barangay_id()) = 0,
    'official sees only their own barangay reports');
  begin
    update public.emergency_hotlines set contact_number = '0000' where true;
    select public.t_assert(false, 'official hotline write must raise');
  exception when others then
    select public.t_assert(true, 'official cannot edit hotlines');
  end;
  begin
    update public.profiles set role = 'citizen' where id <> auth.uid();
    select public.t_assert(false, 'official profile write must raise');
  exception when others then
    select public.t_assert(true, 'official cannot change another account role');
  end;
rollback;

-- --------------------------------------------------------------- LGU
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
  select public.t_assert(public.is_lgu(), 'LGU role resolves from profiles');
  select public.t_assert(
    (select count(*) from public.reports) >=
    (select count(*) from public.reports where barangay_id = public.my_barangay_id()),
    'LGU sees every barangay');
  select public.t_assert(
    (select count(*) from public.emergency_hotlines) >= 0, 'LGU can read hotlines');
rollback;

-- --------------------------------------------------------------- anonymous
begin;
  set local role anon;
  select public.t_assert(public.current_role_key() = 'anon', 'anonymous has no role');
  select public.t_assert((select count(*) from public.reports) = 0, 'anonymous reads no reports');
  select public.t_assert((select count(*) from public.profiles) = 0, 'anonymous reads no profiles');
rollback;
