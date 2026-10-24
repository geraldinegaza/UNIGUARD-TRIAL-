-- ============================================================================
--  UniGuard · one-file upgrade: this project's schema -> upstream 048 + 149-151
--
--  The concatenation of supabase/migrations/026_reconcile_role_model.sql and
--  122_ ... 148_ (upstream migrations 022-048, renumbered +100) and 149-151, in order.
--  Paste the whole file into the Supabase SQL Editor and run it once.
--  Every part is idempotent, so running it again is harmless.
--
--  BEFORE RUNNING: back up preparedness_guides (part 132 merges the
--  per-phase guide rows into one guide each) and reports (part 130 moves
--  reports to the barangay their coordinates fall in).
--  Regenerate with: supabase/upgrade/build.sh
-- ============================================================================



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 026_reconcile_role_model.sql
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 122_auto_verify_on_report.sql
-- One evaluator, used by both triggers
create or replace function public.evaluate_corroboration(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_barangay_id uuid;
  v_hazard      text;
  v_created     timestamptz;
  v_count       int;
  v_row         record;
begin
  select barangay_id, hazard_type, created_at
    into v_barangay_id, v_hazard, v_created
    from public.reports where id = p_report_id;

  if v_hazard is null or v_hazard = '' then return; end if;

  select count(distinct u) into v_count from (
    select r.reporter_id as u
      from public.reports r
     where r.hazard_type = v_hazard
       and (r.barangay_id is not distinct from v_barangay_id)
       and r.status <> 'rejected'
       and r.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
    union
    select c.user_id
      from public.report_corroborations c
      join public.reports r2 on r2.id = c.report_id
     where r2.hazard_type = v_hazard
       and (r2.barangay_id is not distinct from v_barangay_id)
       and r2.status <> 'rejected'
       and r2.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
  ) s
  where u is not null;

  if v_count >= 3 then
    perform set_config('uniguard.reason', 'auto_corroboration', true);
    for v_row in
      update public.reports
         set status = 'verified'
       where hazard_type = v_hazard
         and (barangay_id is not distinct from v_barangay_id)
         and status = 'reported'
         and created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
      returning id, reporter_id, code
    loop
      if v_row.reporter_id is not null then
        insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
        values (v_row.reporter_id,
                'Your report was auto-verified',
                'Report ' || coalesce(v_row.code, '') || ' reached 3 independent confirmations in your barangay.',
                'prepared', 'check', 'report_status', v_row.id);
      end if;
    end loop;
  end if;
end;
$$;

-- confirm-button path: reuse the evaluator
create or replace function public.apply_corroboration()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_corroboration(new.report_id);
  return new;
end;
$$;

-- new-report path: this was missing
create or replace function public.apply_report_corroboration()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_corroboration(new.id);
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_verify'
  ) then
    create trigger reports_verify
      after insert on public.reports
      for each row execute function public.apply_report_corroboration();
  end if;
end $$;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 123_reports_feed_is_mine.sql
-- ============================================================================
--  UniGuard · 023 · Rebuild reports_feed with is_mine and without reporter_id
--
--  Migration 010 rebuilt this view without is_mine and with reporter_id, which
--  breaks "My Reports" and leaks the reporter's id. This restores the 004
--  filter and keeps hazard_other_text.
-- ============================================================================

drop view if exists public.reports_feed;

create view public.reports_feed as
select
    r.id,
    r.code,
    r.barangay_id,
    r.barangay,
    r.hazard_type,
    r.hazard_other_text,
    r.severity,
    r.urgency,
    r.status,
    r.description,
    r.lat,
    r.lng,
    r.photo_path,
    r.created_at,
    r.updated_at,
    r.resolved_at,
    (
        select count(*)
        from public.report_corroborations c
        where
            c.report_id = r.id
    ) as corroborations,
    (r.reporter_id = auth.uid ()) as is_mine
from public.reports r
where
    r.reporter_id = auth.uid ()
    or public.is_lgu ()
    or (
        public.is_official ()
        and r.barangay_id = public.my_barangay_id ()
    )
    or (
        r.barangay_id is not null
        and r.barangay_id = public.my_barangay_id ()
    );

alter view public.reports_feed set(security_invoker = false);

grant select on public.reports_feed to authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 124_analytics_invoker.sql
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 125_corroboration_radius.sql
create or replace function public.distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

alter table public.report_corroborations
add column if not exists lat double precision;

alter table public.report_corroborations
add column if not exists lng double precision;

drop function if exists public.corroborate_report (uuid, text);

create or replace function public.corroborate_report(
  p_report_id uuid, p_note text default '',
  p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_count  int;
  v_rlat   double precision;
  v_rlng   double precision;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to corroborate a report';
  end if;
  if not public.is_active_user() then
    raise exception 'This account cannot corroborate reports';
  end if;

  select lat, lng into v_rlat, v_rlng from public.reports where id = p_report_id;
  if p_lat is not null and v_rlat is not null
     and public.distance_m(p_lat, p_lng, v_rlat, v_rlng) > 500 then
    raise exception 'You are too far from this hazard to confirm it. Confirmations must come from within 500 m.';
  end if;

  insert into public.report_corroborations (report_id, user_id, note, lat, lng)
  values (p_report_id, auth.uid(), coalesce(p_note, ''), p_lat, p_lng);

  select status,
         1 + (select count(*) from public.report_corroborations c where c.report_id = p_report_id)
    into v_status, v_count
    from public.reports where id = p_report_id;

  return jsonb_build_object('corroborations', coalesce(v_count, 1),
    'status', v_status, 'verified', v_status = 'verified', 'threshold', 3);
end;
$$;

revoke all on function public.corroborate_report (
    uuid,
    text,
    double precision,
    double precision
)
from public;

grant
execute on function public.corroborate_report (
    uuid,
    text,
    double precision,
    double precision
) to authenticated;

create or replace function public.apply_corroboration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_radius constant double precision := 500;
  v_barangay_id uuid;
  v_hazard      text;
  v_created     timestamptz;
  v_lat         double precision;
  v_lng         double precision;
  v_count       int;
  v_row         record;
begin
  select barangay_id, hazard_type, created_at, lat, lng
    into v_barangay_id, v_hazard, v_created, v_lat, v_lng
    from public.reports where id = new.report_id;

  if v_hazard is null then
    return new;
  end if;

  select count(distinct u) into v_count from (
    select r.reporter_id as u
      from public.reports r
     where r.hazard_type = v_hazard
       and (r.barangay_id is not distinct from v_barangay_id)
       and r.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
       and (v_lat is null or r.lat is null
            or public.distance_m(v_lat, v_lng, r.lat, r.lng) <= c_radius)
    union
    select c.user_id
      from public.report_corroborations c
      join public.reports r2 on r2.id = c.report_id
     where r2.hazard_type = v_hazard
       and (r2.barangay_id is not distinct from v_barangay_id)
       and r2.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
       and (v_lat is null or coalesce(c.lat, r2.lat) is null
            or public.distance_m(v_lat, v_lng, coalesce(c.lat, r2.lat), coalesce(c.lng, r2.lng)) <= c_radius)
  ) s;

  if v_count >= 3 then
    perform set_config('uniguard.reason', 'auto_corroboration', true);
    for v_row in
      select id from public.reports
       where hazard_type = v_hazard
         and (barangay_id is not distinct from v_barangay_id)
         and status = 'reported'
         and created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
         and (v_lat is null or lat is null
              or public.distance_m(v_lat, v_lng, lat, lng) <= c_radius)
    loop
      update public.reports set status = 'verified' where id = v_row.id;
    end loop;
  end if;
  return new;
end;
$$;

create or replace view public.reports_feed as
select
    r.id,
    r.code,
    r.barangay_id,
    r.barangay,
    r.hazard_type,
    r.hazard_other_text,
    r.severity,
    r.urgency,
    r.status,
    r.description,
    r.lat,
    r.lng,
    r.photo_path,
    r.created_at,
    r.updated_at,
    r.resolved_at,
    1 + (
        select count(*)
        from public.report_corroborations c
        where
            c.report_id = r.id
    ) as corroborations,
    (r.reporter_id = auth.uid ()) as is_mine
from public.reports r
where
    r.reporter_id = auth.uid ()
    or public.is_lgu ()
    or (
        public.is_official ()
        and r.barangay_id = public.my_barangay_id ()
    )
    or (
        r.barangay_id is not null
        and r.barangay_id = public.my_barangay_id ()
    );

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 126_scope_reads_by_barangay.sql
-- A. fill barangay_id from the barangay name, so scoping works even when the
--    client only sends the name (relief and road work never send the id)
create or replace function public.fill_barangay_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.barangay_id is null and coalesce(new.barangay, '') <> '' then
    select id into new.barangay_id from public.barangays where name = new.barangay limit 1;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['relief_distributions','evacuation_centers','road_work_posts','authorized_beneficiaries']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_fill_brgy', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fill_barangay_id()', t || '_fill_brgy', t);
  end loop;
end $$;

-- B. backfill existing rows
update public.relief_distributions x
set
    barangay_id = b.id
from public.barangays b
where
    b.name = x.barangay
    and x.barangay_id is null;

update public.evacuation_centers x
set
    barangay_id = b.id
from public.barangays b
where
    b.name = x.barangay
    and x.barangay_id is null;

update public.road_work_posts x
set
    barangay_id = b.id
from public.barangays b
where
    b.name = x.barangay
    and x.barangay_id is null;

update public.authorized_beneficiaries x
set
    barangay_id = b.id
from public.barangays b
where
    b.name = x.barangay
    and x.barangay_id is null;

-- C. read policies: LGU sees all; everyone else sees their own barangay
--    plus rows that belong to no barangay (municipality-wide)

drop policy if exists relief_distributions_read on public.relief_distributions;

create policy relief_distributions_read on public.relief_distributions for
select to authenticated using (
        public.is_lgu ()
        or barangay_id = public.my_barangay_id ()
        or (
            barangay_id is null
            and coalesce(barangay, '') = ''
        )
    );

drop policy if exists evacuation_read on public.evacuation_centers;

create policy evacuation_read on public.evacuation_centers for
select to authenticated using (
        public.is_lgu ()
        or barangay_id = public.my_barangay_id ()
        or (
            barangay_id is null
            and coalesce(barangay, '') = ''
        )
    );

drop policy if exists advisories_read on public.advisories;

create policy advisories_read on public.advisories for
select to authenticated using (
        public.is_lgu ()
        or author_id = auth.uid ()
        or citywide
        or exists (
            select 1
            from public.advisory_targets t
            where
                t.advisory_id = advisories.id
                and t.barangay_id = public.my_barangay_id ()
        )
    );

drop policy if exists road_work_posts_read on public.road_work_posts;

create policy road_work_posts_read on public.road_work_posts for
select to authenticated using (
        public.is_lgu ()
        or author_id = auth.uid ()
        or citywide
        or barangay_id = public.my_barangay_id ()
    );

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 127_report_edit_guard.sql
-- ============================================================================
--  UniGuard · 027 · Citizen report-edit guard + optional location note
--
--  Closes the gap where `reports_update` (migration 004) let the reporter
--  update ANY column of their own row for 15 minutes (with check (true)), and
--  `guard_report_status` (migration 010) only blocked illegal TRANSITIONS — so
--  a legal transition such as reported -> verified passed for any role that
--  could write the row.
--
--  After this migration a citizen editing their own report inside the
--  15-minute window may change ONLY:
--      description, hazard_type, hazard_other_text, location_note (new),
--      photo_path, lat, lng, urgency, severity
--  severity/urgency are documented as reporter-set (the report form's
--  "How urgent does it look" chips set them at submit; the edit form follows
--  the same rule). Everything else is protected:
--      status, barangay_id, barangay, reporter_id, code, resolved_at
--  Status moves happen only through advance_report_status (RPC), which
--  re-checks role and scope server side. barangay_id is derived from
--  coordinates by migration 030 when lat/lng change — never hand-set.
--
--  Additive + idempotent: one new column, policy replaced, trigger replaced.
-- ============================================================================

-- --------------------------------------------- optional exact address/landmark
alter table public.reports add column if not exists location_note text not null default '';

-- reports_feed carries it so the citizen edit form can pre-fill the field

drop view if exists public.reports_feed;
create or replace view public.reports_feed as
select
    r.id,
    r.code,
    r.barangay_id,
    r.barangay,
    r.hazard_type,
    r.hazard_other_text,
    r.severity,
    r.urgency,
    r.status,
    r.description,
    r.location_note,
    r.lat,
    r.lng,
    r.photo_path,
    r.created_at,
    r.updated_at,
    r.resolved_at,
    (
        select count(*)
        from public.report_corroborations c
        where c.report_id = r.id
    ) as corroborations,
    (r.reporter_id = auth.uid()) as is_mine
from public.reports r
where
    r.reporter_id = auth.uid()
    or public.is_lgu()
    or (public.is_official() and r.barangay_id = public.my_barangay_id())
    or (r.barangay_id is not null and r.barangay_id = public.my_barangay_id());

do $$ begin
  execute 'alter view public.reports_feed set (security_invoker = false)';
exception when others then null;
end $$;

grant select on public.reports_feed to authenticated;

-- ------------------------------------------------------------------ the guard
-- Blocks any field change a citizen is not allowed to make, even inside the
-- 15-minute window. Officials and LGU pass through (their writes run through
-- scoped policies and the RPCs).
create or replace function public.guard_report_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  -- [this project] no signed-in user means a trusted backend call (SQL editor,
  -- service role, Edge Function), the same rule as guard_profile_fields in 021
  -- and 143. Without it the coordinate backfill in 130 is rejected for every
  -- report whose picked barangay disagrees with its coordinates.
  if auth.uid() is null then
    return new;
  end if;

  select coalesce(role, 'citizen') into v_role from public.profiles where id = auth.uid();

  -- officials / LGU are governed by their own policies and the status RPC
  if v_role in ('barangay_official', 'lgu_ldrrmc') then
    -- ...but even they may never reassign identity columns silently
    if new.reporter_id is distinct from old.reporter_id then
      raise exception 'reporter_id cannot be reassigned';
    end if;
    if new.code is distinct from old.code then
      raise exception 'The report code cannot be changed';
    end if;
    return new;
  end if;

  -- a citizen may only touch their OWN row, inside the window
  if new.reporter_id is distinct from auth.uid() or old.reporter_id is distinct from auth.uid() then
    raise exception 'You can only edit your own report';
  end if;
  if old.created_at <= now() - interval '15 minutes' then
    raise exception 'The 15-minute edit window for this report has closed';
  end if;

  -- protected columns
  if new.status is distinct from old.status then
    raise exception 'Status changes go through the official workflow, not the edit form';
  end if;
  if new.barangay_id is distinct from old.barangay_id
     or new.barangay is distinct from old.barangay then
    raise exception 'The barangay is assigned from the report coordinates and cannot be edited';
  end if;
  if new.reporter_id is distinct from old.reporter_id then
    raise exception 'reporter_id cannot be reassigned';
  end if;
  if new.code is distinct from old.code then
    raise exception 'The report code cannot be changed';
  end if;
  if new.resolved_at is distinct from old.resolved_at then
    raise exception 'resolved_at is managed by the workflow';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be edited';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_guard_edit on public.reports;
create trigger reports_guard_edit
  before update on public.reports
  for each row execute function public.guard_report_edit();

-- an edit that changes nothing protected is audit-logged by migration 033's
-- generic trigger; here we record the citizen edit action explicitly so the
-- audit trail distinguishes "citizen edited own report" from official edits.
create or replace function public.audit_citizen_report_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select coalesce(role, 'citizen') into v_role from public.profiles where id = auth.uid();
  if v_role = 'citizen' and new.reporter_id = auth.uid() then
    perform public.write_audit('report.self_edited', 'reports', new.id,
      jsonb_build_object(
        'within_window', true,
        'changed', (select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(new))
                     where key in ('description','hazard_type','hazard_other_text','location_note','lat','lng','severity','urgency','photo_path'))));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_audit_self_edit'
  ) then
    create trigger reports_audit_self_edit
      after update on public.reports
      for each row execute function public.audit_citizen_report_edit();
  end if;
end $$;

-- --------------------------------------------------- tighten the update policy
-- The USING clause keeps the 15-minute window; the WITH CHECK now rejects a
-- row the caller is not allowed to write, instead of the old `true`.
drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
    or (reporter_id = auth.uid() and created_at > now() - interval '15 minutes')
  )
  with check (
    public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
    or (reporter_id = auth.uid())
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 128_status_flow.sql
-- ============================================================================
--  UniGuard · 028 · Strict incident status flow (single source of truth)
--
--  Status flow (DECISIONS in the fix prompt):
--      reported -> verified -> dispatched -> resolved      (one step at a time)
--      rejected  allowed from any non-terminal state       (terminal)
--      resolved  terminal
--
--  · NO role may skip a step — including LGU/LDRRMC. The old guard_report_status
--    (migration 010) let an LGU make any legal-or-illegal-looking jump and
--    allowed resolved -> nothing but also reported -> resolved for everyone.
--  · `resolved` and `rejected` are final: no transition out, for any role.
--  · The auto-verification by corroboration (migrations 022 / 025) still works:
--    it moves reported -> verified (one legal step) from a security-definer
--    trigger whose session runs as the reporting user; the guard below permits
--    the step itself and only checks transitions, so the trigger is unaffected.
--  · reports_log_status (migration 007 trigger) keeps writing history because
--    the guard does not touch that trigger.
--
--  Stored keys are unchanged: reported, verified, dispatched, resolved,
--  rejected. Only the guard + RPC definitions change.
--
--  Idempotent: functions are create-or-replace, triggers dropped and recreated.
-- ============================================================================

-- ------------------------------------------------------------- status guard
create or replace function public.guard_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if new.status is distinct from old.status then
    v_ok := case
      when old.status = 'reported'   and new.status = 'verified'   then true
      when old.status = 'verified'   and new.status = 'dispatched' then true
      when old.status = 'dispatched' and new.status = 'resolved'   then true
      when old.status in ('reported','verified','dispatched') and new.status = 'rejected' then true
      else false
    end;

    if not v_ok then
      raise exception 'Illegal status change from % to %. The flow is reported -> verified -> dispatched -> resolved, one step at a time; rejected is allowed from any open state; resolved and rejected are final.',
        old.status, new.status;
    end if;
  end if;

  if new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  -- reopening guard: resolved/rejected rows must keep their resolved_at
  if new.resolved_at is distinct from old.resolved_at and new.status <> 'resolved' then
    raise exception 'resolved_at can only be set when the status becomes resolved';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_guard_status on public.reports;
create trigger reports_guard_status
  before update on public.reports
  for each row execute function public.guard_report_status();

-- ------------------------------------------------------------------- the RPC
-- Redefined (not edited in place — migrations 007/010/015 stay as they are).
-- Same whitelist, same audit + notification behaviour as 015, plus the
-- one-step transition check so the guard's error never even gets a chance to
-- surface half a transaction. The per-step transition test happens in
-- guard_report_status; here we only pre-validate the target so callers get a
-- clean error message instead of a trigger exception.
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.reports;
  v_role     text;
  v_brgy     uuid;
  v_reporter uuid;
  v_code     text;
  v_tone     text;
  v_title    text;
  v_body     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('verified', 'dispatched', 'resolved', 'rejected') then
    raise exception 'Unknown status: %', p_next;
  end if;

  select role, barangay_id into v_role, v_brgy from public.profiles where id = auth.uid();

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can change an incident status';
  end if;

  -- one step at a time, for every role; terminal states are final
  if not (
       (v_row.status = 'reported'   and p_next in ('verified', 'rejected'))
    or (v_row.status = 'verified'   and p_next in ('dispatched', 'rejected'))
    or (v_row.status = 'dispatched' and p_next in ('resolved', 'rejected'))
  ) then
    raise exception 'A report in "%" cannot move to "%". Move one step at a time; resolved and rejected are final.', v_row.status, p_next;
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  update public.reports set status = p_next where id = p_report_id returning * into v_row;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('from', v_row.status, 'to', p_next, 'note', coalesce(p_note, '')));

  -- notify the reporter so a citizen sees every status change
  v_reporter := v_row.reporter_id;
  v_code     := coalesce(v_row.code, '');
  if v_reporter is not null then
    v_tone  := case p_next when 'dispatched' then 'warning' when 'resolved' then 'prepared'
                            when 'rejected'  then 'warning' else 'advisory' end;
    v_title := case p_next
      when 'verified'   then 'Your report was verified'
      when 'dispatched' then 'Response dispatched to your report'
      when 'resolved'   then 'Your report is resolved'
      when 'rejected'   then 'Your report was rejected'
      else 'Your report status changed'
    end;
    v_body  := case p_next
      when 'verified'   then 'Report ' || v_code || ' has been reviewed and verified.'
      when 'dispatched' then 'A responder unit has been dispatched for ' || v_code || '.'
      when 'resolved'   then 'Report ' || v_code || ' is resolved. Closing note: ' || left(coalesce(p_note, ''), 140)
      when 'rejected'   then 'Report ' || v_code || ' was rejected: ' || left(coalesce(p_note, ''), 140)
      else 'Report ' || v_code || ' is now ' || p_next || '.'
    end;
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_reporter, v_title, v_body, v_tone, 'check', 'report_status', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;

revoke all on function public.advance_report_status(uuid, text, text) from public;
grant execute on function public.advance_report_status(uuid, text, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 129_barangay_scoping.sql
-- ============================================================================
--  UniGuard · 029 · Barangay scoping for SOS reads, road writes and advisories
--
--  Four verified gaps closed:
--
--  A4  sos_log_read (migration 016) let ANY official read every SOS entry
--      municipality-wide. Now an official reads only SOS entries whose sender
--      barangay snapshot matches their own; LGU reads all; citizens keep
--      seeing only their own.
--
--  A5  road_status_write (migration 017) let any official write any barangay.
--      Now officials write only rows in their own barangay. road_status (and
--      road_work_posts, double-checked) are added to the fill_barangay_id()
--      trigger list from migration 026, which had omitted road_status.
--
--  A6  advisories_insert (migration 004) let any official publish for any
--      area. Now a Barangay Official can publish ONLY a single-barangay
--      advisory that targets exactly their own barangay; municipality-wide or
--      multi-barangay publishing is LGU-only. advisories_update cannot widen
--      the area. fanout_advisory already fans out strictly from
--      advisory_targets, so once the targets are scoped the fan-out is scoped.
--
--  Additive + idempotent: one helper column on sos_log, policies replaced,
--  triggers replaced. No existing rows are rewritten except the sos_log
--  backfill of barangay_id (from the stored name snapshot), which is safe to
--  re-run.
-- ============================================================================

-- ---------------------------------------------------------------- A4 · SOS
-- sender barangay snapshot: sos_log stores the NAME (from profiles.barangay).
-- A uuid column makes the scope check exact and survives renames; the RPC in
-- 016 is redefined below to fill it. The read policy accepts either match so
-- rows created before this migration still scope correctly by name.
alter table public.sos_log add column if not exists barangay_id uuid references public.barangays(id) on delete set null;

update public.sos_log s
   set barangay_id = b.id
  from public.barangays b
 where s.barangay_id is null
   and coalesce(s.barangay, '') <> ''
   and b.name = s.barangay;

-- redefine submit_sos: identical behaviour plus barangay_id in the snapshot
create or replace function public.submit_sos(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id     uuid;
  v_row    public.sos_log;
  v_prof   record;
  v_reach  int := 0;
  v_brgy_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send an SOS';
  end if;

  perform public.check_rate_limit('sos', 5, interval '10 minutes');

  select full_name, phone, barangay, barangay_id into v_prof from public.profiles where id = auth.uid();

  if v_prof.barangay_id is null and coalesce(v_prof.barangay, '') <> '' then
    select id into v_brgy_id from public.barangays where name = v_prof.barangay limit 1;
  else
    v_brgy_id := v_prof.barangay_id;
  end if;

  insert into public.sos_log (user_id, profile_name, profile_phone, barangay, barangay_id, lat, lng, accuracy, note)
  values (auth.uid(),
          coalesce(v_prof.full_name, ''),
          coalesce(v_prof.phone, ''),
          coalesce(v_prof.barangay, ''),
          v_brgy_id,
          p_lat, p_lng, p_accuracy, coalesce(p_note, ''))
  returning * into v_row;
  v_id := v_row.id;

  with targets as (
    select p.id from public.profiles p
     where p.disabled = false and p.role = 'lgu_ldrrmc'
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, type, sos_id)
    select id,
           'SOS received from ' || coalesce(v_prof.full_name, 'a resident'),
           coalesce(v_prof.phone, '') || ' · ' || coalesce(v_prof.barangay, '') ||
           ' · ' || coalesce(p_accuracy::text, '') || ' m',
           'emergency', 'alert', 'sos', v_id
      from targets
    returning 1
  )
  select count(*) into v_reach from ins;

  perform public.write_audit('sos.received', 'sos_log', v_id,
    jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy, 'reach', v_reach));

  return jsonb_build_object('id', v_id, 'reach', v_reach);
end;
$$;

revoke all on function public.submit_sos(double precision, double precision, double precision, text) from public;
grant execute on function public.submit_sos(double precision, double precision, double precision, text) to authenticated;

drop policy if exists sos_log_read on public.sos_log;
create policy sos_log_read on public.sos_log
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_lgu()
    or (
      public.is_official()
      and (
        (barangay_id is not null and barangay_id = public.my_barangay_id())
        or (barangay_id is null and coalesce(barangay, '') <> '' and barangay = public.my_barangay_name())
      )
    )
  );

-- keep insert policy: citizens (any signed-in user) insert their own only
drop policy if exists sos_log_insert on public.sos_log;
create policy sos_log_insert on public.sos_log
  for insert to authenticated with check (user_id = auth.uid());

-- SOS status changes (acknowledged / resolved) go through a scoped RPC so the
-- action is audited and officials cannot flip other barangays' entries.
create or replace function public.update_sos_status(p_sos_id uuid, p_status text)
returns jsonb
language plpgsql
security definer set search_path = public as $$
declare
  v_row public.sos_log;
  v_role text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_status not in ('acknowledged', 'resolved') then
    raise exception 'Unknown SOS status: %', p_status;
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can update an SOS';
  end if;

  select * into v_row from public.sos_log where id = p_sos_id;
  if v_row.id is null then raise exception 'That SOS entry does not exist'; end if;

  if v_role = 'barangay_official' then
    if v_row.barangay_id is not null and v_row.barangay_id is distinct from public.my_barangay_id() then
      raise exception 'That SOS entry is outside your barangay';
    end if;
    if v_row.barangay_id is null and coalesce(v_row.barangay, '') is distinct from public.my_barangay_name() then
      raise exception 'That SOS entry is outside your barangay';
    end if;
  end if;

  update public.sos_log set status = p_status where id = p_sos_id returning * into v_row;

  perform public.write_audit('sos.status_changed', 'sos_log', p_sos_id,
    jsonb_build_object('to', p_status));

  -- tell the sender their SOS was picked up / closed
  if v_row.user_id is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, sos_id)
    values (v_row.user_id,
            case p_status when 'acknowledged' then 'Your SOS was received — help is being arranged'
                          else 'Your SOS is resolved' end,
            'Status of your SOS from ' || coalesce(v_row.barangay, 'your barangay') || ' is now ' || p_status || '.',
            case p_status when 'acknowledged' then 'warning' else 'prepared' end,
            'check', 'sos', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

revoke all on function public.update_sos_status(uuid, text) from public;
grant execute on function public.update_sos_status(uuid, text) to authenticated;

-- ------------------------------------------------ A5 · road_status scoping
drop policy if exists road_status_write on public.road_status;
create policy road_status_write on public.road_status
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
  )
  with check (
    public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
  );

