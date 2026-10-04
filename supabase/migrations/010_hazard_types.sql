-- ============================================================================
--  UniGuard · 010 · Hazard "Others" text + a Rejected report status
--
--  Additive only. Two independent changes needed by the revised client:
--
--  1. reports.hazard_other_text — the free-text description a resident types
--     when they pick "Others" on the hazard dropdown (js/hazard-types.js).
--     hazard_type keeps storing the canonical label ("Others"); the specific
--     text is a separate column so hazard-type colour/icon/analytics lookups
--     never depend on what a resident typed.
--
--  2. A 'rejected' report status, so the LGU dashboard's pipeline can be
--     Pending -> Verified -> In Progress -> Resolved, with Rejected as the
--     other way a report can be closed (duplicate, not actionable, hoax).
--     Existing rows are untouched — nothing currently has this status, and
--     the normal forward path (reported -> verified -> dispatched -> resolved)
--     is unchanged.
-- ============================================================================

-- ------------------------------------------------------- hazard "Others" text
alter table public.reports add column if not exists hazard_other_text text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_other_requires_text') then
    alter table public.reports add constraint reports_other_requires_text
      check (hazard_type is distinct from 'Others' or (hazard_other_text is not null and length(trim(hazard_other_text)) > 0))
      not valid;
  end if;
end $$;

-- validate separately so an already-clean table applies this instantly, and a
-- table with a pre-existing inconsistent row does not fail the whole migration
alter table public.reports validate constraint reports_other_requires_text;

-- reports_feed (migration 004) is the read view the client queries; recreate
-- it with the new column so it keeps returning every column the client reads
create or replace view public.reports_feed as
  select r.id, r.code, r.hazard_type, r.hazard_other_text, r.barangay_id, r.barangay, r.description,
         r.severity, r.urgency, r.status, r.lat, r.lng, r.photo_path, r.reporter_id,
         r.resolved_at, r.created_at, r.updated_at,
         (select count(*) from public.report_corroborations c where c.report_id = r.id) as corroborations
    from public.reports r;

-- keep whatever security_invoker setting migration 004 established
do $$
begin
  perform 1 from pg_class where relname = 'reports_feed';
  if found then
    execute 'alter view public.reports_feed set (security_invoker = false)';
  end if;
end $$;

grant select on public.reports_feed to authenticated;

-- ---------------------------------------------------------------- rejected
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status in ('reported', 'verified', 'dispatched', 'resolved', 'rejected'));

-- a report may be rejected from any open state, but not un-rejected or moved
-- on from resolved/rejected — those are final states
create or replace function public.guard_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok  boolean;
  v_lgu boolean;
begin
  if new.status is distinct from old.status then
    v_ok := case
      when old.status = 'reported'   and new.status in ('verified','dispatched','resolved','rejected') then true
      when old.status = 'verified'   and new.status in ('dispatched','resolved','rejected')             then true
      when old.status = 'dispatched' and new.status in ('resolved','rejected')                          then true
      else false
    end;

    if not v_ok then
      select (role = 'lgu_ldrrmc') into v_lgu from public.profiles where id = auth.uid();
      if not coalesce(v_lgu, false) then
        raise exception 'Illegal status change from % to %', old.status, new.status;
      end if;
    end if;
  end if;

  if new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

-- advance_report_status (migration 007) whitelists the statuses it accepts;
-- add 'rejected' to that whitelist
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row   public.reports;
  v_role  text;
  v_brgy  uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('reported', 'verified', 'dispatched', 'resolved', 'rejected') then
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

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  update public.reports set status = p_next where id = p_report_id returning * into v_row;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('to', p_next, 'note', coalesce(p_note, '')));

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;
