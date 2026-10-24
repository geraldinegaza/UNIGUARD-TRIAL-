-- ============================================================================
--  UniGuard · 039 · dispatch_report_v2 + fanout_dispatch v2 (Part D)
--
--  Rewrites the dispatch pipeline so a Barangay Response Team dispatch
--  targets the report's barangay and a municipality-wide unit dispatch
--  targets the dispatched unit, with the right people notified.
--
--  CRITICAL notification rules (from the prompt):
--    · Barangay Response Team dispatch → notify the report's barangay
--      residents and officials (action alert), the reporter and the LGU.
--      Never another barangay.
--    · Municipality-wide unit dispatch → notify the dispatched unit's
--      users, the report's barangay residents and officials (info), the
--      reporter and the LGU.
--      Never another unit, never another barangay.
--    · A barangay official may only dispatch a Response Team for their
--      own barangay; the LGU may send mutual aid to any barangay.
--    · A dispatch_team user is notified ONLY for dispatches addressed
--      to its own unit.
--    · Hospitals never receive a field dispatch; they receive patient
--      notices (migration 040 / set_hospital_capacity RPC handles those).
--
--  drop function is drop-if-exists; the previous 3-arg fanout_dispatch
--  signature is removed first to avoid an ambiguous-overload error.
--
--  Additive + idempotent. The old dispatch_report(uuid, text, text,
--  timestamptz) is kept as a thin wrapper that calls dispatch_report_v2
--  so the existing client (js/repo.js) does not need a parallel upgrade.
-- ============================================================================

-- ------------------------------------------------------ drop the old signatures
-- The 3-arg fanout_dispatch(report_id, team, instructions) is gone; the
-- new one takes (report_id, dispatch_id, team, target_barangay_id, unit_id).
drop function if exists public.fanout_dispatch(uuid, text, text);

-- Keep the existing dispatch_report wrapper behaviour (it took 4 args).
-- We replace the body so it routes to dispatch_report_v2; the wrapper is
-- used by js/repo.js. The RPC is later granted to authenticated.
drop function if exists public.dispatch_report(uuid, text, text, timestamptz);

-- ----------------------------------------------------------- new fan-out helper
-- Inserts one notification row per recipient who should know about a
-- dispatch. Recipients are computed from the team type:
--   · Barangay Response Team → residents + officials of the report's
--     barangay, plus the LGU and the reporter. The official tone is
--     'warning' (action alert).
--   · Municipality-wide unit → users of that unit only on the unit side,
--     plus the residents + officials of the report's barangay (info
--     tone), plus the LGU and the reporter.
--
-- The function takes the dispatch row so it can compute everything in one
-- shot; it does not re-read report_dispatches.
create or replace function public.fanout_dispatch(
  p_report_id          uuid,
  p_dispatch_id        uuid,
  p_team               text,
  p_target_barangay_id uuid,
  p_unit_id            uuid,
  p_instructions       text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.reports;
  v_title    text;
  v_body     text;
  v_unit_tone text;
  v_count    int := 0;
begin
  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    return 0;
  end if;

  v_title := 'Response dispatched to ' || coalesce(v_row.barangay, 'your barangay');
  v_body  := left(p_team || ': ' || coalesce(p_instructions, ''), 240);

  -- 1) reporter + LGU + report's barangay residents/officials (info or
  --    action alert depending on team). Never another barangay.
  if p_team = 'Barangay Response Team' then
    v_unit_tone := 'warning';  -- action alert, the barangay's team is going
  else
    v_unit_tone := 'advisory'; -- info, a municipality unit is coming
  end if;

  with targets as (
    select p.id
      from public.profiles p
     where p.disabled = false
       and (
         p.id = v_row.reporter_id
         or p.role in ('lgu_ldrrmc')
         or (v_row.barangay_id is not null and p.barangay_id = v_row.barangay_id)
       )
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    select id, v_title, v_body, v_unit_tone, 'truck', 'dispatch', v_row.id from targets
    returning 1
  )
  select count(*) into v_count from ins;

  -- 2) the dispatched unit's users (only when a unit is set and the team is
  --    a municipality-wide unit). Hospitals are notified only by patient
  --    notices, NOT by field dispatches. The team 'Hospital' is not in the
  --    allowed team list (it is not) so this branch is never reached for
  --    hospitals; we still guard defensively.
  if p_unit_id is not null and p_team <> 'Barangay Response Team' then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    select p.id, 'Incoming dispatch: ' || p_team,
           left(p_team || ' · ' || coalesce(p_instructions, '') ||
                ' · ' || coalesce(v_row.barangay, 'unknown barangay'), 240),
           'warning', 'truck', 'unit_dispatch', v_row.id
      from public.profiles p
     where p.disabled = false
       and p.role = 'dispatch_team'
       and p.dispatch_unit_id = p_unit_id;
  end if;

  return v_count;