-- fill_barangay_id coverage: migration 026 omitted road_status
do $$
declare t text;
begin
  foreach t in array array['road_status','sos_log']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_fill_brgy', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fill_barangay_id()', t || '_fill_brgy', t);
  end loop;
end $$;

-- road_work_posts scope double-check (A5): the write policy below restricts
-- officials to their own barangay or their own posts; municipality-wide posts
-- (citywide = true) stay LGU-only.
drop policy if exists road_work_posts_write on public.road_work_posts;
create policy road_work_posts_write on public.road_work_posts
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and author_id = auth.uid()
        and citywide = false
        and (barangay_id = public.my_barangay_id() or barangay_id is null))
  )
  with check (
    public.is_lgu()
    or (public.is_official() and author_id = auth.uid()
        and citywide = false
        and (barangay_id = public.my_barangay_id() or barangay_id is null))
  );

-- ------------------------------------------------- A6 · advisory publishing
-- A Barangay Official may insert only a single-barangay advisory whose target
-- list contains exactly their own barangay. LGU may publish anything.
create or replace function public.guard_advisory_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_target_count int;
  v_foreign int;
begin
  select coalesce(role, 'citizen') into v_role from public.profiles where id = auth.uid();

  if v_role = 'barangay_official' then
    if coalesce(new.citywide, false) then
      raise exception 'Only LGU / LDRRMC can publish municipality-wide advisories';
    end if;
    if coalesce(new.affected_area, '') not ilike '%' || coalesce(public.my_barangay_name(), '') || '%' then
      raise exception 'A barangay official can only publish for their own barangay';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists advisories_guard_scope on public.advisories;
create trigger advisories_guard_scope
  before insert on public.advisories
  for each row execute function public.guard_advisory_scope();

-- advisory_targets: an official may attach targets only for their own barangay
create or replace function public.guard_advisory_target()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_lgu() then
    return new;
  end if;
  if public.is_official() and new.barangay_id is distinct from public.my_barangay_id() then
    raise exception 'A barangay official can target only their own barangay';
  end if;
  if not public.is_lgu() and not public.is_official() then
    raise exception 'Only officials can change advisory targets';
  end if;
  return new;
end;
$$;

drop trigger if exists advisory_targets_guard_scope on public.advisory_targets;
create trigger advisory_targets_guard_scope
  before insert or update on public.advisory_targets
  for each row execute function public.guard_advisory_target();

-- update: an official editing their own advisory may not widen the area
drop policy if exists advisories_update on public.advisories;
create policy advisories_update on public.advisories
  for update to authenticated
  using (
    public.is_lgu()
    or (author_id = auth.uid() and public.is_official())
  )
  with check (
    public.is_lgu()
    or (author_id = auth.uid() and public.is_official() and citywide = false)
  );

create or replace function public.guard_advisory_widen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_lgu() then
    return new;
  end if;
  if (new.citywide is distinct from old.citywide and new.citywide) then
    raise exception 'Only LGU / LDRRMC can make an advisory municipality-wide';
  end if;
  return new;
end;
$$;

drop trigger if exists advisories_guard_widen on public.advisories;
create trigger advisories_guard_widen
  before update on public.advisories
  for each row execute function public.guard_advisory_widen();

-- insert policy mirrors the trigger so a direct REST insert fails cleanly
drop policy if exists advisories_insert on public.advisories;
create policy advisories_insert on public.advisories
  for insert to authenticated
  with check (
    public.is_lgu()
    or (public.is_official() and citywide = false)
  );

drop policy if exists advisory_targets_write on public.advisory_targets;
create policy advisory_targets_write on public.advisory_targets
  for all to authenticated
  using (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()))
  with check (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()));


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 130_barangay_routing.sql
-- ============================================================================
--  UniGuard · 030 · Server-side barangay routing from coordinates
--
--  Replaces the name-matching in guard_report_insert (migration 020) with
--  coordinate routing, per the fix prompt's LOCATION decision:
--
--    · A GPS fix or a map pin is mandatory for every hazard report.
--    · The incident's barangay is derived from its coordinates ON THE SERVER,
--      never from the reporter's profile and never from the picked name.
--    · If the reporter's picked barangay disagrees with the coordinates, the
--      coordinates win. (The client shows which barangay received the report.)
--    · Inserts with missing, invalid, swapped, or out-of-Lingayen coordinates
--      are rejected — the same checks as UG_GEO.classify in js/geo.js.
--
--  DATA SOURCE / ACCURACY NOTE (important):
--  The repository contains no barangay boundary polygons, and no official
--  GeoJSON could be bundled with this migration. This migration therefore
--  ships APPROXIMATE barangay centroids (and a per-barangay bounding box)
--  compiled from OpenStreetMap / PhilAtlas references. It is explicitly an
--  APPROXIMATION of the nearest-centroid fallback described in the fix
--  prompt, and every centroid MUST be verified against MDRRMO / PSA-NAMRIA
--  records before production reliance. To upgrade to true polygons later:
--  load official Lingayen barangay boundaries into barangay_geoms.geojson
--  and swap resolve_barangay() for a point-in-polygon test — the routing
--  trigger below will not need to change.
--
--  Backfill of existing reports happens at the end, in a reviewable step.
--  Additive + idempotent.
-- ============================================================================

create table if not exists public.barangay_geoms (
  barangay_id  uuid primary key references public.barangays(id) on delete cascade,
  centroid_lat double precision not null,
  centroid_lng double precision not null,
  min_lat      double precision,
  max_lat      double precision,
  min_lng      double precision,
  max_lng      double precision,
  source       text not null default 'approx: OSM/PhilAtlas centroid, verify vs MDRRMO',
  updated_at   timestamptz not null default now()
);

-- approximate centroids; bbox = centroid +- the offsets below (~1.2 km lat / 1.4 km lng)
insert into public.barangay_geoms (barangay_id, centroid_lat, centroid_lng, min_lat, max_lat, min_lng, max_lng)
select b.id, v.lat, v.lng, v.lat - 0.006, v.lat + 0.006, v.lng - 0.007, v.lng + 0.007
  from (values
    ('Aliwekwek',          16.0260, 120.2340),
    ('Baay',               16.0140, 120.2200),
    ('Balangobong',        16.0450, 120.2130),
    ('Balococ',            16.0530, 120.2060),
    ('Bantayan',           16.0280, 120.2270),
    ('Basing',             16.0330, 120.2020),
    ('Capandanan',         16.0200, 120.2120),
    ('Domalandan Center',  16.0360, 120.2080),
    ('Domalandan East',    16.0390, 120.2110),
    ('Domalandan West',    16.0420, 120.2060),
    ('Dorongan',           16.0100, 120.2500),
    ('Dulag',              16.0000, 120.2140),
    ('Estanza',            15.9980, 120.2400),
    ('Lasip',              16.0250, 120.2460),
    ('Libsong East',       16.0270, 120.2430),
    ('Libsong West',       16.0290, 120.2380),
    ('Malawa',             16.0030, 120.2380),
    ('Malimpuec',          16.0160, 120.2040),
    ('Maniboc',            16.0240, 120.2180),
    ('Matalava',           16.0300, 120.2160),
    ('Naguelguel',         16.0180, 120.2450),
    ('Namolan',            16.0070, 120.2260),
    ('Pangapisan North',   16.0520, 120.2260),
    ('Pangapisan Sur',     16.0430, 120.2240),
    ('Poblacion',          16.0220, 120.2306),
    ('Quibaol',            16.0350, 120.2450),
    ('Rosario',            16.0210, 120.2520),
    ('Sabangan',           16.0400, 120.2330),
    ('Talogtog',           16.0500, 120.2350),
    ('Tonton',             16.0080, 120.2180),
    ('Tumbar',             16.0120, 120.2100),
    ('Wawa',               16.0470, 120.2410)
  ) as v(name, lat, lng)
  join public.barangays b on b.name = v.name
on conflict (barangay_id) do nothing;

-- municipal service bounds — keep in sync with js/geo.js BOUNDS
create or replace function public.lingayen_bounds()
returns table (min_lat double precision, max_lat double precision, min_lng double precision, max_lng double precision)
language sql immutable as $$
  select 15.95::double precision, 16.085::double precision, 120.17::double precision, 120.29::double precision;
$$;

-- same validation ladder as UG_GEO.classify: missing / invalid / swapped /
-- outside / ok. Raises with a human-readable reason.
create or replace function public.validate_report_coords(p_lat double precision, p_lng double precision)
returns void language plpgsql immutable as $$
declare
  b record;
begin
  if p_lat is null and p_lng is null then
    raise exception 'A report needs a location. Turn on GPS or drop a pin on the map before submitting.';
  end if;
  if p_lat is null or p_lng is null or p_lat::text = 'NaN' or p_lng::text = 'NaN' then
    raise exception 'The report coordinates are not valid numbers.';
  end if;
  if abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'The report coordinates are out of range.';
  end if;
  if p_lat = 0 and p_lng = 0 then
    raise exception 'The report has a placeholder (0,0) location. Drop a pin on the map.';
  end if;
  select * into b from public.lingayen_bounds();
  -- latitude written where longitude belongs (16.x / 120.x swapped)
  if p_lat between b.min_lng and b.max_lng and p_lng between b.min_lat and b.max_lat then
    raise exception 'Latitude and longitude look swapped. Latitude must come first (e.g. 16.0206, 120.2306).';
  end if;
  if p_lat < b.min_lat or p_lat > b.max_lat or p_lng < b.min_lng or p_lng > b.max_lng then
    raise exception 'The report location is outside Lingayen. Reports can only be filed inside the municipality.';
  end if;
end;
$$;

-- resolve a point to a barangay: bbox hit first, else nearest centroid.
create or replace function public.resolve_barangay(p_lat double precision, p_lng double precision)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_id  uuid;
  v_dist double precision;
begin
  perform public.validate_report_coords(p_lat, p_lng);

  -- [this project] the boxes overlap, so 'limit 1' alone returned an arbitrary
  -- match (a point beside the Poblacion centroid resolved to Aliwekwek). Among
  -- the boxes that contain the point, take the nearest centroid.
  select g.barangay_id into v_id
    from public.barangay_geoms g
   where p_lat between g.min_lat and g.max_lat
     and p_lng between g.min_lng and g.max_lng
   order by public.distance_m(p_lat, p_lng, g.centroid_lat, g.centroid_lng)
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select g.barangay_id, public.distance_m(p_lat, p_lng, g.centroid_lat, g.centroid_lng) as d
    into v_id, v_dist
    from public.barangay_geoms g
   order by public.distance_m(p_lat, p_lng, g.centroid_lat, g.centroid_lng)
   limit 1;
  return v_id;
end;
$$;

-- --------------------------------------------------------- the insert guard
create or replace function public.guard_report_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role    text;
  v_brgy_id uuid;
  v_pick_id uuid;
  v_name    text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to file a report';
  end if;

  new.reporter_id := auth.uid();

  select coalesce(role, 'citizen') into v_role from public.profiles where id = auth.uid();

  -- coordinates are mandatory and must land inside Lingayen (raises otherwise)
  perform public.validate_report_coords(new.lat, new.lng);

  -- the barangay comes from the coordinates, for every role
  v_brgy_id := public.resolve_barangay(new.lat, new.lng);
  if v_brgy_id is null then
    raise exception 'No barangay matched the report location. Contact the MDRRMO.';
  end if;
  new.barangay_id := v_brgy_id;

  select name into v_name from public.barangays where id = v_brgy_id;
  new.barangay := coalesce(v_name, new.barangay, '');

  -- remember whether the reporter picked a different barangay (hint only)
  if coalesce(new.location_note, '') = '' then
    null; -- nothing to do; the column is the optional landmark text
  end if;

  return new;
end;
$$;

drop trigger if exists reports_guard_insert on public.reports;
create trigger reports_guard_insert
  before insert on public.reports
  for each row execute function public.guard_report_insert();

-- edits: when a citizen moves the pin inside the 15-minute window the
-- barangay is re-derived from the new coordinates (the reporter still cannot
-- set barangay_id directly — migration 027 blocks that).
create or replace function public.route_report_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if (new.lat is distinct from old.lat) or (new.lng is distinct from old.lng) then
    perform public.validate_report_coords(new.lat, new.lng);
    v_id := public.resolve_barangay(new.lat, new.lng);
    if v_id is not null and v_id is distinct from new.barangay_id then
      new.barangay_id := v_id;
      select name into new.barangay from public.barangays where id = v_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_route_update on public.reports;
create trigger reports_route_update
  before update on public.reports
  for each row execute function public.route_report_update();

-- ------------------------------------------------------------- backfill step
-- Reviewable: fills barangay for rows that HAVE valid coordinates and an
-- empty/mismatched barangay. Rows without coordinates are left untouched and
-- listed by docs/MIGRATION-NOTES.md's verification query.
update public.reports r
   set barangay_id = res.bid,
       barangay    = res.name
  from (
    select r2.id, b.id as bid, b.name
      from public.reports r2
      cross join lateral public.resolve_barangay(r2.lat, r2.lng) as rid(id)
      join public.barangays b on b.id = rid.id
     where r2.lat is not null and r2.lng is not null
       and rid.id is not null
  ) res
 where r.id = res.id
   and (r.barangay_id is distinct from res.bid);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 131_road_status_full.sql
-- ============================================================================
--  UniGuard · 031 · Road status: the full form's columns
--
--  The old road_status table carried only road_name, barangay, status, note,
--  lat, lng. The redesigned road-status form (fix prompt, Phase F) needs the
--  segment, cause, severity, timing and updater fields below.
--
--  Status keys: the UI shows Open / One lane / Closed / Under repair. The
--  stored keys gain 'one_lane' and 'under_repair'; legacy rows with
--  'caution' are remapped to 'one_lane' (closest meaning) so the old check
--  constraint can be widened safely.
--
--  Additive + idempotent.
-- ============================================================================

alter table public.road_status add column if not exists segment_from      text not null default '';
alter table public.road_status add column if not exists segment_to        text not null default '';
alter table public.road_status add column if not exists cause             text not null default '';
alter table public.road_status add column if not exists severity          text not null default 'advisory';
alter table public.road_status add column if not exists started_at        timestamptz;
alter table public.road_status add column if not exists estimated_reopen  timestamptz;
alter table public.road_status add column if not exists updater_name      text not null default '';
alter table public.road_status add column if not exists created_by        uuid;

-- legacy 'caution' -> 'one_lane'. [this project] moved ahead of the new check:
-- run after it, the check is rejected by any existing 'caution' row. The old
-- check is dropped first so 'one_lane' is accepted during the remap.
alter table public.road_status drop constraint if exists road_status_status_check;
update public.road_status set status = 'one_lane' where status = 'caution';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_status_status_check') then
    alter table public.road_status add constraint road_status_status_check
      check (status in ('passable','one_lane','blocked','under_repair'));
  else
    -- widen the legacy constraint (it only allowed passable/blocked/caution)
    alter table public.road_status drop constraint road_status_status_check;
    alter table public.road_status add constraint road_status_status_check
      check (status in ('passable','one_lane','blocked','under_repair'));
  end if;
end $$;


do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_status_cause_check') then
    alter table public.road_status add constraint road_status_cause_check
      check (cause in ('', 'flood', 'landslide', 'repair', 'accident', 'other'));
  end if;
end $$;

-- the updater is auto-filled from the session profile on every write
create or replace function public.stamp_road_status_updater()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  select coalesce(full_name, '') into v_name from public.profiles where id = auth.uid();
  if coalesce(v_name, '') <> '' then
    new.updater_name := v_name;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists road_status_stamp_updater on public.road_status;
create trigger road_status_stamp_updater
  before insert or update on public.road_status
  for each row execute function public.stamp_road_status_updater();


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 132_guides_v2.sql
-- ============================================================================
--  UniGuard · 032 · Preparedness guides v2 (one guide, three phases, PDF)
--
--  Old shape (migration 014): one ROW per phase — (hazard_type, phase, title,
--  body). The redesign wants one guide with a title, hazard category, brief
--  summary, separate Before / During / After sections, and an optional PDF.
--
--  New columns on the same table (no content lost, no table swap):
--      summary       one-paragraph teaser shown on the list view
--      body_before   "Before" section text (was phase = 'before')
--      body_during   "During" section text (was phase = 'during')
--      body_after    "After"  section text (was phase = 'after')
--      pdf_path      storage path of the optional attached PDF
--      author_id     who published it (for the audit trail)
--
--  Conversion: rows are grouped by (hazard_type, canonical guide title). The
--  legacy titles are "Before a flood" / "During a flood" / "After a flood"
--  style, so the group key strips a leading Before/During/After and the
--  article: 'Before a flood' -> 'flood'. Each group becomes ONE guide; the
--  per-phase bodies move into their new columns and the phase rows are
--  retired (kept in the table only as guide rows with body_phase='v1' marker
--  is avoided — instead the phase rows are deleted after their content is
--  merged, which is why this step is clearly announced and re-runnable: it
--  only deletes rows that still look like v1 rows).
--
--  Idempotent: re-running finds no v1 rows and does nothing.
-- ============================================================================

alter table public.preparedness_guides add column if not exists summary      text not null default '';
alter table public.preparedness_guides add column if not exists body_before  text not null default '';
alter table public.preparedness_guides add column if not exists body_during  text not null default '';
alter table public.preparedness_guides add column if not exists body_after   text not null default '';
alter table public.preparedness_guides add column if not exists pdf_path     text;
alter table public.preparedness_guides add column if not exists author_id    uuid references public.profiles(id) on delete set null;

-- [this project] the merged guide is stored with phase 'all', which the v1
-- check from 014 (before/during/after only) rejects. Widen it first; an empty
-- table hid this upstream.
alter table public.preparedness_guides drop constraint if exists preparedness_guides_phase_check;
alter table public.preparedness_guides add constraint preparedness_guides_phase_check
  check (phase in ('before', 'during', 'after', 'all'));

do $$
declare
  v_hazard text;
  v_group  text;
  v_b text; v_d text; v_a text;
  v_title text;
  v_gid uuid;
begin
  -- group every v1 row (a v1 row has something in `body` and nothing in body_before)
  for v_hazard, v_group in
    select distinct hazard_type,
           lower(trim(regexp_replace(title, '^(before|during|after)\s+(a|an|the)?\s*', '', 'i')))
      from public.preparedness_guides
     where coalesce(body, '') <> ''
       and coalesce(body_before, '') = '' and coalesce(body_during, '') = '' and coalesce(body_after, '') = ''
  loop
    select max(title) filter (where phase = 'before'),
           max(body)  filter (where phase = 'before'),
           max(body)  filter (where phase = 'during'),
           max(body)  filter (where phase = 'after')
      into v_title, v_b, v_d, v_a
      from public.preparedness_guides
     where hazard_type = v_hazard
       and lower(trim(regexp_replace(title, '^(before|during|after)\s+(a|an|the)?\s*', '', 'i'))) = v_group;

    -- fall back to the phase-less title when only one phase existed
    v_title := coalesce(v_title, initcap(v_group));

    insert into public.preparedness_guides
      (hazard_type, phase, title, body, summary, body_before, body_during, body_after, sort_order, active)
    values
      (v_hazard, 'all', v_title, coalesce(v_b, ''),
       left(coalesce(coalesce(v_b, v_d, v_a), ''), 160) || case when coalesce(length(coalesce(v_b, v_d, v_a)), 0) > 160 then '…' else '' end,
       coalesce(v_b, ''), coalesce(v_d, ''), coalesce(v_a, ''),
       0, true)
    returning id into v_gid;

    -- retire the v1 phase rows for this group (content is merged above)
    delete from public.preparedness_guides
     where hazard_type = v_hazard
       and coalesce(body_before, '') = '' and coalesce(body_during, '') = '' and coalesce(body_after, '') = ''
       and coalesce(body, '') <> ''
       and lower(trim(regexp_replace(title, '^(before|during|after)\s+(a|an|the)?\s*', '', 'i'))) = v_group
       and id <> v_gid;
  end loop;
end $$;

-- RLS for the new table shape stays the read-all / officials-write model.
-- (The existing policies from migration 014 continue to apply; nothing here
-- changes them, because guides are readable by everyone and writable by LGU.)


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 133_audit_coverage.sql
-- ============================================================================
--  UniGuard · 033 · Audit coverage + shelter occupancy history
--
--  A8: every write below lands an audit_log row (actor, action, entity,
--  entity id, before/after where practical). The audit_log table has no
--  insert policy on purpose — rows must be written by security definer
--  functions/triggers, which is exactly what this migration installs.
--
--  Covered by one generic row-change trigger, attached to:
--      advisories             (publish / edit / delete)
--      evacuation_centers     (occupancy + status changes, create, delete)
--      road_status            (create / edit / delete)
--      road_work_posts        (create / edit / delete)
--      emergency_hotlines     (create / edit / delete)
--      preparedness_guides    (create / edit / delete)
--      faqs                   (create / edit / delete)
--      sos_log                (status changes)
--
--  Incident edits + status changes were already audited (migrations 007/015/
--  027). Role changes are audited by the admin-users edge function.
--
--  Also adds `shelter_occupancy_log` so the analytics screen can chart
--  occupancy trends (Phase G) instead of showing only a snapshot.
--
--  Additive + idempotent.
-- ============================================================================

create table if not exists public.shelter_occupancy_log (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references public.evacuation_centers(id) on delete cascade,
  occupancy  integer not null default 0,
  capacity   integer not null default 0,
  status     text not null default 'open',
  recorded_at timestamptz not null default now()
);

create index if not exists shelter_occ_center_idx on public.shelter_occupancy_log (center_id, recorded_at desc);

alter table public.shelter_occupancy_log enable row level security;

drop policy if exists shelter_occ_read on public.shelter_occupancy_log;
create policy shelter_occ_read on public.shelter_occupancy_log
  for select to authenticated using (public.is_lgu() or public.is_official());
-- no insert policy: written by the security definer trigger below

-- ------------------------------------------------------- generic audit trigger
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_meta jsonb;
  v_entity text;
  v_id uuid;
  v_changed jsonb;
