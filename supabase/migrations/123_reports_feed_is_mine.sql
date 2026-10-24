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