-- 155: Dispatch Team console features from the reference build
--      (upstream migrations 049 dispatch_team_features + 050 equipment_management).
--
-- 1. Per-team dispatch steps. report_dispatches gains the statuses declined,
--    under_control, fire_out, on_hold, transporting, arrived_hospital and the
--    columns decline_reason, hold_reason, field_data. dispatch_respond moves
--      BFP       on_scene -> under_control -> fire_out -> done
--      Rescue    en_route / on_scene -> on_hold (reason required) -> resume
--      Ambulance on_scene -> transporting (accepting hospital) -> arrived_hospital -> done
--    A declined dispatch counts as closed (unit status, release on close).
-- 2. decline_dispatch ("Can't respond"), dispatch_help_requests with
--    create_help_request / update_help_request ("Need help").
-- 3. update_dispatch_field_data: rescue details and tally, the accepting
--    hospital, the barangay checklist and evacuation tally.
-- 4. submit_after_action keeps the per-team fields (BFP: families displaced,
--    people injured) and fills in equipment used and the step times.
-- 5. PNP: post_road_closure / reopen_road_closure from a dispatch, shelters
--    that need a patrol, relief escorts (request / confirm).
-- 6. Hospitals: a patient notice only goes to a hospital that is accepting;
--    a notice can be marked arrived or cancelled.
-- 7. Equipment: add_equipment / update_equipment / remove_equipment (retire
--    when it has dispatch history), and the equipment catalog rows.
--
-- Changes from the upstream files, found by running them:
--   * resume set dispatch_status to 'resume', which the status rule refuses;
--     it now returns the dispatch to on_scene.
--   * an empty hospital_id was cast to uuid ('' is not a uuid); now nullif.
--   * dispatch_help_requests got a touch_updated_at trigger but no updated_at
--     column, so every update failed; the column is added.
--   * the catalog's unique index would fail on a database that already has a
--     duplicate label; rows are added only where missing instead.
--   * record_equipment_check saved the condition into the level column, so
--     the level typed in the readiness check was lost; it saves p_level now.
--   * a PNP account could not read the barangay relief distributions it is
--     asked to escort; it can now read the ones with an escort requested.
--   * every function refuses disabled accounts, like 151-154.
--   * no extra row-audit trigger on relief_distributions (the escort
--     functions already write the activity log).
--
-- Safe to run more than once.

/* 1. report_dispatches: statuses and columns -------------------------------- */
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'report_dispatches_status_check') then
    alter table public.report_dispatches drop constraint report_dispatches_status_check;
  end if;
  alter table public.report_dispatches add constraint report_dispatches_status_check
    check (dispatch_status in (
      'sent','acknowledged','en_route','on_scene','done',
      'declined','under_control','fire_out','on_hold','transporting','arrived_hospital'
    ));
end $$;

alter table public.report_dispatches add column if not exists decline_reason text not null default '';
alter table public.report_dispatches add column if not exists hold_reason    text not null default '';
alter table public.report_dispatches add column if not exists field_data     jsonb not null default '{}'::jsonb;

create index if not exists report_dispatches_decline_idx
  on public.report_dispatches (dispatch_status) where dispatch_status = 'declined';

-- a unit stays on duty while any of its dispatches is open (not done, not declined)
create or replace function public.sync_unit_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_open int;
begin
  if new.unit_id is not null then
    select count(*) into v_open from public.report_dispatches d
     where d.unit_id = new.unit_id
       and d.dispatch_status not in ('done','declined');
    if v_open > 0 then
      update public.dispatch_units set status = 'on_duty' where id = new.unit_id;
    else
      update public.dispatch_units set status = 'available' where id = new.unit_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists report_dispatches_sync_unit on public.report_dispatches;
create trigger report_dispatches_sync_unit
  after insert or update of dispatch_status on public.report_dispatches
  for each row execute function public.sync_unit_status();

-- closing a report closes its open dispatches; declined ones stay declined
create or replace function public.release_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('resolved','rejected') and old.status not in ('resolved','rejected') then
    update public.report_dispatches
       set dispatch_status = 'done',
           done_at = coalesce(done_at, now())
     where report_id = new.id
       and dispatch_status not in ('done','declined');
    update public.dispatch_equipment_use
       set released_at = now()
     where released_at is null
       and dispatch_id in (select id from public.report_dispatches where report_id = new.id);
    update public.dispatch_equipment
       set status = 'available'
     where id in (
       select equipment_id from public.dispatch_equipment_use
        where dispatch_id in (select id from public.report_dispatches where report_id = new.id)
     );
    update public.responders set status = 'available'
     where id in (select responder_id from public.report_assignments
                   where report_id = new.id and released_at is null);
    update public.report_assignments set released_at = now()
     where report_id = new.id and released_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_release_on_close on public.reports;
create trigger reports_release_on_close
  after update on public.reports
  for each row execute function public.release_on_close();