begin
  v_entity := tg_table_name;

  if tg_op = 'DELETE' then
    v_old  := to_jsonb(old);
    v_id   := v_old->>'id';
    perform public.write_audit(v_entity || '.deleted', v_entity, v_id,
      jsonb_build_object('before', v_old));
    return old;
  end if;

  v_new := to_jsonb(new);
  v_id  := v_new->>'id';
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    -- keep the meta small: only the columns that actually changed
    select jsonb_object_agg(key, jsonb_build_object('from', old_value, 'to', new_value))
      into v_changed
      from jsonb_each(v_new) n(key, new_value)
      join jsonb_each(v_old) o(key, old_value) using (key)
     where n.new_value is distinct from o.old_value
       and key not in ('updated_at', 'created_at');
    if v_changed is null or v_changed = '{}'::jsonb then
      return new;  -- nothing meaningful changed
    end if;
    v_meta := jsonb_build_object('changed', v_changed);
  else
    v_meta := jsonb_build_object('after', v_new);
  end if;

  perform public.write_audit(v_entity || '.' || lower(tg_op), v_entity, v_id, v_meta);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'advisories','evacuation_centers','road_status','road_work_posts',
    'emergency_hotlines','preparedness_guides','faqs'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- sos_log: audit only status changes (every SOS insert already writes
-- 'sos.received' from the RPC; auditing inserts again would double-log)
create or replace function public.audit_sos_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.write_audit('sos.status_changed', 'sos_log', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists sos_log_audit_status on public.sos_log;
create trigger sos_log_audit_status
  after update on public.sos_log
  for each row execute function public.audit_sos_status();

-- ------------------------------------------------ shelter occupancy history
create or replace function public.log_shelter_occupancy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.occupancy is distinct from old.occupancy
     or new.status is distinct from old.status then
    insert into public.shelter_occupancy_log (center_id, occupancy, capacity, status)
    values (new.id, new.occupancy, new.capacity, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists evacuation_centers_occ_log on public.evacuation_centers;
create trigger evacuation_centers_occ_log
  after update on public.evacuation_centers
  for each row execute function public.log_shelter_occupancy();

-- occupancy trend for the analytics screen (LGU / officials only, via the
-- same analytics scope helper as migration 024)
create or replace view public.analytics_shelter_trend with (security_invoker = true) as
select date_trunc('day', l.recorded_at)::date as day,
       sum(l.occupancy)::bigint as occupancy,
       sum(l.capacity)::bigint as capacity
  from public.shelter_occupancy_log l
  join public.evacuation_centers c on c.id = l.center_id
 where public.analytics_row_visible(c.barangay_id)
 group by 1
 order by 1;

grant select on public.analytics_shelter_trend to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 134_dispatch_details.sql
-- ============================================================================
--  UniGuard · 034 · Dispatch details (team, instructions, ETA, who, when)
--
--  A dispatch is now a record, not just a status flip. dispatch_report():
--    · checks role and barangay scope (same rules as advance_report_status)
--    · requires the incident to be Verified (first dispatch) or already
--      Dispatched (adding another team)
--    · stores team, instructions, ETA; dispatched_by and dispatched_at are
--      filled SERVER side from the session, never trusted from the client
--    · moves verified -> dispatched through advance_report_status, so the
--      one-step guard, history row, audit row and reporter notification
--      all still happen
--  Additive + idempotent.
-- ============================================================================

create table if not exists public.report_dispatches (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.reports(id) on delete cascade,
  team               text not null,
  instructions       text not null default '',
  eta                timestamptz not null,
  dispatched_by      uuid references public.profiles(id) on delete set null,
  dispatched_by_name text not null default '',
  dispatched_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_dispatches_team_check') then
    alter table public.report_dispatches add constraint report_dispatches_team_check
      check (team in ('MDRRMO Rescue','BFP','PNP','Barangay Tanod','Ambulance'));
  end if;
end $$;

create index if not exists report_dispatches_report_idx
  on public.report_dispatches (report_id, dispatched_at desc);

alter table public.report_dispatches enable row level security;

-- readable by LGU, officials of the report's barangay, and the reporter.
-- No insert/update/delete policy: rows are written only by dispatch_report().
drop policy if exists report_dispatches_read on public.report_dispatches;
create policy report_dispatches_read on public.report_dispatches
  for select to authenticated using (
    public.is_lgu()
    or exists (
      select 1 from public.reports r
       where r.id = report_id
         and (r.reporter_id = auth.uid()
              or (public.is_official() and r.barangay_id = public.my_barangay_id()))
    )
  );

create or replace function public.dispatch_report(
  p_report_id    uuid,
  p_team         text,
  p_instructions text,
  p_eta          timestamptz
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_brgy uuid;
  v_name text;
  v_row  public.reports;
  v_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select role, barangay_id, coalesce(full_name, '')
    into v_role, v_brgy, v_name
    from public.profiles where id = auth.uid();

  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can dispatch a response';
  end if;
  if p_team not in ('MDRRMO Rescue','BFP','PNP','Barangay Tanod','Ambulance') then
    raise exception 'Choose a responder team from the list';
  end if;
  if coalesce(trim(p_instructions), '') = '' then
    raise exception 'Write what the responders are supposed to do';
  end if;
  if p_eta is null or p_eta < now() - interval '5 minutes' then
    raise exception 'The ETA must be a time from now onward';
  end if;

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;
  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_row.status not in ('verified', 'dispatched') then
    raise exception 'Verify the report before dispatching a response (it is "%")', v_row.status;
  end if;

  insert into public.report_dispatches
    (report_id, team, instructions, eta, dispatched_by, dispatched_by_name)
  values
    (p_report_id, p_team, trim(p_instructions), p_eta, auth.uid(), v_name)
  returning id into v_id;

  -- first dispatch moves the status; extra teams on an already-dispatched
  -- incident only add a record
  if v_row.status = 'verified' then
    perform public.advance_report_status(
      p_report_id, 'dispatched', p_team || ': ' || left(trim(p_instructions), 120));
  end if;

  perform public.write_audit('report.dispatched', 'reports', p_report_id,
    jsonb_build_object('dispatch_id', v_id, 'team', p_team,
                       'eta', p_eta, 'instructions', left(trim(p_instructions), 300)));

  return jsonb_build_object('id', v_id, 'team', p_team, 'eta', p_eta,
                            'dispatched_by', v_name, 'dispatched_at', now());
end;
$$;

revoke all on function public.dispatch_report(uuid, text, text, timestamptz) from public;
grant execute on function public.dispatch_report(uuid, text, text, timestamptz) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 135_rename_tanod_to_response_team.sql
-- ============================================================================
--  UniGuard · 035 · Rename "Barangay Tanod" → "Barangay Response Team" + per-barangay dispatch notification
--
--  LGU feedback: the "Barangay Tanod" responder label is retired. The team is
--  now an organized per-barangay response unit called "Barangay Response Team",
--  and every time a response team is dispatched to a barangay the residents and
--  officials of that barangay must receive an in-app notification so they are
--  alerted a team has been pushed to them.
--
--  This migration is additive + idempotent:
--    · swaps the report_dispatches.team CHECK constraint for one that accepts
--      'Barangay Response Team' instead of 'Barangay Tanod'
--    · back-fills any existing rows
--    · adds a fanout_dispatch() helper that inserts a per-recipient
--      notification row for every (non-disabled) profile whose barangay_id
--      matches the dispatched report's barangay_id
--    · redefines dispatch_report() to accept the new team name and to call
--      fanout_dispatch() after the dispatch record is written
-- ============================================================================

  -- ---------------------------------------------------------------- team rename
  alter table public.report_dispatches drop constraint if exists report_dispatches_team_check;

  alter table public.report_dispatches add constraint report_dispatches_team_check
    check (team in ('MDRRMO Rescue','BFP','PNP','Barangay Response Team','Ambulance'));

  update public.report_dispatches
     set team = 'Barangay Response Team'
   where team = 'Barangay Tanod';

  -- --------------------------------------- fan-out a dispatch notification
  -- Inserts one row per resident/official of the report's barangay (and the
  -- reporter themselves) so the in-app inbox + bell badge reflect that a
  -- response team has been pushed to them. Mirrors fanout_advisory's shape.
  create or replace function public.fanout_dispatch(
    p_report_id    uuid,
    p_team         text,
    p_instructions text
  )
  returns int
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_row      public.reports;
    v_brgy_id  uuid;
    v_title    text;
    v_body     text;
    v_inserted int := 0;
  begin
    select * into v_row from public.reports where id = p_report_id;
    if v_row.id is null then
      return 0;
    end if;

    v_brgy_id := v_row.barangay_id;
    v_title  := 'Response team dispatched to ' || coalesce(v_row.barangay, 'your barangay');
    v_body   := left(p_team || ': ' || coalesce(p_instructions, ''), 240);

    with targets as (
      select p.id
        from public.profiles p
       where p.disabled = false
         and (
           p.id = v_row.reporter_id
           or (v_brgy_id is not null and p.barangay_id = v_brgy_id)
           or p.role in ('lgu_ldrrmc')
         )
    ), ins as (
      insert into public.notifications (user_id, title, body, tone, icon, report_id)
      select id, v_title, v_body, 'warning', 'truck', v_row.id from targets
      returning 1
    )
    select count(*) into v_inserted from ins;

    return v_inserted;
  end;
  $$;

  revoke all on function public.fanout_dispatch(uuid, text, text) from public;
  grant execute on function public.fanout_dispatch(uuid, text, text) to authenticated;

  -- ----------------------------------------- redefine dispatch_report()
  -- Same behaviour as 034 (role + barangay scope + verified/dispatched guard +
  -- first-dispatch status move + audit row), with two changes:
  --   · the team CHECK accepts 'Barangay Response Team'
  --   · after the dispatch record is written, fanout_dispatch() notifies the
  --     report's barangay that a response team is en route
  create or replace function public.dispatch_report(
    p_report_id    uuid,
    p_team         text,
    p_instructions text,
    p_eta          timestamptz
  )
  returns jsonb
  language plpgsql
  security definer set search_path = public
  as $$
  declare
    v_role text;
    v_brgy uuid;
    v_name text;
    v_row  public.reports;
    v_id   uuid;
    v_notified int := 0;
  begin
    if auth.uid() is null then
      raise exception 'You must be signed in';
    end if;

    select role, barangay_id, coalesce(full_name, '')
      into v_role, v_brgy, v_name
      from public.profiles where id = auth.uid();

    if v_role not in ('barangay_official', 'lgu_ldrrmc') then
      raise exception 'Only officials and LGU can dispatch a response';
    end if;
    if p_team not in ('MDRRMO Rescue','BFP','PNP','Barangay Response Team','Ambulance') then
      raise exception 'Choose a responder team from the list';
    end if;
    if coalesce(trim(p_instructions), '') = '' then
      raise exception 'Write what the responders are supposed to do';
    end if;
    if p_eta is null or p_eta < now() - interval '5 minutes' then
      raise exception 'The ETA must be a time from now onward';
    end if;

    select * into v_row from public.reports where id = p_report_id;
    if v_row.id is null then
      raise exception 'That report does not exist';
    end if;
    if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
      raise exception 'That report is outside your barangay';
    end if;
    if v_row.status not in ('verified', 'dispatched') then
      raise exception 'Verify the report before dispatching a response (it is "%")', v_row.status;
    end if;

    insert into public.report_dispatches
      (report_id, team, instructions, eta, dispatched_by, dispatched_by_name)
    values
      (p_report_id, p_team, trim(p_instructions), p_eta, auth.uid(), v_name)
    returning id into v_id;

    -- first dispatch moves the status; extra teams on an already-dispatched
    -- incident only add a record
    if v_row.status = 'verified' then
      perform public.advance_report_status(
        p_report_id, 'dispatched', p_team || ': ' || left(trim(p_instructions), 120));
    end if;

    perform public.write_audit('report.dispatched', 'reports', p_report_id,
      jsonb_build_object('dispatch_id', v_id, 'team', p_team,
                         'eta', p_eta, 'instructions', left(trim(p_instructions), 300)));

    -- notify the report's barangay (residents + officials + LGU + reporter)
    -- that a response team has been pushed to them.
    v_notified := public.fanout_dispatch(p_report_id, p_team, trim(p_instructions));

    return jsonb_build_object('id', v_id, 'team', p_team, 'eta', p_eta,
                              'dispatched_by', v_name, 'dispatched_at', now(),
                              'notified', v_notified);
  end;
  $$;

  revoke all on function public.dispatch_report(uuid, text, text, timestamptz) from public;
  grant execute on function public.dispatch_report(uuid, text, text, timestamptz) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 136_escalation_policy.sql
-- ============================================================================
--  UniGuard · 036 · Escalation policy: stale reports, severity bypass, LGU verify
--
--  Three operational gaps closed with no new infrastructure:
--
--  1. AUTO-ESCALATION OF STALE REPORTS
--     A report stuck in "reported" for > 30 minutes is surfaced to the LGU
--     main queue with a "Stale: not yet verified by barangay" badge, so an
--     absent barangay official is no longer a single point of failure.
--     Implemented in the reports_feed VIEW (a time check), not a cron job.
--
--  2. SEVERITY BYPASS
--     Life-safety hazards (fire, power line, vehicular accident, landslide)
--     skip the 30-minute wait and are surfaced to the LGU immediately even
--     if still unverified. A real fire must not depend on a barangay
--     official being online. Also a view-time check.
--
--  3. LGU-VERIFIED SECOND PATH
--     LGU/LDRRMC can mark a report "LGU-verified" when a barangay is
--     inactive. Both barangay-official verify and LGU verify move the
--     report to 'verified'; the new columns verified_by_role + verified_by
--     + verified_at record WHO did it so the two levels are distinguishable
--     in the audit log and on the incident detail screen.
--
--  Additive + idempotent. No existing rows are rewritten.
-- ============================================================================

-- ------------------------------------------------------- 3 · who verified it
alter table public.reports add column if not exists verified_by     uuid references public.profiles(id) on delete set null;
alter table public.reports add column if not exists verified_by_name text not null default '';
alter table public.reports add column if not exists verified_by_role text not null default '';
alter table public.reports add column if not exists verified_at     timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_verified_by_role_check'
  ) then
    alter table public.reports add constraint reports_verified_by_role_check
      check (verified_by_role in ('','barangay_official','lgu_ldrrmc'));
  end if;
end $$;

create index if not exists reports_verified_at_idx on public.reports (verified_at desc nulls last);

-- ------------------------------------------------ 3 · lgu_verify_report RPC
-- Moves reported -> verified and stamps verified_by / verified_by_name /
-- verified_by_role / verified_at. Only LGU/LDRRMC may call it. The existing
-- guard_report_status trigger (migration 028) still permits reported -> verified
-- so the one-step rule is respected; this RPC just records the extra metadata
-- and writes an audit row.
create or replace function public.lgu_verify_report(p_report_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row    public.reports;
  v_role   text;
  v_name   text;
  v_brgy   uuid;
  v_reporter uuid;
  v_code   text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select role, barangay_id, coalesce(full_name, '')
    into v_role, v_brgy, v_name
    from public.profiles where id = auth.uid();

  if v_role is null then
    raise exception 'Your account could not be loaded';
  end if;
  if v_role <> 'lgu_ldrrmc' then
    raise exception 'Only LGU / LDRRMC can LGU-verify a report';
  end if;

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;
  if v_row.status <> 'reported' then
    raise exception 'Only a report still in "reported" can be LGU-verified (it is "%")', v_row.status;
  end if;

  perform set_config('uniguard.reason', 'lgu_verify', true);
  perform set_config('uniguard.note',  coalesce(p_note, ''), true);

  update public.reports
     set status           = 'verified',
         verified_by      = auth.uid(),
         verified_by_name = v_name,
         verified_by_role = 'lgu_ldrrmc',
         verified_at     = now()
   where id = p_report_id
   returning * into v_row;

  perform public.write_audit('report.lgu_verified', 'reports', p_report_id,
    jsonb_build_object('note', left(coalesce(p_note, ''), 300),
                        'verified_by', v_name));

  -- tell the reporter so the gap is not a blind spot for them either
  v_reporter := v_row.reporter_id;
  v_code     := coalesce(v_row.code, '');
  if v_reporter is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_reporter,
            'Your report was LGU-verified',
            'Report ' || v_code || ' was verified by the Municipal DRRMO' ||
              case when coalesce(p_note, '') <> '' then ' — ' || left(p_note, 140) else '' end,
            'prepared', 'shield', 'report_status', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'verified_by', v_name, 'verified_by_role', 'lgu_ldrrmc');
end;
$$;

revoke all on function public.lgu_verify_report(uuid, text) from public;
grant execute on function public.lgu_verify_report(uuid, text) to authenticated;

-- ------------------------------------------- 3 · extend advance_report_status
-- The barangay-official verify path also goes through advance_report_status
-- (migration 028). Stamp the verified_* columns there too, so both verify
-- paths record who did it and at what level. The LGU path uses lgu_verify_report
-- above (so it can carry a note + audit action of its own); the barangay path
-- lands here. Redefining the function preserves 028's one-step guard + scope
-- checks + reporter notification, and only adds the verified_* stamping.
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.reports;
  v_role     text;
  v_brgy     uuid;
  v_name     text;
  v_reporter uuid;
  v_code     text;
  v_tone     text;
  v_title    text;
  v_body     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('verified', 'dispatched', 'resolved', 'rejected') then
    raise exception 'Unknown status: %', p_next;
  end if;

  select role, barangay_id, coalesce(full_name, '')
    into v_role, v_brgy, v_name
    from public.profiles where id = auth.uid();

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can change an incident status';
  end if;

  if not (
       (v_row.status = 'reported'   and p_next in ('verified', 'rejected'))
    or (v_row.status = 'verified'   and p_next in ('dispatched', 'rejected'))
    or (v_row.status = 'dispatched' and p_next in ('resolved', 'rejected'))
  ) then
    raise exception 'A report in "%" cannot move to "%". Move one step at a time; resolved and rejected are final.', v_row.status, p_next;
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  if p_next = 'verified' then
    -- record WHO verified + at what level. LGU calling advance_report_status
    -- to verify is allowed but the dedicated lgu_verify_report RPC is
    -- preferred (it carries its own audit action); either way the columns
    -- are stamped correctly here.
    update public.reports
       set status           = 'verified',
           verified_by      = auth.uid(),
           verified_by_name = v_name,
           verified_by_role = v_role,
           verified_at     = now()
     where id = p_report_id
     returning * into v_row;
  else
    update public.reports set status = p_next where id = p_report_id returning * into v_row;
  end if;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('from', v_row.status, 'to', p_next, 'note', coalesce(p_note, ''),
                       'verified_by_role', case when p_next = 'verified' then v_role else null end));

  v_reporter := v_row.reporter_id;
  v_code     := coalesce(v_row.code, '');
  if v_reporter is not null then
    v_tone  := case p_next when 'dispatched' then 'warning' when 'resolved' then 'prepared'
                            when 'rejected'  then 'warning' else 'advisory' end;
    v_title := case p_next
      when 'verified'   then 'Your report was verified'
      when 'dispatched' then 'Response dispatched to your report'
      when 'resolved'   then 'Your report is resolved'
      when 'rejected'   then 'Your report was rejected'
      else 'Your report status changed'
    end;
    v_body  := case p_next
      when 'verified'   then 'Report ' || v_code || ' was reviewed and verified' ||
                            case when v_role = 'lgu_ldrrmc' then ' by the Municipal DRRMO.' else '.' end
      when 'dispatched' then 'A responder unit has been dispatched for ' || v_code || '.'
      when 'resolved'   then 'Report ' || v_code || ' is resolved. Closing note: ' || left(coalesce(p_note, ''), 140)
      when 'rejected'   then 'Report ' || v_code || ' was rejected: ' || left(coalesce(p_note, ''), 140)
      else 'Report ' || v_code || ' is now ' || p_next || '.'
    end;
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_reporter, v_title, v_body, v_tone, 'check', 'report_status', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;

revoke all on function public.advance_report_status(uuid, text, text) from public;
grant execute on function public.advance_report_status(uuid, text, text) to authenticated;

-- ------------------------------------------- 1 + 2 · escalate via the feed view
-- Rebuild reports_feed so the same SELECT returns every row the caller may
-- already see, PLUS two computed booleans:
--   is_stale       — reported > 30 minutes, never verified, not a bypass hazard
--   escalates_to_lgu — is_stale OR a life-safety hazard (fire, power line,
--                      vehicular accident, landslide) still in 'reported'.
-- The LGU queue reads escalates_to_lgu so stale + life-safety reports always
-- land in front of the duty officer without waiting on a barangay official.
-- The barangay official's own queue is unaffected: they still see their own
-- reported rows; the escalation only widens LGU visibility.
-- (The original feed's WHERE clause is preserved verbatim.)
drop view if exists public.reports_feed;

create view public.reports_feed as
select
    r.id,
    r.code,
    r.barangay_id,
    r.barangay,
    r.hazard_type,
    r.hazard_other_text,
    r.severity,
    r.urgency,
    r.status,
    r.description,
    r.lat,
    r.lng,
    r.photo_path,
    r.created_at,
    r.updated_at,
    r.resolved_at,
    r.verified_by,
    r.verified_by_name,
    r.verified_by_role,
    r.verified_at,
    (
        select count(*)
        from public.report_corroborations c
        where c.report_id = r.id
    ) as corroborations,
    (r.reporter_id = auth.uid()) as is_mine,
    /* 1. stale: reported > 30 min, never verified */
    ( r.status = 'reported'
      and r.verified_at is null
      and r.created_at < now() - interval '30 minutes'
    ) as is_stale,
    /* 2. severity bypass: life-safety hazard still unverified */
    ( r.status = 'reported'
      and r.hazard_type in ('fire','power_line','vehicular_accident','landslide')
    ) as is_severity_bypass,
    /* the OR the LGU queue actually filters on */
    ( r.status = 'reported'
      and (
        ( r.verified_at is null
          and r.created_at < now() - interval '30 minutes' )
        or r.hazard_type in ('fire','power_line','vehicular_accident','landslide')
      )
    ) as escalates_to_lgu
from public.reports r
where
    r.reporter_id = auth.uid()
    or public.is_lgu()
    or (
        public.is_official()
        and r.barangay_id = public.my_barangay_id()
    )
    or (
        r.barangay_id is not null
        and r.barangay_id = public.my_barangay_id()
    );

alter view public.reports_feed set(security_invoker = false);

grant select on public.reports_feed to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 137_fix_evacuation_read_policy.sql
drop policy if exists evacuation_read on public.evacuation_centers;

create policy evacuation_read on public.evacuation_centers for
select to authenticated using (true);

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 138_dispatch_units.sql
-- ============================================================================
--  UniGuard · 038 · Dispatch units (Part C of the Dispatch Team feature)
--
--  Introduces a 4th role `dispatch_team` and the municipality-wide units
--  (BFP, PNP, Rescue, Hospital) plus the barangay-owned Response Team
--  equipment, personnel, shifts, hospital capacity and patient notices,
--  support requests, equipment catalogs, and the audit trail for dispatch
--  events.
--
--  Additive + idempotent. Never edits a previous migration. The new
--  `dispatch_team` role joins `citizen`, `barangay_official` and
--  `lgu_ldrrmc` in `profiles_role_check`; the old roles are unaffected.
--
--  The barangay Response Team is NOT a dispatch_units row. It is the
--  barangay itself, using `responders` (migration 007) plus the new
--  `responders.status` column and the new barangay equipment rows on
--  `dispatch_equipment` (owner_barangay_id set, owner_unit_id null).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------- role helper additions
-- The new role lives alongside the existing three. The CHECK on profiles
-- is widened to accept it; the guard_profile_fields trigger (migration
-- 021) is extended below to protect dispatch_unit_id and unit_role the
-- same way it protects role, barangay_id and disabled.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles add constraint profiles_role_check
      check (role in ('citizen','barangay_official','lgu_ldrrmc','dispatch_team'));
  else
    -- drop and re-add so the new role is accepted even if the project was
    -- migrated before this file ran. The check is the only thing that
    -- changes; no data is touched.
    alter table public.profiles drop constraint profiles_role_check;
    alter table public.profiles add constraint profiles_role_check
      check (role in ('citizen','barangay_official','lgu_ldrrmc','dispatch_team'));
  end if;
end $$;

alter table public.profiles add column if not exists dispatch_unit_id uuid;
alter table public.profiles add column if not exists unit_role       text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_unit_role_check'
  ) then
    alter table public.profiles add constraint profiles_unit_role_check
      check (unit_role in ('','unit_admin','member'));
  end if;
end $$;

-- a dispatch_team account must carry a unit; the other three roles must not.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_dispatch_team_unit_check'
  ) then
    alter table public.profiles add constraint profiles_dispatch_team_unit_check
      check (
        (role = 'dispatch_team'  and dispatch_unit_id is not null and unit_role in ('unit_admin','member'))
        or
        (role <> 'dispatch_team' and dispatch_unit_id is null and unit_role = '')
      );
  end if;
end $$;

-- --------------------------------------------------------- role helper functions
-- [this project] moved up from further down: the policies below use them.
create or replace function public.is_dispatch()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'dispatch_team';
$$;

create or replace function public.is_unit_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'dispatch_team'
     and coalesce((select unit_role from public.profiles where id = auth.uid()), '') = 'unit_admin';
$$;

create or replace function public.my_unit_id()
returns uuid language sql stable security definer set search_path = public as $$
  select dispatch_unit_id from public.profiles where id = auth.uid();
$$;

-- -------------------------------------------------------- dispatch_units
create table if not exists public.dispatch_units (
  id             uuid primary key default gen_random_uuid(),
  name           text not null default '',
  unit_type      text not null,
  contact_number text not null default '',
  address        text not null default '',
  lat            double precision,
  lng            double precision,
  status         text not null default 'available',
  active          boolean not null default true,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatch_units_unit_type_check') then
    alter table public.dispatch_units add constraint dispatch_units_unit_type_check
      check (unit_type in ('BFP','PNP','Rescue','Hospital'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispatch_units_status_check') then
    alter table public.dispatch_units add constraint dispatch_units_status_check
      check (status in ('available','on_duty','off_duty'));
  end if;
end $$;

create index if not exists dispatch_units_type_idx   on public.dispatch_units (unit_type, active);
create index if not exists dispatch_units_status_idx  on public.dispatch_units (status, active);

alter table public.dispatch_units enable row level security;

-- everyone signed in can see the municipality-wide directory (read only).
-- writes are LGU only — no policy for insert/update/delete, the RPC handles it.
drop policy if exists dispatch_units_read on public.dispatch_units;
create policy dispatch_units_read on public.dispatch_units
  for select to authenticated using (true);

-- ---------------------------------------------------------- equipment_catalog
-- Per unit_type and a special 'Barangay' type for the barangay Response Team
-- catalog. Each row is one equipment label plus its readiness checklist items.
create table if not exists public.equipment_catalog (
  id            uuid primary key default gen_random_uuid(),
  unit_type     text not null,
  label         text not null,
  checklist     jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_catalog_unit_type_check') then
    alter table public.equipment_catalog add constraint equipment_catalog_unit_type_check
      check (unit_type in ('BFP','PNP','Rescue','Hospital','Barangay'));
  end if;
end $$;

create index if not exists equipment_catalog_type_idx on public.equipment_catalog (unit_type);

alter table public.equipment_catalog enable row level security;
drop policy if exists equipment_catalog_read on public.equipment_catalog;
create policy equipment_catalog_read on public.equipment_catalog
  for select to authenticated using (true);

-- --------------------------------------------------------- dispatch_equipment
-- A piece of equipment belongs to exactly one owner: a unit OR a barangay.
create table if not exists public.dispatch_equipment (
  id                uuid primary key default gen_random_uuid(),
  owner_unit_id     uuid references public.dispatch_units(id) on delete cascade,
  owner_barangay_id uuid references public.barangays(id) on delete cascade,
  catalog_id        uuid references public.equipment_catalog(id) on delete set null,
  custom_label      text not null default '',
  identifier        text not null default '',
  status            text not null default 'available',
  condition         text not null default 'unknown',
  last_checked_at   timestamptz,
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatch_equipment_owner_check') then
    alter table public.dispatch_equipment add constraint dispatch_equipment_owner_check
      check (
        (owner_unit_id is not null and owner_barangay_id is null)
        or
        (owner_unit_id is null and owner_barangay_id is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispatch_equipment_status_check') then
    alter table public.dispatch_equipment add constraint dispatch_equipment_status_check
      check (status in ('available','deployed','maintenance','unavailable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispatch_equipment_condition_check') then
    alter table public.dispatch_equipment add constraint dispatch_equipment_condition_check
      check (condition in ('ready','needs_repair','missing','out_of_service','unknown'));
  end if;
end $$;

create index if not exists dispatch_equipment_unit_idx    on public.dispatch_equipment (owner_unit_id);
create index if not exists dispatch_equipment_brgy_idx    on public.dispatch_equipment (owner_barangay_id);
create index if not exists dispatch_equipment_status_idx  on public.dispatch_equipment (status, condition);

alter table public.dispatch_equipment enable row level security;

-- A unit member reads/writes their own unit's equipment. The barangay
-- official reads/writes their own barangay's equipment. Officials and LGU
-- can READ every unit's equipment (read-only readiness summary).
drop policy if exists dispatch_equipment_read on public.dispatch_equipment;
create policy dispatch_equipment_read on public.dispatch_equipment
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and owner_unit_id = public.my_unit_id())
  );

drop policy if exists dispatch_equipment_write on public.dispatch_equipment;
create policy dispatch_equipment_write on public.dispatch_equipment
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_dispatch() and public.is_unit_admin() and owner_unit_id = public.my_unit_id())
    or (public.is_official() and owner_barangay_id = public.my_barangay_id())
  )
  with check (
    public.is_lgu()
    or (public.is_dispatch() and public.is_unit_admin() and owner_unit_id = public.my_unit_id())
    or (public.is_official() and owner_barangay_id = public.my_barangay_id())
  );

-- -------------------------------------------------------------- equipment_checks
create table if not exists public.equipment_checks (
  id           uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.dispatch_equipment(id) on delete cascade,
  checked_by   uuid references public.profiles(id) on delete set null,
  checked_at   timestamptz not null default now(),
  condition    text not null default 'unknown',
  level        text not null default '',
  notes        text not null default '',
  photo        text,
  items        jsonb not null default '[]'::jsonb
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_checks_condition_check') then
    alter table public.equipment_checks add constraint equipment_checks_condition_check
      check (condition in ('ready','needs_repair','missing','out_of_service','unknown'));
  end if;
end $$;

create index if not exists equipment_checks_eq_idx on public.equipment_checks (equipment_id, checked_at desc);

alter table public.equipment_checks enable row level security;

drop policy if exists equipment_checks_read on public.equipment_checks;
create policy equipment_checks_read on public.equipment_checks
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and exists (
      select 1 from public.dispatch_equipment e
       where e.id = equipment_id and e.owner_unit_id = public.my_unit_id())
    )
  );

-- no insert/update policy: rows go in through the security definer RPC.

-- ----------------------------------------------------- dispatch_equipment_use
-- Tracks which dispatch a piece of equipment is currently deployed to.
-- A partial unique index on equipment_id WHERE released_at IS NULL means
-- one piece of equipment cannot be on two active dispatches.
create table if not exists public.dispatch_equipment_use (
  id          uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.report_dispatches(id) on delete cascade,
  equipment_id uuid not null references public.dispatch_equipment(id) on delete cascade,
  released_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists dispatch_equipment_use_dispatch_idx on public.dispatch_equipment_use (dispatch_id) where released_at is null;
create index if not exists dispatch_equipment_use_dispatch_all_idx on public.dispatch_equipment_use (dispatch_id);
-- the partial unique index that prevents double-booking equipment
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'dispatch_equipment_use'
       and indexname = 'dispatch_equipment_use_one_active_idx'
  ) then
    create unique index dispatch_equipment_use_one_active_idx
      on public.dispatch_equipment_use (equipment_id)
      where released_at is null;
  end if;
end $$;

alter table public.dispatch_equipment_use enable row level security;

drop policy if exists dispatch_equipment_use_read on public.dispatch_equipment_use;
create policy dispatch_equipment_use_read on public.dispatch_equipment_use
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and exists (
      select 1 from public.dispatch_equipment e
       where e.id = equipment_id and e.owner_unit_id = public.my_unit_id())
    )
  );

-- ---------------------------------------------------------------- hospital_capacity
create table if not exists public.hospital_capacity (
  unit_id     uuid primary key references public.dispatch_units(id) on delete cascade,
  er_beds     int not null default 0,
  icu_beds    int not null default 0,
  available   int not null default 0,
  accepting   boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.hospital_capacity enable row level security;

drop policy if exists hospital_capacity_read on public.hospital_capacity;
create policy hospital_capacity_read on public.hospital_capacity
  for select to authenticated using (true);

-- writes through security definer RPC only (set_hospital_capacity)

-- ----------------------------------------------------------------- patient_notices
create table if not exists public.patient_notices (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references public.dispatch_units(id) on delete cascade,
  report_id  uuid references public.reports(id) on delete set null,
  patients   int not null default 1,
  condition  text not null default '',
  eta        timestamptz,
  sent_by    uuid references public.profiles(id) on delete set null,
  status     text not null default 'sent',
  ack_at     timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_notices_status_check') then
    alter table public.patient_notices add constraint patient_notices_status_check
      check (status in ('sent','acknowledged','arrived','cancelled'));
  end if;
end $$;

create index if not exists patient_notices_unit_idx on public.patient_notices (unit_id, created_at desc);

alter table public.patient_notices enable row level security;

drop policy if exists patient_notices_read on public.patient_notices;
create policy patient_notices_read on public.patient_notices
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
  );

-- ---------------------------------------------------------------- unit_personnel
create table if not exists public.unit_personnel (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.dispatch_units(id) on delete cascade,
  name        text not null default '',
  role        text not null default '',
  phone       text not null default '',
  on_duty     boolean not null default false,
  shift_start timestamptz,
  shift_end   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists unit_personnel_unit_idx on public.unit_personnel (unit_id, on_duty);

alter table public.unit_personnel enable row level security;

drop policy if exists unit_personnel_read on public.unit_personnel;
create policy unit_personnel_read on public.unit_personnel
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
  );

drop policy if exists unit_personnel_write on public.unit_personnel;
create policy unit_personnel_write on public.unit_personnel
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_dispatch() and public.is_unit_admin() and unit_id = public.my_unit_id())
  )
  with check (
    public.is_lgu()
    or (public.is_dispatch() and public.is_unit_admin() and unit_id = public.my_unit_id())
  );

