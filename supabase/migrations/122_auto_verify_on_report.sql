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