/* dispatch_respond: the per-team steps --------------------------------------- */
drop function if exists public.dispatch_respond(uuid, text, text);
create or replace function public.dispatch_respond(
  p_dispatch_id uuid,
  p_action      text,
  p_note        text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.report_dispatches;
  v_target   uuid;
  v_role     text;
  v_name     text;
  v_report   public.reports;
  v_now      timestamptz := now();
  v_tone     text;
  v_title    text;
  v_body     text;
  v_team     text;
  v_hospital uuid;
  v_status   text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if p_action not in (
      'acknowledged','en_route','on_scene','done',
      'under_control','fire_out','on_hold','resume',
      'transporting','arrived_hospital'
    ) then
    raise exception 'Unknown action: %', p_action;
  end if;

  select role, coalesce(full_name, '') into v_role, v_name
    from public.profiles where id = auth.uid();

  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;
  if v_row.dispatch_status = 'declined' then
    raise exception 'That dispatch was declined; no further action is allowed';
  end if;

  -- the dispatched unit's users, or (Barangay Response Team) the report's
  -- barangay officials; the LGU always
  if v_role <> 'lgu_ldrrmc' then
    if v_row.unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.unit_id is distinct from public.my_unit_id() then
        raise exception 'Only this unit''s users may respond to this dispatch';
      end if;
    else
      if v_role <> 'barangay_official' then
        raise exception 'Only the barangay official may respond to this dispatch';
      end if;
      select * into v_report from public.reports where id = v_row.report_id;
      if v_report.barangay_id is distinct from public.my_barangay_id() then
        raise exception 'This dispatch is outside your barangay';
      end if;
    end if;
  end if;

  v_team := v_row.team;

  if not (
    (v_row.dispatch_status = 'sent'            and p_action = 'acknowledged')
    or (v_row.dispatch_status = 'acknowledged' and p_action in ('en_route','on_scene','done'))
    or (v_row.dispatch_status = 'en_route'     and p_action in ('on_scene','done'))
    or (v_row.dispatch_status = 'on_scene'     and p_action = 'done')
    -- BFP
    or (v_team = 'BFP' and v_row.dispatch_status = 'on_scene'      and p_action = 'under_control')
    or (v_team = 'BFP' and v_row.dispatch_status = 'under_control' and p_action in ('fire_out','done'))
    or (v_team = 'BFP' and v_row.dispatch_status = 'fire_out'      and p_action = 'done')
    -- Rescue
    or (v_team in ('Rescue Unit','MDRRMO Rescue') and v_row.dispatch_status in ('en_route','on_scene') and p_action = 'on_hold')
    or (v_team in ('Rescue Unit','MDRRMO Rescue') and v_row.dispatch_status = 'on_hold' and p_action = 'resume')
    -- Ambulance
    or (v_team = 'Ambulance' and v_row.dispatch_status = 'on_scene'         and p_action = 'transporting')
    or (v_team = 'Ambulance' and v_row.dispatch_status = 'transporting'     and p_action = 'arrived_hospital')
    or (v_team = 'Ambulance' and v_row.dispatch_status = 'arrived_hospital' and p_action = 'done')
  ) then
    raise exception 'A dispatch in "%" (team %) cannot move to "%"', v_row.dispatch_status, v_team, p_action;
  end if;

  if p_action = 'on_hold' and coalesce(trim(p_note), '') = '' then
    raise exception 'A hold reason is required';
  end if;

  if p_action = 'transporting' then
    v_hospital := nullif(v_row.field_data->>'hospital_id', '')::uuid;
    if v_hospital is null then
      raise exception 'Choose an accepting hospital before transporting';
    end if;
    if not exists (
      select 1 from public.hospital_capacity h
        join public.dispatch_units u on u.id = h.unit_id
       where h.unit_id = v_hospital and h.accepting = true and u.active = true
    ) then
      raise exception 'The chosen hospital is not accepting patients';
    end if;
  end if;

  -- resume is an action, not a status: the rescue goes back on scene
  v_status := case when p_action = 'resume' then 'on_scene' else p_action end;

  update public.report_dispatches
     set dispatch_status = v_status,
         ack_at      = case when p_action = 'acknowledged' then v_now else ack_at end,
         en_route_at = case when p_action = 'en_route'     then v_now else en_route_at end,
         on_scene_at = case when p_action = 'on_scene' then v_now
                            when p_action = 'resume'   then coalesce(on_scene_at, v_now)
                            else on_scene_at end,
         done_at     = case when p_action = 'done'         then v_now else done_at end,
         hold_reason = case when p_action = 'on_hold' then left(coalesce(trim(p_note), ''), 500)
                            when p_action = 'resume'  then ''
                            else hold_reason end
   where id = p_dispatch_id;

  insert into public.report_dispatch_events (dispatch_id, actor, actor_name, action, note)
  values (p_dispatch_id, auth.uid(), v_name, p_action, left(coalesce(p_note, ''), 240));

  perform public.write_audit('dispatch.responded', 'report_dispatches', p_dispatch_id,
    jsonb_build_object('action', p_action, 'note', left(coalesce(p_note, ''), 240)));

  select * into v_report from public.reports where id = v_row.report_id;
  v_target := v_report.barangay_id;

  v_tone := case p_action
    when 'acknowledged'     then 'advisory'
    when 'en_route'         then 'advisory'
    when 'on_scene'         then 'warning'
    when 'under_control'    then 'warning'
    when 'fire_out'         then 'prepared'
    when 'on_hold'          then 'warning'
    when 'resume'           then 'warning'
    when 'transporting'     then 'warning'
    when 'arrived_hospital' then 'prepared'
    when 'done'             then 'prepared'
  end;
  v_title := case p_action
    when 'acknowledged'     then 'Dispatch acknowledged'
    when 'en_route'         then 'Responder en route'
    when 'on_scene'         then 'Responder on scene'
    when 'under_control'    then 'Fire under control'
    when 'fire_out'         then 'Fire out'
    when 'on_hold'          then 'Rescue on hold'
    when 'resume'           then 'Rescue resumed'
    when 'transporting'     then 'Ambulance transporting'
    when 'arrived_hospital' then 'Patient arrived at hospital'
    when 'done'             then 'Dispatch complete'
  end;
  v_body := case p_action
    when 'acknowledged'     then 'Response to ' || coalesce(v_report.code, '') || ' is acknowledged.'
    when 'en_route'         then 'Response to ' || coalesce(v_report.code, '') || ' is en route.'
    when 'on_scene'         then 'Response to ' || coalesce(v_report.code, '') || ' is on scene.'
    when 'under_control'    then 'Response to ' || coalesce(v_report.code, '') || ': fire is under control.'
    when 'fire_out'         then 'Response to ' || coalesce(v_report.code, '') || ': fire is out.'
    when 'on_hold'          then 'Response to ' || coalesce(v_report.code, '') || ' is on hold. Reason: ' || coalesce(trim(p_note), '')
    when 'resume'           then 'Response to ' || coalesce(v_report.code, '') || ' resumed operations.'
    when 'transporting'     then 'Ambulance for ' || coalesce(v_report.code, '') || ' is transporting.'
    when 'arrived_hospital' then 'Ambulance for ' || coalesce(v_report.code, '') || ' arrived at hospital.'
    when 'done'             then 'Response to ' || coalesce(v_report.code, '') || ' is done.'
  end;

  -- the report's barangay officials and the LGU; never another barangay
  insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
  select p.id, v_title, v_body, v_tone, 'truck', 'dispatch_status', v_report.id
    from public.profiles p
   where p.disabled = false
     and (
       p.role = 'lgu_ldrrmc'
       or (v_target is not null and p.barangay_id = v_target and p.role = 'barangay_official')
     );

  -- the reporter, from on scene onwards
  if p_action in ('on_scene','under_control','fire_out','on_hold','resume',
                  'transporting','arrived_hospital','done')
     and v_report.reporter_id is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_report.reporter_id, v_title, v_body, v_tone, 'check', 'dispatch_status', v_report.id);
  end if;

  if p_action = 'done' then
    update public.dispatch_equipment_use
       set released_at = v_now
     where dispatch_id = p_dispatch_id and released_at is null;
    update public.dispatch_equipment
       set status = 'available'
     where id in (select equipment_id from public.dispatch_equipment_use where dispatch_id = p_dispatch_id);
  end if;

  return jsonb_build_object('dispatch_id', p_dispatch_id, 'action', p_action, 'status', v_status, 'at', v_now);
end;
$$;

revoke all on function public.dispatch_respond(uuid, text, text) from public;
grant execute on function public.dispatch_respond(uuid, text, text) to authenticated;