-- ----------------------------------------------------------------- unit_shifts
create table if not exists public.unit_shifts (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.dispatch_units(id) on delete cascade,
  personnel_id uuid references public.unit_personnel(id) on delete cascade,
  start_at    timestamptz not null default now(),
  end_at      timestamptz,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists unit_shifts_unit_idx on public.unit_shifts (unit_id, start_at desc);

alter table public.unit_shifts enable row level security;

drop policy if exists unit_shifts_read on public.unit_shifts;
create policy unit_shifts_read on public.unit_shifts
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
  );

-- ----------------------------------------------------------------- unit_requests
create table if not exists public.unit_requests (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.dispatch_units(id) on delete cascade,
  kind        text not null default '',
  details     text not null default '',
  status      text not null default 'pending',
  created_by  uuid references public.profiles(id) on delete set null,
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'unit_requests_status_check') then
    alter table public.unit_requests add constraint unit_requests_status_check
      check (status in ('pending','approved','declined','done'));
  end if;
end $$;

create index if not exists unit_requests_unit_idx on public.unit_requests (unit_id, created_at desc);

alter table public.unit_requests enable row level security;

drop policy if exists unit_requests_read on public.unit_requests;
create policy unit_requests_read on public.unit_requests
  for select to authenticated using (
    public.is_lgu()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
  );

-- ----------------------------------------------------- extend report_dispatches
-- [this project] moved above the dispatch events section, which reads unit_id.
alter table public.report_dispatches add column if not exists unit_id            uuid;
alter table public.report_dispatches add column if not exists target_barangay_id uuid;
alter table public.report_dispatches add column if not exists dispatch_status    text not null default 'sent';
alter table public.report_dispatches add column if not exists ack_at            timestamptz;
alter table public.report_dispatches add column if not exists en_route_at       timestamptz;
alter table public.report_dispatches add column if not exists on_scene_at        timestamptz;
alter table public.report_dispatches add column if not exists done_at           timestamptz;
alter table public.report_dispatches add column if not exists after_action      text not null default '';
alter table public.report_dispatches add column if not exists after_action_at   timestamptz;
alter table public.report_dispatches add column if not exists after_action_by   uuid;
alter table public.report_dispatches add column if not exists after_action_meta jsonb not null default '{}'::jsonb;

-- widen the team check to accept 'Rescue Unit' (from unit_type 'Rescue'),
-- keeping all previously allowed values
alter table public.report_dispatches drop constraint if exists report_dispatches_team_check;
alter table public.report_dispatches add constraint report_dispatches_team_check
  check (team in ('MDRRMO Rescue','BFP','PNP','Barangay Response Team','Ambulance','Rescue Unit'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_dispatches_status_check') then
    alter table public.report_dispatches add constraint report_dispatches_status_check
      check (dispatch_status in ('sent','acknowledged','en_route','on_scene','done'));
  end if;
end $$;

create index if not exists report_dispatches_unit_idx      on public.report_dispatches (unit_id, dispatched_at desc);
create index if not exists report_dispatches_brgy_idx      on public.report_dispatches (target_barangay_id, dispatched_at desc);
create index if not exists report_dispatches_status_idx    on public.report_dispatches (dispatch_status, dispatched_at desc);

-- [this project] PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS; guard by name.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_dispatches_unit_fkey') then
    alter table public.report_dispatches add constraint report_dispatches_unit_fkey
      foreign key (unit_id) references public.dispatch_units(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'report_dispatches_target_brgy_fkey') then
    alter table public.report_dispatches add constraint report_dispatches_target_brgy_fkey
      foreign key (target_barangay_id) references public.barangays(id) on delete set null;
  end if;
end $$;

-- Update the read policy so the dispatched unit's members can read it too.
drop policy if exists report_dispatches_read on public.report_dispatches;
create policy report_dispatches_read on public.report_dispatches
  for select to authenticated using (
    public.is_lgu()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
    or exists (
      select 1 from public.reports r
       where r.id = report_id
         and (r.reporter_id = auth.uid()
              or (public.is_official() and r.barangay_id = public.my_barangay_id()))
    )
  );

-- ----------------------------------------------------------------- dispatch events
-- Per-dispatch timeline. Each action (acknowledge, en route, on scene, done)
-- is one row, written by the dispatch_respond RPC. Visible to LGU, the
-- report's barangay officials and the dispatched unit.
create table if not exists public.report_dispatch_events (
  id          uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.report_dispatches(id) on delete cascade,
  actor       uuid references public.profiles(id) on delete set null,
  actor_name  text not null default '',
  action      text not null default '',
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists report_dispatch_events_dispatch_idx on public.report_dispatch_events (dispatch_id, created_at);

alter table public.report_dispatch_events enable row level security;

drop policy if exists report_dispatch_events_read on public.report_dispatch_events;
create policy report_dispatch_events_read on public.report_dispatch_events
  for select to authenticated using (
    public.is_lgu()
    or (public.is_dispatch() and exists (
      select 1 from public.report_dispatches d
       where d.id = dispatch_id and d.unit_id = public.my_unit_id())
    )
    or exists (
      select 1 from public.report_dispatches d
       join public.reports r on r.id = d.report_id
      where d.id = dispatch_id
        and (public.is_official() and r.barangay_id = public.my_barangay_id())
    )
  );

-- ----------------------------------------------------------------- responders
-- Add a status column for the barangay Response Team roster (Available /
-- On duty / Off duty). On duty is set automatically on assignment and
-- cleared on release (trigger below).
alter table public.responders add column if not exists status text not null default 'available';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'responders_status_check') then
    alter table public.responders add constraint responders_status_check
      check (status in ('available','on_duty','off_duty'));
  end if;
end $$;

-- Tighten the existing read policy: officials see only their own barangay's
-- responders (plus LGU). The previous policy let any official see every
-- responder; that is no longer appropriate.
drop policy if exists responders_read on public.responders;
create policy responders_read on public.responders
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
  );

drop policy if exists responders_write on public.responders;
create policy responders_write on public.responders
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and (barangay_id = public.my_barangay_id() or barangay_id is null))
  )
  with check (
    public.is_lgu()
    or (public.is_official() and (barangay_id = public.my_barangay_id() or barangay_id is null))
  );

-- ----------------------------------------------------- emergency_hotlines.category
alter table public.emergency_hotlines add column if not exists category text not null default 'Other';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'emergency_hotlines_category_check') then
    alter table public.emergency_hotlines add constraint emergency_hotlines_category_check
      check (category in ('BFP','PNP','Rescue Unit','Hospital','Barangay Captain','MDRRMO','Other'));
  end if;
end $$;

-- backfill category by agency name (case-insensitive substring match)
update public.emergency_hotlines set category = 'BFP'              where category = 'Other' and lower(agency_name) like '%bfp%';
update public.emergency_hotlines set category = 'PNP'              where category = 'Other' and lower(agency_name) like '%pnp%';
update public.emergency_hotlines set category = 'Rescue Unit'      where category = 'Other' and (lower(agency_name) like '%rescue%' or lower(agency_name) like '%mdrrmo%');
update public.emergency_hotlines set category = 'Hospital'         where category = 'Other' and lower(agency_name) like '%hospital%';
update public.emergency_hotlines set category = 'Barangay Captain' where category = 'Other' and (lower(agency_name) like '%captain%' or lower(agency_name) like '%barangay%');
update public.emergency_hotlines set category = 'MDRRMO'           where category = 'Other' and (lower(agency_name) like '%mdrrmo%' or lower(agency_name) like '%ldrrmc%');

-- ------------------------------------------------------------ barangays captain
alter table public.barangays add column if not exists captain_name  text not null default '';
alter table public.barangays add column if not exists captain_phone text not null default '';

-- ------------------------------------------------------ profile field guard
-- Extend guard_profile_fields so dispatch_unit_id and unit_role are also
-- protected: only LGU (or a trusted backend call with no auth.uid()) can
-- change them. A unit_admin can invite members INTO THEIR OWN UNIT through
-- the admin-users edge function (which runs as service role), but they
-- cannot re-assign themselves or anyone to a different unit through REST.
create or replace function public.guard_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  if coalesce(v_role, '') <> 'lgu_ldrrmc' then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own role';
    end if;
    if new.barangay_id is distinct from old.barangay_id then
      raise exception 'Barangay assignment is managed by your LGU administrator';
    end if;
    if new.disabled is distinct from old.disabled then
      raise exception 'Account status is managed by your LGU administrator';
    end if;
    if new.dispatch_unit_id is distinct from old.dispatch_unit_id then
      raise exception 'Unit assignment is managed by your LGU administrator';
    end if;
    if new.unit_role is distinct from old.unit_role then
      raise exception 'Unit role is managed by your LGU administrator';
    end if;
  end if;
  return new;
end;
$$;

-- -------------------------------------------------- responders on_duty trigger
-- When an assignment is created the responder is set to on_duty; when
-- released_at is set the responder returns to available. Both are
-- security definer so the assign_responder RPC (migration 007) can move
-- them without an explicit client update.
create or replace function public.sync_responder_duty()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.responders set status = 'on_duty' where id = new.responder_id;
  elsif tg_op = 'UPDATE' and new.released_at is not null and old.released_at is null then
    update public.responders set status = 'available' where id = new.responder_id;
  end if;
  return new;
end;
$$;

drop trigger if exists report_assignments_duty on public.report_assignments;
create trigger report_assignments_duty
  after insert or update on public.report_assignments
  for each row execute function public.sync_responder_duty();

-- ----------------------------------------------------- unit status auto trigger
-- When a dispatch is created the unit moves to on_duty; when every dispatch
-- for the unit is done the unit returns to available. Same pattern for the
-- barangay Response Team — but the barangay has no row in dispatch_units,
-- so we mark the barangay responders available again instead. The trigger
-- on report_dispatches handles both.
create or replace function public.sync_unit_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_open int;
begin
  if new.unit_id is not null then
    select count(*) into v_open from public.report_dispatches d
     where d.unit_id = new.unit_id and d.dispatch_status <> 'done';
    if v_open > 0 then
      update public.dispatch_units set status = 'on_duty' where id = new.unit_id;
    else
      update public.dispatch_units set status = 'available' where id = new.unit_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists report_dispatches_sync_unit on public.report_dispatches;
create trigger report_dispatches_sync_unit
  after insert or update of dispatch_status on public.report_dispatches
  for each row execute function public.sync_unit_status();

-- ----------------------------------------------------- add new tables to realtime
do $$
declare t text;
begin
  foreach t in array array[
    'dispatch_units','dispatch_equipment','equipment_checks',
    'dispatch_equipment_use','hospital_capacity','patient_notices',
    'unit_personnel','unit_shifts','unit_requests','report_dispatch_events'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when others then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------- housekeeping: updated_at
do $$
declare t text;
begin
  foreach t in array array[
    'dispatch_units','dispatch_equipment','unit_personnel',
    'unit_requests','hospital_capacity'
  ]
  loop
    if not exists (
      select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and tg.tgname = t || '_touch'
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
        t || '_touch', t);
    end if;
  end loop;
end $$;

-- Audit triggers: reuse audit_row_change from migration 033
do $$
declare t text;
begin
  foreach t in array array[
    'dispatch_units','dispatch_equipment','unit_personnel',
    'unit_shifts','unit_requests','hospital_capacity','patient_notices'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- Add report_dispatches to the audit_row_change trigger (it was not on the
-- original list because migration 034 had its own write_audit call inside
-- dispatch_report). Audit the column changes now so the dispatch_status
-- transitions are visible.
do $$
begin
  execute 'drop trigger if exists report_dispatches_audit on public.report_dispatches';
  execute 'create trigger report_dispatches_audit after insert or update or delete on public.report_dispatches for each row execute function public.audit_row_change()';
end $$;

-- Revoke any default grants that might have leaked; grant select to authenticated
grant select on public.dispatch_units to authenticated;
grant select on public.equipment_catalog to authenticated;
grant select on public.dispatch_equipment to authenticated;
grant select on public.equipment_checks to authenticated;
grant select on public.dispatch_equipment_use to authenticated;
grant select on public.hospital_capacity to authenticated;
grant select on public.patient_notices to authenticated;
grant select on public.unit_personnel to authenticated;
grant select on public.unit_shifts to authenticated;
grant select on public.unit_requests to authenticated;
grant select on public.report_dispatch_events to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 139_dispatch_report_v2.sql
-- ============================================================================
--  UniGuard · 039 · dispatch_report_v2 + fanout_dispatch v2 (Part D)
--
--  Rewrites the dispatch pipeline so a Barangay Response Team dispatch
--  targets the report's barangay and a municipality-wide unit dispatch
--  targets the dispatched unit, with the right people notified.
--
--  CRITICAL notification rules (from the prompt):
--    · Barangay Response Team dispatch → notify the report's barangay
--      residents and officials (action alert), the reporter and the LGU.
--      Never another barangay.
--    · Municipality-wide unit dispatch → notify the dispatched unit's
--      users, the report's barangay residents and officials (info), the
--      reporter and the LGU.
--      Never another unit, never another barangay.
--    · A barangay official may only dispatch a Response Team for their
--      own barangay; the LGU may send mutual aid to any barangay.
--    · A dispatch_team user is notified ONLY for dispatches addressed
--      to its own unit.
--    · Hospitals never receive a field dispatch; they receive patient
--      notices (migration 040 / set_hospital_capacity RPC handles those).
--
--  drop function is drop-if-exists; the previous 3-arg fanout_dispatch
--  signature is removed first to avoid an ambiguous-overload error.
--
--  Additive + idempotent. The old dispatch_report(uuid, text, text,
--  timestamptz) is kept as a thin wrapper that calls dispatch_report_v2
--  so the existing client (js/repo.js) does not need a parallel upgrade.
-- ============================================================================

-- ------------------------------------------------------ drop the old signatures
-- The 3-arg fanout_dispatch(report_id, team, instructions) is gone; the
-- new one takes (report_id, dispatch_id, team, target_barangay_id, unit_id).
drop function if exists public.fanout_dispatch(uuid, text, text);

-- Keep the existing dispatch_report wrapper behaviour (it took 4 args).
-- We replace the body so it routes to dispatch_report_v2; the wrapper is
-- used by js/repo.js. The RPC is later granted to authenticated.
drop function if exists public.dispatch_report(uuid, text, text, timestamptz);

-- ----------------------------------------------------------- new fan-out helper
-- Inserts one notification row per recipient who should know about a
-- dispatch. Recipients are computed from the team type:
--   · Barangay Response Team → residents + officials of the report's
--     barangay, plus the LGU and the reporter. The official tone is
--     'warning' (action alert).
--   · Municipality-wide unit → users of that unit only on the unit side,
--     plus the residents + officials of the report's barangay (info
--     tone), plus the LGU and the reporter.
--
-- The function takes the dispatch row so it can compute everything in one
-- shot; it does not re-read report_dispatches.
create or replace function public.fanout_dispatch(
  p_report_id          uuid,
  p_dispatch_id        uuid,
  p_team               text,
  p_target_barangay_id uuid,
  p_unit_id            uuid,
  p_instructions       text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.reports;
  v_title    text;
  v_body     text;
  v_unit_tone text;
  v_count    int := 0;
begin
  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    return 0;
  end if;

  v_title := 'Response dispatched to ' || coalesce(v_row.barangay, 'your barangay');
  v_body  := left(p_team || ': ' || coalesce(p_instructions, ''), 240);

  -- 1) reporter + LGU + report's barangay residents/officials (info or
  --    action alert depending on team). Never another barangay.
  if p_team = 'Barangay Response Team' then
    v_unit_tone := 'warning';  -- action alert, the barangay's team is going
  else
    v_unit_tone := 'advisory'; -- info, a municipality unit is coming
  end if;

  with targets as (
    select p.id
      from public.profiles p
     where p.disabled = false
       and (
         p.id = v_row.reporter_id
         or p.role in ('lgu_ldrrmc')
         or (v_row.barangay_id is not null and p.barangay_id = v_row.barangay_id)
       )
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    select id, v_title, v_body, v_unit_tone, 'truck', 'dispatch', v_row.id from targets
    returning 1
  )
  select count(*) into v_count from ins;

  -- 2) the dispatched unit's users (only when a unit is set and the team is
  --    a municipality-wide unit). Hospitals are notified only by patient
  --    notices, NOT by field dispatches. The team 'Hospital' is not in the
  --    allowed team list (it is not) so this branch is never reached for
  --    hospitals; we still guard defensively.
  if p_unit_id is not null and p_team <> 'Barangay Response Team' then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    select p.id, 'Incoming dispatch: ' || p_team,
           left(p_team || ' · ' || coalesce(p_instructions, '') ||
                ' · ' || coalesce(v_row.barangay, 'unknown barangay'), 240),
           'warning', 'truck', 'unit_dispatch', v_row.id
      from public.profiles p
     where p.disabled = false
       and p.role = 'dispatch_team'
       and p.dispatch_unit_id = p_unit_id;
  end if;

  return v_count;
end;
$$;

