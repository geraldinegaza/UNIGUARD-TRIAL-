-- ============================================================================
--  UniGuard · 023 · Crowd corroboration on report submission
--
--  Additive and re-runnable. Migration 002 verifies a hazard when a resident
--  explicitly confirms someone else's report. The system design also calls for
--  the status to move from "reported" to "verified" once three or more
--  independent residents REPORT the same hazard in the same barangay within a
--  short window. This trigger applies the same rule (same hazard type, same
--  barangay, six hours either side, three distinct people) when a report is
--  filed, so no extra action is needed from anyone.
-- ============================================================================
create or replace function public.auto_verify_on_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if new.hazard_type is null or new.hazard_type = '' then
    return new;
  end if;

  select count(distinct u) into v_count from (
    select r.reporter_id as u
      from public.reports r
     where r.hazard_type = new.hazard_type
       and (r.barangay_id is not distinct from new.barangay_id)
       and r.status <> 'rejected'
       and r.created_at between new.created_at - interval '6 hours' and new.created_at + interval '6 hours'
    union
    select c.user_id
      from public.report_corroborations c
      join public.reports r2 on r2.id = c.report_id
     where r2.hazard_type = new.hazard_type
       and (r2.barangay_id is not distinct from new.barangay_id)
       and r2.created_at between new.created_at - interval '6 hours' and new.created_at + interval '6 hours'
  ) s
  where u is not null;

  if v_count >= 3 then
    perform set_config('uniguard.reason', 'auto_corroboration', true);
    update public.reports
       set status = 'verified'
     where hazard_type = new.hazard_type
       and (barangay_id is not distinct from new.barangay_id)
       and status = 'reported'
       and created_at between new.created_at - interval '6 hours' and new.created_at + interval '6 hours';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_auto_verify'
  ) then
    create trigger reports_auto_verify
      after insert on public.reports
      for each row execute function public.auto_verify_on_report();
  end if;
end $$;