/* 3. field data -------------------------------------------------------------- */
create or replace function public.update_dispatch_field_data(
  p_dispatch_id uuid,
  p_patch       jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row    public.report_dispatches;
  v_role   text;
  v_unit   uuid;
  v_brgy   uuid;
  v_team   text;
  v_k      text;
  v_merged jsonb;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to update';
  end if;

  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;
  if v_row.dispatch_status not in ('acknowledged','en_route','on_scene','under_control','fire_out','on_hold','transporting','arrived_hospital') then
    raise exception 'Field data can only be updated while the dispatch is open and acknowledged';
  end if;

  select role, dispatch_unit_id, barangay_id into v_role, v_unit, v_brgy
    from public.profiles where id = auth.uid();

  if v_role <> 'lgu_ldrrmc' then
    if v_row.unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.unit_id is distinct from v_unit then
        raise exception 'Only this unit''s users may update field data';
      end if;
    else
      if v_role <> 'barangay_official' then
        raise exception 'Only the barangay official may update field data';
      end if;
      if v_row.target_barangay_id is distinct from v_brgy then
        raise exception 'This dispatch is outside your barangay';
      end if;
    end if;
  end if;

  v_team := v_row.team;

  for v_k in select jsonb_object_keys(p_patch) loop
    if v_k not in ('hospital_id','checklist_done','evac_tally','rescue_details','rescue_tally') then
      raise exception 'Unknown field_data key: %', v_k;
    end if;
    if v_team = 'Barangay Response Team' and v_k not in ('checklist_done','evac_tally','hospital_id') then
      raise exception 'Barangay Response Team field_data does not allow key: %', v_k;
    end if;
    if v_team in ('Rescue Unit','MDRRMO Rescue') and v_k not in ('rescue_details','rescue_tally','hospital_id') then
      raise exception 'Rescue Unit field_data does not allow key: %', v_k;
    end if;
  end loop;

  -- a hospital must be an active hospital unit
  if nullif(p_patch->>'hospital_id', '') is not null and not exists (
    select 1 from public.dispatch_units
     where id::text = p_patch->>'hospital_id' and unit_type = 'Hospital' and active = true
  ) then
    raise exception 'That hospital does not exist';
  end if;

  v_merged := coalesce(v_row.field_data, '{}'::jsonb) || p_patch;

  update public.report_dispatches
     set field_data = v_merged
   where id = p_dispatch_id;

  perform public.write_audit('dispatch.field_data', 'report_dispatches', p_dispatch_id,
    jsonb_build_object('patch', p_patch));

  return jsonb_build_object('dispatch_id', p_dispatch_id, 'field_data', v_merged);
end;
$$;

revoke all on function public.update_dispatch_field_data(uuid, jsonb) from public;
grant execute on function public.update_dispatch_field_data(uuid, jsonb) to authenticated;

/* 2. decline ("Can't respond") ----------------------------------------------- */
create or replace function public.decline_dispatch(
  p_dispatch_id uuid,
  p_reason      text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row    public.report_dispatches;
  v_role   text;
  v_name   text;
  v_unit   uuid;
  v_brgy   uuid;
  v_report public.reports;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to decline a dispatch';
  end if;
  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;
  if v_row.dispatch_status not in ('sent','acknowledged') then
    raise exception 'A dispatch in "%" cannot be declined', v_row.dispatch_status;
  end if;

  select role, coalesce(full_name, ''), dispatch_unit_id, barangay_id
    into v_role, v_name, v_unit, v_brgy
    from public.profiles where id = auth.uid();

  if v_role <> 'lgu_ldrrmc' then
    if v_row.unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.unit_id is distinct from v_unit then
        raise exception 'Only this unit''s users may decline this dispatch';
      end if;
    else
      if v_role <> 'barangay_official' then
        raise exception 'Only the barangay official may decline this dispatch';
      end if;
      select * into v_report from public.reports where id = v_row.report_id;
      if v_report.barangay_id is distinct from v_brgy then
        raise exception 'This dispatch is outside your barangay';
      end if;
    end if;
  end if;

  update public.report_dispatches
     set dispatch_status = 'declined',
         decline_reason  = left(trim(p_reason), 500)
   where id = p_dispatch_id;

  insert into public.report_dispatch_events (dispatch_id, actor, actor_name, action, note)
  values (p_dispatch_id, auth.uid(), v_name, 'declined', left(trim(p_reason), 240));

  perform public.write_audit('dispatch.declined', 'report_dispatches', p_dispatch_id,
    jsonb_build_object('reason', left(trim(p_reason), 500), 'by', v_name));

  -- the dispatcher and the LGU pick another team; the reporter is not told
  select * into v_report from public.reports where id = v_row.report_id;

  if v_row.dispatched_by is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_row.dispatched_by,
      'Dispatch declined: ' || coalesce(v_row.team, 'team'),
      left(coalesce(v_row.team, '') || ' declined: ' || trim(p_reason) ||
           ' — pick another team for ' || coalesce(v_report.code, ''), 240),
      'warning', 'alert', 'dispatch_declined', v_report.id);
  end if;

  insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
  select p.id, 'Dispatch declined: ' || coalesce(v_row.team, 'team'),
         left(coalesce(v_row.team, '') || ' declined ' || coalesce(v_report.code, '') ||
              ' — pick another team.', 240),
         'warning', 'alert', 'dispatch_declined', v_report.id
    from public.profiles p
   where p.disabled = false and p.role = 'lgu_ldrrmc'
     and p.id is distinct from v_row.dispatched_by;

  update public.dispatch_equipment_use
     set released_at = now()
   where dispatch_id = p_dispatch_id and released_at is null;
  update public.dispatch_equipment
     set status = 'available'
   where id in (select equipment_id from public.dispatch_equipment_use where dispatch_id = p_dispatch_id);

  return jsonb_build_object('dispatch_id', p_dispatch_id, 'status', 'declined', 'at', now());
end;
$$;

revoke all on function public.decline_dispatch(uuid, text) from public;
grant execute on function public.decline_dispatch(uuid, text) to authenticated;

/* 2. help requests ("Need help") ---------------------------------------------- */
create table if not exists public.dispatch_help_requests (
  id              uuid primary key default gen_random_uuid(),
  dispatch_id     uuid not null references public.report_dispatches(id) on delete cascade,
  unit_id         uuid references public.dispatch_units(id) on delete set null,
  barangay_id     uuid references public.barangays(id) on delete set null,
  kind            text not null default 'general',
  message         text not null default '',
  status          text not null default 'sent',
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz
);
alter table public.dispatch_help_requests add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatch_help_requests_kind_check') then
    alter table public.dispatch_help_requests add constraint dispatch_help_requests_kind_check
      check (kind in ('general','water_tanker','extra_personnel','beyond_capacity'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispatch_help_requests_status_check') then
    alter table public.dispatch_help_requests add constraint dispatch_help_requests_status_check
      check (status in ('sent','acknowledged','resolved'));
  end if;
end $$;

create index if not exists dispatch_help_requests_dispatch_idx on public.dispatch_help_requests (dispatch_id, created_at desc);
create index if not exists dispatch_help_requests_unit_idx     on public.dispatch_help_requests (unit_id, status);
create index if not exists dispatch_help_requests_brgy_idx     on public.dispatch_help_requests (barangay_id, status);
create index if not exists dispatch_help_requests_status_idx   on public.dispatch_help_requests (status, created_at desc);

alter table public.dispatch_help_requests enable row level security;

-- read: the LGU, the unit that asked, the report's barangay officials; writes go through the functions
drop policy if exists dispatch_help_requests_read on public.dispatch_help_requests;
create policy dispatch_help_requests_read on public.dispatch_help_requests
  for select to authenticated using (
    public.is_lgu()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
    or (
      public.is_official()
      and exists (
        select 1 from public.report_dispatches d
          join public.reports r on r.id = d.report_id
         where d.id = dispatch_help_requests.dispatch_id
           and r.barangay_id = public.my_barangay_id()
      )
    )
  );

grant select on public.dispatch_help_requests to authenticated;

drop trigger if exists dispatch_help_requests_touch on public.dispatch_help_requests;
create trigger dispatch_help_requests_touch before update on public.dispatch_help_requests
  for each row execute function public.touch_updated_at();
drop trigger if exists dispatch_help_requests_audit on public.dispatch_help_requests;
create trigger dispatch_help_requests_audit after insert or update or delete on public.dispatch_help_requests
  for each row execute function public.audit_row_change();

create or replace function public.create_help_request(
  p_dispatch_id uuid,
  p_kind        text,
  p_message     text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row    public.report_dispatches;
  v_role   text;
  v_name   text;
  v_unit   uuid;
  v_brgy   uuid;
  v_id     uuid;
  v_report public.reports;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if p_kind not in ('general','water_tanker','extra_personnel','beyond_capacity') then
    raise exception 'Unknown help request kind';
  end if;
  if coalesce(trim(p_message), '') = '' then
    raise exception 'Write a short message';
  end if;

  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;
  if v_row.dispatch_status in ('done','declined') then
    raise exception 'This dispatch is closed';
  end if;

  select role, coalesce(full_name, ''), dispatch_unit_id, barangay_id
    into v_role, v_name, v_unit, v_brgy
    from public.profiles where id = auth.uid();

  if v_role not in ('lgu_ldrrmc','dispatch_team','barangay_official') then
    raise exception 'Only responders, officials or the LGU may request help';
  end if;
  if v_role <> 'lgu_ldrrmc' then
    if v_row.unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.unit_id is distinct from v_unit then
        raise exception 'You can only request help for your own unit''s dispatch';
      end if;
    else
      if v_role <> 'barangay_official' then
        raise exception 'Only the barangay official may request help for this dispatch';
      end if;
      select * into v_report from public.reports where id = v_row.report_id;
      if v_report.barangay_id is distinct from v_brgy then
        raise exception 'This dispatch is outside your barangay';
      end if;
    end if;
  end if;

  insert into public.dispatch_help_requests
    (dispatch_id, unit_id, barangay_id, kind, message, status, created_by)
  values
    (p_dispatch_id,
     case when v_role = 'dispatch_team' then v_row.unit_id else null end,
     case when v_role = 'barangay_official' then v_brgy else null end,
     p_kind, left(trim(p_message), 1000), 'sent', auth.uid())
  returning id into v_id;

  select * into v_report from public.reports where id = v_row.report_id;
  insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
  select p.id,
    'Help request: ' || replace(p_kind, '_', ' '),
    left(coalesce(v_row.team, '') || ' · ' || coalesce(v_report.code, '') || ' — ' || trim(p_message), 240),
    'warning', 'inbox', 'dispatch_help', v_report.id
    from public.profiles p
   where p.disabled = false and p.role = 'lgu_ldrrmc';

  perform public.write_audit('dispatch.help_requested', 'dispatch_help_requests', v_id,
    jsonb_build_object('kind', p_kind, 'dispatch_id', p_dispatch_id, 'by', v_name));

  return jsonb_build_object('id', v_id, 'status', 'sent');
end;
$$;

revoke all on function public.create_help_request(uuid, text, text) from public;
grant execute on function public.create_help_request(uuid, text, text) to authenticated;

create or replace function public.update_help_request(
  p_id     uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.dispatch_help_requests;
  v_name     text;
  v_dispatch public.report_dispatches;
  v_report   public.reports;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if p_status not in ('acknowledged','resolved') then
    raise exception 'Help request can only move to acknowledged or resolved';
  end if;
  if not public.is_lgu() then
    raise exception 'Only the LGU may update a help request';
  end if;
  select * into v_row from public.dispatch_help_requests where id = p_id;
  if v_row.id is null then
    raise exception 'That help request does not exist';
  end if;
  if not (
    (v_row.status = 'sent' and p_status = 'acknowledged')
    or (v_row.status = 'acknowledged' and p_status = 'resolved')
  ) then
    raise exception 'A help request in "%" cannot move to "%"', v_row.status, p_status;
  end if;

  select coalesce(full_name, '') into v_name from public.profiles where id = auth.uid();

  update public.dispatch_help_requests
     set status          = p_status,
         acknowledged_by = case when p_status = 'acknowledged' then auth.uid() else acknowledged_by end,
         acknowledged_at = case when p_status = 'acknowledged' then now() else acknowledged_at end,
         resolved_by     = case when p_status = 'resolved' then auth.uid() else resolved_by end,
         resolved_at     = case when p_status = 'resolved' then now() else resolved_at end
   where id = p_id;

  if v_row.created_by is not null then
    select * into v_dispatch from public.report_dispatches where id = v_row.dispatch_id;
    select * into v_report from public.reports where id = v_dispatch.report_id;
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_row.created_by,
      'Help request ' || p_status,
      left(replace(coalesce(v_row.kind, ''), '_', ' ') || ' for ' || coalesce(v_report.code, '') || ' · ' || coalesce(v_row.message, ''), 240),
      case when p_status = 'resolved' then 'prepared' else 'advisory' end,
      'check', 'dispatch_help', v_report.id);
  end if;

  perform public.write_audit('dispatch.help_updated', 'dispatch_help_requests', p_id,
    jsonb_build_object('status', p_status, 'by', v_name));

  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

revoke all on function public.update_help_request(uuid, text) from public;
grant execute on function public.update_help_request(uuid, text) to authenticated;

/* 4. after-action report ------------------------------------------------------ */
drop function if exists public.submit_after_action(uuid, text, jsonb);
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
  v_row    public.report_dispatches;
  v_role   text;
  v_name   text;
  v_unit   uuid;
  v_brgy   uuid;
  v_team   text;
  v_k      text;
  v_clean  jsonb;
  v_common text[] := array['people_assisted','equipment_used','times','follow_up_needed','follow_up_note'];
  v_bfp    text[] := array['families_displaced','people_injured'];
  v_used   jsonb;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if coalesce(trim(p_text), '') = '' then
    raise exception 'Write a short after-action summary';
  end if;
  if p_meta is not null and jsonb_typeof(p_meta) <> 'object' then
    raise exception 'The after-action details must be an object';
  end if;
  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;
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

  v_team  := v_row.team;
  v_clean := coalesce(p_meta, '{}'::jsonb);

  for v_k in select jsonb_object_keys(v_clean) loop
    if not (v_k = any(v_common) or (v_team = 'BFP' and v_k = any(v_bfp))) then
      raise exception 'After-action key "%" is not allowed for team %', v_k, v_team;
    end if;
  end loop;

  if not (v_clean ? 'equipment_used') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'equipment_id', eu.equipment_id,
             'identifier', coalesce(nullif(e.identifier, ''), e.custom_label, ''))), '[]'::jsonb)
      into v_used
      from public.dispatch_equipment_use eu
      left join public.dispatch_equipment e on e.id = eu.equipment_id
     where eu.dispatch_id = p_dispatch_id;
    v_clean := v_clean || jsonb_build_object('equipment_used', v_used);
  end if;

  if not (v_clean ? 'times') then
    v_clean := v_clean || jsonb_build_object('times', jsonb_build_object(
      'ack_at', v_row.ack_at, 'en_route_at', v_row.en_route_at,
      'on_scene_at', v_row.on_scene_at, 'done_at', v_row.done_at));
  end if;

  update public.report_dispatches
     set after_action      = left(trim(p_text), 4000),
         after_action_at   = now(),
         after_action_by   = auth.uid(),
         after_action_meta = v_clean
   where id = p_dispatch_id;

  perform public.write_audit('dispatch.after_action', 'report_dispatches', p_dispatch_id,
    jsonb_build_object('by', v_name, 'meta', v_clean));

  return jsonb_build_object('id', p_dispatch_id, 'at', now());
end;
$$;

revoke all on function public.submit_after_action(uuid, text, jsonb) from public;
grant execute on function public.submit_after_action(uuid, text, jsonb) to authenticated;

/* 5. PNP: road closure from a dispatch --------------------------------------- */
alter table public.road_status add column if not exists dispatch_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_status_dispatch_id_fkey') then
    alter table public.road_status add constraint road_status_dispatch_id_fkey
      foreign key (dispatch_id) references public.report_dispatches(id) on delete set null;
  end if;
end $$;

create index if not exists road_status_dispatch_idx
  on public.road_status (dispatch_id) where dispatch_id is not null;

create or replace function public.post_road_closure(
  p_dispatch_id      uuid,
  p_road_name        text,
  p_note             text,
  p_lat              double precision default null,
  p_lng              double precision default null,
  p_segment_from     text default '',
  p_segment_to       text default '',
  p_estimated_reopen timestamptz default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row     public.report_dispatches;
  v_unit    public.dispatch_units;
  v_role    text;
  v_name    text;
  v_unit_id uuid;
  v_id      uuid;
  v_brgy    uuid;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if coalesce(trim(p_road_name), '') = '' then
    raise exception 'A road name is required';
  end if;

  select role, coalesce(full_name, ''), dispatch_unit_id
    into v_role, v_name, v_unit_id
    from public.profiles where id = auth.uid();
  if v_role <> 'dispatch_team' then
    raise exception 'Only a PNP unit member may post a road closure from a dispatch';
  end if;

  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;
  if v_row.unit_id is distinct from v_unit_id then
    raise exception 'You can only post a closure from your own unit''s dispatch';
  end if;
  if v_row.dispatch_status in ('done','declined') then
    raise exception 'This dispatch is closed';
  end if;

  select * into v_unit from public.dispatch_units where id = v_unit_id;
  if v_unit.unit_type is distinct from 'PNP' then
    raise exception 'Only a PNP unit may post a road closure from a dispatch';
  end if;

  select barangay_id into v_brgy from public.reports where id = v_row.report_id;

  insert into public.road_status
    (road_name, barangay, barangay_id, status, note, lat, lng,
     segment_from, segment_to, cause, severity, estimated_reopen,
     updated_by, created_by, updater_name, started_at, dispatch_id)
  values
    (left(trim(p_road_name), 200),
     coalesce((select name from public.barangays where id = v_brgy), ''),
     v_brgy,
     'blocked',
     left(coalesce(p_note, ''), 1000),
     p_lat, p_lng,
     left(coalesce(p_segment_from, ''), 200),
     left(coalesce(p_segment_to, ''), 200),
     'accident',
     'warning',
     p_estimated_reopen,
     auth.uid(), auth.uid(), v_name, now(), p_dispatch_id)
  returning id into v_id;

  perform public.write_audit('road_status.posted_from_dispatch', 'road_status', v_id,
    jsonb_build_object('dispatch_id', p_dispatch_id, 'road_name', p_road_name, 'by', v_name));

  return jsonb_build_object('id', v_id, 'status', 'blocked', 'dispatch_id', p_dispatch_id);
end;
$$;

revoke all on function public.post_road_closure(uuid, text, text, double precision, double precision, text, text, timestamptz) from public;
grant execute on function public.post_road_closure(uuid, text, text, double precision, double precision, text, text, timestamptz) to authenticated;

create or replace function public.reopen_road_closure(p_dispatch_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row     public.report_dispatches;
  v_unit_id uuid;
  v_unit    public.dispatch_units;
  v_role    text;
  v_name    text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  select role, coalesce(full_name, ''), dispatch_unit_id
    into v_role, v_name, v_unit_id
    from public.profiles where id = auth.uid();
  if v_role <> 'dispatch_team' then
    raise exception 'Only a PNP unit member may reopen their own road closure';
  end if;

  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;
  if v_row.unit_id is distinct from v_unit_id then
    raise exception 'You can only reopen a closure posted from your own unit''s dispatch';
  end if;
  select * into v_unit from public.dispatch_units where id = v_unit_id;
  if v_unit.unit_type is distinct from 'PNP' then
    raise exception 'Only a PNP unit may reopen a road closure';
  end if;

  update public.road_status
     set status       = 'passable',
         updated_by   = auth.uid(),
         updater_name = coalesce(nullif(v_name, ''), updater_name),
         updated_at   = now()
   where dispatch_id = p_dispatch_id
     and status = 'blocked'
     and created_by = auth.uid();

  if not found then
    raise exception 'No open closure posted by you was found for this dispatch';
  end if;

  perform public.write_audit('road_status.reopened', 'road_status', null,
    jsonb_build_object('dispatch_id', p_dispatch_id, 'by', v_name));

  return jsonb_build_object('dispatch_id', p_dispatch_id, 'status', 'passable');
end;
$$;

revoke all on function public.reopen_road_closure(uuid) from public;
grant execute on function public.reopen_road_closure(uuid) to authenticated;

/* 5. PNP: shelters that need a patrol ---------------------------------------- */
alter table public.evacuation_centers add column if not exists needs_patrol    boolean not null default false;
alter table public.evacuation_centers add column if not exists needs_patrol_at timestamptz;

create index if not exists evacuation_centers_needs_patrol_idx
  on public.evacuation_centers (needs_patrol) where needs_patrol = true;

/* 5. PNP: relief escorts ------------------------------------------------------ */
alter table public.relief_distributions add column if not exists escort_status  text not null default 'none';
alter table public.relief_distributions add column if not exists escort_note    text not null default '';
alter table public.relief_distributions add column if not exists escort_unit_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'relief_distributions_escort_status_check') then
    alter table public.relief_distributions add constraint relief_distributions_escort_status_check
      check (escort_status in ('none','requested','confirmed'));
  end if;
end $$;

create index if not exists relief_distributions_escort_idx
  on public.relief_distributions (escort_status) where escort_status <> 'none';

-- a PNP account reads the distributions it is asked to escort
create or replace function public.my_unit_is_pnp()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_dispatch() and exists (
    select 1 from public.dispatch_units u
     where u.id = public.my_unit_id() and u.unit_type = 'PNP'
  );
$$;
revoke all on function public.my_unit_is_pnp() from public;
grant execute on function public.my_unit_is_pnp() to authenticated;

drop policy if exists relief_distributions_read_pnp_escort on public.relief_distributions;
create policy relief_distributions_read_pnp_escort on public.relief_distributions
  for select to authenticated using (escort_status <> 'none' and public.my_unit_is_pnp());

create or replace function public.request_relief_escort(
  p_distribution_id uuid,
  p_note            text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row  public.relief_distributions;
  v_role text;
  v_brgy uuid;
  v_name text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  select * into v_row from public.relief_distributions where id = p_distribution_id;
  if v_row.id is null then
    raise exception 'That distribution does not exist';
  end if;
  select role, coalesce(full_name, ''), barangay_id into v_role, v_name, v_brgy
    from public.profiles where id = auth.uid();
  if v_role not in ('lgu_ldrrmc','barangay_official') then
    raise exception 'Only the LGU or a barangay official may request an escort';
  end if;
  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'This distribution is outside your barangay';
  end if;
  if v_row.escort_status = 'confirmed' then
    raise exception 'This escort is already confirmed';
  end if;

  update public.relief_distributions
     set escort_status = 'requested',
         escort_note   = left(coalesce(p_note, ''), 1000),
         updated_at    = now()
   where id = p_distribution_id;

  insert into public.notifications (user_id, title, body, tone, icon, type)
  select p.id,
    'Relief escort requested',
    left(coalesce(v_row.title, '') || ' · ' || coalesce(v_row.barangay, '') || ' — ' || coalesce(p_note, ''), 240),
    'warning', 'shield', 'relief_escort'
    from public.profiles p
   where p.disabled = false and p.role = 'dispatch_team'
     and p.dispatch_unit_id in (select id from public.dispatch_units where unit_type = 'PNP' and active = true);

  perform public.write_audit('relief.escort_requested', 'relief_distributions', p_distribution_id,
    jsonb_build_object('by', v_name, 'note', left(coalesce(p_note, ''), 500)));

  return jsonb_build_object('id', p_distribution_id, 'escort_status', 'requested');
end;
$$;

revoke all on function public.request_relief_escort(uuid, text) from public;
grant execute on function public.request_relief_escort(uuid, text) to authenticated;

create or replace function public.confirm_relief_escort(p_distribution_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row     public.relief_distributions;
  v_role    text;
  v_name    text;
  v_unit_id uuid;
  v_unit    public.dispatch_units;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  select role, coalesce(full_name, ''), dispatch_unit_id
    into v_role, v_name, v_unit_id
    from public.profiles where id = auth.uid();
  if v_role <> 'dispatch_team' then
    raise exception 'Only a PNP unit member may confirm an escort';
  end if;
  select * into v_unit from public.dispatch_units where id = v_unit_id;
  if v_unit.unit_type is distinct from 'PNP' then
    raise exception 'Only a PNP unit may confirm an escort';
  end if;
  select * into v_row from public.relief_distributions where id = p_distribution_id;
  if v_row.id is null then
    raise exception 'That distribution does not exist';
  end if;
  if v_row.escort_status = 'confirmed' then
    raise exception 'This escort is already confirmed';
  end if;
  if v_row.escort_status <> 'requested' then
    raise exception 'No escort was requested for this distribution';
  end if;

  update public.relief_distributions
     set escort_status  = 'confirmed',
         escort_unit_id = v_unit_id,
         updated_at     = now()
   where id = p_distribution_id;

  perform public.write_audit('relief.escort_confirmed', 'relief_distributions', p_distribution_id,
    jsonb_build_object('unit_id', v_unit_id, 'by', v_name));

  return jsonb_build_object('id', p_distribution_id, 'escort_status', 'confirmed', 'unit_id', v_unit_id);
end;
$$;

revoke all on function public.confirm_relief_escort(uuid) from public;
grant execute on function public.confirm_relief_escort(uuid) to authenticated;

/* 6. hospitals: patient notices ---------------------------------------------- */
drop function if exists public.send_patient_notice(uuid, uuid, int, text, timestamptz);
create or replace function public.send_patient_notice(
  p_unit_id   uuid,
  p_report_id uuid default null,
  p_patients  int default 1,
  p_condition text default '',
  p_eta       timestamptz default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_id   uuid;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if not exists (select 1 from public.dispatch_units where id = p_unit_id and unit_type = 'Hospital' and active = true) then
    raise exception 'That hospital does not exist';
  end if;
  if not exists (select 1 from public.hospital_capacity where unit_id = p_unit_id and accepting = true) then
    raise exception 'That hospital is not accepting patients';
  end if;

  select role, coalesce(full_name, '') into v_role, v_name
    from public.profiles where id = auth.uid();
  if v_role not in ('lgu_ldrrmc','barangay_official','dispatch_team') then
    raise exception 'Only officials, LGU or responders may send a patient notice';
  end if;

  insert into public.patient_notices (unit_id, report_id, patients, condition, eta, sent_by, status)
  values (p_unit_id, p_report_id, greatest(coalesce(p_patients, 1), 1), left(coalesce(p_condition, ''), 240), p_eta, auth.uid(), 'sent')
  returning id into v_id;

  insert into public.notifications (user_id, title, body, tone, icon, type)
  select p.id, 'Incoming patient notice',
         left(greatest(coalesce(p_patients, 1), 1) || ' patient(s) · ' || coalesce(p_condition, ''), 240),
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

drop function if exists public.ack_patient_notice(uuid, text);
create or replace function public.ack_patient_notice(
  p_notice_id uuid,
  p_status    text default 'acknowledged'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row  public.patient_notices;
  v_role text;
  v_unit uuid;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
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
  if v_row.status not in ('sent','acknowledged') then
    raise exception 'A notice in "%" cannot move to "%"', v_row.status, p_status;
  end if;

  update public.patient_notices
     set status = p_status,
         ack_at = case when p_status = 'acknowledged' then now() else ack_at end
   where id = p_notice_id;

  perform public.write_audit('patient.notice_acked', 'patient_notices', p_notice_id,
    jsonb_build_object('status', p_status));

  return jsonb_build_object('id', p_notice_id, 'status', p_status);
end;
$$;

revoke all on function public.ack_patient_notice(uuid, text) from public;
grant execute on function public.ack_patient_notice(uuid, text) to authenticated;

/* 7. equipment ---------------------------------------------------------------- */
-- the catalog the Add form's Type list reads, added only where missing
insert into public.equipment_catalog (unit_type, label, checklist)
select v.unit_type, v.label, v.checklist::jsonb
  from (values
    ('BFP', 'Fire Truck',                 '["Water level","Hose condition","Pump test","Fuel level","Engine start"]'),
    ('BFP', 'Water Tanker',               '["Water volume","Valve operation","Hose connection","Fuel level"]'),
    ('BFP', 'Aerial Ladder',              '["Hydraulic test","Ladder extension","Stabilisers","Controls"]'),
    ('BFP', 'Breathing Apparatus (SCBA)', '["Cylinder pressure","Face mask seal","Regulator","Airflow"]'),
    ('BFP', 'Hose Set',                   '["Nozzles","Couplings","Pressure test","Length"]'),
    ('PNP', 'Patrol Car',                 '["Fuel level","Radio battery","Lights and siren","First-aid kit"]'),
    ('PNP', 'Motorcycle',                 '["Fuel level","Tyres","Lights","Radio battery"]'),
    ('PNP', 'Barriers and Cones',         '["Count","Reflective condition","Stands","Bag"]'),
    ('PNP', 'Radios',                     '["Battery","Channel scan","Antenna","Speaker"]'),
    ('PNP', 'Crowd-Control Kit',          '["Vests","Megaphone","Baton","Whistle"]'),
    ('Rescue', 'Rescue Boat',             '["Engine start","Fuel level","Life vests","Paddles","Hull"]'),
    ('Rescue', 'Extrication Tools',       '["Hydraulic pump","Cutter","Spreader","Ram","Hoses"]'),
    ('Rescue', 'Rope and Rappel Set',     '["Rope integrity","Carabiners","Harnesses","Descenders","Anchors"]'),
    ('Rescue', 'Stretcher',               '["Straps","Frame","Wheels","Cleanliness"]'),
    ('Rescue', 'First-Aid Kit',           '["Bandages","Antiseptics","Medicines list","Triage tags"]'),
    ('Hospital', 'Ambulance',             '["Fuel level","Tyres","Stretcher","Oxygen tank","Defibrillator"]'),
    ('Hospital', 'ER Beds',               '["Available count","Bedding","Monitors","Oxygen outlets"]'),
    ('Hospital', 'ICU Beds',              '["Available count","Ventilators","Monitors","Power"]'),
    ('Hospital', 'Oxygen',                '["Cylinder count","Pressure","Backup supply","Flow meters"]'),
    ('Hospital', 'Blood Supply',          '["A+","A-","B+","B-","AB+","AB-","O+","O-","Storage temp"]'),
    ('Barangay', 'Boat',                  '["Hull","Paddles","Life vests","Rope"]'),
    ('Barangay', 'Rope',                  '["Length","Knot integrity","Cleanliness"]'),
    ('Barangay', 'Stretcher',             '["Frame","Straps","Wheels"]'),
    ('Barangay', 'Radio',                 '["Battery","Channel","Speaker","Antenna"]'),
    ('Barangay', 'First-Aid Kit',         '["Bandages","Antiseptics","Medicines list","Triage tags"]'),
    ('Barangay', 'Life Vests',            '["Count","Buckles","Straps","Tear check"]'),
    ('Barangay', 'Sandbags',              '["Stock count","Tie integrity","Mould check"]'),
    ('Barangay', 'Flashlights',           '["Battery","Beam test","Spare batteries","Count"]'),
    ('Barangay', 'Megaphone',             '["Battery","Volume test","Microphone","Siren"]'),
    ('Barangay', 'Generator',             '["Fuel level","Oil level","Start test","Output V"]')
  ) as v(unit_type, label, checklist)
 where not exists (
   select 1 from public.equipment_catalog c
    where c.unit_type = v.unit_type and lower(c.label) = lower(v.label)
 );

-- the readiness check keeps the level that was typed (it stored the condition)
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
  v_row  public.dispatch_equipment;
  v_role text;
  v_unit uuid;
  v_brgy uuid;
  v_id   uuid;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
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
  values (p_equipment_id, auth.uid(), p_condition, left(coalesce(p_level, ''), 120),
          left(coalesce(p_notes, ''), 500), p_photo, coalesce(p_items, '[]'::jsonb))
  returning id into v_id;

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

create or replace function public.add_equipment(
  p_owner_unit_id     uuid default null,
  p_owner_barangay_id uuid default null,
  p_catalog_id        uuid default null,
  p_custom_label      text default '',
  p_identifier        text default '',
  p_condition         text default 'unknown',
  p_notes             text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role       text;
  v_unit       uuid;
  v_brgy       uuid;
  v_name       text;
  v_catalog    public.equipment_catalog;
  v_unit_row   public.dispatch_units;
  v_id         uuid;
  v_label      text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if p_condition is null or p_condition not in ('ready','needs_repair','missing','out_of_service','unknown') then
    raise exception 'Invalid condition (use ready, needs_repair, missing, out_of_service or unknown)';
  end if;
  if (p_owner_unit_id is null) = (p_owner_barangay_id is null) then
    raise exception 'Pick exactly one owner: a unit OR a barangay';
  end if;

  select role, dispatch_unit_id, barangay_id, coalesce(full_name, '')
    into v_role, v_unit, v_brgy, v_name
    from public.profiles where id = auth.uid();

  if v_role not in ('lgu_ldrrmc','dispatch_team','barangay_official') then
    raise exception 'Only the LGU, a unit admin, or a barangay official can add equipment';
  end if;
  if v_role = 'dispatch_team' then
    if not public.is_unit_admin() then
      raise exception 'Only a unit admin can add equipment';
    end if;
    if p_owner_unit_id is distinct from v_unit then
      raise exception 'You can only add equipment to your own unit';
    end if;
  elsif v_role = 'barangay_official' then
    if p_owner_barangay_id is distinct from v_brgy then
      raise exception 'You can only add equipment to your own barangay';
    end if;
  end if;

  if p_owner_unit_id is not null then
    select * into v_unit_row from public.dispatch_units where id = p_owner_unit_id;
    if v_unit_row.id is null then
      raise exception 'That unit does not exist';
    end if;
  end if;

  if p_catalog_id is not null then
    select * into v_catalog from public.equipment_catalog where id = p_catalog_id;
    if v_catalog.id is null then
      raise exception 'That catalog entry does not exist';
    end if;
    if p_owner_unit_id is not null then
      if v_unit_row.unit_type is distinct from v_catalog.unit_type then
        raise exception 'The catalog type (%) does not match the unit type (%)', v_catalog.unit_type, v_unit_row.unit_type;
      end if;
    elsif v_catalog.unit_type <> 'Barangay' then
      raise exception 'A barangay-owned equipment row must use a Barangay catalog entry';
    end if;
  elsif coalesce(trim(p_custom_label), '') = '' then
    raise exception 'Pick a type from the catalog, or write a custom label';
  end if;

  v_label := left(coalesce(trim(p_custom_label), ''), 200);
  if p_catalog_id is not null and v_label = '' then
    v_label := v_catalog.label;
  end if;

  insert into public.dispatch_equipment
    (owner_unit_id, owner_barangay_id, catalog_id, custom_label, identifier,
     status, condition, notes, last_checked_at)
  values
    (p_owner_unit_id, p_owner_barangay_id, p_catalog_id, v_label,
     left(coalesce(trim(p_identifier), ''), 200),
     'available', p_condition,
     left(coalesce(trim(p_notes), ''), 1000), null)
  returning id into v_id;

  perform public.write_audit('equipment.added', 'dispatch_equipment', v_id,
    jsonb_build_object(
      'owner_unit_id', p_owner_unit_id, 'owner_barangay_id', p_owner_barangay_id,
      'catalog_id', p_catalog_id, 'custom_label', v_label,
      'identifier', left(coalesce(trim(p_identifier), ''), 200),
      'condition', p_condition, 'by', v_name));

  return jsonb_build_object('id', v_id, 'status', 'available');
end;
$$;

revoke all on function public.add_equipment(uuid, uuid, uuid, text, text, text, text) from public;
grant execute on function public.add_equipment(uuid, uuid, uuid, text, text, text, text) to authenticated;

-- edit the identifier, label, condition and notes; the owner and type stay
create or replace function public.update_equipment(
  p_equipment_id uuid,
  p_identifier   text default null,
  p_custom_label text default null,
  p_condition    text default null,
  p_notes        text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row  public.dispatch_equipment;
  v_role text;
  v_unit uuid;
  v_brgy uuid;
  v_name text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if p_condition is not null and p_condition not in ('ready','needs_repair','missing','out_of_service','unknown') then
    raise exception 'Invalid condition';
  end if;

  select * into v_row from public.dispatch_equipment where id = p_equipment_id;
  if v_row.id is null then
    raise exception 'That equipment does not exist';
  end if;

  select role, dispatch_unit_id, barangay_id, coalesce(full_name, '')
    into v_role, v_unit, v_brgy, v_name
    from public.profiles where id = auth.uid();

  if v_role <> 'lgu_ldrrmc' then
    if v_row.owner_unit_id is not null then
      if v_role <> 'dispatch_team' or not public.is_unit_admin() or v_row.owner_unit_id is distinct from v_unit then
        raise exception 'Only the LGU or this unit''s admin may edit this equipment';
      end if;
    else
      if v_role <> 'barangay_official' or v_row.owner_barangay_id is distinct from v_brgy then
        raise exception 'Only the LGU or this barangay''s official may edit this equipment';
      end if;
    end if;
  end if;

  -- an empty identifier clears it; null leaves it as it is
  update public.dispatch_equipment
     set identifier   = case when p_identifier is null then identifier else left(trim(p_identifier), 200) end,
         custom_label = coalesce(nullif(left(coalesce(trim(p_custom_label), ''), 200), ''), custom_label),
         condition    = coalesce(p_condition, condition),
         notes        = case when p_notes is null then notes else left(trim(p_notes), 1000) end,
         updated_at   = now()
   where id = p_equipment_id;

  perform public.write_audit('equipment.updated', 'dispatch_equipment', p_equipment_id,
    jsonb_build_object(
      'identifier', p_identifier, 'custom_label', p_custom_label,
      'condition', p_condition, 'notes', left(coalesce(p_notes, ''), 500), 'by', v_name));

  return jsonb_build_object('id', p_equipment_id, 'at', now());
end;
$$;

revoke all on function public.update_equipment(uuid, text, text, text, text) from public;
grant execute on function public.update_equipment(uuid, text, text, text, text) to authenticated;

-- delete when never used on a dispatch; otherwise retire (status unavailable)
create or replace function public.remove_equipment(
  p_equipment_id uuid,
  p_retire       boolean default false
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row       public.dispatch_equipment;
  v_role      text;
  v_unit      uuid;
  v_brgy      uuid;
  v_name      text;
  v_use_count int;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;

  select * into v_row from public.dispatch_equipment where id = p_equipment_id;
  if v_row.id is null then
    raise exception 'That equipment does not exist';
  end if;

  select role, dispatch_unit_id, barangay_id, coalesce(full_name, '')
    into v_role, v_unit, v_brgy, v_name
    from public.profiles where id = auth.uid();

  if v_role <> 'lgu_ldrrmc' then
    if v_row.owner_unit_id is not null then
      if v_role <> 'dispatch_team' or not public.is_unit_admin() or v_row.owner_unit_id is distinct from v_unit then
        raise exception 'Only the LGU or this unit''s admin may remove this equipment';
      end if;
    else
      if v_role <> 'barangay_official' or v_row.owner_barangay_id is distinct from v_brgy then
        raise exception 'Only the LGU or this barangay''s official may remove this equipment';
      end if;
    end if;
  end if;

  if v_row.status = 'deployed' then
    raise exception 'This equipment is currently deployed. Release it from its dispatch before removing or retiring.';
  end if;

  select count(*) into v_use_count
    from public.dispatch_equipment_use
   where equipment_id = p_equipment_id;

  if coalesce(p_retire, false) then
    update public.dispatch_equipment
       set status = 'unavailable', updated_at = now()
     where id = p_equipment_id;
    perform public.write_audit('equipment.retired', 'dispatch_equipment', p_equipment_id,
      jsonb_build_object('had_dispatch_history', v_use_count > 0, 'by', v_name));
    return jsonb_build_object('id', p_equipment_id, 'status', 'unavailable', 'retired', true);
  end if;

  if v_use_count > 0 then
    raise exception 'This equipment has been used in % dispatch(es). Retire it instead (status = unavailable) so the dispatch history is preserved.', v_use_count;
  end if;
  delete from public.dispatch_equipment where id = p_equipment_id;
  perform public.write_audit('equipment.removed', 'dispatch_equipment', p_equipment_id,
    jsonb_build_object('had_dispatch_history', false, 'by', v_name));
  return jsonb_build_object('id', p_equipment_id, 'removed', true);
end;
$$;

revoke all on function public.remove_equipment(uuid, boolean) from public;
grant execute on function public.remove_equipment(uuid, boolean) to authenticated;

-- how many dispatches used a piece of equipment (the Retire / remove pop-up);
-- a security definer count, because a member cannot read every use row
create or replace function public.equipment_use_count(p_equipment_id uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.dispatch_equipment_use u
   where u.equipment_id = p_equipment_id
     and exists (
       select 1 from public.dispatch_equipment e
        where e.id = u.equipment_id
          and (public.is_lgu()
               or (public.is_dispatch() and e.owner_unit_id = public.my_unit_id())
               or (public.is_official() and e.owner_barangay_id = public.my_barangay_id()))
     );
$$;
revoke all on function public.equipment_use_count(uuid) from public;
grant execute on function public.equipment_use_count(uuid) to authenticated;

/* realtime -------------------------------------------------------------------- */
do $$
begin
  begin
    alter publication supabase_realtime add table public.dispatch_help_requests;
  exception when others then null;
  end;
end $$;

notify pgrst, 'reload schema';
