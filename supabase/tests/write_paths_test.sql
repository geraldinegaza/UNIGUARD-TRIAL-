-- ============================================================================
--  UniGuard · write-path test (after migrations 026 + 122-153)
--
--  Runs every save the app makes, with the values it sends, as the role that
--  makes it. Everything
--  runs inside one transaction that is rolled back, so nothing is written.
--  Replaces upstream docs/RLS-TEST.sql, which put BEGIN/EXCEPTION blocks in
--  plain SQL (only valid inside PL/pgSQL) and could not run.
--
--  Fill the :ids below with real accounts before running on a live project,
--  or run it as-is on the scratch database used by the upgrade test.
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
  if c is distinct from true then raise exception 'SECURITY TEST FAILED: %', label; end if;
  raise notice 'ok  %', label;
end $$;
-- runs a write and returns how many rows it changed (row security filters
-- silently, so a blocked write changes 0 rows rather than raising)
create or replace function pg_temp.rows_changed(stmt text) returns int language plpgsql as $$
declare n int;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when others then
    return 0;
  end;
  return n;
end $$;
-- runs a statement and passes only if it raises
create or replace function pg_temp.must_fail(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok  % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'SECURITY TEST FAILED: % (statement succeeded)', label;
end $$;

-- fixtures, written as the trusted backend ------------------------------------
select pg_temp.as_backend();
create temp table t_ids as
select (select id from public.profiles where email = 'resident1@example.com') as citizen,
       (select id from public.profiles where email = 'resident2@example.com') as citizen2,
       (select id from public.profiles where email = 'official@example.com') as official,
       (select id from public.profiles where email = 'lgu@example.com') as lgu,
       (select id from public.profiles where is_super_admin and email = 'test-admin@example.com') as superadmin;
grant select on t_ids to authenticated;

insert into public.dispatch_units (name, unit_type, contact_number, address)
values ('Test BFP Unit', 'BFP', '0917 000 0000', 'Lingayen') on conflict do nothing;
update public.profiles set role = 'dispatch_team',
       dispatch_unit_id = (select id from public.dispatch_units where name = 'Test BFP Unit'), unit_role = 'unit_admin'
 where email = 'test-dispatch@example.com';
create temp table t_unit as select id as unit, (select id from public.profiles where email = 'test-dispatch@example.com') as member
  from public.dispatch_units where name = 'Test BFP Unit';
grant select on t_unit to authenticated;

-- a fresh report in another barangay (as its resident)
update public.profiles set barangay = 'Baay', barangay_id = (select id from public.barangays where name = 'Baay')
 where email = 'resident3@example.com';
select pg_temp.as_user((select id from public.profiles where email = 'resident3@example.com'));
insert into public.reports (reporter_id, hazard_type, description, barangay, severity, urgency, lat, lng)
select auth.uid(), 'Fire', 'House fire near the chapel', 'Baay', 'emergency', 'emergency', g.centroid_lat, g.centroid_lng
  from public.barangay_geoms g join public.barangays b on b.id = g.barangay_id where b.name = 'Baay';
select pg_temp.as_backend();
create temp table t_rep as
select (select id from public.reports where description = 'House fire near the chapel') as baay_report,
       (select id from public.reports where status = 'reported' and barangay = 'Poblacion' limit 1) as pob_pending,
       (select id from public.reports where status = 'verified' and barangay = 'Poblacion' limit 1) as pob_verified;
grant select on t_rep to authenticated;
select pg_temp.ok((select barangay from public.reports where id = (select baay_report from t_rep)) = 'Baay',
                  'a report is routed to the barangay of its coordinates');


-- ======================================================================
-- Write paths: every save the app makes, with the exact values it sends,
-- as the role that makes it. A failure here means a button that looks
-- like it works in the browser but is refused by the real database.
-- ======================================================================
create or replace function pg_temp.saves(stmt text, label text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute stmt;
    get diagnostics n = row_count;
  exception when others then
    raise exception 'WRITE PATH FAILED: % (%)', label, sqlerrm;
  end;
  if n = 0 and stmt !~* '^\s*select' then raise exception 'WRITE PATH FAILED: % (0 rows, row security refused it)', label; end if;
  raise notice 'ok  %', label;
end $$;

-- resident --------------------------------------------------------------------
select pg_temp.as_user((select citizen from t_ids));
select pg_temp.saves($$insert into public.reports (hazard_type, hazard_other_text, barangay, description, severity, urgency, lat, lng, photo_path)
  select 'flood', null, 'Poblacion', 'Knee-deep water near the plaza', 'warning', 'warning', g.centroid_lat, g.centroid_lng, null
  from public.barangay_geoms g join public.barangays b on b.id = g.barangay_id where b.name = 'Poblacion'$$, 'resident files a report');
select pg_temp.saves($$insert into public.reports (hazard_type, hazard_other_text, barangay, description, severity, urgency, lat, lng)
  select 'other', 'Sinkhole on the road', 'Poblacion', 'A sinkhole opened', 'advisory', 'advisory', g.centroid_lat, g.centroid_lng
  from public.barangay_geoms g join public.barangays b on b.id = g.barangay_id where b.name = 'Poblacion'$$, 'resident files an "Others" report');
select pg_temp.saves($$select public.submit_sos(16.02, 120.23, 12, '')$$, 'resident sends an SOS');
select pg_temp.saves($$update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null$$, 'resident marks notifications read')
  where exists (select 1 from public.notifications where user_id = (select citizen from t_ids) and read_at is null);
select pg_temp.saves($$insert into public.alert_acknowledgments (advisory_id) select id from public.advisories where citywide limit 1$$, 'resident acknowledges an emergency alert');
select pg_temp.saves($$select public.save_push_subscription('https://push.example/1', 'k', 'a', 'test')$$, 'resident turns on push alerts');
select pg_temp.ok((select count(*) from public.push_subscriptions) = 1, 'the subscription is saved for the resident');

-- second resident corroborates the first resident's report
select pg_temp.as_user((select citizen2 from t_ids));
select pg_temp.saves($$select public.corroborate_report((select id from public.reports_feed where description = 'Knee-deep water near the plaza'), '')$$,
                     'another resident confirms a report');

-- barangay official -----------------------------------------------------------
select pg_temp.as_user((select official from t_ids));
select pg_temp.saves($$insert into public.advisories (author_id, title, body, severity, kind, affected_area, citywide, published_at)
  values (auth.uid(), 'Flood watch', 'Stay alert', 'warning', 'emergency', 'Poblacion', false, now())$$, 'official publishes a barangay advisory');
select pg_temp.saves($$insert into public.advisory_targets (advisory_id, barangay_id)
  select id, public.my_barangay_id() from public.advisories where title = 'Flood watch'$$, 'official targets it at their barangay');
select pg_temp.saves($$select public.fanout_advisory((select id from public.advisories where title = 'Flood watch'))$$, 'official sends its notifications');
select pg_temp.saves($$update public.evacuation_centers set occupancy = 40, status = 'open', facilities = array['Toilets','Kitchen'],
  contact_person = 'Ana', contact_phone = '0917 000 0000' where barangay_id = public.my_barangay_id()$$, 'official updates their shelter, facilities and contact')
  where exists (select 1 from public.evacuation_centers c join public.profiles p on p.barangay_id = c.barangay_id where p.id = (select official from t_ids));
select pg_temp.saves($$insert into public.relief_distributions (title, barangay, barangay_id, location_name, distribution_at, eligibility, required_docs, contact_phone, active)
  values ('Food packs', 'Poblacion', public.my_barangay_id(), 'Covered court', now() + interval '1 day', '["All households"]'::jsonb, '["Valid ID"]'::jsonb, '0917', true)$$,
  'official schedules a relief distribution');
select pg_temp.saves($$insert into public.authorized_beneficiaries (barangay, beneficiary_name, claimant_name, claimant_id, category, barangay_id)
  values ('Poblacion', 'Juan Cruz', 'Maria Cruz', 'CTRL-1', '4Ps / Indigent', public.my_barangay_id())$$, 'official adds an authorized beneficiary');
select pg_temp.saves($$insert into public.road_status (road_name, barangay, status, note, lat, lng, segment_from, segment_to, cause, severity, started_at, estimated_reopen, updated_by)
  values ('Avenida Rizal', 'Poblacion', 'one_lane', 'Flooded', null, null, 'Plaza', 'Bridge', 'flood', 'Major', now(), now() + interval '6 hours', auth.uid())$$,
  'official posts a road status with segment, cause and severity');

-- LDRRMO ---------------------------------------------------------------------
select pg_temp.as_user((select lgu from t_ids));
select pg_temp.saves($$insert into public.advisories (author_id, title, body, severity, kind, affected_area, citywide, published_at)
  values (auth.uid(), 'Signal No. 2', 'Move to shelters', 'emergency', 'emergency', 'Municipality-wide', true, now())$$, 'LDRRMO publishes a municipal advisory');
select pg_temp.saves($$select public.fanout_advisory((select id from public.advisories where title = 'Signal No. 2'))$$, 'LDRRMO sends it to every resident');
select pg_temp.saves($$insert into public.evacuation_centers (name, barangay, barangay_id, address, capacity, occupancy, status, note, lat, lng, facilities, contact_person, contact_phone)
  values ('Test Shelter', 'Poblacion', (select id from public.barangays where name = 'Poblacion'), 'Main St', 200, 0, 'open', '', 16.02, 120.23, array['Toilets'], 'Ana', '0917')$$,
  'LDRRMO adds a shelter');
select pg_temp.saves($$insert into public.preparedness_guides (hazard_type, phase, title, body, summary, body_before, author_id)
  values ('Flood', 'all', 'Test guide', 'Pack a go bag', 'Pack a go bag', 'Pack a go bag', auth.uid())$$, 'LDRRMO writes a guide');
select pg_temp.saves($$update public.preparedness_guides set body_during = 'Move to higher ground' where title = 'Test guide'$$, 'LDRRMO adds the During section');
select pg_temp.saves($$insert into public.faqs (question, answer, category) values ('Where do I go?', 'To the nearest shelter', 'General')$$, 'LDRRMO adds an FAQ');
select pg_temp.saves($$insert into public.road_work_posts (title, description, barangay, road_name, address, lat, lng, expected_start, expected_end, citywide, author_id)
  values ('Road clearing', 'Avoid', '', 'Avenida Rizal', '', null, null, now(), now() + interval '6 hours', true, auth.uid())$$, 'LDRRMO posts road work');
select pg_temp.saves($$select public.fanout_road_work((select id from public.road_work_posts where title = 'Road clearing'))$$, 'LDRRMO notifies residents of road work');
select pg_temp.saves($$select public.advance_report_status((select id from public.reports where description = 'Knee-deep water near the plaza'), 'rejected', 'Duplicate')$$,
                     'LDRRMO rejects a report');

-- Super Admin -----------------------------------------------------------------
select pg_temp.as_user((select superadmin from t_ids));
select pg_temp.saves($$insert into public.emergency_hotlines (agency_name, contact_number, scope) values ('Coast Guard Lingayen', '0917 222 3333', 'Municipality-wide')$$,
                     'Super Admin adds a hotline directly');
select pg_temp.saves($$update public.emergency_hotlines set contact_number = '0917 222 4444' where agency_name = 'Coast Guard Lingayen'$$, 'Super Admin edits a hotline');

-- dispatch unit admin -----------------------------------------------------------
select pg_temp.as_user((select member from t_unit));
select pg_temp.saves($$insert into public.unit_personnel (unit_id, name, role, phone) values (public.my_unit_id(), 'Juan', 'Driver', '0917')$$, 'unit admin adds crew');
select pg_temp.saves($$insert into public.dispatch_equipment (owner_unit_id, custom_label, identifier) values (public.my_unit_id(), 'Fire truck', 'SFP 1')$$, 'unit admin adds equipment');

-- deletes and read markers ------------------------------------------------------
select pg_temp.as_user((select citizen from t_ids));
select pg_temp.saves($$update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null$$, 'resident marks their notifications read');
select pg_temp.as_user((select official from t_ids));
select pg_temp.saves($$delete from public.authorized_beneficiaries where claimant_id = 'CTRL-1'$$, 'official removes a beneficiary');
select pg_temp.saves($$delete from public.road_status where road_name = 'Avenida Rizal' and segment_from = 'Plaza'$$, 'official removes their road status');
select pg_temp.saves($$update public.relief_distributions set location_name = 'Barangay hall' where title = 'Food packs'$$, 'official edits their relief schedule');
select pg_temp.as_user((select lgu from t_ids));
select pg_temp.saves($$update public.faqs set answer = 'To the nearest open shelter' where question = 'Where do I go?'$$, 'LDRRMO edits an FAQ');
select pg_temp.saves($$delete from public.faqs where question = 'Where do I go?'$$, 'LDRRMO deletes an FAQ');
select pg_temp.saves($$update public.evacuation_centers set status = 'full' where name = 'Test Shelter'$$, 'LDRRMO marks a shelter full');
select pg_temp.as_user((select superadmin from t_ids));
select pg_temp.saves($$delete from public.emergency_hotlines where agency_name = 'Coast Guard Lingayen'$$, 'Super Admin deletes a hotline');

-- Super Admin and dispatch console (reference build) ---------------------------
select pg_temp.as_user((select superadmin from t_ids));
select pg_temp.saves($$update public.reports set hazard_type = 'flood', severity = 'emergency', description = 'Corrected by the Super Admin'
  where id = (select pob_pending from t_rep)$$, 'Super Admin corrects an incident record');
select pg_temp.saves($$update public.profiles set full_name = 'Kap. Santos', phone = '0917 000 1111' where email = 'official@example.com'$$,
                     'Super Admin edits an account name and phone');
select pg_temp.as_user((select member from t_unit));
select pg_temp.saves($$select public.record_equipment_check((select id from public.dispatch_equipment where owner_unit_id = public.my_unit_id() limit 1), 'needs_repair', '40%', 'Leaking hose')$$,
                     'unit admin records a readiness check with level and notes');
select pg_temp.saves($$select public.set_equipment_status((select id from public.dispatch_equipment where owner_unit_id = public.my_unit_id() limit 1), 'maintenance', null, 'At the shop')$$,
                     'unit admin sets equipment status with a note');
select pg_temp.saves($$select public.set_personnel_duty((select id from public.unit_personnel where unit_id = public.my_unit_id() limit 1), true, now(), null)$$,
                     'unit admin clocks a crew member in');
select pg_temp.saves($$select public.create_unit_request(public.my_unit_id(), 'other', 'Generator for the station')$$, 'unit sends a support request');
select pg_temp.as_user((select superadmin from t_ids));
select pg_temp.saves($$select public.delete_dispatch_unit((select unit from t_unit))$$, 'Super Admin deletes a dispatch unit');
select pg_temp.ok((select role from public.profiles where id = (select member from t_unit)) = 'citizen', 'its member account becomes a resident');

rollback;
