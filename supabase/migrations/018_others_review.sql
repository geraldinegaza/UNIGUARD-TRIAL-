-- ============================================================================
--  UniGuard · 018 · "Others" hazard review helper
--
--  Additive only. A simple view that aggregates the free-text residents typed
--  when they picked "Others" on the hazard dropdown, so the LGU can scan for
--  patterns worth promoting into a permanent hazard type. No data is moved;
--  it is a read-only summary.
-- ============================================================================

create or replace view public.others_hazard_review as
  select hazard_other_text as description,
         count(*)          as occurrences,
         max(created_at)   as latest_at
    from public.reports
   where hazard_type = 'Others'
     and hazard_other_text is not null
     and length(trim(hazard_other_text)) > 0
   group by lower(trim(hazard_other_text)), hazard_other_text
   order by occurrences desc, latest_at desc;

grant select on public.others_hazard_review to authenticated;
