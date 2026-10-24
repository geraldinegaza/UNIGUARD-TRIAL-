-- ============================================================================
--  UniGuard · 024 · Analytics access control (security invoker + scope)
--
--  This migration was referenced by README.md and docs/DEPLOY.md but was
--  missing from the repository. It closes the hole where the analytics views
--  from migration 008 were granted to every authenticated user and therefore
--  showed everyone (including citizens) municipality-wide aggregates.
--
--  Rules enforced here (and nowhere else):
--    · LGU / LDRRMC            -> sees analytics for all barangays
--    · Barangay Official       -> sees analytics scoped to my_barangay_id()
--    · Citizen                 -> sees NO analytics rows at all
--
--  Two mechanisms, because neither is sufficient alone:
--    1. security_invoker = true  — the view runs with the CALLER's rights, so
--       RLS on the underlying tables applies. This alone is NOT enough for
--       tables whose read policy is permissive (evacuation_centers is
--       `using (true)`), which is why:
--    2. explicit scope predicates INSIDE every view body — is_lgu() or
--       barangay_id = my_barangay_id() — so a permissive read policy can never
--       widen analytics.
--
--  The old view names keep working (the console UI selects from them), and
--  each view also gains a date-ranged function twin (p_from, p_to) that the
--  analytics screen uses for its date-range filters. The functions apply the
--  same scope internally.
--
--  Additive and idempotent: views are create-or-replace, policies/grants are
--  dropped and recreated, no data is touched.
-- ============================================================================

-- --------------------------------------------------------------- scope helper
-- One predicate, reused by every view and function below. Kept in exactly one
-- place so the analytics scope rule cannot drift between objects.

drop view if exists public.analytics_by_hazard;
drop view if exists public.analytics_pipeline;
drop view if exists public.analytics_daily;
drop view if exists public.analytics_response_times;
drop view if exists public.analytics_corroboration;
drop view if exists public.analytics_shelters;
drop view if exists public.analytics_by_barangay;

create or replace function public.analytics_visible()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_lgu() or public.is_official();
$$;