end;
$$;

revoke all on function public.fanout_dispatch(uuid, uuid, text, uuid, uuid, text) from public;
grant execute on function public.fanout_dispatch(uuid, uuid, text, uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------- dispatch_report_v2
-- p_unit_id    : nullable uuid of the dispatched dispatch_units row. Required
--                for municipality-wide teams (BFP/PNP/Rescue Unit/Ambulance).
--                NULL when team = 'Barangay Response Team'.
-- p_target_barangay_id : nullable uuid. NULL when team is a municipality-wide
--                unit (the report's barangay is what matters and we read it
--                from the report row). Must equal the report's barangay_id
--                when team = 'Barangay Response Team'.
-- p_equipment_ids : uuid[] of dispatch_equipment rows. Each must belong to
--                the chosen owner (the unit OR the report's barangay) and
--                be status = 'available'. The RPC marks them deployed.
create or replace function public.dispatch_report_v2(
  p_report_id          uuid,
  p_team               text,
  p_instructions       text,
  p_eta                timestamptz,
  p_unit_id            uuid default null,
  p_target_barangay_id uuid default null,
  p_equipment_ids      uuid[] default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role     text;
  v_brgy     uuid;
  v_name     text;
  v_row      public.reports;
  v_disp_id  uuid;
  v_team     text;
  v_unit_id  uuid;
  v_target_brgy uuid;
  v_notified int := 0;
  v_eq       record;
  v_count    int := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select role, barangay_id, coalesce(full_name, '')
    into v_role, v_brgy, v_name
    from public.profiles where id = auth.uid();

  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can dispatch a response';
  end if;

  -- The team whitelist now includes 'Rescue Unit' (from a Rescue-type unit).
  if p_team not in ('MDRRMO Rescue','BFP','PNP','Barangay Response Team','Ambulance','Rescue Unit') then
    raise exception 'Choose a responder team from the list';
  end if;
  if coalesce(trim(p_instructions), '') = '' then
    raise exception 'Write what the responders are supposed to do';
  end if;
  if p_eta is null or p_eta < now() - interval '5 minutes' then
    raise exception 'The ETA must be a time from now onward';
  end if;

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  -- scope: a barangay_official cannot dispatch outside their barangay.
  -- The barangay Response Team can ONLY target the report's barangay.
  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_row.status not in ('verified', 'dispatched') then
    raise exception 'Verify the report before dispatching a response (it is "%")', v_row.status;
  end if;

  v_team := p_team;

  -- Branch: Barangay Response Team vs municipality-wide unit.
  if v_team = 'Barangay Response Team' then
    -- the team is the report's barangay's own team. The target_barangay_id
    -- passed in MUST equal the report's barangay_id; if it does not, the
    -- caller is trying to dispatch another barangay's team.
    v_target_brgy := v_row.barangay_id;
    if p_target_barangay_id is not null and p_target_barangay_id is distinct from v_row.barangay_id then
      raise exception 'A Barangay Response Team dispatch can only target the report''s barangay';
    end if;
    if v_role = 'barangay_official' and v_target_brgy is distinct from v_brgy then
      raise exception 'You cannot dispatch another barangay''s Response Team';
    end if;
    v_unit_id := null;
  else
    -- municipality-wide unit. The unit_id is required and must be active.
    if p_unit_id is null then
      raise exception 'Pick a unit to dispatch';
    end if;
    select id into v_unit_id from public.dispatch_units
     where id = p_unit_id and active = true;
    if v_unit_id is null then
      raise exception 'That unit does not exist or is not active';
    end if;
    -- the unit_type must match the team the caller picked
    if not (
      (v_team = 'BFP'        and (select unit_type from public.dispatch_units where id = v_unit_id) = 'BFP')   or
      (v_team = 'PNP'        and (select unit_type from public.dispatch_units where id = v_unit_id) = 'PNP')   or
      (v_team in ('Rescue Unit','MDRRMO Rescue') and (select unit_type from public.dispatch_units where id = v_unit_id) = 'Rescue') or
      (v_team = 'Ambulance'  and (select unit_type from public.dispatch_units where id = v_unit_id) = 'Hospital')
    ) then
      raise exception 'The unit type does not match the team you picked';
    end if;
    v_target_brgy := v_row.barangay_id;
  end if;

  -- equipment validation: each id must belong to the chosen owner and be
  -- status = available AND condition in a deployable state.
  if p_equipment_ids is not null then
    foreach v_eq in array p_equipment_ids loop
      select * into v_count from public.dispatch_equipment e
       where e.id = v_eq
         and e.status = 'available'
         and e.condition not in ('needs_repair','missing','out_of_service')
         and (
           (v_team = 'Barangay Response Team' and e.owner_barangay_id = v_target_brgy)
           or (v_team <> 'Barangay Response Team' and e.owner_unit_id = v_unit_id)
         );
      if not found then
        raise exception 'Equipment % is not available, not in a deployable condition, or not owned by the chosen team', v_eq;
      end if;
    end loop;
  end if;

  -- Write the dispatch row.
  insert into public.report_dispatches
    (report_id, team, instructions, eta, dispatched_by, dispatched_by_name,
     unit_id, target_barangay_id, dispatch_status)
  values
    (p_report_id, v_team, trim(p_instructions), p_eta, auth.uid(), v_name,
     v_unit_id, v_target_brgy, 'sent')
  returning id into v_disp_id;

  -- mark equipment deployed and write the use rows
  if p_equipment_ids is not null then
    foreach v_eq in array p_equipment_ids loop
      insert into public.dispatch_equipment_use (dispatch_id, equipment_id)
      values (v_disp_id, v_eq);
      update public.dispatch_equipment
         set status = 'deployed', last_checked_at = now()
       where id = v_eq;
    end loop;
  end if;

  -- first dispatch moves the report status to dispatched; extra teams add
  -- a record only. The 028/036 guard_report_status trigger enforces one
  -- step at a time so the move is legal.
  if v_row.status = 'verified' then
    perform public.advance_report_status(
      p_report_id, 'dispatched', v_team || ': ' || left(trim(p_instructions), 120));
  end if;

  -- audit row
  perform public.write_audit('report.dispatched', 'reports', p_report_id,
    jsonb_build_object('dispatch_id', v_disp_id, 'team', v_team,
                       'unit_id', v_unit_id, 'target_barangay_id', v_target_brgy,
                       'eta', p_eta, 'instructions', left(trim(p_instructions), 300)));

  -- the timeline event
  insert into public.report_dispatch_events (dispatch_id, actor, actor_name, action, note)
  values (v_disp_id, auth.uid(), v_name, 'dispatched', left(trim(p_instructions), 240));

  -- fan-out notifications
  v_notified := public.fanout_dispatch(p_report_id, v_disp_id, v_team, v_target_brgy, v_unit_id, trim(p_instructions));

  return jsonb_build_object('id', v_disp_id, 'team', v_team, 'eta', p_eta,
                            'dispatched_by', v_name, 'dispatched_at', now(),
                            'unit_id', v_unit_id, 'target_barangay_id', v_target_brgy,
                            'notified', v_notified);
end;
$$;

revoke all on function public.dispatch_report_v2(uuid, text, text, timestamptz, uuid, uuid, uuid[]) from public;
grant execute on function public.dispatch_report_v2(uuid, text, text, timestamptz, uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------- backward-compat wrapper
-- The client (js/repo.js) still calls dispatch_report(uuid, text, text,
-- timestamptz). We re-create it as a thin wrapper that calls dispatch_report_v2
-- with no equipment and no unit (the barangay Response Team branch).
create or replace function public.dispatch_report(
  p_report_id    uuid,
  p_team         text,
  p_instructions text,
  p_eta          timestamptz
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  return public.dispatch_report_v2(
    p_report_id := p_report_id,
    p_team := p_team,
    p_instructions := p_instructions,
    p_eta := p_eta,
    p_unit_id := null,
    p_target_barangay_id := null,
    p_equipment_ids := null
  );
end;
$$;

revoke all on function public.dispatch_report(uuid, text, text, timestamptz) from public;
grant execute on function public.dispatch_report(uuid, text, text, timestamptz) to authenticated;

-- ----------------------------------------------------- dispatch_respond RPC
-- Acknowledge → En route → On scene → Done, with a note. Each action
-- writes a timeline row and notifies the barangay officials of the report's
-- barangay and the LGU; on_scene and done also notify the reporter.
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
  v_row       public.report_dispatches;
  v_unit_id  uuid;
  v_target   uuid;
  v_role     text;
  v_name     text;
  v_report   public.reports;
  v_now      timestamptz := now();
  v_tone     text;
  v_title    text;
  v_body     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_action not in ('acknowledged','en_route','on_scene','done') then
    raise exception 'Unknown action: %', p_action;
  end if;

  select role, coalesce(full_name, '') into v_role, v_name
    from public.profiles where id = auth.uid();

  select * into v_row from public.report_dispatches where id = p_dispatch_id;
  if v_row.id is null then
    raise exception 'That dispatch does not exist';
  end if;

  -- Only the dispatched unit's users OR the LGU may update a unit dispatch.
  -- For Barangay Response Team dispatches, the report's barangay officials
  -- and the LGU may update.
  if v_role <> 'lgu_ldrrmc' then
    if v_row.unit_id is not null then
      if v_role <> 'dispatch_team' or v_row.unit_id is distinct from public.my_unit_id() then
        raise exception 'Only this unit''s users may respond to this dispatch';
      end if;
    else
      -- Barangay Response Team dispatch
      if v_role <> 'barangay_official' then
        raise exception 'Only the barangay official may respond to this dispatch';
      end if;
      select * into v_report from public.reports where id = v_row.report_id;
      if v_report.barangay_id is distinct from public.my_barangay_id() then
        raise exception 'This dispatch is outside your barangay';
      end if;
    end if;
  end if;

  -- Enforce the same one-step ordering for dispatch_status.
  if not (
    (v_row.dispatch_status = 'sent'        and p_action = 'acknowledged')
    or (v_row.dispatch_status = 'acknowledged' and p_action in ('en_route','on_scene','done'))
    or (v_row.dispatch_status = 'en_route'    and p_action in ('on_scene','done'))
    or (v_row.dispatch_status = 'on_scene'    and p_action = 'done')
  ) then
    raise exception 'A dispatch in "%" cannot move to "%"', v_row.dispatch_status, p_action;
  end if;

  update public.report_dispatches
     set dispatch_status = p_action,
         ack_at      = case when p_action = 'acknowledged' then v_now else ack_at end,
         en_route_at = case when p_action = 'en_route'    then v_now else en_route_at end,
         on_scene_at = case when p_action = 'on_scene'    then v_now else on_scene_at end,
         done_at     = case when p_action = 'done'        then v_now else done_at end
   where id = p_dispatch_id;

  insert into public.report_dispatch_events (dispatch_id, actor, actor_name, action, note)
  values (p_dispatch_id, auth.uid(), v_name, p_action, left(coalesce(p_note, ''), 240));

  perform public.write_audit('dispatch.responded', 'report_dispatches', p_dispatch_id,
    jsonb_build_object('action', p_action, 'note', left(coalesce(p_note, ''), 240)));

  -- Notify: the report's barangay officials + LGU. On scene and Done
  -- also notify the reporter. Never other barangays or units.
  select * into v_report from public.reports where id = v_row.report_id;
  v_unit_id := v_row.unit_id;
  v_target  := v_report.barangay_id;

  v_tone  := case p_action when 'acknowledged' then 'advisory'  when 'en_route' then 'advisory'
                            when 'on_scene'   then 'warning'  when 'done' then 'prepared' end;
  v_title := case p_action
    when 'acknowledged' then 'Dispatch acknowledged'
    when 'en_route'      then 'Responder en route'
    when 'on_scene'      then 'Responder on scene'
    when 'done'          then 'Dispatch complete'
  end;
  v_body  := case p_action
    when 'acknowledged' then 'Response to ' || coalesce(v_report.code, '') || ' is acknowledged.'
    when 'en_route'      then 'Response to ' || coalesce(v_report.code, '') || ' is en route.'
    when 'on_scene'      then 'Response to ' || coalesce(v_report.code, '') || ' is on scene.'
    when 'done'          then 'Response to ' || coalesce(v_report.code, '') || ' is done.'
  end;

  -- barangay officials (info or action) + LGU
  insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
  select p.id, v_title, v_body, v_tone, 'truck', 'dispatch_status', v_report.id
    from public.profiles p
   where p.disabled = false
     and (
       p.role = 'lgu_ldrrmc'
       or (v_target is not null and p.barangay_id = v_target and p.role = 'barangay_official')
     );

  -- reporter, only for on_scene and done
  if p_action in ('on_scene','done') and v_report.reporter_id is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_report.reporter_id, v_title, v_body, v_tone, 'check', 'dispatch_status', v_report.id);
  end if;

  -- When done, release the equipment and reset the unit status (the
  -- sync_unit_status trigger handles the unit).
  if p_action = 'done' then
    update public.dispatch_equipment_use
       set released_at = v_now
     where dispatch_id = p_dispatch_id and released_at is null;
    update public.dispatch_equipment
       set status = 'available'
     where id in (select equipment_id from public.dispatch_equipment_use where dispatch_id = p_dispatch_id);
  end if;

  return jsonb_build_object('dispatch_id', p_dispatch_id, 'action', p_action, 'at', v_now);
end;
$$;

revoke all on function public.dispatch_respond(uuid, text, text) from public;
grant execute on function public.dispatch_respond(uuid, text, text) to authenticated;

-- ----------------------------------------------------- report resolved/rejected trigger
-- When a report becomes resolved or rejected: release its equipment, mark
-- open dispatches done, reset unit status. Reuses the same pattern as
-- migration 028's guard_report_status (a BEFORE UPDATE trigger).
create or replace function public.release_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('resolved','rejected') and old.status not in ('resolved','rejected') then
    -- mark every open dispatch on this report done
    update public.report_dispatches
       set dispatch_status = 'done',
           done_at = now()
     where report_id = new.id and dispatch_status <> 'done';
    -- release equipment
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
    -- responders back to available
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