revoke all on function public.fanout_dispatch(uuid, uuid, text, uuid, uuid, text) from public;
grant execute on function public.fanout_dispatch(uuid, uuid, text, uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------- dispatch_report_v2
-- p_unit_id    : nullable uuid of the dispatched dispatch_units row. Required
--                for municipality-wide teams (BFP/PNP/Rescue Unit/Ambulance).
--                NULL when team = 'Barangay Response Team'.
-- p_target_barangay_id : nullable uuid. NULL when team is a municipality-wide
--                unit (the report's barangay is what matters and we read it
--                from the report row). Must equal the report's barangay_id
--                when team = 'Barangay Response Team'.
-- p_equipment_ids : uuid[] of dispatch_equipment rows. Each must belong to
--                the chosen owner (the unit OR the report's barangay) and
--                be status = 'available'. The RPC marks them deployed.
create or replace function public.dispatch_report_v2(
  p_report_id          uuid,
  p_team               text,
  p_instructions       text,
  p_eta                timestamptz,
  p_unit_id            uuid default null,
  p_target_barangay_id uuid default null,
  p_equipment_ids      uuid[] default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role     text;
  v_brgy     uuid;
  v_name     text;
  v_row      public.reports;
  v_disp_id  uuid;
  v_team     text;
  v_unit_id  uuid;
  v_target_brgy uuid;
  v_notified int := 0;
  v_eq       record;
  v_count    int := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select role, barangay_id, coalesce(full_name, '')
    into v_role, v_brgy, v_name
    from public.profiles where id = auth.uid();

  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can dispatch a response';
  end if;

  -- The team whitelist now includes 'Rescue Unit' (from a Rescue-type unit).
  if p_team not in ('MDRRMO Rescue','BFP','PNP','Barangay Response Team','Ambulance','Rescue Unit') then
    raise exception 'Choose a responder team from the list';
  end if;
  if coalesce(trim(p_instructions), '') = '' then
    raise exception 'Write what the responders are supposed to do';
  end if;
  if p_eta is null or p_eta < now() - interval '5 minutes' then
    raise exception 'The ETA must be a time from now onward';
  end if;

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  -- scope: a barangay_official cannot dispatch outside their barangay.
  -- The barangay Response Team can ONLY target the report's barangay.
  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_row.status not in ('verified', 'dispatched') then
    raise exception 'Verify the report before dispatching a response (it is "%")', v_row.status;
  end if;

  v_team := p_team;

  -- Branch: Barangay Response Team vs municipality-wide unit.
  if v_team = 'Barangay Response Team' then
    -- the team is the report's barangay's own team. The target_barangay_id
    -- passed in MUST equal the report's barangay_id; if it does not, the
    -- caller is trying to dispatch another barangay's team.
    v_target_brgy := v_row.barangay_id;
    if p_target_barangay_id is not null and p_target_barangay_id is distinct from v_row.barangay_id then
      raise exception 'A Barangay Response Team dispatch can only target the report''s barangay';
    end if;
    if v_role = 'barangay_official' and v_target_brgy is distinct from v_brgy then
      raise exception 'You cannot dispatch another barangay''s Response Team';
    end if;
    v_unit_id := null;
  else
    -- municipality-wide unit. The unit_id is required and must be active.
    if p_unit_id is null then
      raise exception 'Pick a unit to dispatch';
    end if;
    select id into v_unit_id from public.dispatch_units
     where id = p_unit_id and active = true;
    if v_unit_id is null then
      raise exception 'That unit does not exist or is not active';
    end if;
    -- the unit_type must match the team the caller picked
    if not (
      (v_team = 'BFP'        and (select unit_type from public.dispatch_units where id = v_unit_id) = 'BFP')   or
      (v_team = 'PNP'        and (select unit_type from public.dispatch_units where id = v_unit_id) = 'PNP')   or
      (v_team in ('Rescue Unit','MDRRMO Rescue') and (select unit_type from public.dispatch_units where id = v_unit_id) = 'Rescue') or
      (v_team = 'Ambulance'  and (select unit_type from public.dispatch_units where id = v_unit_id) = 'Hospital')
    ) then
      raise exception 'The unit type does not match the team you picked';
    end if;
    v_target_brgy := v_row.barangay_id;
  end if;

  -- equipment validation: each id must belong to the chosen owner and be
  -- status = available AND condition in a deployable state.
  if p_equipment_ids is not null then
    foreach v_eq in array p_equipment_ids loop
      select * into v_count from public.dispatch_equipment e
       where e.id = v_eq
         and e.status = 'available'
         and e.condition not in ('needs_repair','missing','out_of_service')
         and (
           (v_team = 'Barangay Response Team' and e.owner_barangay_id = v_target_brgy)
           or (v_team <> 'Barangay Response Team' and e.owner_unit_id = v_unit_id)
         );
      if not found then
        raise exception 'Equipment % is not available, not in a deployable condition, or not owned by the chosen team', v_eq;
      end if;
    end loop;
  end if;

  -- Write the dispatch row.
  insert into public.report_dispatches
    (report_id, team, instructions, eta, dispatched_by, dispatched_by_name,
     unit_id, target_barangay_id, dispatch_status)
  values
    (p_report_id, v_team, trim(p_instructions), p_eta, auth.uid(), v_name,
     v_unit_id, v_target_brgy, 'sent')
  returning id into v_disp_id;

  -- mark equipment deployed and write the use rows
  if p_equipment_ids is not null then
    foreach v_eq in array p_equipment_ids loop
      insert into public.dispatch_equipment_use (dispatch_id, equipment_id)
      values (v_disp_id, v_eq);
      update public.dispatch_equipment
         set status = 'deployed', last_checked_at = now()
       where id = v_eq;
    end loop;
  end if;

  -- first dispatch moves the report status to dispatched; extra teams add
  -- a record only. The 028/036 guard_report_status trigger enforces one
  -- step at a time so the move is legal.
  if v_row.status = 'verified' then
    perform public.advance_report_status(
      p_report_id, 'dispatched', v_team || ': ' || left(trim(p_instructions), 120));
  end if;

  -- audit row
  perform public.write_audit('report.dispatched', 'reports', p_report_id,
    jsonb_build_object('dispatch_id', v_disp_id, 'team', v_team,
                       'unit_id', v_unit_id, 'target_barangay_id', v_target_brgy,
                       'eta', p_eta, 'instructions', left(trim(p_instructions), 300)));

  -- the timeline event
  insert into public.report_dispatch_events (dispatch_id, actor, actor_name, action, note)
  values (v_disp_id, auth.uid(), v_name, 'dispatched', left(trim(p_instructions), 240));

  -- fan-out notifications
  v_notified := public.fanout_dispatch(p_report_id, v_disp_id, v_team, v_target_brgy, v_unit_id, trim(p_instructions));

  return jsonb_build_object('id', v_disp_id, 'team', v_team, 'eta', p_eta,
                            'dispatched_by', v_name, 'dispatched_at', now(),
                            'unit_id', v_unit_id, 'target_barangay_id', v_target_brgy,
                            'notified', v_notified);
end;
$$;

revoke all on function public.dispatch_report_v2(uuid, text, text, timestamptz, uuid, uuid, uuid[]) from public;
grant execute on function public.dispatch_report_v2(uuid, text, text, timestamptz, uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------- backward-compat wrapper
-- The client (js/repo.js) still calls dispatch_report(uuid, text, text,
-- timestamptz). We re-create it as a thin wrapper that calls dispatch_report_v2
-- with no equipment and no unit (the barangay Response Team branch).
create or replace function public.dispatch_report(
  p_report_id    uuid,
  p_team         text,
  p_instructions text,
  p_eta          timestamptz
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  return public.dispatch_report_v2(
    p_report_id := p_report_id,
    p_team := p_team,
    p_instructions := p_instructions,
    p_eta := p_eta,
    p_unit_id := null,
    p_target_barangay_id := null,
    p_equipment_ids := null
  );
end;
$$;

revoke all on function public.dispatch_report(uuid, text, text, timestamptz) from public;
grant execute on function public.dispatch_report(uuid, text, text, timestamptz) to authenticated;

-- ----------------------------------------------------- dispatch_respond RPC
-- Acknowledge → En route → On scene → Done, with a note. Each action
-- writes a timeline row and notifies the barangay officials of the report's
-- barangay and the LGU; on_scene and done also notify the reporter.
create or replace function public.dispatch_respond(
  p_dispatch_id uuid,
  p_action      text,
  p_note        text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row       public.report_dispatches;
  v_unit_id  uuid;
  v_target   uuid;
  v_role     text;
  v_name     text;
  v_report   public.reports;
  v_now      timestamptz := now();
  v_tone     text;
  v_title    text;
  v_body     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_action not in ('acknowledged','en_route','on_scene','done') then
    raise exception 'Unknown action: %', p_action;
  end if;

  select role, coalesce(full_name, '') into v_role, v_name
    from public.profiles where id = auth.uid();

  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;

  -- Only the dispatched unit's users OR the LGU may update a unit dispatch.
  -- For Barangay Response Team dispatches, the report's barangay officials
  -- and the LGU may update.
  if v_role <> 'lgu_ldrrmc' then
    if v_row.unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.unit_id is distinct from public.my_unit_id() then
        raise exception 'Only this unit''s users may respond to this dispatch';
      end if;
    else
      -- Barangay Response Team dispatch
      if v_role <> 'barangay_official' then
        raise exception 'Only the barangay official may respond to this dispatch';
      end if;
      select * into v_report from public.reports where id = v_row.report_id;
      if v_report.barangay_id is distinct from public.my_barangay_id() then
        raise exception 'This dispatch is outside your barangay';
      end if;
    end if;
  end if;

  -- Enforce the same one-step ordering for dispatch_status.
  if not (
    (v_row.dispatch_status = 'sent'        and p_action = 'acknowledged')
    or (v_row.dispatch_status = 'acknowledged' and p_action in ('en_route','on_scene','done'))
    or (v_row.dispatch_status = 'en_route'    and p_action in ('on_scene','done'))
    or (v_row.dispatch_status = 'on_scene'    and p_action = 'done')
  ) then
    raise exception 'A dispatch in "%" cannot move to "%"', v_row.dispatch_status, p_action;
  end if;

  update public.report_dispatches
     set dispatch_status = p_action,
         ack_at      = case when p_action = 'acknowledged' then v_now else ack_at end,
         en_route_at = case when p_action = 'en_route'    then v_now else en_route_at end,
         on_scene_at = case when p_action = 'on_scene'    then v_now else on_scene_at end,
         done_at     = case when p_action = 'done'        then v_now else done_at end
   where id = p_dispatch_id;

  insert into public.report_dispatch_events (dispatch_id, actor, actor_name, action, note)
  values (p_dispatch_id, auth.uid(), v_name, p_action, left(coalesce(p_note, ''), 240));

  perform public.write_audit('dispatch.responded', 'report_dispatches', p_dispatch_id,
    jsonb_build_object('action', p_action, 'note', left(coalesce(p_note, ''), 240)));

  -- Notify: the report's barangay officials + LGU. On scene and Done
  -- also notify the reporter. Never other barangays or units.
  select * into v_report from public.reports where id = v_row.report_id;
  v_unit_id := v_row.unit_id;
  v_target  := v_report.barangay_id;

  v_tone  := case p_action when 'acknowledged' then 'advisory'  when 'en_route' then 'advisory'
                            when 'on_scene'   then 'warning'  when 'done' then 'prepared' end;
  v_title := case p_action
    when 'acknowledged' then 'Dispatch acknowledged'
    when 'en_route'      then 'Responder en route'
    when 'on_scene'      then 'Responder on scene'
    when 'done'          then 'Dispatch complete'
  end;
  v_body  := case p_action
    when 'acknowledged' then 'Response to ' || coalesce(v_report.code, '') || ' is acknowledged.'
    when 'en_route'      then 'Response to ' || coalesce(v_report.code, '') || ' is en route.'
    when 'on_scene'      then 'Response to ' || coalesce(v_report.code, '') || ' is on scene.'
    when 'done'          then 'Response to ' || coalesce(v_report.code, '') || ' is done.'
  end;

  -- barangay officials (info or action) + LGU
  insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
  select p.id, v_title, v_body, v_tone, 'truck', 'dispatch_status', v_report.id
    from public.profiles p
   where p.disabled = false
     and (
       p.role = 'lgu_ldrrmc'
       or (v_target is not null and p.barangay_id = v_target and p.role = 'barangay_official')
     );

  -- reporter, only for on_scene and done
  if p_action in ('on_scene','done') and v_report.reporter_id is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_report.reporter_id, v_title, v_body, v_tone, 'check', 'dispatch_status', v_report.id);
  end if;

  -- When done, release the equipment and reset the unit status (the
  -- sync_unit_status trigger handles the unit).
  if p_action = 'done' then
    update public.dispatch_equipment_use
       set released_at = v_now
     where dispatch_id = p_dispatch_id and released_at is null;
    update public.dispatch_equipment
       set status = 'available'
     where id in (select equipment_id from public.dispatch_equipment_use where dispatch_id = p_dispatch_id);
  end if;

  return jsonb_build_object('dispatch_id', p_dispatch_id, 'action', p_action, 'at', v_now);
end;
$$;

revoke all on function public.dispatch_respond(uuid, text, text) from public;
grant execute on function public.dispatch_respond(uuid, text, text) to authenticated;

-- ----------------------------------------------------- report resolved/rejected trigger
-- When a report becomes resolved or rejected: release its equipment, mark
-- open dispatches done, reset unit status. Reuses the same pattern as
-- migration 028's guard_report_status (a BEFORE UPDATE trigger).
create or replace function public.release_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('resolved','rejected') and old.status not in ('resolved','rejected') then
    -- mark every open dispatch on this report done
    update public.report_dispatches
       set dispatch_status = 'done',
           done_at = now()
     where report_id = new.id and dispatch_status <> 'done';
    -- release equipment
    update public.dispatch_equipment_use
       set released_at = now()
     where released_at is null
       and dispatch_id in (select id from public.report_dispatches where report_id = new.id);
    update public.dispatch_equipment
       set status = 'available'
     where id in (
       select equipment_id from public.dispatch_equipment_use
        where dispatch_id in (select id from public.report_dispatches where report_id = new.id)
     );
    -- responders back to available
    update public.responders set status = 'available'
     where id in (select responder_id from public.report_assignments
                   where report_id = new.id and released_at is null);
    update public.report_assignments set released_at = now()
     where report_id = new.id and released_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_release_on_close on public.reports;
create trigger reports_release_on_close
  after update on public.reports
  for each row execute function public.release_on_close();


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 140_dispatch_rpcs.sql
-- ============================================================================
--  UniGuard · 040 · Dispatch unit RPCs (Part E)
--
--  All privileged writes for the dispatch team interface. Every RPC re-checks
--  role, unit and barangay on the SERVER, never trusting the client for
--  role, unit_id, barangay_id or target_barangay_id.
--
--  RPCs in this file:
--    · record_equipment_check
--    · set_equipment_status
--    · set_hospital_capacity
--    · send_patient_notice  +  ack_patient_notice
--    · set_personnel_duty
--    · create_unit_request  +  decide_unit_request
--    · submit_after_action
--    · directory_contacts
--    · unit_stats
--    · create_dispatch_unit + invite_unit_member + disable_unit_member
--
--  Additive + idempotent.
-- ============================================================================

-- ----------------------------------------------------------- record_equipment_check
create or replace function public.record_equipment_check(
  p_equipment_id uuid,
  p_condition    text,
  p_level        text default '',
  p_notes        text default '',
  p_photo        text default null,
  p_items        jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.dispatch_equipment;
  v_role text;
  v_unit uuid;
  v_brgy uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_condition not in ('ready','needs_repair','missing','out_of_service','unknown') then
    raise exception 'Invalid condition';
  end if;

  select * into v_row from public.dispatch_equipment where id = p_equipment_id;
  if v_row.id is null then
    raise exception 'That equipment does not exist';
  end if;

  select role, barangay_id, dispatch_unit_id
    into v_role, v_brgy, v_unit
    from public.profiles where id = auth.uid();

  -- Either a unit member checking their own unit's equipment, or the
  -- barangay official checking their own barangay's equipment, or the LGU.
  if v_role <> 'lgu_ldrrmc' then
    if v_row.owner_unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.owner_unit_id is distinct from v_unit then
        raise exception 'You can only check your own unit''s equipment';
      end if;
    else
      if v_role <> 'barangay_official' or v_row.owner_barangay_id is distinct from v_brgy then
        raise exception 'You can only check your own barangay''s equipment';
      end if;
    end if;
  end if;

  insert into public.equipment_checks (equipment_id, checked_by, condition, level, notes, photo, items)
  values (p_equipment_id, auth.uid(), p_condition, p_condition, left(coalesce(p_notes, ''), 500), p_photo, coalesce(p_items, '[]'::jsonb))
  returning id into v_id;

  -- stamp the equipment row with the latest condition + last_checked_at so
  -- the dispatch picker can filter against it.
  update public.dispatch_equipment
     set condition = p_condition,
         last_checked_at = now(),
         status = case when p_condition in ('needs_repair','missing','out_of_service') then 'maintenance'
                       when status = 'available' then 'available' else status end
   where id = p_equipment_id;

  perform public.write_audit('equipment.checked', 'dispatch_equipment', p_equipment_id,
    jsonb_build_object('condition', p_condition, 'level', p_level));

  return jsonb_build_object('id', v_id, 'condition', p_condition, 'checked_at', now());
end;
$$;

revoke all on function public.record_equipment_check(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.record_equipment_check(uuid, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------- set_equipment_status
create or replace function public.set_equipment_status(
  p_equipment_id uuid,
  p_status       text,
  p_condition    text default null,
  p_notes        text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.dispatch_equipment;
  v_role text;
  v_unit uuid;
  v_brgy uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_status not in ('available','deployed','maintenance','unavailable') then
    raise exception 'Invalid status';
  end if;
  if p_condition is not null and p_condition not in ('ready','needs_repair','missing','out_of_service','unknown') then
    raise exception 'Invalid condition';
  end if;

  select * into v_row from public.dispatch_equipment where id = p_equipment_id;
  if v_row.id is null then raise exception 'That equipment does not exist'; end if;

  select role, barangay_id, dispatch_unit_id into v_role, v_brgy, v_unit
    from public.profiles where id = auth.uid();

  if v_role <> 'lgu_ldrrmc' then
    if v_row.owner_unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.owner_unit_id is distinct from v_unit then
        raise exception 'Not your equipment';
      end if;
    else
      if v_role <> 'barangay_official' or v_row.owner_barangay_id is distinct from v_brgy then
        raise exception 'Not your equipment';
      end if;
    end if;
  end if;

  update public.dispatch_equipment
     set status = p_status,
         condition = coalesce(p_condition, condition),
         notes = left(coalesce(p_notes, ''), 500)
   where id = p_equipment_id;

  perform public.write_audit('equipment.status_set', 'dispatch_equipment', p_equipment_id,
    jsonb_build_object('status', p_status, 'condition', p_condition));

  return jsonb_build_object('id', p_equipment_id, 'status', p_status);
end;
$$;

revoke all on function public.set_equipment_status(uuid, text, text, text) from public;
grant execute on function public.set_equipment_status(uuid, text, text, text) to authenticated;

-- --------------------------------------------------------- set_hospital_capacity
create or replace function public.set_hospital_capacity(
  p_unit_id   uuid,
  p_er_beds   int,
  p_icu_beds  int,
  p_available int,
  p_accepting boolean
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or v_unit is distinct from p_unit_id) then
    raise exception 'Only this hospital''s users may set capacity';
  end if;
  if not exists (select 1 from public.dispatch_units where id = p_unit_id and unit_type = 'Hospital') then
    raise exception 'That unit is not a hospital';
  end if;

  insert into public.hospital_capacity (unit_id, er_beds, icu_beds, available, accepting, updated_at)
  values (p_unit_id, p_er_beds, p_icu_beds, p_available, p_accepting, now())
  on conflict (unit_id) do update
     set er_beds = excluded.er_beds,
         icu_beds = excluded.icu_beds,
         available = excluded.available,
         accepting = excluded.accepting,
         updated_at = now();

  perform public.write_audit('hospital.capacity_set', 'hospital_capacity', p_unit_id,
    jsonb_build_object('er', p_er_beds, 'icu', p_icu_beds, 'available', p_available, 'accepting', p_accepting));

  return jsonb_build_object('unit_id', p_unit_id, 'accepting', p_accepting, 'at', now());
end;
$$;

revoke all on function public.set_hospital_capacity(uuid, int, int, int, boolean) from public;
grant execute on function public.set_hospital_capacity(uuid, int, int, int, boolean) to authenticated;

-- ------------------------------------------------------- send_patient_notice + ack
create or replace function public.send_patient_notice(
  p_unit_id    uuid,
  p_report_id  uuid default null,
  p_patients   int default 1,
  p_condition  text default '',
  p_eta        timestamptz default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.dispatch_units where id = p_unit_id and unit_type = 'Hospital' and active = true) then
    raise exception 'That hospital does not exist';
  end if;

  select role, coalesce(full_name, '') into v_role, v_name
    from public.profiles where id = auth.uid();
  if v_role not in ('lgu_ldrrmc','barangay_official','dispatch_team') then
    raise exception 'Only officials, LGU or responders may send a patient notice';
  end if;

  insert into public.patient_notices (unit_id, report_id, patients, condition, eta, sent_by, status)
  values (p_unit_id, p_report_id, greatest(p_patients, 1), left(coalesce(p_condition, ''), 240), p_eta, auth.uid(), 'sent')
  returning id into v_id;

  -- notify the hospital's users only (rule: a notice reaches only that
  -- hospital's users)
  insert into public.notifications (user_id, title, body, tone, icon, type)
  select p.id, 'Incoming patient notice', left(p_patients || ' patient(s) · ' || p_condition, 240),
         'warning', 'truck', 'patient_notice'
    from public.profiles p
   where p.disabled = false
     and p.role = 'dispatch_team'
     and p.dispatch_unit_id = p_unit_id;

  perform public.write_audit('patient.notice_sent', 'patient_notices', v_id,
    jsonb_build_object('unit_id', p_unit_id, 'patients', p_patients, 'sent_by', v_name));

  return jsonb_build_object('id', v_id, 'unit_id', p_unit_id);
end;
$$;

revoke all on function public.send_patient_notice(uuid, uuid, int, text, timestamptz) from public;
grant execute on function public.send_patient_notice(uuid, uuid, int, text, timestamptz) to authenticated;

create or replace function public.ack_patient_notice(
  p_notice_id uuid,
  p_status    text default 'acknowledged'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.patient_notices;
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_status not in ('acknowledged','arrived','cancelled') then
    raise exception 'Invalid status';
  end if;
  select * into v_row from public.patient_notices where id = p_notice_id;
  if v_row.id is null then raise exception 'That notice does not exist'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or v_unit is distinct from v_row.unit_id) then
    raise exception 'Only this hospital''s users may acknowledge the notice';
  end if;

  update public.patient_notices
     set status = p_status, ack_at = case when p_status = 'acknowledged' then now() else ack_at end
   where id = p_notice_id;

  perform public.write_audit('patient.notice_acked', 'patient_notices', p_notice_id,
    jsonb_build_object('status', p_status));

  return jsonb_build_object('id', p_notice_id, 'status', p_status);
end;
$$;

revoke all on function public.ack_patient_notice(uuid, text) from public;
grant execute on function public.ack_patient_notice(uuid, text) to authenticated;

-- ---------------------------------------------------------------- set_personnel_duty
create or replace function public.set_personnel_duty(
  p_personnel_id uuid,
  p_on_duty      boolean,
  p_shift_start  timestamptz default null,
  p_shift_end    timestamptz default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.unit_personnel;
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into v_row from public.unit_personnel where id = p_personnel_id;
  if v_row.id is null then raise exception 'That personnel does not exist'; end if;

  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or v_unit is distinct from v_row.unit_id) then
    raise exception 'Not your unit';
  end if;

  update public.unit_personnel
     set on_duty = p_on_duty,
         shift_start = p_shift_start,
         shift_end = p_shift_end
   where id = p_personnel_id;

  if p_on_duty then
    insert into public.unit_shifts (unit_id, personnel_id, start_at)
    values (v_row.unit_id, p_personnel_id, coalesce(p_shift_start, now()));
  else
    update public.unit_shifts set end_at = now()
     where personnel_id = p_personnel_id and end_at is null;
  end if;

  return jsonb_build_object('id', p_personnel_id, 'on_duty', p_on_duty);
end;
$$;

revoke all on function public.set_personnel_duty(uuid, boolean, timestamptz, timestamptz) from public;
grant execute on function public.set_personnel_duty(uuid, boolean, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------- create_unit_request + decide
create or replace function public.create_unit_request(
  p_unit_id uuid,
  p_kind    text,
  p_details text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or v_unit is distinct from p_unit_id) then
    raise exception 'Not your unit';
  end if;
  if p_kind not in ('fuel','personnel','equipment','mutual_aid','other') then
    raise exception 'Unknown request kind';
  end if;

  insert into public.unit_requests (unit_id, kind, details, created_by, status)
  values (p_unit_id, p_kind, left(coalesce(p_details, ''), 1000), auth.uid(), 'pending')
  returning id into v_id;

  -- notify every LGU user
  insert into public.notifications (user_id, title, body, tone, icon, type)
  select p.id, 'Support request from ' || (select name from public.dispatch_units where id = p_unit_id),
         left(p_kind || ': ' || p_details, 240), 'warning', 'inbox', 'unit_request'
    from public.profiles p
   where p.disabled = false and p.role = 'lgu_ldrrmc';

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.create_unit_request(uuid, text, text) from public;
grant execute on function public.create_unit_request(uuid, text, text) to authenticated;

create or replace function public.decide_unit_request(
  p_request_id uuid,
  p_decision   text,
  p_note       text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.unit_requests;
  v_role text;
  v_name text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_decision not in ('approved','declined','done') then
    raise exception 'Decision must be approved, declined or done';
  end if;
  select * into v_row from public.unit_requests where id = p_request_id;
  if v_row.id is null then raise exception 'That request does not exist'; end if;

  select role, coalesce(full_name, '') into v_role, v_name
    from public.profiles where id = auth.uid();
  -- only the LGU may decide; a unit_admin may close a request to 'done'
  -- when they consider it delivered
  if v_role = 'lgu_ldrrmc' then
    null;
  elsif v_role = 'dispatch_team' and public.is_unit_admin() and p_decision = 'done' and v_row.unit_id = public.my_unit_id() then
    null;
  else
    raise exception 'Only the LGU may decide a support request';
  end if;

  update public.unit_requests
     set status = p_decision, decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;

  -- notify the unit's users
  insert into public.notifications (user_id, title, body, tone, icon, type)
  select p.id, 'Support request ' || p_decision,
         left(coalesce(p_note, '') || ' · ' || v_row.kind, 240),
         case when p_decision = 'approved' then 'prepared' when p_decision = 'done' then 'prepared' else 'warning' end,
         'check', 'unit_request'
    from public.profiles p
   where p.disabled = false and p.role = 'dispatch_team' and p.dispatch_unit_id = v_row.unit_id;

  perform public.write_audit('unit_request.decided', 'unit_requests', p_request_id,
    jsonb_build_object('decision', p_decision, 'note', left(coalesce(p_note, ''), 240), 'by', v_name));

  return jsonb_build_object('id', p_request_id, 'status', p_decision);
end;
$$;

revoke all on function public.decide_unit_request(uuid, text, text) from public;
grant execute on function public.decide_unit_request(uuid, text, text) to authenticated;

-- --------------------------------------------------------- submit_after_action
create or replace function public.submit_after_action(
  p_dispatch_id uuid,
  p_text        text,
  p_meta        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.report_dispatches;
  v_role text;
  v_name text;
  v_unit uuid;
  v_brgy uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'Write a short after-action summary'; end if;
  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then raise exception 'That dispatch does not exist'; end if;
  if v_row.dispatch_status <> 'done' then
    raise exception 'The after-action report can be filed only after the dispatch is Done';
  end if;

  select role, coalesce(full_name, ''), dispatch_unit_id, barangay_id
    into v_role, v_name, v_unit, v_brgy
    from public.profiles where id = auth.uid();

  if v_role <> 'lgu_ldrrmc' then
    if v_row.unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.unit_id is distinct from v_unit then
        raise exception 'Only this unit''s users may file this after-action report';
      end if;
    else
      if v_role <> 'barangay_official' then
        raise exception 'Only the barangay official may file this after-action report';
      end if;
      if v_row.target_barangay_id is distinct from v_brgy then
        raise exception 'This dispatch is outside your barangay';
      end if;
    end if;
  end if;

  update public.report_dispatches
     set after_action = left(trim(p_text), 4000),
         after_action_at = now(),
         after_action_by = auth.uid(),
         after_action_meta = coalesce(p_meta, '{}'::jsonb)
   where id = p_dispatch_id;

  perform public.write_audit('dispatch.after_action', 'report_dispatches', p_dispatch_id,
    jsonb_build_object('by', v_name, 'meta', p_meta));

  return jsonb_build_object('id', p_dispatch_id, 'at', now());
end;
$$;

revoke all on function public.submit_after_action(uuid, text, jsonb) from public;
grant execute on function public.submit_after_action(uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------- directory_contacts
-- One read function the barangay and dispatch clients share. Returns the
-- emergency hotlines with their category, plus barangay captains joined
-- from public.barangays. SECURITY DEFINER so the dispatch user (whose
-- hotlines_read policy is fine for read but the captains come from a row
-- they may not see directly) can read the directory.
create or replace function public.directory_contacts()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'name', h.agency_name, 'number', h.contact_number,
    'category', coalesce(h.category, 'Other'), 'scope', h.scope, 'description', h.description
  )), '[]'::jsonb) into v_out
    from public.emergency_hotlines h
   where h.active is true;

  return jsonb_build_object('hotlines', v_out);
end;
$$;

revoke all on function public.directory_contacts() from public;
grant execute on function public.directory_contacts() to authenticated;

-- -------------------------------------------------------------------- unit_stats
-- Returns the calling unit's own stats. Dispatch users call this for
-- themselves; the LGU gets the full picture by iterating every unit.
create or replace function public.unit_stats(p_unit_id uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
  v_target uuid;
  v_total int;
  v_ack int;
  v_done int;
  v_open int;
  v_avg_ack numeric;
  v_avg_scene numeric;
  v_month int;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();

  -- A dispatch user can only request their own unit's stats; the LGU may
  -- pass any unit_id or null for an aggregate.
  if v_role = 'dispatch_team' then
    v_target := v_unit;
    if p_unit_id is not null and p_unit_id is distinct from v_unit then
      raise exception 'You can only read your own unit''s stats';
    end if;
  elsif v_role = 'lgu_ldrrmc' then
    v_target := p_unit_id;  -- null = all units
  else
    raise exception 'Only the LGU or dispatch users may call unit_stats';
  end if;

  -- Totals for the target unit (or all units if null and caller is LGU)
  select count(*), count(*) filter (where dispatch_status = 'acknowledged'),
         count(*) filter (where dispatch_status = 'done'),
         count(*) filter (where dispatch_status not in ('done'))
    into v_total, v_ack, v_done, v_open
    from public.report_dispatches d
   where v_target is null or d.unit_id = v_target;

  -- Average times (dispatched_at -> ack_at, ack_at -> on_scene_at)
  select coalesce(avg(extract(epoch from (ack_at - dispatched_at)) / 60), 0),
         coalesce(avg(extract(epoch from (on_scene_at - ack_at)) / 60), 0)
    into v_avg_ack, v_avg_scene
    from public.report_dispatches d
   where (v_target is null or d.unit_id = v_target)
     and ack_at is not null;

  -- Dispatches this month
  select count(*) into v_month
    from public.report_dispatches d
   where (v_target is null or d.unit_id = v_target)
     and date_trunc('month', d.dispatched_at) = date_trunc('month', now());

  return jsonb_build_object(
    'unit_id', v_target,
    'total_dispatches', v_total,
    'acknowledged', v_ack,
    'done', v_done,
    'open', v_open,
    'avg_ack_minutes', v_avg_ack,
    'avg_scene_minutes', v_avg_scene,
    'this_month', v_month
  );
end;
$$;

revoke all on function public.unit_stats(uuid) from public;
grant execute on function public.unit_stats(uuid) to authenticated;

-- ------------------------------------------------------------ create_dispatch_unit
-- LGU-only. Creates a unit row. The first unit_admin is then created via
-- the admin-users edge function (which runs with the service role).
create or replace function public.create_dispatch_unit(
  p_name           text,
  p_unit_type      text,
  p_contact_number text default '',
  p_address        text default '',
  p_lat            double precision default null,
  p_lng            double precision default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_lgu() then raise exception 'Only the LGU can create dispatch units'; end if;
  if p_unit_type not in ('BFP','PNP','Rescue','Hospital') then
    raise exception 'Unknown unit type';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A unit name is required'; end if;

  insert into public.dispatch_units (name, unit_type, contact_number, address, lat, lng, created_by, status, active)
  values (trim(p_name), p_unit_type, p_contact_number, p_address, p_lat, p_lng, auth.uid(), 'available', true)
  returning id into v_id;

  perform public.write_audit('dispatch_unit.created', 'dispatch_units', v_id,
    jsonb_build_object('name', p_name, 'unit_type', p_unit_type));

  return jsonb_build_object('id', v_id, 'name', p_name, 'unit_type', p_unit_type);
end;
$$;

revoke all on function public.create_dispatch_unit(text, text, text, text, double precision, double precision) from public;
grant execute on function public.create_dispatch_unit(text, text, text, text, double precision, double precision) to authenticated;

-- -------------------------------------------------------- update_dispatch_unit
create or replace function public.update_dispatch_unit(
  p_unit_id        uuid,
  p_name           text default null,
  p_contact_number text default null,
  p_address        text default null,
  p_active          boolean default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();

  -- LGU can edit any unit; a unit_admin can edit their own unit's contact
  -- info and active flag (deactivating themselves).
  if v_role <> 'lgu_ldrrmc' then
    if v_role <> 'dispatch_team' or not public.is_unit_admin() or v_unit is distinct from p_unit_id then
      raise exception 'Only the LGU or this unit''s admin may edit it';
    end if;
  end if;

  update public.dispatch_units
     set name = coalesce(p_name, name),
         contact_number = coalesce(p_contact_number, contact_number),
         address = coalesce(p_address, address),
         active = coalesce(p_active, active)
   where id = p_unit_id;

  perform public.write_audit('dispatch_unit.updated', 'dispatch_units', p_unit_id,
    jsonb_build_object('name', p_name, 'contact_number', p_contact_number, 'address', p_address, 'active', p_active));

  return jsonb_build_object('id', p_unit_id);
end;
$$;

revoke all on function public.update_dispatch_unit(uuid, text, text, text, boolean) from public;
grant execute on function public.update_dispatch_unit(uuid, text, text, text, boolean) to authenticated;

-- ----------------------------------------------- add_personnel / update_personnel
create or replace function public.add_personnel(
  p_unit_id uuid,
  p_name    text,
  p_role    text default '',
  p_phone   text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or not public.is_unit_admin() or v_unit is distinct from p_unit_id) then
    raise exception 'Only the LGU or this unit''s admin may add personnel';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A name is required'; end if;

  insert into public.unit_personnel (unit_id, name, role, phone)
  values (p_unit_id, trim(p_name), left(coalesce(p_role, ''), 80), left(coalesce(p_phone, ''), 40))
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.add_personnel(uuid, text, text, text) from public;
grant execute on function public.add_personnel(uuid, text, text, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 141_core_modules_def_settings.sql
-- UniGuard · Core modules D, E, F + Settings
--
-- This migration adds the schema for the three LDRRMO core modules that were
-- not in the original build, plus the Settings surface that supports them:
--
--   D. Evacuation center management — adds facilities, contact_person and
--      contact_phone to the existing evacuation_centers table. (Evacuee
--      check-in is intentionally NOT included in this build.)
--   E. Relief & resource inventory — a new relief_inventory table for stock
--      levels + reorder points, and a relief_distribution_log table for every
--      pack handed out per barangay / per family.
--   F. Early warning & announcements — adds alert_type and language to the
--      existing advisories table so the four LDRRMO categories (weather
--      advisory, evacuation order, road closure, general) and the EN/FIL
--      publish language are stored with each broadcast.
--   Settings — app_settings (key/value) and message_templates (EN + Filipino,
--      Pangasinense removed per build spec).
--
-- Every new table carries RLS so a barangay official only sees their own
-- rows; the LGU role sees everything. The policies mirror the existing
-- pattern in 004_rls_policies.sql.

-- =====================================================================
-- D. Evacuation centers: facilities + contact person
-- =====================================================================
alter table public.evacuation_centers
  add column if not exists facilities text[] default '{}',
  add column if not exists contact_person text default '',
  add column if not exists contact_phone text default '';
comment on column public.evacuation_centers.facilities is
  'List of on-site facilities (medical station, kitchen, generator, etc.). Displayed as chips on the center card.';
comment on column public.evacuation_centers.contact_person is
  'Shelter manager or point of contact on site.';
comment on column public.evacuation_centers.contact_phone is
  'Contact number for the shelter manager. Becomes a tap-to-call button on the card.';

-- =====================================================================
-- E. Relief & resource inventory
-- =====================================================================
create table if not exists public.relief_inventory (
  id           text primary key,
  name         text not null,
  category     text not null check (category in ('Food','Water','Medical','Equipment','Shelter')),
  unit         text not null default 'units',
  stock        integer not null default 0,
  reorder      integer not null default 0,
  location     text default '',
  supplier     text default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
comment on table public.relief_inventory is
  'Module E: stock of food packs, water, medicine, boats and equipment the LDRRMO pre-positions at the municipal warehouse. Low-stock = stock <= reorder.';
create index if not exists idx_relief_inventory_category on public.relief_inventory(category);

create table if not exists public.relief_distribution_log (
  id              text primary key,
  item_id         text references public.relief_inventory(id) on delete set null,
  item_name       text not null,
  qty             integer not null default 0 check (qty >= 0),
  barangay        text not null,
  family          text default '',
  distributed_by  text default '',
  distributed_at  timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);
comment on table public.relief_distribution_log is
  'Module E: every pack handed out per barangay and per family. Recording a distribution decrements the matching inventory row.';
create index if not exists idx_relief_dist_log_brgy on public.relief_distribution_log(barangay);
create index if not exists idx_relief_dist_log_at on public.relief_distribution_log(distributed_at desc);

-- RLS for the two new relief tables: LGU sees everything, barangay officials
-- see only their own barangay's rows, citizens cannot read either table.
alter table public.relief_inventory enable row level security;
alter table public.relief_distribution_log enable row level security;

drop policy if exists "relief_inventory read" on public.relief_inventory;
create policy "relief_inventory read" on public.relief_inventory
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('lgu_ldrrmc','barangay_official'))
  );
drop policy if exists "relief_inventory write" on public.relief_inventory;
create policy "relief_inventory write" on public.relief_inventory
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  );

drop policy if exists "relief_dist_log read" on public.relief_distribution_log;
create policy "relief_dist_log read" on public.relief_distribution_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid()
        and p.role = 'barangay_official')
      and public.my_barangay_name() = relief_distribution_log.barangay
    )
  );
drop policy if exists "relief_dist_log write" on public.relief_distribution_log;
create policy "relief_dist_log write" on public.relief_distribution_log
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('lgu_ldrrmc','barangay_official'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('lgu_ldrrmc','barangay_official'))
  );

-- =====================================================================
-- F. Advisories: alert_type + language
-- =====================================================================
alter table public.advisories
  add column if not exists alert_type text not null default 'general'
    check (alert_type in ('general','weather_advisory','evacuation_order','road_closure')),
  add column if not exists language text not null default 'en'
    check (language in ('en','fil'));
comment on column public.advisories.alert_type is
  'Module F: the LDRRMO alert category — weather advisory, evacuation order, road closure or general. Drives the icon on the citizen lock screen and the template shortlist in the composer.';
comment on column public.advisories.language is
  'Module F: the language the advisory was composed in. English or Filipino only (Pangasinense removed per build spec).';

-- =====================================================================
-- Settings: app_settings + message_templates
-- =====================================================================
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);
comment on table public.app_settings is
  'System-wide settings: organisation profile, notifications, offline/sync behaviour, language, display and SMS provider. Stored as key/value JSON so new settings can be added without a migration.';

alter table public.app_settings enable row level security;
drop policy if exists "app_settings read" on public.app_settings;
create policy "app_settings read" on public.app_settings
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  );
drop policy if exists "app_settings write" on public.app_settings;
create policy "app_settings write" on public.app_settings
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  );

create table if not exists public.message_templates (
  id           text primary key,
  category     text not null check (category in ('general','weather_advisory','evacuation_order','road_closure')),
  label        text not null,
  title_en     text default '',
  body_en      text default '',
  title_fil    text default '',
  body_fil     text default '',
  placeholders text[] default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
comment on table public.message_templates is
  'Reusable broadcast templates in English and Filipino. Pangasinense is intentionally not stored — the build spec limits templates to EN + FIL only. The advisory composer applies a template then fills placeholders at publish time.';
create index if not exists idx_message_templates_category on public.message_templates(category);

alter table public.message_templates enable row level security;
drop policy if exists "message_templates read" on public.message_templates;
create policy "message_templates read" on public.message_templates
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('lgu_ldrrmc','barangay_official'))
  );
drop policy if exists "message_templates write" on public.message_templates;
create policy "message_templates write" on public.message_templates
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  );

-- =====================================================================
-- Seed: default message templates (EN + Filipino, no Pangasinense)
-- =====================================================================
insert into public.message_templates (id, category, label, title_en, body_en, title_fil, body_fil, placeholders) values
  ('MT-001','evacuation_order','Evacuation Order — Flood',
   'Evacuation Order: Move to Higher Ground',
   'Flood waters are rising in {barangay}. Residents within 200 meters of the shoreline must move immediately to {center}. Bring your go-bag, medication and identification.',
   'Utos ng Paglikas: Lumikas sa Mataas na Lugar',
   'Tumataas ang baha sa {barangay}. Dapat lumikas kaagad ang mga residente sa loob ng 200 metro mula sa baybayin patungong {center}. Dalhin ang inyong go-bag, gamot at pagkakakilanlan.',
   array['{barangay}','{center}']),
  ('MT-002','evacuation_order','Pre-emptive Evacuation — Storm Surge',
   'Pre-emptive Evacuation: Storm Surge Warning',
   'A storm surge is expected to hit {barangay} within the next few hours. Residents along the coast are ordered to move to {center} now. Do not wait for the water to reach your home.',
   'Pre-emptibong Paglikas: Babala sa Storm Surge',
   'Inaasahang tatama ang storm surge sa {barangay} sa loob ng ilang oras. Ini-uutos sa mga residente sa baybayin na lumikas na ngayon patungong {center}. Huwag nang hintayin na makarating ang tubig sa inyong tahanan.',
   array['{barangay}','{center}']),
  ('MT-003','weather_advisory','Typhoon Public Advisory',
   'Typhoon Advisory: {barangay}',
   'Typhoon signal no. {signal} is raised over {barangay}. Expect strong winds and heavy rain. Secure loose items, charge devices, and stay indoors. Monitor official channels for updates.',
   'Advisory sa Bagyo: {barangay}',
   'Naka-angat ang signal ng bagyo blg. {signal} sa {barangay}. Asahin ang malakas na hangin at malakas na ulan. Tiyakin na nakakabit ang mga kalat-kalat na gamit, naka-charge ang mga device, at manatili sa loob ng bahay. Subaybayan ang opisyal na mga channel para sa mga update.',
   array['{barangay}','{signal}']),
  ('MT-004','weather_advisory','Heavy Rainfall / Flood Watch',
   'Heavy Rainfall Advisory',
   'Moderate to heavy rainfall is affecting {barangay} and may cause flooding in low-lying areas. Residents near rivers and creeks are advised to prepare for possible evacuation.',
   'Advisory sa Malakas na Ulan',
   'Nakakaapekto ang katamtaman hanggang malakas na pag-ulan sa {barangay} at maaaring magdulot ng baha sa mababang lugar. Hinuhimok ang mga residente malapit sa ilog at sapa na maghanda para sa posibleng paglikas.',
   array['{barangay}']),
  ('MT-005','road_closure','Road Closure Notice',
   'Road Closure: {road}',
   '{road} in {barangay} is closed until further notice due to {hazard}. Seek alternate routes. Do not attempt to pass through flooded or blocked sections.',
   'Pagkasara ng Kalsada: {road}',
   'Sara ang {road} sa {barangay} hanggang sa karagdagang paunawa dahil sa {hazard}. Gumamit ng ibang ruta. Huwag subukang dumaan sa mga bahagi na binaha o hinarang.',
   array['{road}','{barangay}','{hazard}']),
  ('MT-006','general','Class Suspension',
   'Suspension of Classes, All Levels',
   'Classes at all levels in {area} are suspended today due to inclement weather. Parents are advised to keep children indoors and monitor official channels.',
   'Pag-suspinde ng Klase, Lahat ng Antas',
   'Suspended ang klase sa lahat ng antas sa {area} ngayon dahil sa masamang panahon. Hinuhimok ang mga magulang na panatilihing nasa loob ng bahay ang mga bata at subaybayan ang opisyal na mga channel.',
   array['{area}']),
  ('MT-007','general','All Clear Notice',
   'All Clear: Safe to Return',
   'The hazard affecting {barangay} has passed. Residents may now return to their homes. Please continue to exercise caution and report any remaining damage through UniGuard.',
   'All Clear: Ligtas na ang Pagbabalik',
   'Lampas na ang panganib na nakakaapekto sa {barangay}. Maaari na ngayong bumalik ang mga residente sa kanilang mga tahanan. Mangyaring mag-ingat pa rin at iulat ang anumang natitirang pinsala sa pamamagitan ng UniGuard.',
   array['{barangay}']),
  ('MT-008','general','Relief Goods Distribution',
   'Relief Goods Distribution in {barangay}',
   'Relief goods will be distributed at {location} on {date}. Affected families are requested to bring a valid ID and their barangay certificate. Priority will be given to seniors, PWDs and pregnant women.',
   'Pamamahagi ng Relief Goods sa {barangay}',
   'Mamamahagi ng relief goods sa {location} sa {date}. Hinihiling sa mga apektadong pamilya na magdala ng wastong ID at kanilang barangay certificate. Prayoridad ang mga senior, PWD at buntis.',
   array['{barangay}','{location}','{date}'])
on conflict (id) do nothing;

-- default app settings (single row, key = 'main')
insert into public.app_settings (key, value) values
  ('main', jsonb_build_object(
    'org', jsonb_build_object(
      'municipality','Lingayen','province','Pangasinan',
      'office','Municipal Disaster Risk Reduction and Management Office',
      'contact','(075) 632-2222','email','mdrrmo@lingayen.gov.ph'),
    'notifications', jsonb_build_object(
      'pushEnabled',true,'smsFallback',true,'emailAlerts',false,
      'quietHours',false,'quietStart','22:00','quietEnd','06:00'),
    'offline', jsonb_build_object(
      'autoSync',true,'cacheMaps',true,'retentionDays',30),
    'language', jsonb_build_object('default','en','citizenDisplay','bilingual'),
    'display', jsonb_build_object(
      'incidentSort','priority','showCorroboration',true,'compactTables',false),
    'sms', jsonb_build_object('provider','none','senderId','UNIGUARD')
  ))
on conflict (key) do nothing;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 142_dispatch_units_dedup.sql
-- UniGuard · 042 · dispatch_units dedup + unit member invite fixes
--
-- Two problems found after the first real deploy:
--
--   1. DUPLICATE UNITS: migration 038 created the dispatch_units table without
--      a unique constraint on `name`. The `create_dispatch_unit` RPC does a
--      plain INSERT, so every click of "Create unit + invite admin" in the UI
--      created a duplicate row (e.g. three "BFP Lingayen" rows). The unique
--      index `dispatch_units_name_key` only existed in seed/003, which runs
--      AFTER the user has already created duplicates manually.
--
--      Fix: clean up the existing duplicates FIRST (mark the extras inactive),
--      THEN add the unique index, THEN rewrite `create_dispatch_unit` so it
--      returns the existing row if a unit with the same name already exists
--      instead of inserting a duplicate.
--
--   2. UNIT MEMBER INVITE: the `admin-users` edge function's `create` action
--      calls `admin.auth.admin.inviteUserByEmail()` to send the invitation
--      email. If the email doesn't arrive, it's almost always because:
--        a) the edge function is the OLD version (doesn't support dispatch_team
--           role, requires a fullName field the dispatch unit form doesn't have)
--           — replace it with the new version in supabase/functions/admin-users
--        b) the SUPABASE_SERVICE_ROLE_KEY secret isn't set on the function
--        c) Supabase Auth email sending isn't configured / is rate-limited
--      This migration cannot fix (a)/(b)/(c) — those are dashboard/deploy steps.

-- =====================================================================
-- STEP 1 — DELETE existing duplicates, keep only the oldest row per name.
--           This removes the extra rows entirely (not just marks them
--           inactive) so the table is clean and a regular full unique
--           index can be created in STEP 2 without conflicts.
--           Safe because the oldest row per name keeps its original UUID,
--           so any foreign-key references (dispatch_equipment,
--           report_dispatches, etc.) still resolve to it.
--           Uses DISTINCT ON (not min(uuid)) because PostgreSQL has no
--           built-in min() aggregate for the UUID type.
-- =====================================================================
do $$
begin
  delete from public.dispatch_units
   where id in (
     select id from (
       select id, name, created_at,
              row_number() over (partition by name order by created_at asc) as rn
         from public.dispatch_units
     ) ranked
     where rn > 1
   );
  if found then
    raise notice 'Deleted duplicate dispatch_units rows';
  end if;
end $$;

-- =====================================================================
-- STEP 2 — Add a full unique index on dispatch_units.name.
--           Safe now because STEP 1 deleted all duplicate rows — every
--           name appears exactly once in the table.
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'dispatch_units'
       and indexname = 'dispatch_units_name_key'
  ) then
    create unique index dispatch_units_name_key on public.dispatch_units (name);
  end if;
