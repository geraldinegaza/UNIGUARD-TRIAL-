-- 156: the resident Hazard Map shows open hazards in every barangay.
--
-- A resident's reports_feed stays scoped to their own barangay (plus their own
-- reports), so Home, Reported Near You and every list keep to the barangay they
-- live in. The map is the one place a resident looks across barangay lines:
-- a flood next door or a blocked road on the way to a shelter matters to them.
--
-- hazard_map_feed carries only what a map marker needs. No description, photo,
-- location note or reporter identity leaves the reports table through it, and
-- only reports still open (reported, verified, dispatched) with a location are
-- listed. It runs as its owner (security_invoker = false) so it can read across
-- barangays without widening the reports table's own row level security.
--
-- Additive and re-runnable.

drop view if exists public.hazard_map_feed;

create view public.hazard_map_feed as
select
    r.id,
    r.code,
    r.barangay_id,
    r.barangay,
    r.hazard_type,
    r.hazard_other_text,
    r.severity,
    r.status,
    r.lat,
    r.lng,
    r.created_at,
    (
        select count(*)
        from public.report_corroborations c
        where c.report_id = r.id
    ) as corroborations,
    (r.reporter_id = auth.uid()) as is_mine
from public.reports r
where
    auth.uid() is not null
    and r.status in ('reported', 'verified', 'dispatched')
    and r.lat is not null
    and r.lng is not null;

alter view public.hazard_map_feed set (security_invoker = false);

revoke all on public.hazard_map_feed from public, anon;
grant select on public.hazard_map_feed to authenticated;

comment on view public.hazard_map_feed is
  'Open hazards with a location in every barangay, for the resident Hazard Map. Marker fields only: no description, photo or reporter.';
