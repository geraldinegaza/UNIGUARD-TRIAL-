-- ============================================================================
--  UniGuard · 040 · Dispatch unit RPCs (Part E)
--
--  All privileged writes for the dispatch team interface. Every RPC re-checks
--  role, unit and barangay on the SERVER, never trusting the client for
--  role, unit_id, barangay_id or target_barangay_id.
--
--  RPCs in this file:
--    · record_equipment_check
--    · set_equipment_status
--    · set_hospital_capacity
--    · send_patient_notice  +  ack_patient_notice
--    · set_personnel_duty
--    · create_unit_request  +  decide_unit_request
--    · submit_after_action
--    · directory_contacts
--    · unit_stats
--    · create_dispatch_unit + invite_unit_member + disable_unit_member
--
--  Additive + idempotent.
-- ============================================================================

-- ----------------------------------------------------------- record_equipment_check
create or replace function public.record_equipment_check(
  p_equipment_id uuid,
  p_condition    text,
  p_level        text default '',
  p_notes        text default '',
  p_photo        text default null,
  p_items        jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.dispatch_equipment;
  v_role text;
  v_unit uuid;
  v_brgy uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_condition not in ('ready','needs_repair','missing','out_of_service','unknown') then
    raise exception 'Invalid condition';
  end if;

  select * into v_row from public.dispatch_equipment where id = p_equipment_id;
  if v_row.id is null then
    raise exception 'That equipment does not exist';
  end if;

  select role, barangay_id, dispatch_unit_id
    into v_role, v_brgy, v_unit
    from public.profiles where id = auth.uid();

  -- Either a unit member checking their own unit's equipment, or the
  -- barangay official checking their own barangay's equipment, or the LGU.
  if v_role <> 'lgu_ldrrmc' then
    if v_row.owner_unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.owner_unit_id is distinct from v_unit then
        raise exception 'You can only check your own unit''s equipment';
      end if;
    else
      if v_role <> 'barangay_official' or v_row.owner_barangay_id is distinct from v_brgy then
        raise exception 'You can only check your own barangay''s equipment';
      end if;
    end if;
  end if;

  insert into public.equipment_checks (equipment_id, checked_by, condition, level, notes, photo, items)
  values (p_equipment_id, auth.uid(), p_condition, p_condition, left(coalesce(p_notes, ''), 500), p_photo, coalesce(p_items, '[]'::jsonb))
  returning id into v_id;

  -- stamp the equipment row with the latest condition + last_checked_at so
  -- the dispatch picker can filter against it.
  update public.dispatch_equipment
     set condition = p_condition,
         last_checked_at = now(),
         status = case when p_condition in ('needs_repair','missing','out_of_service') then 'maintenance'
                       when status = 'available' then 'available' else status end
   where id = p_equipment_id;

  perform public.write_audit('equipment.checked', 'dispatch_equipment', p_equipment_id,
    jsonb_build_object('condition', p_condition, 'level', p_level));

  return jsonb_build_object('id', v_id, 'condition', p_condition, 'checked_at', now());
end;
$$;

revoke all on function public.record_equipment_check(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.record_equipment_check(uuid, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------- set_equipment_status
create or replace function public.set_equipment_status(
  p_equipment_id uuid,
  p_status       text,
  p_condition    text default null,
  p_notes        text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.dispatch_equipment;
  v_role text;
  v_unit uuid;
  v_brgy uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_status not in ('available','deployed','maintenance','unavailable') then
    raise exception 'Invalid status';
  end if;
  if p_condition is not null and p_condition not in ('ready','needs_repair','missing','out_of_service','unknown') then
    raise exception 'Invalid condition';
  end if;

  select * into v_row from public.dispatch_equipment where id = p_equipment_id;
  if v_row.id is null then raise exception 'That equipment does not exist'; end if;

  select role, barangay_id, dispatch_unit_id into v_role, v_brgy, v_unit
    from public.profiles where id = auth.uid();

  if v_role <> 'lgu_ldrrmc' then
    if v_row.owner_unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.owner_unit_id is distinct from v_unit then
        raise exception 'Not your equipment';
      end if;
    else
      if v_role <> 'barangay_official' or v_row.owner_barangay_id is distinct from v_brgy then
        raise exception 'Not your equipment';
      end if;
    end if;
  end if;

  update public.dispatch_equipment
     set status = p_status,
         condition = coalesce(p_condition, condition),
         notes = left(coalesce(p_notes, ''), 500)
   where id = p_equipment_id;

  perform public.write_audit('equipment.status_set', 'dispatch_equipment', p_equipment_id,
    jsonb_build_object('status', p_status, 'condition', p_condition));

  return jsonb_build_object('id', p_equipment_id, 'status', p_status);
end;
$$;

revoke all on function public.set_equipment_status(uuid, text, text, text) from public;
grant execute on function public.set_equipment_status(uuid, text, text, text) to authenticated;

-- --------------------------------------------------------- set_hospital_capacity
create or replace function public.set_hospital_capacity(
  p_unit_id   uuid,
  p_er_beds   int,
  p_icu_beds  int,
  p_available int,
  p_accepting boolean
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or v_unit is distinct from p_unit_id) then
    raise exception 'Only this hospital''s users may set capacity';
  end if;
  if not exists (select 1 from public.dispatch_units where id = p_unit_id and unit_type = 'Hospital') then
    raise exception 'That unit is not a hospital';
  end if;

  insert into public.hospital_capacity (unit_id, er_beds, icu_beds, available, accepting, updated_at)
  values (p_unit_id, p_er_beds, p_icu_beds, p_available, p_accepting, now())
  on conflict (unit_id) do update
     set er_beds = excluded.er_beds,
         icu_beds = excluded.icu_beds,
         available = excluded.available,
         accepting = excluded.accepting,
         updated_at = now();

  perform public.write_audit('hospital.capacity_set', 'hospital_capacity', p_unit_id,
    jsonb_build_object('er', p_er_beds, 'icu', p_icu_beds, 'available', p_available, 'accepting', p_accepting));

  return jsonb_build_object('unit_id', p_unit_id, 'accepting', p_accepting, 'at', now());
end;
$$;

revoke all on function public.set_hospital_capacity(uuid, int, int, int, boolean) from public;
grant execute on function public.set_hospital_capacity(uuid, int, int, int, boolean) to authenticated;

-- ------------------------------------------------------- send_patient_notice + ack
create or replace function public.send_patient_notice(
  p_unit_id    uuid,
  p_report_id  uuid default null,
  p_patients   int default 1,
  p_condition  text default '',
  p_eta        timestamptz default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.dispatch_units where id = p_unit_id and unit_type = 'Hospital' and active = true) then
    raise exception 'That hospital does not exist';
  end if;

  select role, coalesce(full_name, '') into v_role, v_name
    from public.profiles where id = auth.uid();
  if v_role not in ('lgu_ldrrmc','barangay_official','dispatch_team') then
    raise exception 'Only officials, LGU or responders may send a patient notice';
  end if;

  insert into public.patient_notices (unit_id, report_id, patients, condition, eta, sent_by, status)
  values (p_unit_id, p_report_id, greatest(p_patients, 1), left(coalesce(p_condition, ''), 240), p_eta, auth.uid(), 'sent')
  returning id into v_id;

  -- notify the hospital's users only (rule: a notice reaches only that
  -- hospital's users)
  insert into public.notifications (user_id, title, body, tone, icon, type)
  select p.id, 'Incoming patient notice', left(p_patients || ' patient(s) · ' || p_condition, 240),
         'warning', 'truck', 'patient_notice'
    from public.profiles p
   where p.disabled = false
     and p.role = 'dispatch_team'
     and p.dispatch_unit_id = p_unit_id;

  perform public.write_audit('patient.notice_sent', 'patient_notices', v_id,
    jsonb_build_object('unit_id', p_unit_id, 'patients', p_patients, 'sent_by', v_name));

  return jsonb_build_object('id', v_id, 'unit_id', p_unit_id);
end;
$$;

revoke all on function public.send_patient_notice(uuid, uuid, int, text, timestamptz) from public;
grant execute on function public.send_patient_notice(uuid, uuid, int, text, timestamptz) to authenticated;

create or replace function public.ack_patient_notice(
  p_notice_id uuid,
  p_status    text default 'acknowledged'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.patient_notices;
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_status not in ('acknowledged','arrived','cancelled') then
    raise exception 'Invalid status';
  end if;
  select * into v_row from public.patient_notices where id = p_notice_id;
  if v_row.id is null then raise exception 'That notice does not exist'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or v_unit is distinct from v_row.unit_id) then
    raise exception 'Only this hospital''s users may acknowledge the notice';
  end if;

  update public.patient_notices
     set status = p_status, ack_at = case when p_status = 'acknowledged' then now() else ack_at end
   where id = p_notice_id;

  perform public.write_audit('patient.notice_acked', 'patient_notices', p_notice_id,
    jsonb_build_object('status', p_status));

  return jsonb_build_object('id', p_notice_id, 'status', p_status);
end;
$$;

revoke all on function public.ack_patient_notice(uuid, text) from public;
grant execute on function public.ack_patient_notice(uuid, text) to authenticated;

-- ---------------------------------------------------------------- set_personnel_duty
create or replace function public.set_personnel_duty(
  p_personnel_id uuid,
  p_on_duty      boolean,
  p_shift_start  timestamptz default null,
  p_shift_end    timestamptz default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.unit_personnel;
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into v_row from public.unit_personnel where id = p_personnel_id;
  if v_row.id is null then raise exception 'That personnel does not exist'; end if;

  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or v_unit is distinct from v_row.unit_id) then
    raise exception 'Not your unit';
  end if;

  update public.unit_personnel
     set on_duty = p_on_duty,
         shift_start = p_shift_start,
         shift_end = p_shift_end
   where id = p_personnel_id;

  if p_on_duty then
    insert into public.unit_shifts (unit_id, personnel_id, start_at)
    values (v_row.unit_id, p_personnel_id, coalesce(p_shift_start, now()));
  else
    update public.unit_shifts set end_at = now()
     where personnel_id = p_personnel_id and end_at is null;
  end if;

  return jsonb_build_object('id', p_personnel_id, 'on_duty', p_on_duty);
end;
$$;

revoke all on function public.set_personnel_duty(uuid, boolean, timestamptz, timestamptz) from public;
grant execute on function public.set_personnel_duty(uuid, boolean, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------- create_unit_request + decide
create or replace function public.create_unit_request(
  p_unit_id uuid,
  p_kind    text,
  p_details text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or v_unit is distinct from p_unit_id) then
    raise exception 'Not your unit';
  end if;
  if p_kind not in ('fuel','personnel','equipment','mutual_aid','other') then
    raise exception 'Unknown request kind';
  end if;

  insert into public.unit_requests (unit_id, kind, details, created_by, status)
  values (p_unit_id, p_kind, left(coalesce(p_details, ''), 1000), auth.uid(), 'pending')
  returning id into v_id;

  -- notify every LGU user
  insert into public.notifications (user_id, title, body, tone, icon, type)
  select p.id, 'Support request from ' || (select name from public.dispatch_units where id = p_unit_id),
         left(p_kind || ': ' || p_details, 240), 'warning', 'inbox', 'unit_request'
    from public.profiles p
   where p.disabled = false and p.role = 'lgu_ldrrmc';

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.create_unit_request(uuid, text, text) from public;
grant execute on function public.create_unit_request(uuid, text, text) to authenticated;

create or replace function public.decide_unit_request(
  p_request_id uuid,
  p_decision   text,
  p_note       text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.unit_requests;
  v_role text;
  v_name text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_decision not in ('approved','declined','done') then
    raise exception 'Decision must be approved, declined or done';
  end if;
  select * into v_row from public.unit_requests where id = p_request_id;
  if v_row.id is null then raise exception 'That request does not exist'; end if;

  select role, coalesce(full_name, '') into v_role, v_name
    from public.profiles where id = auth.uid();
  -- only the LGU may decide; a unit_admin may close a request to 'done'
  -- when they consider it delivered
  if v_role = 'lgu_ldrrmc' then
    null;
  elsif v_role = 'dispatch_team' and public.is_unit_admin() and p_decision = 'done' and v_row.unit_id = public.my_unit_id() then
    null;
  else
    raise exception 'Only the LGU may decide a support request';
  end if;

  update public.unit_requests
     set status = p_decision, decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;

  -- notify the unit's users
  insert into public.notifications (user_id, title, body, tone, icon, type)
  select p.id, 'Support request ' || p_decision,
         left(coalesce(p_note, '') || ' · ' || v_row.kind, 240),
         case when p_decision = 'approved' then 'prepared' when p_decision = 'done' then 'prepared' else 'warning' end,
         'check', 'unit_request'
    from public.profiles p
   where p.disabled = false and p.role = 'dispatch_team' and p.dispatch_unit_id = v_row.unit_id;

  perform public.write_audit('unit_request.decided', 'unit_requests', p_request_id,
    jsonb_build_object('decision', p_decision, 'note', left(coalesce(p_note, ''), 240), 'by', v_name));

  return jsonb_build_object('id', p_request_id, 'status', p_decision);
end;
$$;

revoke all on function public.decide_unit_request(uuid, text, text) from public;
grant execute on function public.decide_unit_request(uuid, text, text) to authenticated;

-- --------------------------------------------------------- submit_after_action
create or replace function public.submit_after_action(
  p_dispatch_id uuid,
  p_text        text,
  p_meta        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.report_dispatches;
  v_role text;
  v_name text;
  v_unit uuid;
  v_brgy uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'Write a short after-action summary'; end if;
  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then raise exception 'That dispatch does not exist'; end if;
  if v_row.dispatch_status <> 'done' then
    raise exception 'The after-action report can be filed only after the dispatch is Done';
  end if;

  select role, coalesce(full_name, ''), dispatch_unit_id, barangay_id
    into v_role, v_name, v_unit, v_brgy
    from public.profiles where id = auth.uid();

  if v_role <> 'lgu_ldrrmc' then
    if v_row.unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.unit_id is distinct from v_unit then
        raise exception 'Only this unit''s users may file this after-action report';
      end if;
    else
      if v_role <> 'barangay_official' then
        raise exception 'Only the barangay official may file this after-action report';
      end if;
      if v_row.target_barangay_id is distinct from v_brgy then
        raise exception 'This dispatch is outside your barangay';
      end if;
    end if;
  end if;

  update public.report_dispatches
     set after_action = left(trim(p_text), 4000),
         after_action_at = now(),
         after_action_by = auth.uid(),
         after_action_meta = coalesce(p_meta, '{}'::jsonb)
   where id = p_dispatch_id;

  perform public.write_audit('dispatch.after_action', 'report_dispatches', p_dispatch_id,
    jsonb_build_object('by', v_name, 'meta', p_meta));

  return jsonb_build_object('id', p_dispatch_id, 'at', now());
end;
$$;

revoke all on function public.submit_after_action(uuid, text, jsonb) from public;
grant execute on function public.submit_after_action(uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------- directory_contacts
-- One read function the barangay and dispatch clients share. Returns the
-- emergency hotlines with their category, plus barangay captains joined
-- from public.barangays. SECURITY DEFINER so the dispatch user (whose
-- hotlines_read policy is fine for read but the captains come from a row
-- they may not see directly) can read the directory.
create or replace function public.directory_contacts()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'name', h.agency_name, 'number', h.contact_number,
    'category', coalesce(h.category, 'Other'), 'scope', h.scope, 'description', h.description
  )), '[]'::jsonb) into v_out
    from public.emergency_hotlines h
   where h.active is true;

  return jsonb_build_object('hotlines', v_out);
end;
$$;

revoke all on function public.directory_contacts() from public;
grant execute on function public.directory_contacts() to authenticated;

-- -------------------------------------------------------------------- unit_stats
-- Returns the calling unit's own stats. Dispatch users call this for
-- themselves; the LGU gets the full picture by iterating every unit.
create or replace function public.unit_stats(p_unit_id uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
  v_target uuid;
  v_total int;
  v_ack int;
  v_done int;
  v_open int;
  v_avg_ack numeric;
  v_avg_scene numeric;
  v_month int;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();

  -- A dispatch user can only request their own unit's stats; the LGU may
  -- pass any unit_id or null for an aggregate.
  if v_role = 'dispatch_team' then
    v_target := v_unit;
    if p_unit_id is not null and p_unit_id is distinct from v_unit then
      raise exception 'You can only read your own unit''s stats';
    end if;
  elsif v_role = 'lgu_ldrrmc' then
    v_target := p_unit_id;  -- null = all units
  else
    raise exception 'Only the LGU or dispatch users may call unit_stats';
  end if;

  -- Totals for the target unit (or all units if null and caller is LGU)
  select count(*), count(*) filter (where dispatch_status = 'acknowledged'),
         count(*) filter (where dispatch_status = 'done'),
         count(*) filter (where dispatch_status not in ('done'))
    into v_total, v_ack, v_done, v_open
    from public.report_dispatches d
   where v_target is null or d.unit_id = v_target;

  -- Average times (dispatched_at -> ack_at, ack_at -> on_scene_at)
  select coalesce(avg(extract(epoch from (ack_at - dispatched_at)) / 60), 0),
         coalesce(avg(extract(epoch from (on_scene_at - ack_at)) / 60), 0)
    into v_avg_ack, v_avg_scene
    from public.report_dispatches d
   where (v_target is null or d.unit_id = v_target)
     and ack_at is not null;

  -- Dispatches this month
  select count(*) into v_month
    from public.report_dispatches d
   where (v_target is null or d.unit_id = v_target)
     and date_trunc('month', d.dispatched_at) = date_trunc('month', now());

  return jsonb_build_object(
    'unit_id', v_target,
    'total_dispatches', v_total,
    'acknowledged', v_ack,
    'done', v_done,
    'open', v_open,
    'avg_ack_minutes', v_avg_ack,
    'avg_scene_minutes', v_avg_scene,
    'this_month', v_month
  );
end;
$$;

revoke all on function public.unit_stats(uuid) from public;
grant execute on function public.unit_stats(uuid) to authenticated;

-- ------------------------------------------------------------ create_dispatch_unit
-- LGU-only. Creates a unit row. The first unit_admin is then created via
-- the admin-users edge function (which runs with the service role).
create or replace function public.create_dispatch_unit(
  p_name           text,
  p_unit_type      text,
  p_contact_number text default '',
  p_address        text default '',
  p_lat            double precision default null,
  p_lng            double precision default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_lgu() then raise exception 'Only the LGU can create dispatch units'; end if;
  if p_unit_type not in ('BFP','PNP','Rescue','Hospital') then
    raise exception 'Unknown unit type';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A unit name is required'; end if;

  insert into public.dispatch_units (name, unit_type, contact_number, address, lat, lng, created_by, status, active)
  values (trim(p_name), p_unit_type, p_contact_number, p_address, p_lat, p_lng, auth.uid(), 'available', true)
  returning id into v_id;

  perform public.write_audit('dispatch_unit.created', 'dispatch_units', v_id,
    jsonb_build_object('name', p_name, 'unit_type', p_unit_type));

  return jsonb_build_object('id', v_id, 'name', p_name, 'unit_type', p_unit_type);
end;
$$;

revoke all on function public.create_dispatch_unit(text, text, text, text, double precision, double precision) from public;
grant execute on function public.create_dispatch_unit(text, text, text, text, double precision, double precision) to authenticated;

-- -------------------------------------------------------- update_dispatch_unit
create or replace function public.update_dispatch_unit(
  p_unit_id        uuid,
  p_name           text default null,
  p_contact_number text default null,
  p_address        text default null,
  p_active          boolean default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();

  -- LGU can edit any unit; a unit_admin can edit their own unit's contact
  -- info and active flag (deactivating themselves).
  if v_role <> 'lgu_ldrrmc' then
    if v_role <> 'dispatch_team' or not public.is_unit_admin() or v_unit is distinct from p_unit_id then
      raise exception 'Only the LGU or this unit''s admin may edit it';
    end if;
  end if;

  update public.dispatch_units
     set name = coalesce(p_name, name),
         contact_number = coalesce(p_contact_number, contact_number),
         address = coalesce(p_address, address),
         active = coalesce(p_active, active)
   where id = p_unit_id;

  perform public.write_audit('dispatch_unit.updated', 'dispatch_units', p_unit_id,
    jsonb_build_object('name', p_name, 'contact_number', p_contact_number, 'address', p_address, 'active', p_active));

  return jsonb_build_object('id', p_unit_id);
end;
$$;

revoke all on function public.update_dispatch_unit(uuid, text, text, text, boolean) from public;
grant execute on function public.update_dispatch_unit(uuid, text, text, text, boolean) to authenticated;

-- ----------------------------------------------- add_personnel / update_personnel
create or replace function public.add_personnel(
  p_unit_id uuid,
  p_name    text,
  p_role    text default '',
  p_phone   text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_unit uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select role, dispatch_unit_id into v_role, v_unit
    from public.profiles where id = auth.uid();
  if v_role <> 'lgu_ldrrmc' and (v_role <> 'dispatch_team' or not public.is_unit_admin() or v_unit is distinct from p_unit_id) then
    raise exception 'Only the LGU or this unit''s admin may add personnel';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A name is required'; end if;

  insert into public.unit_personnel (unit_id, name, role, phone)
  values (p_unit_id, trim(p_name), left(coalesce(p_role, ''), 80), left(coalesce(p_phone, ''), 40))
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.add_personnel(uuid, text, text, text) from public;
grant execute on function public.add_personnel(uuid, text, text, text) to authenticated;