end $$;

-- =====================================================================
-- STEP 3 — Rewrite create_dispatch_unit so it deduplicates by name.
--           If a unit with the same name already exists AND is active,
--           return its id instead of inserting a duplicate. This makes
--           the "Create unit + invite admin" button idempotent — clicking
--           it twice doesn't create two rows; the second click just
--           re-invites the admin into the existing unit.
-- =====================================================================
create or replace function public.create_dispatch_unit(
  p_name           text,
  p_unit_type      text,
  p_contact_number text default '',
  p_address        text default '',
  p_lat            double precision default null,
  p_lng            double precision default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id       uuid;
  v_existing uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_lgu() then raise exception 'Only the LGU can create dispatch units'; end if;
  if p_unit_type not in ('BFP','PNP','Rescue','Hospital') then
    raise exception 'Unknown unit type';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A unit name is required'; end if;

  -- dedup: if a unit with this exact name already exists, return its id
  -- instead of creating a duplicate. The UI can then invite the admin
  -- into the existing unit.
  select id into v_existing
    from public.dispatch_units
   where name = trim(p_name)
     and active = true
   limit 1;

  if v_existing is not null then
    perform public.write_audit('dispatch_unit.duplicate_attempt', 'dispatch_units', v_existing,
      jsonb_build_object('name', p_name, 'unit_type', p_unit_type, 'note', 'Unit already exists; returned existing id'));
    return jsonb_build_object('id', v_existing, 'name', p_name, 'unit_type', p_unit_type, 'already_exists', true);
  end if;

  insert into public.dispatch_units (name, unit_type, contact_number, address, lat, lng, created_by, status, active)
  values (trim(p_name), p_unit_type, p_contact_number, p_address, p_lat, p_lng, auth.uid(), 'available', true)
  returning id into v_id;

  perform public.write_audit('dispatch_unit.created', 'dispatch_units', v_id,
    jsonb_build_object('name', p_name, 'unit_type', p_unit_type));

  return jsonb_build_object('id', v_id, 'name', p_name, 'unit_type', p_unit_type);
end;
$$;

revoke all on function public.create_dispatch_unit(text, text, text, text, double precision, double precision) from public;
grant execute on function public.create_dispatch_unit(text, text, text, text, double precision, double precision) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 143_super_admin.sql
-- ============================================================================
--  UniGuard · 043 · Super Admin (LDRRMO core module H: admin and security)
--
--  Roles after this migration:
--      Super Admin        lgu_ldrrmc + profiles.is_super_admin = true
--      LDRRMO Staff       lgu_ldrrmc
--      Barangay Official  barangay_official
--      Responder          dispatch_team
--      Citizen            citizen
--
--  Super Admin is a FLAG on an LGU account, not a new role key. Every existing
--  policy and function that checks `lgu_ldrrmc` (about sixty of them across
--  migrations 001-042) therefore keeps working unchanged: a Super Admin can do
--  everything LDRRMO staff can. What changes is the short list of things that
--  now require the flag:
--      · changing a role, a barangay assignment, a unit assignment or the
--        disabled flag on any account
--      · editing another person's profile row
--      · reading the activity log (audit_log)
--
--  The system can never be left without an active Super Admin: the profile
--  guard refuses the change that would remove the last one.
--
--  Deploy order: run this file, THEN deploy supabase/functions/admin-users.
--  Additive + idempotent. No row is deleted.
-- ============================================================================

begin;

-- ------------------------------------------------------------------- column
alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

comment on column public.profiles.is_super_admin is
  'Super Admin tier of the lgu_ldrrmc role: manages accounts, roles and the activity log. Only meaningful when role = lgu_ldrrmc.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_super_admin_role_check') then
    alter table public.profiles add constraint profiles_super_admin_role_check
      check (not is_super_admin or role = 'lgu_ldrrmc');
  end if;
end $$;

-- ------------------------------------------------------------------- helper
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'lgu_ldrrmc' and p.is_super_admin and not p.disabled
      from public.profiles p where p.id = auth.uid()), false);
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

-- ----------------------------------------------------- profile field guard
-- Supersedes the version in migration 038. Same protected fields, but the
-- caller must now be the Super Admin (not just any LGU account), and
-- is_super_admin itself is protected.
create or replace function public.guard_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- the flag can only ride on an LGU account
  if new.role is distinct from 'lgu_ldrrmc' then
    new.is_super_admin := false;
  end if;

  -- never leave the system without an active Super Admin. This applies to
  -- every caller, including the service role and the SQL editor.
  if old.is_super_admin and old.role = 'lgu_ldrrmc' and not old.disabled
     and not (new.is_super_admin and new.role = 'lgu_ldrrmc' and not new.disabled) then
    if not exists (
      select 1 from public.profiles p
       where p.id <> old.id and p.role = 'lgu_ldrrmc' and p.is_super_admin and not p.disabled
    ) then
      raise exception 'This is the last active Super Admin. Grant Super Admin to another account first.';
    end if;
  end if;

  -- no signed-in user means a trusted backend call (service role / Edge
  -- Function / SQL editor). Normal clients always carry a uid.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_super_admin() then
    if new.role is distinct from old.role then
      raise exception 'Roles are managed by the Super Admin';
    end if;
    if new.is_super_admin is distinct from old.is_super_admin then
      raise exception 'Super Admin access is managed by the Super Admin';
    end if;
    if new.barangay_id is distinct from old.barangay_id then
      raise exception 'Barangay assignment is managed by the Super Admin';
    end if;
    if new.disabled is distinct from old.disabled then
      raise exception 'Account status is managed by the Super Admin';
    end if;
    if new.dispatch_unit_id is distinct from old.dispatch_unit_id then
      raise exception 'Unit assignment is managed by the Super Admin';
    end if;
    if new.unit_role is distinct from old.unit_role then
      raise exception 'Unit role is managed by the Super Admin';
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------- policies
-- Editing someone else's profile row: Super Admin only (was: any LGU account).
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

-- The activity log: Super Admin only (was: any LGU account).
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated using (public.is_super_admin());

-- ------------------------------------------------------- role administration
-- The three RPCs from migration 006, now gated on the Super Admin.
-- p_role accepts 'super_admin' as shorthand for lgu_ldrrmc + the flag.
create or replace function public.admin_set_user_role(
  p_user uuid,
  p_role text,
  p_barangay_id uuid default null
)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.profiles;
  v_barangay text;
  v_before   public.profiles;
  v_super    boolean := (p_role = 'super_admin');
  v_role     text    := case when p_role = 'super_admin' then 'lgu_ldrrmc' else p_role end;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can change roles';
  end if;
  if v_role not in ('citizen', 'barangay_official', 'lgu_ldrrmc') then
    raise exception 'Unknown role: %', p_role;
  end if;

  select * into v_before from public.profiles where id = p_user;
  if v_before.id is null then
    raise exception 'That account does not exist';
  end if;
  if p_user = auth.uid() and v_before.is_super_admin and not v_super then
    raise exception 'You cannot remove your own Super Admin access';
  end if;

  v_barangay := null;
  if p_barangay_id is not null then
    select name into v_barangay from public.barangays where id = p_barangay_id;
  end if;

  update public.profiles
     set role           = v_role,
         is_super_admin = v_super,
         barangay_id    = coalesce(p_barangay_id, barangay_id),
         barangay       = coalesce(v_barangay, barangay),
         updated_at     = now()
   where id = p_user
  returning * into v_row;

  perform public.write_audit('user.role_changed', 'profiles', p_user,
    jsonb_build_object(
      'from', case when v_before.is_super_admin then 'super_admin' else v_before.role end,
      'to', p_role, 'barangay_id', p_barangay_id));

  return v_row;
end;
$$;

create or replace function public.admin_set_user_disabled(p_user uuid, p_disabled boolean)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can disable an account';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot disable your own account';
  end if;

  update public.profiles
     set disabled = p_disabled, updated_at = now()
   where id = p_user
  returning * into v_row;

  if v_row.id is null then
    raise exception 'That account does not exist';
  end if;

  perform public.write_audit(case when p_disabled then 'user.disabled' else 'user.enabled' end,
    'profiles', p_user, jsonb_build_object('disabled', p_disabled));

  return v_row;
end;
$$;

create or replace function public.admin_set_user_barangay(p_user uuid, p_barangay_id uuid)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_row  public.profiles;
  v_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can assign barangays';
  end if;

  select name into v_name from public.barangays where id = p_barangay_id;

  update public.profiles
     set barangay_id = p_barangay_id,
         barangay    = coalesce(v_name, ''),
         updated_at  = now()
   where id = p_user
  returning * into v_row;

  if v_row.id is null then
    raise exception 'That account does not exist';
  end if;

  perform public.write_audit('user.barangay_changed', 'profiles', p_user,
    jsonb_build_object('barangay_id', p_barangay_id, 'barangay', v_name));

  return v_row;
end;
$$;

-- ------------------------------------------------- the first Super Admin
-- Promotes the account that owns this email. The account must already exist
-- (sign up or be invited first). If it does not, the whole migration rolls
-- back with a clear message rather than leaving the system with no Super
-- Admin, which would lock everyone out of user management.
do $$
declare
  v_email constant text := 'geraldinegazazz05@gmail.com';
  v_id    uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    -- [this project] 026 already turned this project's 'super_admin' accounts
    -- into flagged Super Admins. If one is active, the system is not left
    -- without a Super Admin, so carry on; otherwise stop as upstream does.
    if exists (select 1 from public.profiles
                where role = 'lgu_ldrrmc' and is_super_admin and not disabled) then
      raise notice 'No account for %; keeping the existing Super Admin account(s).', v_email;
      return;
    end if;
    raise exception 'No account exists for %. Create or sign up that account, then run this migration again.', v_email;
  end if;

  update public.profiles
     set role = 'lgu_ldrrmc', is_super_admin = true, disabled = false,
         dispatch_unit_id = null, unit_role = '',   -- required by profiles_dispatch_team_unit_check
         updated_at = now()
   where id = v_id
     and not (role = 'lgu_ldrrmc' and is_super_admin and not disabled);

  if found then
    insert into public.audit_log (actor_id, action, entity, entity_id, meta)
    values (null, 'user.role_changed', 'profiles', v_id,
            jsonb_build_object('to', 'super_admin', 'email', v_email, 'via', 'migration 043'));
  elsif not exists (select 1 from public.profiles where id = v_id) then
    raise exception 'The account % has no profile row. Sign in once with it, then run this migration again.', v_email;
  end if;
end $$;

commit;

-- Verify:
--   select email, role, is_super_admin, disabled from public.profiles where is_super_admin;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 144_reports_documentation.sql
-- ============================================================================
--  UniGuard · 044 · Reports and documentation (LDRRMO core module G)
--
--  Two tables behind js/reporting.js:
--
--    damage_assessments   one row per barangay damage and needs assessment:
--                         affected and displaced population, casualties, houses,
--                         infrastructure and agriculture cost, lifelines, needs.
--                         Feeds the situation report.
--    situation_reports    the register of issued situation reports: number,
--                         event, period, scope and the headline figures at the
--                         time it was saved. Append-only.
--
--  Scope follows the rest of the system: a barangay official reads and writes
--  only their own barangay's rows; LGU accounts see every barangay. Only an LGU
--  account can mark an assessment `validated`, and a validated assessment is
--  read-only for the barangay.
--
--  Every change lands in audit_log through the generic row trigger from
--  migration 033, so it shows in the Activity Log (module H).
--
--  Until this file is applied the app keeps these records on the device.
--  Additive + idempotent.
-- ============================================================================

begin;

-- ------------------------------------------------------- damage assessments
create table if not exists public.damage_assessments (
  id                  uuid primary key default gen_random_uuid(),
  barangay_id         uuid references public.barangays(id) on delete set null,
  barangay            text not null default '',
  report_id           uuid references public.reports(id) on delete set null,
  report_code         text not null default '',
  event_name          text not null default '',
  hazard_type         text not null default '',
  assessed_on         date not null default current_date,

  affected_families   integer not null default 0 check (affected_families  >= 0),
  affected_persons    integer not null default 0 check (affected_persons   >= 0),
  displaced_families  integer not null default 0 check (displaced_families >= 0),
  displaced_persons   integer not null default 0 check (displaced_persons  >= 0),
  dead                integer not null default 0 check (dead     >= 0),
  injured             integer not null default 0 check (injured  >= 0),
  missing             integer not null default 0 check (missing  >= 0),
  houses_totally      integer not null default 0 check (houses_totally   >= 0),
  houses_partially    integer not null default 0 check (houses_partially >= 0),

  infra_damage_php    numeric(14,2) not null default 0 check (infra_damage_php >= 0),
  agri_damage_php     numeric(14,2) not null default 0 check (agri_damage_php  >= 0),
  infra_notes         text not null default '',
  agri_notes          text not null default '',

  power_status        text not null default 'Not assessed',
  water_status        text not null default 'Not assessed',
  comms_status        text not null default 'Not assessed',

  needs               text[] not null default '{}',
  needs_notes         text not null default '',
  remarks             text not null default '',

  status              text not null default 'draft'
                        check (status in ('draft', 'submitted', 'validated')),
  assessed_by_name    text not null default '',
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists damage_assessments_brgy_idx   on public.damage_assessments (barangay_id, assessed_on desc);
create index if not exists damage_assessments_date_idx   on public.damage_assessments (assessed_on desc);
create index if not exists damage_assessments_report_idx on public.damage_assessments (report_id);

-- Keep barangay_id and the barangay name in step, whichever one the client
-- sent, and stop a barangay official validating their own assessment.
create or replace function public.guard_damage_assessment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.barangay_id is null and coalesce(new.barangay, '') <> '' then
    select id into new.barangay_id from public.barangays where name = new.barangay;
  elsif new.barangay_id is not null and coalesce(new.barangay, '') = '' then
    select name into new.barangay from public.barangays where id = new.barangay_id;
  end if;

  if auth.uid() is not null and not public.is_lgu() then
    if tg_op = 'INSERT' then
      if new.status = 'validated' then
        raise exception 'Only LDRRMO staff can validate an assessment';
      end if;
    else
      if old.status = 'validated' then
        raise exception 'A validated assessment can only be changed by LDRRMO staff';
      end if;
      if new.status = 'validated' then
        raise exception 'Only LDRRMO staff can validate an assessment';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists damage_assessments_guard on public.damage_assessments;
create trigger damage_assessments_guard
  before insert or update on public.damage_assessments
  for each row execute function public.guard_damage_assessment();

drop trigger if exists damage_assessments_touch on public.damage_assessments;
create trigger damage_assessments_touch
  before update on public.damage_assessments
  for each row execute function public.touch_updated_at();

alter table public.damage_assessments enable row level security;

drop policy if exists damage_assessments_read on public.damage_assessments;
create policy damage_assessments_read on public.damage_assessments
  for select to authenticated using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );

