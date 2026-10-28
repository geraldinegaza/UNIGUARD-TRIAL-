-- ============================================================================
--  UniGuard · dispatch console test (after migration 155)
--
--  Runs every dispatch console action as the account that makes it: the
--  per-team steps, Can't respond, Need help, field data, the after-action
--  report, PNP road closures and relief escorts, hospital notices, and
--  equipment add / edit / retire / remove. Also checks what each account must
--  NOT be able to do. Everything runs inside one transaction that is rolled
--  back, so nothing is written.
-- ============================================================================
begin;

create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.as_backend() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create or replace function pg_temp.ok(c boolean, label text) returns void language plpgsql as $$
begin
  if c is distinct from true then raise exception 'DISPATCH TEST FAILED: %', label; end if;
  raise notice 'ok  %', label;
end $$;
create or replace function pg_temp.saves(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise exception 'DISPATCH TEST FAILED: % (%)', label, sqlerrm;
  end;
  raise notice 'ok  %', label;
end $$;
create or replace function pg_temp.must_fail(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok  % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'DISPATCH TEST FAILED: % (statement succeeded)', label;
end $$;

-- fixtures, written as the trusted backend ------------------------------------
select pg_temp.as_backend();

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1', 'bfp-admin@example.com',   '{"full_name":"BFP Admin"}'),
 ('00000000-0000-0000-0000-0000000000a2', 'bfp-member@example.com',  '{"full_name":"BFP Member"}'),
 ('00000000-0000-0000-0000-0000000000a3', 'pnp-member@example.com',  '{"full_name":"PNP Member"}'),
 ('00000000-0000-0000-0000-0000000000a4', 'rescue@example.com',      '{"full_name":"Rescue Lead"}'),
 ('00000000-0000-0000-0000-0000000000a5', 'hospital@example.com',    '{"full_name":"Hospital Desk"}'),
 ('00000000-0000-0000-0000-0000000000a6', 'bfp-disabled@example.com','{"full_name":"BFP Disabled"}'),
 ('00000000-0000-0000-0000-0000000000a7', 'hospital2@example.com',   '{"full_name":"Divert Desk"}');

insert into public.dispatch_units (name, unit_type, contact_number, address) values
 ('T BFP', 'BFP', '1', ''), ('T PNP', 'PNP', '2', ''), ('T Rescue', 'Rescue', '3', ''),
 ('T Hospital', 'Hospital', '4', ''), ('T Hospital Divert', 'Hospital', '5', '');
insert into public.hospital_capacity (unit_id, er_beds, icu_beds, available, accepting)
select id, 5, 2, 3, name = 'T Hospital' from public.dispatch_units where name in ('T Hospital', 'T Hospital Divert');

update public.profiles p set role = 'dispatch_team', dispatch_unit_id = u.id, unit_role = x.unit_role, disabled = x.disabled
  from (values
    ('bfp-admin@example.com', 'T BFP', 'unit_admin', false),
    ('bfp-member@example.com', 'T BFP', 'member', false),
    ('pnp-member@example.com', 'T PNP', 'member', false),
    ('rescue@example.com', 'T Rescue', 'unit_admin', false),
    ('hospital@example.com', 'T Hospital', 'unit_admin', false),
    ('hospital2@example.com', 'T Hospital Divert', 'unit_admin', false),
    ('bfp-disabled@example.com', 'T BFP', 'unit_admin', true)
  ) as x(email, unit, unit_role, disabled)
  join public.dispatch_units u on u.name = x.unit
 where p.email = x.email;

create temp table t as
select (select id from public.profiles where email = 'bfp-admin@example.com')    as bfp_admin,
       (select id from public.profiles where email = 'bfp-member@example.com')   as bfp_member,
       (select id from public.profiles where email = 'pnp-member@example.com')   as pnp,
       (select id from public.profiles where email = 'rescue@example.com')       as rescue,
       (select id from public.profiles where email = 'hospital@example.com')     as hospital,
       (select id from public.profiles where email = 'bfp-disabled@example.com') as disabled,
       (select id from public.profiles where email = 'lgu@example.com')          as lgu,
       (select id from public.profiles where email = 'resident1@example.com')    as resident,
       (select id from public.dispatch_units where name = 'T BFP')               as u_bfp,
       (select id from public.dispatch_units where name = 'T PNP')               as u_pnp,
       (select id from public.dispatch_units where name = 'T Rescue')            as u_rescue,
       (select id from public.dispatch_units where name = 'T Hospital')          as u_hosp,
       (select id from public.dispatch_units where name = 'T Hospital Divert')   as u_divert,
       (select id from public.reports where reporter_id = (select id from public.profiles where email = 'resident1@example.com') order by created_at limit 1) as report;
grant select on t to authenticated;

-- one dispatch per team, plus spares for declining
insert into public.report_dispatches (report_id, team, instructions, dispatched_by, dispatched_by_name, unit_id, eta)
select t.report, x.team, x.tag, t.lgu, 'LGU Staff', x.unit, now() + interval '15 minutes'
  from t, lateral (values
    ('BFP', 'bfp', t.u_bfp), ('BFP', 'bfp-decline', t.u_bfp), ('BFP', 'bfp-late', t.u_bfp),
    ('PNP', 'pnp', t.u_pnp), ('Rescue Unit', 'rescue', t.u_rescue), ('Ambulance', 'amb', t.u_hosp)
  ) as x(team, tag, unit);
create temp table d as
select (select id from public.report_dispatches where instructions = 'bfp')         as bfp,
       (select id from public.report_dispatches where instructions = 'bfp-decline') as bfp_decline,
       (select id from public.report_dispatches where instructions = 'bfp-late')    as bfp_late,
       (select id from public.report_dispatches where instructions = 'pnp')         as pnp,
       (select id from public.report_dispatches where instructions = 'rescue')      as rescue,
       (select id from public.report_dispatches where instructions = 'amb')         as amb;
grant select on d to authenticated;

insert into public.evacuation_centers (name, barangay, address, capacity, status, needs_patrol, needs_patrol_at)
values ('T Shelter', 'Poblacion', '', 100, 'open', true, now());
insert into public.relief_distributions (title, barangay, barangay_id, location_name, distribution_at, active)
select 'T Relief', 'Poblacion', id, 'Plaza', now(), true from public.barangays where name = 'Poblacion';
create temp table r as select id as relief from public.relief_distributions where title = 'T Relief';
grant select on r to authenticated;

-- disabled accounts --------------------------------------------------------------
select pg_temp.as_user((select disabled from t));
select pg_temp.must_fail($$select public.dispatch_respond((select bfp from d), 'acknowledged', '')$$, 'a disabled account cannot respond');
select pg_temp.must_fail($$select public.add_equipment((select u_bfp from t), null, null, 'Pump', '', 'unknown', '')$$, 'a disabled account cannot add equipment');

-- BFP: on_scene -> under_control -> fire_out -> done ---------------------------
select pg_temp.as_user((select bfp_member from t));
select pg_temp.saves($$select public.dispatch_respond((select bfp from d), 'acknowledged', '')$$, 'BFP acknowledges');
select pg_temp.must_fail($$select public.dispatch_respond((select bfp from d), 'under_control', '')$$, 'BFP cannot skip to under control');
select pg_temp.saves($$select public.dispatch_respond((select bfp from d), 'en_route', '')$$, 'BFP en route');
select pg_temp.saves($$select public.dispatch_respond((select bfp from d), 'on_scene', '')$$, 'BFP on scene');
select pg_temp.saves($$select public.dispatch_respond((select bfp from d), 'under_control', 'Contained')$$, 'BFP fire under control');
select pg_temp.saves($$select public.dispatch_respond((select bfp from d), 'fire_out', '')$$, 'BFP fire out');
select pg_temp.must_fail($$select public.submit_after_action((select bfp from d), 'Early', '{}')$$, 'no after-action before Done');
select pg_temp.saves($$select public.dispatch_respond((select bfp from d), 'done', '')$$, 'BFP done');
select pg_temp.must_fail($$select public.submit_after_action((select bfp from d), 'Report', '{"rescued":3}')$$, 'after-action refuses a key the team does not have');
select pg_temp.saves($$select public.submit_after_action((select bfp from d), 'House fire out',
  '{"people_assisted":4,"follow_up_needed":true,"follow_up_note":"Check wiring","families_displaced":2,"people_injured":1}')$$, 'BFP files the after-action with its own fields');
select pg_temp.ok((select after_action_meta ? 'times' and after_action_meta ? 'equipment_used' and (after_action_meta->>'families_displaced')::int = 2
                     from public.report_dispatches where id = (select bfp from d)), 'after-action keeps the fields and adds times and equipment');
select pg_temp.as_backend();
select pg_temp.ok((select count(*) = 1 from public.notifications where user_id = (select reporter_id from public.reports where id = (select report from t)) and title = 'Fire under control'), 'the reporter hears "fire under control"');
select pg_temp.as_user((select bfp_member from t));

-- Can't respond -----------------------------------------------------------------
select pg_temp.must_fail($$select public.decline_dispatch((select bfp_decline from d), '  ')$$, 'declining needs a reason');
select pg_temp.as_user((select pnp from t));
select pg_temp.must_fail($$select public.decline_dispatch((select bfp_decline from d), 'Busy')$$, 'another unit cannot decline');
select pg_temp.as_user((select bfp_member from t));
select pg_temp.saves($$select public.decline_dispatch((select bfp_decline from d), 'Truck in the shop')$$, 'BFP declines with a reason');
select pg_temp.ok((select dispatch_status = 'declined' and decline_reason = 'Truck in the shop' from public.report_dispatches where id = (select bfp_decline from d)), 'the dispatch is declined with its reason');
select pg_temp.as_backend();
select pg_temp.ok((select count(*) = 1 from public.notifications where user_id = (select lgu from t) and type = 'dispatch_declined'), 'the dispatcher is told to pick another team, once');
select pg_temp.as_user((select bfp_member from t));
select pg_temp.must_fail($$select public.dispatch_respond((select bfp_decline from d), 'acknowledged', '')$$, 'a declined dispatch is closed');
select pg_temp.saves($$select public.dispatch_respond((select bfp_late from d), 'acknowledged', '')$$, 'BFP acknowledges another dispatch');
select pg_temp.saves($$select public.dispatch_respond((select bfp_late from d), 'en_route', '')$$, 'BFP en route on it');
select pg_temp.must_fail($$select public.decline_dispatch((select bfp_late from d), 'Too late')$$, 'cannot decline once en route');

-- Need help ---------------------------------------------------------------------
select pg_temp.saves($$select public.create_help_request((select bfp_late from d), 'water_tanker', 'Requesting a water tanker on this dispatch.')$$, 'BFP asks for a water tanker');
select pg_temp.must_fail($$select public.create_help_request((select bfp_late from d), 'helicopter', 'x')$$, 'unknown help kind refused');
select pg_temp.must_fail($$select public.create_help_request((select bfp from d), 'general', 'x')$$, 'no help request on a closed dispatch');
select pg_temp.ok((select count(*) = 1 from public.dispatch_help_requests where dispatch_id = (select bfp_late from d)), 'the unit reads its own help request');
select pg_temp.must_fail($$select public.update_help_request((select id from public.dispatch_help_requests limit 1), 'acknowledged')$$, 'a unit cannot acknowledge its own help request');
select pg_temp.as_user((select pnp from t));
select pg_temp.ok((select count(*) = 0 from public.dispatch_help_requests), 'another unit does not see the help request');
select pg_temp.as_user((select lgu from t));
select pg_temp.saves($$select public.update_help_request((select id from public.dispatch_help_requests where dispatch_id = (select bfp_late from d)), 'acknowledged')$$, 'LGU acknowledges the help request');
select pg_temp.saves($$select public.update_help_request((select id from public.dispatch_help_requests where dispatch_id = (select bfp_late from d)), 'resolved')$$, 'LGU resolves the help request');
select pg_temp.as_backend();
select pg_temp.ok((select count(*) = 2 from public.notifications where user_id = (select bfp_member from t) and type = 'dispatch_help'), 'the unit hears about both updates');

-- Rescue: on hold needs a reason, resume returns on scene ----------------------
select pg_temp.as_user((select rescue from t));
select pg_temp.saves($$select public.dispatch_respond((select rescue from d), 'acknowledged', '')$$, 'Rescue acknowledges');
select pg_temp.saves($$select public.update_dispatch_field_data((select rescue from d),
  '{"rescue_details":{"stranded_count":5,"location":"Rooftop","special_needs":"Elderly"},"rescue_tally":{"rescued":0,"injured":0,"missing":0,"destinations":[]}}')$$, 'Rescue saves rescue details');
select pg_temp.must_fail($$select public.update_dispatch_field_data((select rescue from d), '{"checklist_done":[]}')$$, 'Rescue cannot write the barangay checklist');
select pg_temp.saves($$select public.dispatch_respond((select rescue from d), 'en_route', '')$$, 'Rescue en route');
select pg_temp.must_fail($$select public.dispatch_respond((select rescue from d), 'on_hold', '')$$, 'on hold needs a reason');
select pg_temp.saves($$select public.dispatch_respond((select rescue from d), 'on_hold', 'Current too strong')$$, 'Rescue on hold with a reason');
select pg_temp.ok((select dispatch_status = 'on_hold' and hold_reason = 'Current too strong' from public.report_dispatches where id = (select rescue from d)), 'the hold reason is kept');
select pg_temp.saves($$select public.dispatch_respond((select rescue from d), 'resume', '')$$, 'Rescue resumes');
select pg_temp.ok((select dispatch_status = 'on_scene' and hold_reason = '' and on_scene_at is not null from public.report_dispatches where id = (select rescue from d)), 'resume puts the rescue back on scene');
select pg_temp.saves($$select public.send_patient_notice((select u_hosp from t), (select report from t), 2, 'Hypothermia', null)$$, 'Rescue sends a patient notice to an accepting hospital');
select pg_temp.must_fail($$select public.send_patient_notice((select u_divert from t), (select report from t), 1, 'x', null)$$, 'a hospital on divert is refused');
select pg_temp.saves($$select public.dispatch_respond((select rescue from d), 'done', '')$$, 'Rescue done');

-- Ambulance: transporting needs an accepting hospital --------------------------
select pg_temp.as_user((select hospital from t));
select pg_temp.saves($$select public.dispatch_respond((select amb from d), 'acknowledged', '')$$, 'Ambulance acknowledges');
select pg_temp.saves($$select public.dispatch_respond((select amb from d), 'on_scene', '')$$, 'Ambulance on scene');
select pg_temp.must_fail($$select public.dispatch_respond((select amb from d), 'transporting', '')$$, 'no transporting without a hospital');
select pg_temp.must_fail($$select public.update_dispatch_field_data((select amb from d), '{"hospital_id":"00000000-0000-0000-0000-000000000000"}')$$, 'an unknown hospital is refused');
select pg_temp.saves($$select public.update_dispatch_field_data((select amb from d), jsonb_build_object('hospital_id', (select u_divert from t)))$$, 'Ambulance picks a hospital');
select pg_temp.must_fail($$select public.dispatch_respond((select amb from d), 'transporting', '')$$, 'no transporting to a hospital on divert');
select pg_temp.saves($$select public.update_dispatch_field_data((select amb from d), jsonb_build_object('hospital_id', (select u_hosp from t)))$$, 'Ambulance picks an accepting hospital');
select pg_temp.saves($$select public.dispatch_respond((select amb from d), 'transporting', '')$$, 'Ambulance transporting');
select pg_temp.saves($$select public.dispatch_respond((select amb from d), 'arrived_hospital', '')$$, 'Ambulance arrived at hospital');
select pg_temp.saves($$select public.dispatch_respond((select amb from d), 'done', '')$$, 'Ambulance done');
select pg_temp.must_fail($$select public.submit_after_action((select amb from d), 'x', '{"families_displaced":1}')$$, 'BFP-only after-action fields are refused for an ambulance');

-- hospital notices: acknowledge, arrived, cancel --------------------------------
select pg_temp.saves($$select public.ack_patient_notice((select id from public.patient_notices where condition = 'Hypothermia'), 'acknowledged')$$, 'hospital acknowledges the notice');
select pg_temp.saves($$select public.ack_patient_notice((select id from public.patient_notices where condition = 'Hypothermia'), 'arrived')$$, 'hospital marks the patient arrived');
select pg_temp.must_fail($$select public.ack_patient_notice((select id from public.patient_notices where condition = 'Hypothermia'), 'cancelled')$$, 'an arrived notice cannot be cancelled');
select pg_temp.as_backend();
insert into public.patient_notices (unit_id, patients, condition, sent_by, status)
select u_hosp, 1, 'Fracture', lgu, 'sent' from t;
create temp table pn as select id from public.patient_notices where condition = 'Fracture';
grant select on pn to authenticated;
select pg_temp.as_user((select pnp from t));
select pg_temp.must_fail($$select public.ack_patient_notice((select id from pn), 'acknowledged')$$, 'another unit cannot touch the hospital''s notice');
select pg_temp.as_user((select hospital from t));
select pg_temp.saves($$select public.ack_patient_notice((select id from pn), 'cancelled')$$, 'hospital cancels a notice that is still open');
select pg_temp.as_user((select pnp from t));

-- PNP: road closure, patrol shelters, relief escort -----------------------------
select pg_temp.saves($$select public.dispatch_respond((select pnp from d), 'acknowledged', '')$$, 'PNP acknowledges');
select pg_temp.saves($$select public.post_road_closure((select pnp from d), 'Rizal St', 'Detour via Mabini', null, null, 'Purok 1', 'Junction', null)$$, 'PNP posts a road closure');
select pg_temp.ok((select status = 'blocked' and cause = 'accident' from public.road_status where dispatch_id = (select pnp from d)), 'the closure is on the road status list');
select pg_temp.saves($$select public.reopen_road_closure((select pnp from d))$$, 'PNP reopens the road');
select pg_temp.must_fail($$select public.reopen_road_closure((select pnp from d))$$, 'nothing left to reopen');
select pg_temp.ok((select count(*) = 1 from public.evacuation_centers where needs_patrol), 'PNP reads the shelters that need a patrol');
select pg_temp.ok((select count(*) = 0 from public.relief_distributions where title = 'T Relief'), 'PNP does not read a relief distribution with no escort requested');
select pg_temp.must_fail($$select public.confirm_relief_escort((select relief from r))$$, 'nothing to confirm before a request');
select pg_temp.as_user((select bfp_member from t));
select pg_temp.must_fail($$select public.post_road_closure((select bfp_late from d), 'X', '', null, null, '', '', null)$$, 'a BFP unit cannot post a road closure');
select pg_temp.as_user((select lgu from t));
select pg_temp.saves($$select public.request_relief_escort((select relief from r), 'Crowd expected')$$, 'LGU requests a relief escort');
select pg_temp.as_user((select pnp from t));
select pg_temp.ok((select count(*) = 1 from public.relief_distributions where title = 'T Relief' and escort_status = 'requested'), 'PNP reads the escort request');
select pg_temp.saves($$select public.confirm_relief_escort((select relief from r))$$, 'PNP confirms the escort');
select pg_temp.as_user((select bfp_member from t));
select pg_temp.ok((select count(*) = 0 from public.relief_distributions where title = 'T Relief'), 'a BFP account still does not read it');
select pg_temp.must_fail($$select public.confirm_relief_escort((select relief from r))$$, 'a BFP account cannot confirm an escort');

-- equipment: add / edit / retire / remove -----------------------------------------
select pg_temp.must_fail($$select public.add_equipment((select u_bfp from t), null, null, 'Pump', '', 'unknown', '')$$, 'a member cannot add equipment');
select pg_temp.as_user((select bfp_admin from t));
select pg_temp.must_fail($$select public.add_equipment((select u_pnp from t), null, null, 'Pump', '', 'unknown', '')$$, 'a unit admin cannot add to another unit');
select pg_temp.must_fail($$select public.add_equipment((select u_bfp from t), null, (select id from public.equipment_catalog where unit_type = 'PNP' limit 1), '', '', 'unknown', '')$$, 'a catalog type from another unit type is refused');
select pg_temp.must_fail($$select public.add_equipment((select u_bfp from t), null, null, '  ', '', 'unknown', '')$$, 'Other (custom) needs a label');
select pg_temp.saves($$select public.add_equipment((select u_bfp from t), null, (select id from public.equipment_catalog where unit_type = 'BFP' and label = 'Fire Truck'), '', 'Engine 2', 'ready', 'New')$$, 'unit admin adds a catalog fire truck');
select pg_temp.ok((select custom_label = 'Fire Truck' and identifier = 'Engine 2' from public.dispatch_equipment where identifier = 'Engine 2'), 'the catalog label is filled in');
select pg_temp.saves($$select public.add_equipment((select u_bfp from t), null, null, 'Portable Pump', 'P-1', 'unknown', '')$$, 'unit admin adds custom equipment');
select pg_temp.saves($$select public.update_equipment((select id from public.dispatch_equipment where identifier = 'P-1'), '', 'Portable Pump 2', 'ready', '')$$, 'unit admin edits it, clearing the tag');
select pg_temp.ok((select identifier = '' and custom_label = 'Portable Pump 2' from public.dispatch_equipment where custom_label = 'Portable Pump 2'), 'the edit is saved');
select pg_temp.saves($$select public.record_equipment_check((select id from public.dispatch_equipment where identifier = 'Engine 2'), 'ready', '80%', 'Full tank')$$, 'a readiness check with a level');
select pg_temp.ok((select level = '80%' from public.equipment_checks order by checked_at desc limit 1), 'the level typed is saved');
select pg_temp.ok((select public.equipment_use_count((select id from public.dispatch_equipment where identifier = 'Engine 2')) = 0), 'the history count is zero');
select pg_temp.as_backend();
insert into public.dispatch_equipment_use (dispatch_id, equipment_id)
select (select bfp from d), id from public.dispatch_equipment where identifier = 'Engine 2';
select pg_temp.as_user((select bfp_admin from t));
select pg_temp.ok((select public.equipment_use_count((select id from public.dispatch_equipment where identifier = 'Engine 2')) = 1), 'the history count sees the dispatch');
select pg_temp.must_fail($$select public.remove_equipment((select id from public.dispatch_equipment where identifier = 'Engine 2'), false)$$, 'equipment with history cannot be deleted');
select pg_temp.saves($$select public.remove_equipment((select id from public.dispatch_equipment where identifier = 'Engine 2'), true)$$, 'it can be retired');
select pg_temp.ok((select status = 'unavailable' from public.dispatch_equipment where identifier = 'Engine 2'), 'retired equipment is unavailable');
select pg_temp.saves($$select public.remove_equipment((select id from public.dispatch_equipment where custom_label = 'Portable Pump 2'), false)$$, 'unused equipment can be deleted');
select pg_temp.as_user((select bfp_member from t));
select pg_temp.must_fail($$select public.update_equipment((select id from public.dispatch_equipment where identifier = 'Engine 2'), 'x', null, null, null)$$, 'a member cannot edit equipment');
select pg_temp.must_fail($$select public.remove_equipment((select id from public.dispatch_equipment where identifier = 'Engine 2'), true)$$, 'a member cannot retire equipment');

-- closing the report keeps a declined dispatch declined ----------------------------
select pg_temp.as_backend();
update public.reports set status = 'verified' where id = (select report from t) and status = 'reported';
update public.reports set status = 'dispatched' where id = (select report from t) and status = 'verified';
update public.reports set status = 'resolved' where id = (select report from t);
select pg_temp.ok((select dispatch_status = 'declined' from public.report_dispatches where id = (select bfp_decline from d)), 'closing the report keeps the declined dispatch declined');
select pg_temp.ok((select dispatch_status = 'done' from public.report_dispatches where id = (select bfp_late from d)), 'closing the report closes the open dispatch');
select pg_temp.ok((select status = 'available' from public.dispatch_units where id = (select u_bfp from t)), 'the unit is available again');

rollback;