-- The barangay scope predicate for analytics rows that carry barangay_id:
-- LGU sees everything; an official sees only their own barangay.
create or replace function public.analytics_row_visible(p_barangay_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_lgu()
      or (public.is_official() and p_barangay_id is not distinct from public.my_barangay_id());
$$;

-- ============================================================================
-- 1 · Incidents by hazard type (was: whole municipality, 30 fixed days)
-- ============================================================================
create or replace view public.analytics_by_hazard with (security_invoker = true) as
select r.hazard_type,
       count(*)::bigint as total,
       count(*) filter (where r.severity = 'emergency')::bigint as emergency_total
  from public.reports r
 where r.created_at >= now() - interval '30 days'
   and public.analytics_row_visible(r.barangay_id)
 group by r.hazard_type;

create or replace function public.analytics_by_hazard(p_from date, p_to date)
returns table (hazard_type text, total bigint, emergency_total bigint)
language sql stable security definer set search_path = public as $$
  select r.hazard_type,
         count(*)::bigint as total,
         count(*) filter (where r.severity = 'emergency')::bigint as emergency_total
    from public.reports r
   where r.created_at >= p_from::timestamptz
     and r.created_at <  (p_to + 1)::timestamptz
     and public.analytics_row_visible(r.barangay_id)
   group by r.hazard_type
   order by total desc;
$$;

-- ============================================================================
-- 2 · Live pipeline load
-- ============================================================================
create or replace view public.analytics_pipeline with (security_invoker = true) as
select r.status, count(*)::bigint as total
  from public.reports r
 where public.analytics_row_visible(r.barangay_id)
 group by r.status;

create or replace function public.analytics_pipeline(p_from date, p_to date)
returns table (status text, total bigint)
language sql stable security definer set search_path = public as $$
  select r.status, count(*)::bigint as total
    from public.reports r
   where r.created_at >= p_from::timestamptz
     and r.created_at <  (p_to + 1)::timestamptz
     and public.analytics_row_visible(r.barangay_id)
   group by r.status;
$$;

-- ============================================================================
-- 3 · Daily report volume for the trend chart
-- ============================================================================
create or replace view public.analytics_daily with (security_invoker = true) as
select date_trunc('day', r.created_at)::date as day,
       count(*)::bigint as total
  from public.reports r
 where r.created_at >= now() - interval '14 days'
   and public.analytics_row_visible(r.barangay_id)
 group by 1
 order by 1;

create or replace function public.analytics_daily(p_from date, p_to date)
returns table (day date, total bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('day', r.created_at)::date as day,
         count(*)::bigint as total
    from public.reports r
   where r.created_at >= p_from::timestamptz
     and r.created_at <  (p_to + 1)::timestamptz
     and public.analytics_row_visible(r.barangay_id)
   group by 1
   order by 1;
$$;

-- ============================================================================
-- 4 · Response performance (report -> dispatched, report -> resolved)
-- ============================================================================
create or replace view public.analytics_response_times with (security_invoker = true) as
select r.id,
       r.code,
       r.barangay,
       r.barangay_id,
       r.severity,
       min(h.created_at) filter (where h.to_status = 'verified')   as verified_at,
       min(h.created_at) filter (where h.to_status = 'dispatched') as dispatched_at,
       r.resolved_at,
       extract(epoch from (min(h.created_at) filter (where h.to_status = 'dispatched') - r.created_at)) as seconds_to_dispatch,
       extract(epoch from (r.resolved_at - r.created_at)) as seconds_to_resolve
  from public.reports r
  left join public.report_status_history h on h.report_id = r.id
 where public.analytics_row_visible(r.barangay_id)
 group by r.id, r.code, r.barangay, r.barangay_id, r.severity, r.created_at, r.resolved_at;

create or replace function public.analytics_response_times(p_from date, p_to date)
returns table (id uuid, code text, barangay text, severity text,
               verified_at timestamptz, dispatched_at timestamptz, resolved_at timestamptz,
               seconds_to_dispatch double precision, seconds_to_resolve double precision)
language sql stable security definer set search_path = public as $$
  select r.id,
         r.code,
         r.barangay,
         r.severity,
         min(h.created_at) filter (where h.to_status = 'verified')   as verified_at,
         min(h.created_at) filter (where h.to_status = 'dispatched') as dispatched_at,
         r.resolved_at,
         extract(epoch from (min(h.created_at) filter (where h.to_status = 'dispatched') - r.created_at)) as seconds_to_dispatch,
         extract(epoch from (r.resolved_at - r.created_at)) as seconds_to_resolve
    from public.reports r
    left join public.report_status_history h on h.report_id = r.id
   where r.created_at >= p_from::timestamptz
     and r.created_at <  (p_to + 1)::timestamptz
     and public.analytics_row_visible(r.barangay_id)
   group by r.id, r.code, r.barangay, r.severity, r.created_at, r.resolved_at;
$$;

-- ============================================================================
-- 5 · Corroboration quality
-- ============================================================================
create or replace view public.analytics_corroboration with (security_invoker = true) as
select
  count(*)::bigint as total_reports,
  count(*) filter (where r.status <> 'reported')::bigint as verified_or_beyond,
  count(*) filter (where exists (
    select 1 from public.report_status_history h
     where h.report_id = r.id and h.reason = 'auto_corroboration'))::bigint as auto_verified
  from public.reports r
 where public.analytics_row_visible(r.barangay_id);

create or replace function public.analytics_corroboration(p_from date, p_to date)
returns table (total_reports bigint, verified_or_beyond bigint, auto_verified bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*)::bigint as total_reports,
    count(*) filter (where r.status <> 'reported')::bigint as verified_or_beyond,
    count(*) filter (where exists (
      select 1 from public.report_status_history h
       where h.report_id = r.id and h.reason = 'auto_corroboration'))::bigint as auto_verified
    from public.reports r
   where r.created_at >= p_from::timestamptz
     and r.created_at <  (p_to + 1)::timestamptz
     and public.analytics_row_visible(r.barangay_id);
$$;

-- ============================================================================
-- 6 · Shelter occupancy snapshot
--    evacuation_centers has a permissive read policy (`using (true)`), so
--    security_invoker alone would NOT scope this view — the explicit
--    analytics_row_visible() predicate inside does the real work.
-- ============================================================================
create or replace view public.analytics_shelters with (security_invoker = true) as
select c.status,
       count(*)::bigint as centres,
       coalesce(sum(c.capacity), 0)::bigint as capacity,
       coalesce(sum(c.occupancy), 0)::bigint as occupancy
  from public.evacuation_centers c
 where public.analytics_row_visible(c.barangay_id)
 group by c.status;

create or replace function public.analytics_shelters(p_from date, p_to date)
returns table (status text, centres bigint, capacity bigint, occupancy bigint)
language sql stable security definer set search_path = public as $$
  select c.status,
         count(*)::bigint as centres,
         coalesce(sum(c.capacity), 0)::bigint as capacity,
         coalesce(sum(c.occupancy), 0)::bigint as occupancy
    from public.evacuation_centers c
   where public.analytics_row_visible(c.barangay_id)
   group by c.status;
$$;

-- ============================================================================
-- 7 · Incidents by barangay — used by the LGU barangay-comparison panel
-- ============================================================================
create or replace view public.analytics_by_barangay with (security_invoker = true) as
select r.barangay,
       r.barangay_id,
       count(*)::bigint as total,
       count(*) filter (where r.status <> 'resolved' and r.status <> 'rejected')::bigint as open_total,
       count(*) filter (where r.severity = 'emergency')::bigint as emergency_total
  from public.reports r
 where public.analytics_row_visible(r.barangay_id)
 group by r.barangay, r.barangay_id
 order by total desc;

create or replace function public.analytics_by_barangay(p_from date, p_to date)
returns table (barangay text, total bigint, open_total bigint, emergency_total bigint)
language sql stable security definer set search_path = public as $$
  select r.barangay,
         count(*)::bigint as total,
         count(*) filter (where r.status <> 'resolved' and r.status <> 'rejected')::bigint as open_total,
         count(*) filter (where r.severity = 'emergency')::bigint as emergency_total
    from public.reports r
   where r.created_at >= p_from::timestamptz
     and r.created_at <  (p_to + 1)::timestamptz
     and public.analytics_row_visible(r.barangay_id)
   group by r.barangay
   order by total desc;
$$;

-- ============================================================================
-- Grants: every authenticated user may CALL these objects, but the scope
-- predicates inside mean a citizen's session always receives zero rows.
-- (Postgres cannot grant per-user, so the row-level predicate IS the rule.)
-- ============================================================================
grant select on public.analytics_by_hazard       to authenticated;
grant select on public.analytics_pipeline        to authenticated;
grant select on public.analytics_daily           to authenticated;
grant select on public.analytics_response_times  to authenticated;
grant select on public.analytics_corroboration   to authenticated;
grant select on public.analytics_shelters        to authenticated;
grant select on public.analytics_by_barangay     to authenticated;

grant execute on function public.analytics_by_hazard(date, date)       to authenticated;
grant execute on function public.analytics_pipeline(date, date)        to authenticated;
grant execute on function public.analytics_daily(date, date)           to authenticated;
grant execute on function public.analytics_response_times(date, date)  to authenticated;
grant execute on function public.analytics_corroboration(date, date)   to authenticated;
grant execute on function public.analytics_shelters(date, date)        to authenticated;
grant execute on function public.analytics_by_barangay(date, date)     to authenticated;