drop policy if exists damage_assessments_insert on public.damage_assessments;
create policy damage_assessments_insert on public.damage_assessments
  for insert to authenticated with check (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );

drop policy if exists damage_assessments_update on public.damage_assessments;
create policy damage_assessments_update on public.damage_assessments
  for update to authenticated
  using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  )
  with check (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );

-- a barangay may withdraw its own draft; anything further along is LGU only
drop policy if exists damage_assessments_delete on public.damage_assessments;
create policy damage_assessments_delete on public.damage_assessments
  for delete to authenticated using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id() and status = 'draft')
    )
  );

-- ------------------------------------------------ situation report register
create table if not exists public.situation_reports (
  id                uuid primary key default gen_random_uuid(),
  sitrep_no         integer not null default 1 check (sitrep_no > 0),
  event_name        text not null default '',
  period_from       date,
  period_to         date,
  barangay_id       uuid references public.barangays(id) on delete set null,
  barangay          text not null default '',          -- '' = municipality-wide
  summary           jsonb not null default '{}'::jsonb, -- headline figures when saved
  remarks           text not null default '',
  prepared_by_name  text not null default '',
  created_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);

create index if not exists situation_reports_created_idx on public.situation_reports (created_at desc);
create index if not exists situation_reports_event_idx   on public.situation_reports (lower(event_name), sitrep_no);

alter table public.situation_reports enable row level security;

drop policy if exists situation_reports_read on public.situation_reports;
create policy situation_reports_read on public.situation_reports
  for select to authenticated using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );

-- a municipality-wide report (barangay_id null) can only be saved by the LGU
drop policy if exists situation_reports_insert on public.situation_reports;
create policy situation_reports_insert on public.situation_reports
  for insert to authenticated with check (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );
-- no update or delete policy: the register is append-only

-- ------------------------------------------------------------ activity log
do $$
declare t text;
begin
  foreach t in array array['damage_assessments', 'situation_reports']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

commit;

-- Verify:
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('damage_assessments', 'situation_reports') order by 1, 2;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 145_one_hour_lgu_escalation.sql
-- Migration 045 · one-hour LGU escalation for unverified barangay reports
--
-- Implements the DOCX requirement: "Dapat jan sa LGU kung di na check ng
-- barangay within 1hr mag aapear agad sa lgu to verify it." A report that
-- has not been verified by the Barangay Official within 60 minutes of
-- submission becomes visible in the LGU verification queue with a clear
-- "overdue" marker. The barangay official can still verify it later;
-- the LGU verification is a fallback, not a takeover.
--
-- This migration is purely additive: a new status flag, a new view, and a
-- new security-definer RPC. No existing column, row or policy is changed.
-- Re-runnable: every CREATE is guarded by IF NOT EXISTS.

/* ---------------------------------------------------------------------------
   1.escalation_status column on reports
   ---------------------------------------------------------------------------
   Adds an explicit, persisted escalation flag to the reports table so the
   LGU dashboard can read it directly without recomputing on every render.
   The trigger in step 2 keeps it in sync with the report's verification
   status and created_at.
*/
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS escalation_status text NOT NULL DEFAULT 'pending'
  CHECK (escalation_status IN ('pending','overdue','verified','cancelled'));

COMMENT ON COLUMN public.reports.escalation_status IS
  'pending = within the 1-hour barangay verification window; overdue = the window elapsed and the LGU verification queue should surface it; verified = the report has been verified (by the barangay official or LGU); cancelled = the report was rejected/archived and is no longer eligible for escalation.';

/* ---------------------------------------------------------------------------
   2.trigger that flips escalation_status to 'overdue' on the 1-hour boundary
   ---------------------------------------------------------------------------
   A Postgres trigger fires on every INSERT/UPDATE on reports. When the
   report's status is still 'reported' or 'verified' (i.e. not yet
   verified or already past it) AND created_at is more than 1 hour ago
   AND escalation_status is still 'pending', it flips to 'overdue'.
   Once the report is verified (status moves past 'verified'/'resolved'),
   it becomes 'verified' and stays that way. Rejected/archived reports
   become 'cancelled'.
*/
CREATE OR REPLACE FUNCTION public.ug_refresh_escalation_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  age_hours numeric;
BEGIN
  age_hours := EXTRACT(EPOCH FROM (now() - COALESCE(NEW.created_at, now()))) / 3600.0;

  IF NEW.status IN ('rejected') THEN
    NEW.escalation_status := 'cancelled';
  ELSIF NEW.status IN ('verified','dispatched','resolved') THEN
    NEW.escalation_status := 'verified';
  ELSIF NEW.status = 'reported' AND age_hours >= 1.0 THEN
    -- exactly at the 1-hour boundary: surface to LGU
    NEW.escalation_status := 'overdue';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_escalation ON public.reports;
CREATE TRIGGER trg_reports_escalation
  BEFORE INSERT OR UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.ug_refresh_escalation_status();

/* ---------------------------------------------------------------------------
   3. backfill the column on existing rows
   ---------------------------------------------------------------------------
   The trigger only fires on new writes, so existing rows need a one-shot
   backfill that applies the same rules. Idempotent — re-running the UPDATE
   leaves rows in the same state because the trigger enforces the rule on
   subsequent writes.
*/
UPDATE public.reports
   SET escalation_status = CASE
     WHEN status IN ('rejected') THEN 'cancelled'
     WHEN status IN ('verified','dispatched','resolved') THEN 'verified'
     WHEN status = 'reported' AND EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0 >= 1.0 THEN 'overdue'
     ELSE 'pending'
   END
WHERE escalation_status IS NULL OR escalation_status = 'pending';

/* ---------------------------------------------------------------------------
   4. lgu_escalation_queue view
   ---------------------------------------------------------------------------
   A read-only view that the LGU dashboard can read directly. Returns every
   report whose escalation_status is 'overdue' (i.e. the 1-hour window has
   elapsed without a barangay verification) along with the columns the LGU
   verification screen needs.
*/
CREATE OR REPLACE VIEW public.lgu_escalation_queue AS
SELECT
  r.id, r.code, r.hazard_type, r.barangay, r.barangay_id,
  r.severity, r.description, r.status,
  r.created_at,
  EXTRACT(EPOCH FROM (now() - r.created_at)) / 60.0 AS minutes_since_submission,
  r.escalation_status
FROM public.reports r
WHERE r.escalation_status = 'overdue'
ORDER BY r.created_at ASC;

COMMENT ON VIEW public.lgu_escalation_queue IS
  'Reports that the Barangay Official has not verified within 1 hour of submission. Surfaced to the LGU as a fallback verification queue. The original barangay official can still verify later.';

/* ---------------------------------------------------------------------------
   5. an RPC the LGU can call to "claim" an overdue report for verification
   ---------------------------------------------------------------------------
   The LGU verifies an overdue report by setting its status to 'verified'
   through this RPC. The RPC re-checks that the caller is an LGU staff
   member (or Super Admin) and writes an audit log row. Idempotent: calling
   it twice on the same report is a no-op after the first call.
*/
CREATE OR REPLACE FUNCTION public.lgu_verify_overdue_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_report public.reports%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller;
  IF NOT FOUND OR v_profile.role NOT IN ('lgu_ldrrmc') THEN
    RAISE EXCEPTION 'Only LGU staff can verify overdue reports' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_report FROM public.reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  -- short-circuit: already verified
  IF v_report.status IN ('verified','dispatched','resolved') THEN
    RETURN jsonb_build_object('ok', true, 'already_verified', true, 'report_id', p_report_id);
  END IF;

  -- advance the report to verified
  UPDATE public.reports
     SET status = 'verified',
         verified_at = now(),
         verified_by = v_caller,
         escalation_status = 'verified'
   WHERE id = p_report_id;

  -- write an audit row
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, meta, created_at)
  VALUES (v_caller, 'lgu_verify', 'reports', p_report_id,
          jsonb_build_object('from', v_report.status, 'to', 'verified',
                             'overdue_minutes', EXTRACT(EPOCH FROM (now() - v_report.created_at)) / 60.0),
          now());

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'status', 'verified');
END;
$$;

COMMENT ON FUNCTION public.lgu_verify_overdue_report(uuid) IS
  'Lets the LGU verify a report that the barangay official did not verify within 1 hour of submission. Re-checks the caller is LGU staff.';

/* ---------------------------------------------------------------------------
   6. RLS — the escalation queue is visible to LGU / Super Admin only
   ---------------------------------------------------------------------------
   The view inherits the reports table RLS for now (security_invoker was
   applied in migration 024). The explicit policy below is a defensive
   double-check for older engines. It is additive — never replaces existing
   reports policies.
*/
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_lgu_escalation_read" ON public.reports;
CREATE POLICY "reports_lgu_escalation_read"
  ON public.reports FOR SELECT
  TO authenticated
  USING (
    escalation_status = 'overdue'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('lgu_ldrrmc','barangay_official')
    )
  );

-- Allow LGU/Super Admin to call the verification RPC.
-- Postgres grants EXECUTE on functions to PUBLIC by default; the function
-- re-checks the caller internally, so no extra grant is required.


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 145_super_admin_improvements.sql
-- ============================================================================
--  UniGuard · 044 · Super Admin improvements
--
--  Companion to migration 043 (the Super Admin role). This file:
--    · Reclassifies inventory rows from the broad "Shelter" category into
--      the more accurate "Shelter Supplies" (tents, tarpaulins, sleeping
--      mats, blankets) and "Hygiene" (hygiene kits, soap, sanitary products,
--      water containers). The CHECK constraint is widened so the new
--      categories are valid going forward; existing rows are backfilled.
--    · Adds an audit_log_with_actor view that joins profiles into the
--      audit_log so the Super Admin Activity Log can show the actor's role
--      and barangay in one query (the JS client joins them already; this
--      view is the canonical server-side definition for the same data).
--    · Re-attaches the generic audit trigger to road_status if it is
--      missing (migration 033 already covers it, but this re-affirms it
--      so an upgrade-from-older-schema path doesn't miss the table).
--    · Grants the Super Admin SELECT on the new view (RLS already covers
--      the underlying audit_log via the audit_read policy from 043).
--
--  Additive + idempotent. No row is deleted. Existing item IDs, stock
--  quantities, supplier information, warehouse locations and reorder
--  levels are all preserved.
-- ============================================================================

begin;

-- ----------------------------------------------------------------- inventory
-- 1. Widen the CHECK on relief_inventory.category to accept the new
--    "Shelter Supplies" and "Hygiene" categories. Drop the old constraint
--    if it exists, then add the new one. Wrapped in DO so it is re-runnable.
do $$
declare
  c record;
begin
  for c in
    select oid, conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.relief_inventory'::regclass
       and contype = 'c'
  loop
    if position('Shelter' in coalesce(c.def, '')) > 0 then
      execute format('alter table public.relief_inventory drop constraint if exists %I', c.conname);
    end if;
  end loop;
end $$;

alter table public.relief_inventory
  drop constraint if exists relief_inventory_category_check;
alter table public.relief_inventory
  add constraint relief_inventory_category_check
    check (category in ('Food','Water','Medical','Equipment','Shelter','Shelter Supplies','Hygiene'));

comment on column public.relief_inventory.category is
  'Module E: the kind of stock. Shelter Supplies = tents, tarpaulins, sleeping mats, blankets (temporary shelter and sleeping items). Hygiene = hygiene kits, soap, sanitary products, water containers (personal sanitation). Shelter (legacy) is preserved for back-compat but new items should use Shelter Supplies.';

-- 2. Backfill existing rows: tarpaulins, sleeping mats, tents, blankets,
--    mosquito nets → Shelter Supplies; hygiene kits, soap, sanitary
--    products, water containers → Hygiene. Match on a case-insensitive
--    name pattern. Existing rows that don't match either pattern keep
--    their current category (so a custom item the LGU added is not
--    silently re-classified). Stock quantities, reorder levels, supplier
--    and location are NOT touched.
update public.relief_inventory
   set category = 'Shelter Supplies', updated_at = now()
 where category = 'Shelter'
   and (lower(name) ~ 'tarp|trapal|sleeping mat|tent|blanket|mosquito');

update public.relief_inventory
   set category = 'Hygiene', updated_at = now()
 where category = 'Shelter'
   and (lower(name) ~ 'hygiene|soap|detergent|sanitary|napkin|water container|sanitation');

-- 3. Audit the reclassification itself, one entry per affected row, so
--    the Super Admin can see in the activity log that the migration
--    changed the category. The actor is NULL (system / migration) so
--    it shows up as "System" in the activity log, which is correct.
--    relief_inventory.id is text (e.g. 'INV-01'), but audit_log.entity_id
--    is uuid — so we store null in entity_id and put the text id inside meta.
insert into public.audit_log (actor_id, action, entity, entity_id, meta)
select null, 'relief_inventory.category_reclassified', 'relief_inventory', null,
       jsonb_build_object('from', 'Shelter', 'to', category, 'name', name, 'item_id', id)
  from public.relief_inventory
 where category in ('Shelter Supplies', 'Hygiene');

-- 4. Audit triggers: re-affirm road_status has the generic audit trigger.
--    Migration 033 already creates it; this is defensive so an upgrade
--    from an older snapshot (033 not yet applied) still has coverage.
drop trigger if exists road_status_audit on public.road_status;
create trigger road_status_audit
  after insert or update or delete on public.road_status
  for each row execute function public.audit_row_change();

-- 4a. Redefine audit_row_change() to handle tables whose primary key is TEXT
--     (e.g. relief_inventory.id = 'INV-01'). The original function (migration
--     033) declares v_id uuid and assigns v_new->>'id' — which raises
--     "invalid input syntax for type uuid" on text ids. This version tries
--     the cast; if the id isn't a valid uuid, it passes null as entity_id
--     and puts the text id inside meta so the activity log still captures it.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old    jsonb;
  v_new    jsonb;
  v_meta   jsonb;
  v_entity text;
  v_id     uuid;
  v_raw_id text;
  v_changed jsonb;
begin
  v_entity := tg_table_name;

  if tg_op = 'DELETE' then
    v_old  := to_jsonb(old);
    v_raw_id := v_old->>'id';
    v_id := null;
    begin
      v_id := v_raw_id::uuid;
    exception when others then
      v_id := null;
    end;
    perform public.write_audit(v_entity || '.deleted', v_entity, v_id,
      jsonb_build_object('before', v_old, 'text_id', v_raw_id));
    return old;
  end if;

  v_new := to_jsonb(new);
  v_raw_id := v_new->>'id';
  v_id := null;
  begin
    v_id := v_raw_id::uuid;
  exception when others then
    v_id := null;
  end;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    -- keep the meta small: only the columns that actually changed
    select jsonb_object_agg(key, jsonb_build_object('from', old_value, 'to', new_value))
      into v_changed
      from jsonb_each(v_new) n(key, new_value)
      join jsonb_each(v_old) o(key, old_value) using (key)
     where n.new_value is distinct from o.old_value
       and key not in ('updated_at', 'created_at');
    if v_changed is null or v_changed = '{}'::jsonb then
      return new;  -- nothing meaningful changed
    end if;
    v_meta := jsonb_build_object('changed', v_changed, 'text_id', v_raw_id);
  else
    v_meta := jsonb_build_object('after', v_new, 'text_id', v_raw_id);
  end if;

  perform public.write_audit(v_entity || '.' || lower(tg_op), v_entity, v_id, v_meta);
  return coalesce(new, old);
end;
$$;

-- 5. The same for relief_inventory itself — every stock movement should
--    be auditable, including category changes made through the LGU UI.
--    (Migration 033 did NOT include relief_inventory, so this is a real
--    new trigger.)
drop trigger if exists relief_inventory_audit on public.relief_inventory;
create trigger relief_inventory_audit
  after insert or update or delete on public.relief_inventory
  for each row execute function public.audit_row_change();

-- 6. Relief distribution log: also covered by the generic trigger so the
--    Super Admin can see when a distribution record was created, edited
--    or deleted.
drop trigger if exists relief_distribution_log_audit on public.relief_distribution_log;
create trigger relief_distribution_log_audit
  after insert or update or delete on public.relief_distribution_log
  for each row execute function public.audit_row_change();

-- ----------------------------------------------------- audit_log_with_actor
-- 7. A view that joins profiles into audit_log so the Super Admin
--    Activity Log can read role + barangay in one query. Mirrors the
--    embedded select the JS client already does. The view is
--    security_invoker = true so the underlying audit_read policy from
--    migration 043 (Super Admin only) applies.
create or replace view public.audit_log_with_actor with (security_invoker = true) as
select a.id,
       a.created_at,
       a.actor_id,
       p.full_name     as actor_name,
       case when p.role = 'lgu_ldrrmc' and p.is_super_admin then 'super_admin'
            else p.role end as actor_role,
       p.unit_role     as actor_unit_role,
       p.barangay      as actor_barangay,
       a.action,
       a.entity,
       a.entity_id,
       a.meta
  from public.audit_log a
  left join public.profiles p on p.id = a.actor_id
 order by a.created_at desc;

grant select on public.audit_log_with_actor to authenticated;

comment on view public.audit_log_with_actor is
  'Joins audit_log to profiles so the Super Admin Activity Log can show the actor''s role and barangay in one query. RLS still applies through security_invoker.';

commit;

-- Verify:
--   select name, category from public.relief_inventory order by category, name;
--   select * from public.audit_log_with_actor limit 5;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 146_super_admin_verify_block_and_change_requests.sql
-- ============================================================================
--  UniGuard · 046 · Super Admin verify block + change request workflow
--
--  This migration closes three gaps from the master prompt:
--
--  1. SUPER ADMIN VERIFY BLOCK (Section 1 + Section 13.8 of the master prompt).
--     The client already hides the Verify / LGU-Verify buttons for Super Admin
--     sessions, but the underlying RPCs (advance_report_status and
--     lgu_verify_report) still accept any lgu_ldrrmc caller — which includes
--     a Super Admin calling the RPC directly via SQL editor or a custom HTTP
--     request. This migration adds a server-side check at the top of each
--     function: if the caller is a Super Admin and the action would verify a
--     report (reported → verified, or LGU-verify), raise an exception.
--     A config flag UG_CONFIG.SUPER_ADMIN_VERIFY_OVERRIDE on the client only
--     relaxes the client guard; the server is always enforced.
--
--  2. CHANGE REQUEST WORKFLOW (Emergency Hotlines Management and Super Admin
--     Approval — Sections A, B, C, D, E). Adds:
--       · change_requests table — pending submissions from LGU / BO for
--         add/edit/delete actions on protected tables (initially emergency_
--         hotlines; the schema is generic so other tables can be added).
--       · RLS: LGU / BO can INSERT + SELECT their own; Super Admin can SELECT
--         all and UPDATE (to set status, decided_by, decided_at, decision_note).
--         No DELETE policy — history is preserved.
--       · submit_change_request(p_target_table, p_action, p_target_id,
--         p_current_data, p_proposed_data, p_reason) — security definer RPC
--         that creates a pending row. The caller's id, role and barangay are
--         stamped from auth.uid() / profiles, never from the client payload.
--       · approve_change_request(p_request_id, p_decision_note) — Super Admin
--         only. Applies the change to the target table, marks the request
--         approved, writes audit_log, and notifies the requester.
--       · reject_change_request(p_request_id, p_decision_note) — Super Admin
--         only. Marks the request rejected, writes audit_log, notifies the
--         requester. Official record is unchanged.
--       · Tightened emergency_hotlines RLS: SELECT stays open to authenticated;
--         INSERT/UPDATE/DELETE restricted to the Super Admin only. LGU/BO
--         must go through submit_change_request.
--
--  3. ACTIVITY LOG RECORDS for change requests, approvals, rejections, and
--     direct Super Admin hotline mutations. The existing audit_row_change
--     trigger (migration 033) already covers emergency_hotlines create/edit/
--     delete; the new RPCs add explicit audit rows for the request lifecycle.
--
--  Additive + idempotent. No row is deleted.
-- ============================================================================

begin;

-- ============================================================================
--  PART 1 — Super Admin verify block (server-side)
-- ============================================================================

-- ---------------------------------------------------------------- advance_report_status
-- Re-define with the additional guard: a Super Admin cannot move a report
-- from 'reported' to 'verified' (which is the verify step). The other
-- transitions (verified → dispatched, dispatched → resolved, reject) are
-- still allowed, since those are not "verify" actions.
do $$
begin
  -- drop the existing grant before redefining (idempotent)
  revoke execute on function public.advance_report_status(uuid, text, text) from authenticated;
end $$;

create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.reports;
  v_role     text;
  v_brgy     uuid;
  v_is_super boolean := false;
  v_reporter uuid;
  v_code     text;
  v_tone     text;
  v_title    text;
  v_body     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('reported', 'verified', 'dispatched', 'resolved', 'rejected') then
    raise exception 'Unknown status: %', p_next;
  end if;

  -- fetch the caller's profile in one round-trip; v_is_super tells us if they
  -- are a Super Admin (lgu_ldrrmc + is_super_admin).
  select role, barangay_id, coalesce(is_super_admin, false)
    into v_role, v_brgy, v_is_super
    from public.profiles where id = auth.uid();

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can change an incident status';
  end if;

  -- ── Super Admin verify block ───────────────────────────────────────────
  -- Moving reported → verified is the verify step. The Super Admin must NOT
  -- be able to perform it, even though they inherit lgu_ldrrmc privileges.
  -- Other transitions (dispatch, resolve, reject) are allowed because they
  -- are not "verify" actions.
  if v_is_super and v_row.status = 'reported' and p_next = 'verified' then
    raise exception 'Super Admin cannot verify reports. Use Edit to correct the record instead.';
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  update public.reports set status = p_next where id = p_report_id returning * into v_row;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('to', p_next, 'note', coalesce(p_note, '')));

  -- notify the reporter (if any) so a citizen sees every status change
  v_reporter := v_row.reporter_id;
  v_code     := coalesce(v_row.code, '');
  if v_reporter is not null then
    v_tone  := case p_next when 'dispatched' then 'warning' when 'resolved' then 'prepared'
                            when 'rejected'  then 'warning' else 'advisory' end;
    v_title := case p_next
      when 'verified'   then 'Your report was verified'
      when 'dispatched' then 'Response dispatched to your report'
      when 'resolved'   then 'Your report is resolved'
      when 'rejected'   then 'Your report was rejected'
      else 'Your report status changed'
    end;
    v_body  := case p_next
      when 'verified'   then 'Report ' || v_code || ' has been reviewed and verified.'
      when 'dispatched' then 'A responder unit has been dispatched for ' || v_code || '.'
      when 'resolved'   then 'Report ' || v_code || ' is resolved. Closing note: ' || left(coalesce(p_note, ''), 140)
      when 'rejected'   then 'Report ' || v_code || ' was rejected: ' || left(coalesce(p_note, ''), 140)
      else 'Report ' || v_code || ' is now ' || p_next || '.'
    end;
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_reporter, v_title, v_body, v_tone, 'check', 'report_status', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;

grant execute on function public.advance_report_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- lgu_verify_report
-- Same guard: the Super Admin must not be able to LGU-verify a report.
do $$
begin
  revoke execute on function public.lgu_verify_report(uuid, text) from authenticated;
end $$;

create or replace function public.lgu_verify_report(p_report_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row    public.reports;
  v_role   text;
  v_name   text;
  v_brgy   uuid;
  v_is_super boolean := false;
  v_reporter uuid;
  v_code   text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select role, barangay_id, coalesce(full_name, ''), coalesce(is_super_admin, false)
    into v_role, v_brgy, v_name, v_is_super
    from public.profiles where id = auth.uid();

  if v_role is null then
    raise exception 'Your account could not be loaded';
  end if;
  if v_role <> 'lgu_ldrrmc' then
    raise exception 'Only LGU / LDRRMC can LGU-verify a report';
  end if;

  -- ── Super Admin verify block ───────────────────────────────────────────
  if v_is_super then
    raise exception 'Super Admin cannot verify reports. Use Edit to correct the record instead.';
  end if;

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;
  if v_row.status <> 'reported' then
    raise exception 'Only a report still in "reported" can be LGU-verified (it is "%")', v_row.status;
  end if;

  perform set_config('uniguard.reason', 'lgu_verify', true);
  perform set_config('uniguard.note',  coalesce(p_note, ''), true);

  update public.reports
     set status           = 'verified',
         verified_by      = auth.uid(),
         verified_by_name = v_name,
         verified_by_role = 'lgu_ldrrmc',
         verified_at     = now()
   where id = p_report_id
   returning * into v_row;

  perform public.write_audit('report.lgu_verified', 'reports', p_report_id,
    jsonb_build_object('note', left(coalesce(p_note, ''), 300),
                        'verified_by', v_name));

  v_reporter := v_row.reporter_id;
  v_code     := coalesce(v_row.code, '');
  if v_reporter is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_reporter,
            'Your report was LGU-verified',
            'Report ' || v_code || ' was verified by the Municipal DRRMO' ||
              case when coalesce(p_note, '') <> '' then ' — ' || left(p_note, 140) else '' end,
            'prepared', 'shield', 'report_status', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'verified_by', v_name, 'verified_by_role', 'lgu_ldrrmc');
end;
$$;

grant execute on function public.lgu_verify_report(uuid, text) to authenticated;


-- ============================================================================
--  PART 2 — Change request workflow (Emergency Hotlines approval)
-- ============================================================================

-- -------------------------------------------------------- change_requests table
create table if not exists public.change_requests (
  id              uuid primary key default gen_random_uuid(),
  -- who submitted
  requester_id    uuid not null references public.profiles(id) on delete set null,
  requester_role  text not null default '',
  requester_name  text not null default '',
  requester_barangay text not null default '',
  -- what they want to change
  target_table    text not null,           -- e.g. 'emergency_hotlines'
  target_id       uuid,                    -- null for an Add request
  action          text not null,            -- 'add' | 'edit' | 'delete'
  current_data    jsonb not null default '{}'::jsonb,
  proposed_data   jsonb not null default '{}'::jsonb,
  reason          text not null default '',
  -- lifecycle
  status          text not null default 'pending',
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  decision_note   text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint change_requests_action_check check (action in ('add','edit','delete')),
  constraint change_requests_status_check check (status in ('pending','approved','rejected')),
  constraint change_requests_target_check check (
    target_table in ('emergency_hotlines','evacuation_centers','advisories','road_status','preparedness_guides')
  )
);

create index if not exists change_requests_status_idx on public.change_requests (status, created_at desc);
create index if not exists change_requests_requester_idx on public.change_requests (requester_id, created_at desc);
create index if not exists change_requests_target_idx on public.change_requests (target_table, target_id);

alter table public.change_requests enable row level security;

-- LGU and Barangay Officials can submit (INSERT) and read their own requests.
-- Super Admin can read all and UPDATE (decide). Nobody can DELETE — the
-- request history is preserved even after a decision.
drop policy if exists change_requests_read on public.change_requests;
create policy change_requests_read on public.change_requests
  for select to authenticated using (
    public.is_super_admin()
    or requester_id = auth.uid()
  );

