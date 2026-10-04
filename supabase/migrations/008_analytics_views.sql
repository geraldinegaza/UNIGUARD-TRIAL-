-- ============================================================================
--  UniGuard · 008 · Analytics views
--
--  Additive only. The console reads these instead of aggregating client side,
--  which keeps the numbers consistent and the payload small.
-- ============================================================================

-- incidents per hazard type over the last 30 days
create or replace view public.analytics_by_hazard as
select hazard_type,
       count(*)::bigint as total,
       count(*) filter (where severity = 'emergency')::bigint as emergency_total
  from public.reports
 where created_at >= now() - interval '30 days'
 group by hazard_type
 order by total desc;

-- live pipeline load
create or replace view public.analytics_pipeline as
select status, count(*)::bigint as total
  from public.reports
 group by status;

-- daily report volume for the trend chart
create or replace view public.analytics_daily as
select date_trunc('day', created_at)::date as day, count(*)::bigint as total
  from public.reports
 where created_at >= now() - interval '14 days'
 group by 1
 order by 1;

-- response performance: how long each stage took, from the history table
create or replace view public.analytics_response_times as
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
 group by r.id, r.code, r.barangay, r.severity, r.created_at, r.resolved_at;

-- corroboration quality: share of reports that auto verified as intended
create or replace view public.analytics_corroboration as
select
  count(*)::bigint as total_reports,
  count(*) filter (where status <> 'reported')::bigint as verified_or_beyond,
  count(*) filter (where exists (
    select 1 from public.report_status_history h
     where h.report_id = reports.id and h.reason = 'auto_corroboration'))::bigint as auto_verified
  from public.reports;

-- shelter occupancy snapshot
create or replace view public.analytics_shelters as
select status,
       count(*)::bigint as centres,
       coalesce(sum(capacity), 0)::bigint as capacity,
       coalesce(sum(occupancy), 0)::bigint as occupancy
  from public.evacuation_centers
 group by status;

grant select on public.analytics_by_hazard      to authenticated;
grant select on public.analytics_pipeline       to authenticated;
grant select on public.analytics_daily          to authenticated;
grant select on public.analytics_response_times to authenticated;
grant select on public.analytics_corroboration  to authenticated;
grant select on public.analytics_shelters       to authenticated;
