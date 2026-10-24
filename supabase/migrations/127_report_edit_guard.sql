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