drop policy if exists change_requests_insert on public.change_requests;
create policy change_requests_insert on public.change_requests
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and (public.is_lgu() or public.is_official())
  );

drop policy if exists change_requests_update on public.change_requests;
create policy change_requests_update on public.change_requests
  for update to authenticated using (public.is_super_admin())
  with check (public.is_super_admin());

-- no delete policy: history is preserved.

grant select on public.change_requests to authenticated;

comment on table public.change_requests is
  'Master prompt · Emergency Hotlines Management and Super Admin Approval. Holds pending add/edit/delete requests submitted by LGU staff or Barangay Officials against protected tables (initially emergency_hotlines). The Super Admin approves or rejects each one; only approved changes are applied to the official records.';

-- -------------------------------------------------- submit_change_request RPC
-- Creates a pending change request. The caller's identity, role and barangay
-- are stamped from auth.uid() / profiles, never from the client payload.
create or replace function public.submit_change_request(
  p_target_table  text,
  p_action        text,
  p_target_id     uuid default null,
  p_current_data  jsonb default '{}'::jsonb,
  p_proposed_data jsonb default '{}'::jsonb,
  p_reason        text default ''
)
returns public.change_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_row    public.change_requests;
  v_role   text;
  v_name   text;
  v_brgy   text;
  v_is_super boolean := false;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_action not in ('add','edit','delete') then
    raise exception 'Action must be add, edit or delete';
  end if;
  if p_action in ('edit','delete') and p_target_id is null then
    raise exception 'A target_id is required for edit / delete requests';
  end if;
  if p_action = 'add' and (p_proposed_data is null or p_proposed_data = '{}'::jsonb) then
    raise exception 'Proposed data is required for an add request';
  end if;
  -- Super Admin does not submit requests — they directly manage the records.
  select role, coalesce(full_name,''), coalesce(barangay,''), coalesce(is_super_admin, false)
    into v_role, v_name, v_brgy, v_is_super
    from public.profiles where id = auth.uid();
  if v_is_super then
    raise exception 'The Super Admin manages official records directly — no request needed';
  end if;
  if v_role not in ('barangay_official','lgu_ldrrmc') then
    raise exception 'Only Barangay Officials and LGU staff may submit change requests';
  end if;

  insert into public.change_requests (
    requester_id, requester_role, requester_name, requester_barangay,
    target_table, target_id, action,
    current_data, proposed_data, reason
  ) values (
    auth.uid(), v_role, v_name, v_brgy,
    p_target_table, p_target_id, p_action,
    coalesce(p_current_data, '{}'::jsonb),
    coalesce(p_proposed_data, '{}'::jsonb),
    left(coalesce(p_reason, ''), 500)
  ) returning * into v_row;

  perform public.write_audit('change_request.submitted', 'change_requests', v_row.id,
    jsonb_build_object(
      'target_table', p_target_table,
      'target_id', p_target_id,
      'action', p_action,
      'reason', left(coalesce(p_reason, ''), 240),
      'requester', v_name
    ));

  return v_row;
end;
$$;

revoke all on function public.submit_change_request(text, text, uuid, jsonb, jsonb, text) from public;
grant execute on function public.submit_change_request(text, text, uuid, jsonb, jsonb, text) to authenticated;

-- -------------------------------------------------- approve_change_request RPC
-- Super Admin only. Applies the proposed change to the target table, marks
-- the request approved, writes audit_log, and notifies the requester.
create or replace function public.approve_change_request(
  p_request_id    uuid,
  p_decision_note text default ''
)
returns public.change_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_row    public.change_requests;
  v_name   text;
  v_id     uuid;
  v_proposed jsonb;
  v_current jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can approve a change request';
  end if;

  select * into v_row from public.change_requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'That change request does not exist';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That change request has already been decided (%)', v_row.status;
  end if;

  select coalesce(full_name,'') into v_name from public.profiles where id = auth.uid();
  v_proposed := v_row.proposed_data;
  v_current  := v_row.current_data;

  -- Apply the change to the target table. Only emergency_hotlines is wired up
  -- in this migration; additional tables can be added here as needed.
  if v_row.target_table = 'emergency_hotlines' then
    if v_row.action = 'add' then
      insert into public.emergency_hotlines (agency_name, contact_number, scope, description, barangay_id, active)
      values (
        coalesce(v_proposed->>'agency_name',''),
        coalesce(v_proposed->>'contact_number',''),
        coalesce(v_proposed->>'scope','Municipality-wide'),
        coalesce(v_proposed->>'description',''),
        nullif(v_proposed->>'barangay_id','')::uuid,
        coalesce((v_proposed->>'active')::boolean, true)
      ) returning id into v_id;
    elsif v_row.action = 'edit' then
      update public.emergency_hotlines
         set agency_name    = coalesce(v_proposed->>'agency_name', agency_name),
             contact_number = coalesce(v_proposed->>'contact_number', contact_number),
             scope          = coalesce(v_proposed->>'scope', scope),
             description    = coalesce(v_proposed->>'description', description),
             active         = coalesce((v_proposed->>'active')::boolean, active),
             updated_at     = now()
       where id = v_row.target_id
       returning id into v_id;
      v_id := v_row.target_id;
    elsif v_row.action = 'delete' then
      delete from public.emergency_hotlines where id = v_row.target_id returning id into v_id;
      v_id := v_row.target_id;
    end if;
  else
    raise exception 'Approving changes on % is not supported yet', v_row.target_table;
  end if;

  update public.change_requests
     set status = 'approved',
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = left(coalesce(p_decision_note, ''), 500),
         updated_at = now()
   where id = p_request_id
   returning * into v_row;

  perform public.write_audit('change_request.approved', 'change_requests', p_request_id,
    jsonb_build_object(
      'target_table', v_row.target_table,
      'target_id', v_row.target_id,
      'action', v_row.action,
      'decided_by', v_name,
      'note', left(coalesce(p_decision_note, ''), 240)
    ));

  -- notify the requester
  if v_row.requester_id is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type)
    values (v_row.requester_id,
            'Change request approved',
            'Your ' || v_row.action || ' request on ' || v_row.target_table ||
              ' was approved by ' || v_name || '.' ||
              case when coalesce(p_decision_note, '') <> '' then ' ' || left(p_decision_note, 140) else '' end,
            'prepared', 'check', 'change_request');
  end if;

  return v_row;
end;
$$;

revoke all on function public.approve_change_request(uuid, text) from public;
grant execute on function public.approve_change_request(uuid, text) to authenticated;

-- -------------------------------------------------- reject_change_request RPC
-- Super Admin only. Leaves the official record unchanged, stores the
-- rejection decision + note, writes audit_log, and notifies the requester.
create or replace function public.reject_change_request(
  p_request_id    uuid,
  p_decision_note text default ''
)
returns public.change_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_row  public.change_requests;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can reject a change request';
  end if;

  select * into v_row from public.change_requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'That change request does not exist';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That change request has already been decided (%)', v_row.status;
  end if;

  select coalesce(full_name,'') into v_name from public.profiles where id = auth.uid();

  update public.change_requests
     set status = 'rejected',
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = left(coalesce(p_decision_note, ''), 500),
         updated_at = now()
   where id = p_request_id
   returning * into v_row;

  perform public.write_audit('change_request.rejected', 'change_requests', p_request_id,
    jsonb_build_object(
      'target_table', v_row.target_table,
      'target_id', v_row.target_id,
      'action', v_row.action,
      'decided_by', v_name,
      'note', left(coalesce(p_decision_note, ''), 240)
    ));

  if v_row.requester_id is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type)
    values (v_row.requester_id,
            'Change request rejected',
            'Your ' || v_row.action || ' request on ' || v_row.target_table ||
              ' was rejected by ' || v_name || '.' ||
              case when coalesce(p_decision_note, '') <> '' then ' Reason: ' || left(p_decision_note, 140) else '' end,
            'warning', 'alert', 'change_request');
  end if;

  return v_row;
end;
$$;

revoke all on function public.reject_change_request(uuid, text) from public;
grant execute on function public.reject_change_request(uuid, text) to authenticated;

-- ============================================================================
--  PART 3 — Tighten emergency_hotlines RLS (Super Admin only writes)
-- ============================================================================

-- DROP the old LGU-wide write policy and replace it with a Super-Admin-only
-- one. LGU / BO must now go through submit_change_request → approve_change_
-- request. The audit_row_change trigger (migration 033) still fires on every
-- direct Super Admin INSERT/UPDATE/DELETE.
drop policy if exists hotlines_write on public.emergency_hotlines;
create policy hotlines_write on public.emergency_hotlines
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

comment on policy hotlines_write on public.emergency_hotlines is
  'Master prompt · Emergency Hotlines Management. Only the Super Admin can directly INSERT / UPDATE / DELETE official hotline records. LGU and Barangay Officials must submit a change_request and wait for Super Admin approval.';

-- ============================================================================
--  PART 4 — Audit trigger on change_requests itself
-- ============================================================================
-- The generic audit_row_change trigger covers emergency_hotlines etc. We add
-- a dedicated trigger on change_requests so the request lifecycle (not just
-- the underlying record change) is captured in one place.
drop trigger if exists change_requests_audit on public.change_requests;
create trigger change_requests_audit
  after insert or update on public.change_requests
  for each row execute function public.audit_row_change();

commit;

-- Verify:
--   select id, action, target_table, status from public.change_requests order by created_at desc;
--   select agency_name, contact_number from public.emergency_hotlines order by agency_name;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 147_one_hour_lgu_escalation.sql
-- Migration 047 · one-hour LGU escalation for unverified barangay reports
--
-- Implements the DOCX requirement: "Dapat jan sa LGU kung di na check ng
-- barangay within 1hr mag aapear agad sa lgu to verify it." A report that
-- has not been verified by the Barangay Official within 60 minutes of
-- submission becomes visible in the LGU verification queue with a clear
-- "overdue" marker. The barangay official can still verify it later;
-- the LGU verification is a fallback, not a takeover.
--
-- NOTE: migration 036 already implements a 30-minute "is_stale" flag on the
-- reports_feed view + a severity bypass for life-safety hazards. This
-- migration adds the explicit persisted escalation_status column + a 1-hour
-- boundary + an RPC the LGU uses to verify an overdue report. The two
-- mechanisms coexist: 30-minute "stale" surfaces the report as a chip;
-- 60-minute "overdue" persists the status and exposes a verification queue.
--
-- This migration is purely additive: a new status flag, a new view, and a
-- new security-definer RPC. No existing column, row or policy is changed.
-- Re-runnable: every CREATE is guarded by IF NOT EXISTS.

/* ---------------------------------------------------------------------------
   1. escalation_status column on reports
   ---------------------------------------------------------------------------
   Adds an explicit, persisted escalation flag to the reports table so the
   LGU dashboard can read it directly without recomputing on every render.
   The trigger in step 2 keeps it in sync with the report's verification
   status and created_at.
*/
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS escalation_status text NOT NULL DEFAULT 'pending'
  CHECK (escalation_status IN ('pending','overdue','verified','cancelled'));

COMMENT ON COLUMN public.reports.escalation_status IS
  'pending = within the 1-hour barangay verification window; overdue = the window elapsed and the LGU verification queue should surface it; verified = the report has been verified (by the barangay official or LGU); cancelled = the report was rejected/archived and is no longer eligible for escalation.';

/* ---------------------------------------------------------------------------
   2. trigger that flips escalation_status to 'overdue' on the 1-hour boundary
   ---------------------------------------------------------------------------
   A Postgres trigger fires on every INSERT/UPDATE on reports. When the
   report's status is still 'reported' AND created_at is more than 1 hour
   ago AND escalation_status is still 'pending', it flips to 'overdue'.
   Once the report is verified (status moves past 'verified'/'resolved'),
   it becomes 'verified' and stays that way. Rejected/archived reports
   become 'cancelled'.
*/
CREATE OR REPLACE FUNCTION public.ug_refresh_escalation_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  age_hours numeric;
BEGIN
  age_hours := EXTRACT(EPOCH FROM (now() - COALESCE(NEW.created_at, now()))) / 3600.0;

  IF NEW.status IN ('rejected') THEN
    NEW.escalation_status := 'cancelled';
  ELSIF NEW.status IN ('verified','dispatched','resolved') THEN
    NEW.escalation_status := 'verified';
  ELSIF NEW.status = 'reported' AND age_hours >= 1.0 THEN
    -- exactly at the 1-hour boundary: surface to LGU
    NEW.escalation_status := 'overdue';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_escalation ON public.reports;
CREATE TRIGGER trg_reports_escalation
  BEFORE INSERT OR UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.ug_refresh_escalation_status();

/* ---------------------------------------------------------------------------
   3. backfill the column on existing rows
   ---------------------------------------------------------------------------
   The trigger only fires on new writes, so existing rows need a one-shot
   backfill that applies the same rules. Idempotent — re-running the UPDATE
   leaves rows in the same state because the trigger enforces the rule on
   subsequent writes.
*/
UPDATE public.reports
   SET escalation_status = CASE
     WHEN status IN ('rejected') THEN 'cancelled'
     WHEN status IN ('verified','dispatched','resolved') THEN 'verified'
     WHEN status = 'reported' AND EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0 >= 1.0 THEN 'overdue'
     ELSE 'pending'
   END
WHERE escalation_status IS NULL OR escalation_status = 'pending';

/* ---------------------------------------------------------------------------
   4. lgu_escalation_queue view
   ---------------------------------------------------------------------------
   A read-only view that the LGU dashboard can read directly. Returns every
   report whose escalation_status is 'overdue' (i.e. the 1-hour window has
   elapsed without a barangay verification) along with the columns the LGU
   verification screen needs.
*/
CREATE OR REPLACE VIEW public.lgu_escalation_queue AS
SELECT
  r.id, r.code, r.hazard_type, r.barangay, r.barangay_id,
  r.severity, r.description, r.status,
  r.created_at,
  EXTRACT(EPOCH FROM (now() - r.created_at)) / 60.0 AS minutes_since_submission,
  r.escalation_status
FROM public.reports r
WHERE r.escalation_status = 'overdue'
ORDER BY r.created_at ASC;

COMMENT ON VIEW public.lgu_escalation_queue IS
  'Reports that the Barangay Official has not verified within 1 hour of submission. Surfaced to the LGU as a fallback verification queue. The original barangay official can still verify later.';

/* ---------------------------------------------------------------------------
   5. an RPC the LGU can call to "claim" an overdue report for verification
   ---------------------------------------------------------------------------
   The LGU verifies an overdue report by setting its status to 'verified'
   through this RPC. The RPC re-checks that the caller is an LGU staff
   member (NOT a Super Admin — Super Admin verify is blocked per migration
   046) and writes an audit log row. Idempotent: calling it twice on the
   same report is a no-op after the first call.
*/
CREATE OR REPLACE FUNCTION public.lgu_verify_overdue_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_report public.reports%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller;
  IF NOT FOUND OR v_profile.role NOT IN ('lgu_ldrrmc') THEN
    RAISE EXCEPTION 'Only LGU staff can verify overdue reports' USING ERRCODE = '42501';
  END IF;

  -- Super Admin cannot verify reports (defense-in-depth, same rule as
  -- migration 046's lgu_verify_report and advance_report_status guards).
  IF COALESCE(v_profile.is_super_admin, false) THEN
    RAISE EXCEPTION 'Super Admin cannot verify reports. Use Edit to correct the record instead.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_report FROM public.reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  -- short-circuit: already verified
  IF v_report.status IN ('verified','dispatched','resolved') THEN
    RETURN jsonb_build_object('ok', true, 'already_verified', true, 'report_id', p_report_id);
  END IF;

  -- advance the report to verified
  UPDATE public.reports
     SET status = 'verified',
         verified_at = now(),
         verified_by = v_caller,
         escalation_status = 'verified'
   WHERE id = p_report_id;

  -- write an audit row (only if the audit_log table exists)
  BEGIN
    INSERT INTO public.audit_log (actor_id, action, entity, entity_id, meta, created_at)
    VALUES (v_caller, 'lgu_verify', 'reports', p_report_id,
            jsonb_build_object('from', v_report.status, 'to', 'verified',
                               'overdue_minutes', EXTRACT(EPOCH FROM (now() - v_report.created_at)) / 60.0),
            now());
  EXCEPTION WHEN OTHERS THEN
    NULL; -- audit_log missing or different schema — non-fatal
  END;

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'status', 'verified');
END;
$$;

COMMENT ON FUNCTION public.lgu_verify_overdue_report(uuid) IS
  'Lets the LGU verify a report that the barangay official did not verify within 1 hour of submission. Re-checks the caller is LGU staff (not Super Admin).';

/* ---------------------------------------------------------------------------
   6. RLS — the escalation queue is visible to LGU / Super Admin only
   ---------------------------------------------------------------------------
   The view inherits the reports table RLS for now (security_invoker was
   applied in migration 024). The explicit policy below is a defensive
   double-check for older engines. It is additive — never replaces existing
   reports policies.
*/
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_lgu_escalation_read" ON public.reports;
CREATE POLICY "reports_lgu_escalation_read"
  ON public.reports FOR SELECT
  TO authenticated
  USING (
    escalation_status = 'overdue'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('lgu_ldrrmc','barangay_official')
    )
  );

-- Allow LGU/Super Admin to call the verification RPC.
-- Postgres grants EXECUTE on functions to PUBLIC by default; the function
-- re-checks the caller internally, so no extra grant is required.


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 148_fixpack_01.sql
-- Migration 048 · Fix Pack 01 (tester findings, QA PDF Oct 23 2026)
--
-- Idempotent and re-runnable: every change is guarded (IF NOT EXISTS /
-- constraint lookup), so running it twice is harmless. Apply it in the
-- Supabase SQL editor after 047.
--
-- Sections:
--   A. advisories.delivery_mode (Task F2) — the advisory composer writes this
--      column but no earlier migration created it, so every publish failed
--      with "Could not find the 'delivery_mode' column of 'advisories' in the
--      schema cache".

begin;

-- A. advisories.delivery_mode (composer: push notification vs in-app only)
alter table public.advisories
  add column if not exists delivery_mode text not null default 'push';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'advisories_delivery_mode_check') then
    alter table public.advisories add constraint advisories_delivery_mode_check
      check (delivery_mode in ('push','in_app'));
  end if;
end $$;
comment on column public.advisories.delivery_mode is
  'push = publish + Web Push/SMS fan-out; in_app = publish to the in-app inbox only.';
-- safety net in case 041 was skipped on the live project
alter table public.advisories add column if not exists alert_type text not null default 'general';
alter table public.advisories add column if not exists language  text not null default 'en';

commit;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 149_hazard_keys.sql
-- ============================================================================
--  UniGuard · 149 · One stored form for hazard types: the key
--
--  reports.hazard_type held two forms. This project's app stored the display
--  label ('Fire', 'Electrical / Power Line Hazard'); upstream stores the key
--  ('fire', 'power_line'). The rules disagreed the same way: the escalation
--  policy (136/147) matches keys, so a label never got the life-safety fast
--  track, while the "Others" rule (010) and the review view (018) match the
--  label 'Others', so a key 'other' skipped both.
--
--  From here the key is the stored form (the app now writes keys). This file
--  converts existing labels to keys and lets the two "Others" rules accept
--  either spelling. Idempotent; display is unaffected (the app shows labels).
-- ============================================================================
update public.reports r
   set hazard_type = m.key
  from (values
    ('flood', 'Flood'), ('river_overflow', 'River Overflow'), ('drainage_blockage', 'Drainage Blockage'),
    ('storm_surge', 'Storm Surge'), ('coastal_erosion', 'Coastal Erosion'),
    ('strong_wind', 'Strong Wind / Typhoon Damage'), ('fallen_tree', 'Fallen Tree'),
    ('landslide', 'Landslide / Soil Erosion'), ('earthquake', 'Earthquake'), ('road_damage', 'Road Damage'),
    ('vehicular_accident', 'Vehicular Accident'), ('fire', 'Fire'),
    ('power_line', 'Electrical / Power Line Hazard'), ('other', 'Others')
  ) as m(key, label)
 where lower(trim(r.hazard_type)) = lower(m.label);

alter table public.reports drop constraint if exists reports_other_requires_text;
alter table public.reports add constraint reports_other_requires_text
  check (hazard_type not in ('Others', 'other')
         or (hazard_other_text is not null and length(trim(hazard_other_text)) > 0))
  not valid;
do $$
begin
  alter table public.reports validate constraint reports_other_requires_text;
exception when others then
  raise notice 'reports_other_requires_text kept NOT VALID: some older "Others" rows have no description';
end $$;

create or replace view public.others_hazard_review as
  select hazard_other_text as description,
         count(*)          as occurrences,
         max(created_at)   as latest_at
    from public.reports
   where hazard_type in ('Others', 'other')
     and hazard_other_text is not null
     and length(trim(hazard_other_text)) > 0
   group by lower(trim(hazard_other_text)), hazard_other_text
   order by occurrences desc, latest_at desc;
grant select on public.others_hazard_review to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 150_dispatch_reads_its_reports.sql
-- ============================================================================
--  UniGuard · 150 · A dispatch unit can read the reports dispatched to it
--
--  138/139 let a dispatch_team account read the report_dispatches rows
--  addressed to its unit, but not the reports behind them, so the dispatch
--  console showed a dispatch with no hazard, barangay or location (the
--  report embed came back empty). This adds exactly that read: a dispatch
--  account sees a report only while a dispatch of it is addressed to the
--  account's own unit.
--
--  The check runs in a security definer function, because a policy on
--  reports that queried report_dispatches directly would recurse into the
--  report_dispatches policy, which itself queries reports.
--  Additive and idempotent.
-- ============================================================================
create or replace function public.report_is_dispatched_to_my_unit(p_report_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_dispatch() and exists (
    select 1 from public.report_dispatches d
     where d.report_id = p_report_id
       and d.unit_id = public.my_unit_id()
  );
$$;
revoke all on function public.report_is_dispatched_to_my_unit(uuid) from public;
grant execute on function public.report_is_dispatched_to_my_unit(uuid) to authenticated;

drop policy if exists reports_read_dispatched_unit on public.reports;
create policy reports_read_dispatched_unit on public.reports
  for select to authenticated using (public.report_is_dispatched_to_my_unit(id));


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 151_phase3_operations.sql
-- 151: Phase 3 operations — overdue queue, relief stock, view rights.
--
-- 1. The one-hour overdue queue (147) only flipped a report to 'overdue' when
--    something wrote to it, so a report nobody touched never reached the LGU.
--    The queue now works from the clock, the way reports_feed computes
--    is_stale (136). It also ran with its owner's rights and no role filter,
--    so any account could list every overdue report; it now runs with the
--    reader's rights, and the extra read rule from 147 is narrowed to the LGU
--    (it let an official read every barangay's overdue reports).
-- 2. lgu_verify_overdue_report verifies through lgu_verify_report, so both
--    paths record who verified, notify the reporter and refuse the Super Admin.
-- 3. others_hazard_review also ran with its owner's rights; it now runs with
--    the reader's.
-- 4. relief_inventory / relief_distribution_log had text ids with no default,
--    write rules that ignored disabled accounts, and let an official log a
--    distribution for any barangay. A distribution is now recorded through
--    log_relief_distribution, which checks the scope and the stock and lowers
--    the stock in the same step.
--
-- Safe to run more than once.

/* 1. overdue queue ---------------------------------------------------------- */
create or replace view public.lgu_escalation_queue
with (security_invoker = true) as
select
  r.id, r.code, r.hazard_type, r.barangay, r.barangay_id,
  r.severity, r.description, r.status,
  r.created_at,
  extract(epoch from (now() - r.created_at)) / 60.0 as minutes_since_submission,
  'overdue'::text as escalation_status
from public.reports r
where r.status = 'reported'
  and r.created_at <= now() - interval '1 hour'
order by r.created_at asc;

revoke all on public.lgu_escalation_queue from anon;
grant select on public.lgu_escalation_queue to authenticated;

drop policy if exists "reports_lgu_escalation_read" on public.reports;
create policy "reports_lgu_escalation_read"
  on public.reports for select
  to authenticated
  using (
    escalation_status = 'overdue'
    and public.is_active_user()
    and public.is_lgu()
  );

/* 2. one verify path --------------------------------------------------------- */
create or replace function public.lgu_verify_overdue_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.reports where id = p_report_id;
  if v_status in ('verified', 'dispatched', 'resolved') then
    return jsonb_build_object('ok', true, 'already_verified', true, 'report_id', p_report_id);
  end if;
  return public.lgu_verify_report(p_report_id, 'Verified by the LDRRMO after one hour without barangay verification');
end;
$$;

/* 3. others review ----------------------------------------------------------- */
alter view public.others_hazard_review set (security_invoker = true);
revoke all on public.others_hazard_review from anon;

/* 4. relief stock ------------------------------------------------------------ */
alter table public.relief_inventory alter column id set default gen_random_uuid()::text;
alter table public.relief_distribution_log alter column id set default gen_random_uuid()::text;

drop policy if exists "relief_inventory read" on public.relief_inventory;
create policy "relief_inventory read" on public.relief_inventory
  for select to authenticated
  using (public.is_active_user() and (public.is_lgu() or public.is_official()));

drop policy if exists "relief_inventory write" on public.relief_inventory;
create policy "relief_inventory write" on public.relief_inventory
  for all to authenticated
  using (public.is_active_user() and public.is_lgu())
  with check (public.is_active_user() and public.is_lgu());

drop policy if exists "relief_dist_log read" on public.relief_distribution_log;
create policy "relief_dist_log read" on public.relief_distribution_log
  for select to authenticated
  using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay = public.my_barangay_name())
    )
  );

-- rows are written by log_relief_distribution; the LGU may still correct them
drop policy if exists "relief_dist_log write" on public.relief_distribution_log;
create policy "relief_dist_log write" on public.relief_distribution_log
  for all to authenticated
  using (public.is_active_user() and public.is_lgu())
  with check (public.is_active_user() and public.is_lgu());

create or replace function public.log_relief_distribution(
  p_item_id text,
  p_qty integer,
  p_barangay text,
  p_family text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.relief_inventory;
  v_name text;
  v_id   text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if not (public.is_lgu() or public.is_official()) then
    raise exception 'Only LDRRMO staff and barangay officials can record a distribution';
  end if;
  if public.is_official() and not public.is_lgu() and coalesce(p_barangay, '') <> coalesce(public.my_barangay_name(), '') then
    raise exception 'You can record distributions for your own barangay only';
  end if;
  if coalesce(trim(p_barangay), '') = '' then
    raise exception 'Choose the barangay that received the goods';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Enter a quantity above zero';
  end if;

  select * into v_item from public.relief_inventory where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'That item is not in the inventory';
  end if;
  if v_item.stock < p_qty then
    raise exception 'Only % % of % left in stock', v_item.stock, v_item.unit, v_item.name;
  end if;

  update public.relief_inventory
     set stock = stock - p_qty, updated_at = now()
   where id = p_item_id;

  select coalesce(full_name, '') into v_name from public.profiles where id = auth.uid();

  insert into public.relief_distribution_log (item_id, item_name, qty, barangay, family, distributed_by, distributed_at, created_by)
  values (p_item_id, v_item.name, p_qty, trim(p_barangay), coalesce(trim(p_family), ''), v_name, now(), auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'stock', v_item.stock - p_qty);
end;
$$;

revoke all on function public.log_relief_distribution(text, integer, text, text) from public, anon;
grant execute on function public.log_relief_distribution(text, integer, text, text) to authenticated;
