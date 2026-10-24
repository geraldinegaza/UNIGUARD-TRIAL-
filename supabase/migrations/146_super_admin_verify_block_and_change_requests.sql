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
