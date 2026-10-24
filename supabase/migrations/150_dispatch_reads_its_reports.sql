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
