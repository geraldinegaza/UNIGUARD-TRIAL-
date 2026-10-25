-- ============================================================================
--  UniGuard · per-role security test (after migrations 026 + 122-153)
--
--  Impersonates each role and asserts what it can and cannot do. Everything
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

-- ---------------------------------------------------------------- citizen
select pg_temp.as_user((select citizen from t_ids));
select pg_temp.ok(public.current_role_key() = 'citizen', 'citizen role resolves from profiles');
select pg_temp.ok((select count(*) from public.reports where reporter_id is distinct from auth.uid()) = 0,
                  'citizen cannot read another resident''s report rows');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_name = 'reports_feed' and column_name = 'reporter_id'),
                  'reports_feed exposes no reporter identity');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'citizen sees only their own profile');
select pg_temp.ok((select count(*) from public.audit_log) = 0, 'citizen cannot read the activity log');
select pg_temp.ok((select count(*) from public.analytics_pipeline) = 0, 'citizen sees no analytics');
select pg_temp.must_fail($$update public.profiles set role = 'lgu_ldrrmc' where id = auth.uid()$$, 'citizen cannot change their own role');
update public.profiles set is_super_admin = true where id = auth.uid();  -- the guard quietly resets it
select pg_temp.ok(not public.is_super_admin() and not (select is_super_admin from public.profiles where id = auth.uid()),
                  'citizen cannot make themselves Super Admin');
select pg_temp.must_fail(format('select public.advance_report_status(%L, ''verified'', '''')', (select pob_pending from t_rep)), 'citizen cannot verify a report');
select pg_temp.ok(pg_temp.rows_changed($$update public.emergency_hotlines set contact_number = '0000' where true$$) = 0, 'citizen cannot edit hotlines');

-- --------------------------------------------------------- barangay official (Poblacion)
select pg_temp.as_user((select official from t_ids));
select pg_temp.ok(public.current_role_key() = 'barangay_official', 'official role resolves from profiles');
select pg_temp.ok((select count(*) from public.reports where barangay_id is distinct from public.my_barangay_id()) = 0,
                  'official sees only their own barangay''s reports');
select pg_temp.ok((select count(*) from public.reports where id = (select baay_report from t_rep)) = 0,
                  'official cannot see another barangay''s report');
select pg_temp.must_fail(format('select public.advance_report_status(%L, ''dispatched'', '''')', (select pob_pending from t_rep)),
                         'status cannot skip a step (reported -> dispatched)');
select public.advance_report_status((select pob_pending from t_rep), 'verified', 'checked on site');
select pg_temp.ok((select status from public.reports where id = (select pob_pending from t_rep)) = 'verified', 'official can verify one step');
select pg_temp.ok(pg_temp.rows_changed($$insert into public.advisories (title, body, severity, kind, citywide) values ('t','t','advisory','emergency', true)$$) = 0,
                  'official cannot publish a municipality-wide advisory');
select pg_temp.ok(pg_temp.rows_changed($$update public.emergency_hotlines set contact_number = '0000' where true$$) = 0, 'official cannot edit hotlines directly');
select public.submit_change_request('emergency_hotlines', 'edit',
  (select id from public.emergency_hotlines limit 1), '{}'::jsonb,
  '{"agency_name":"Lingayen MDRRMO","contact_number":"(075) 542-9999","scope":"Municipality-wide"}'::jsonb, 'new trunk line');
select pg_temp.ok((select count(*) from public.change_requests where status = 'pending') = 1, 'official can submit a hotline change request');
select pg_temp.ok((select count(*) from public.audit_log) = 0, 'official cannot read the activity log');

-- ---------------------------------------------------------------- LGU staff
select pg_temp.as_user((select lgu from t_ids));
select pg_temp.ok(public.current_role_key() = 'lgu_ldrrmc' and not public.is_super_admin(), 'LGU staff is not a Super Admin');
select pg_temp.ok((select count(*) from public.reports where id = (select baay_report from t_rep)) = 1, 'LGU sees every barangay');
select pg_temp.ok(pg_temp.rows_changed($$update public.profiles set role = 'barangay_official' where email = 'resident2@example.com'$$) = 0
                  and (select role from public.profiles where email = 'resident2@example.com') = 'citizen',
                  'LGU staff cannot change roles (Super Admin only)');
select pg_temp.must_fail(format('select public.approve_change_request(%L, '''')', (select id from public.change_requests limit 1)),
                         'LGU staff cannot approve change requests');
select pg_temp.ok((select count(*) from public.audit_log) = 0, 'LGU staff cannot read the activity log');

-- ---------------------------------------------------------------- Super Admin
select pg_temp.as_user((select superadmin from t_ids));
select pg_temp.ok(public.is_super_admin(), 'migrated super_admin account is a Super Admin');
select pg_temp.ok((select count(*) from public.audit_log) > 0, 'Super Admin reads the activity log');
select pg_temp.must_fail(format('select public.advance_report_status(%L, ''verified'', '''')', (select baay_report from t_rep)),
                         'Super Admin cannot verify reports');
select public.approve_change_request((select id from public.change_requests limit 1), 'confirmed with PLDT');
select pg_temp.ok((select h.contact_number from public.emergency_hotlines h join public.change_requests c on c.target_id = h.id limit 1) = '(075) 542-9999',
                  'approving a change request updates the hotline');
select pg_temp.ok((select status from public.change_requests limit 1) = 'approved', 'the request is marked approved');
update public.profiles set role = 'barangay_official',
       barangay_id = (select id from public.barangays where name = 'Baay'), barangay = 'Baay'
 where email = 'resident2@example.com';
select pg_temp.ok((select role from public.profiles where email = 'resident2@example.com') = 'barangay_official', 'Super Admin can change roles');

-- ---------------------------------------------------------------- dispatch team
select pg_temp.as_user((select member from t_unit));
select pg_temp.ok(public.current_role_key() = 'dispatch_team' and public.my_unit_id() = (select unit from t_unit), 'dispatch account resolves its unit');
select pg_temp.ok((select count(*) from public.report_dispatches) = 0, 'dispatch sees no dispatches before one is addressed to its unit');
select pg_temp.ok((select count(*) from public.audit_log) = 0, 'dispatch cannot read the activity log');

-- LGU dispatches the verified Poblacion report to that unit
select pg_temp.as_user((select lgu from t_ids));
select public.dispatch_report_v2((select pob_verified from t_rep), 'BFP', 'Proceed to the market', now() + interval '15 minutes',
                                 (select unit from t_unit), null, null);
select pg_temp.as_user((select member from t_unit));
select pg_temp.ok((select count(*) from public.report_dispatches) = 1, 'dispatch sees the dispatch addressed to its unit');
select pg_temp.ok((select count(*) from public.reports) = 1
                  and (select id from public.reports) = (select pob_verified from t_rep),
                  'dispatch reads only the report dispatched to its unit');

-- ------------------------------------------------- Phase 3 (migration 151)
-- the Baay report has waited two hours without barangay verification
select pg_temp.as_backend();
update public.reports set created_at = now() - interval '2 hours' where id = (select baay_report from t_rep);
insert into public.relief_inventory (name, category, unit, stock, reorder) values ('Test Food Pack', 'Food', 'packs', 20, 5);
create temp table t_item as select id from public.relief_inventory where name = 'Test Food Pack';
grant select on t_item to authenticated;

set local role anon;
select pg_temp.must_fail($$select count(*) from public.lgu_escalation_queue$$, 'a signed-out visitor cannot read the overdue queue');
select pg_temp.must_fail($$select count(*) from public.others_hazard_review$$, 'a signed-out visitor cannot read the Others review');
select pg_temp.as_backend();

select pg_temp.as_user((select citizen from t_ids));
select pg_temp.ok((select count(*) from public.lgu_escalation_queue) = 0, 'a resident sees nobody else''s overdue reports');
select pg_temp.must_fail($$select public.log_relief_distribution((select id from t_item), 1, 'Poblacion', '')$$, 'a resident cannot record a relief distribution');
select pg_temp.ok((select count(*) from public.situation_reports) = 0 and (select count(*) from public.relief_inventory) = 0,
                  'a resident cannot read situation reports or relief stock');

select pg_temp.as_user((select official from t_ids));
select pg_temp.ok((select count(*) from public.lgu_escalation_queue where id = (select baay_report from t_rep)) = 0,
                  'an official does not see another barangay''s overdue report');
select pg_temp.ok((select (public.log_relief_distribution((select id from t_item), 5, 'Poblacion', 'Dela Cruz household'))->>'stock') = '15',
                  'an official records goods for their barangay and the stock drops');
select pg_temp.must_fail($$select public.log_relief_distribution((select id from t_item), 1, 'Baay', '')$$, 'an official cannot record goods for another barangay');
select pg_temp.must_fail($$select public.log_relief_distribution((select id from t_item), 99, 'Poblacion', '')$$, 'a distribution larger than the stock is refused');
select pg_temp.ok(pg_temp.rows_changed($$insert into public.relief_distribution_log (item_id, item_name, qty, barangay) values ((select id from t_item), 'x', 1, 'Baay')$$) = 0,
                  'an official cannot write the distribution log directly');
select pg_temp.ok(pg_temp.rows_changed($$update public.relief_inventory set stock = 999 where true$$) = 0, 'an official cannot change the stock');
insert into public.damage_assessments (barangay_id, assessed_on, affected_families, affected_persons, status)
values (public.my_barangay_id(), current_date, 4, 15, 'submitted');
select pg_temp.ok((select count(*) from public.damage_assessments) = 1, 'an official files a damage assessment for their barangay');
select pg_temp.must_fail($$insert into public.damage_assessments (barangay_id, status) values (public.my_barangay_id(), 'validated')$$,
                         'an official cannot validate an assessment');
select pg_temp.must_fail($$insert into public.damage_assessments (barangay_id, status) values ((select id from public.barangays where name = 'Baay'), 'draft')$$,
                         'an official cannot file for another barangay');
insert into public.situation_reports (sitrep_no, event_name, barangay_id, summary) values (1, 'Test event', public.my_barangay_id(), '{"incidents": 1}');
select pg_temp.ok((select count(*) from public.situation_reports) = 1, 'an official saves a situation report for their barangay');

select pg_temp.as_user((select lgu from t_ids));
select pg_temp.ok((select count(*) from public.lgu_escalation_queue where id = (select baay_report from t_rep)) = 1,
                  'the LDRRMO sees a report unverified for over an hour, with no write needed');
select pg_temp.ok((select count(*) from public.relief_distribution_log where barangay = 'Poblacion') = 1, 'the LDRRMO reads the distribution log');
select pg_temp.ok(pg_temp.rows_changed($$update public.damage_assessments set status = 'validated' where true$$) = 1, 'the LDRRMO validates the assessment');

select pg_temp.as_user((select superadmin from t_ids));
select pg_temp.must_fail($$select public.lgu_verify_overdue_report((select baay_report from t_rep))$$, 'the Super Admin cannot verify an overdue report');

select pg_temp.as_user((select lgu from t_ids));
select public.lgu_verify_overdue_report((select baay_report from t_rep));
select pg_temp.ok((select status = 'verified' and verified_by_role = 'lgu_ldrrmc' from public.reports where id = (select baay_report from t_rep)),
                  'the LDRRMO verifies the overdue report, recorded as an LGU verification');
select pg_temp.ok((select count(*) from public.lgu_escalation_queue where id = (select baay_report from t_rep)) = 0,
                  'a verified report leaves the overdue queue');

-- ------------------------------------------------- Phase 4 (migration 152)
select pg_temp.as_backend();
set local role anon;
select pg_temp.ok((public.org_profile() ->> 'contact') is not null, 'anyone can read the MDRRMO name and hotline');
select pg_temp.as_backend();

create temp table t_adv as select id from public.advisories where citywide limit 1;
grant select on t_adv to authenticated;
select pg_temp.as_user((select citizen from t_ids));
select pg_temp.must_fail($$select public.fanout_advisory((select id from t_adv))$$,
                         'a resident cannot re-send an advisory''s notifications');
select pg_temp.ok((select count(*) from public.message_templates) = 0, 'a resident cannot read message templates');

select pg_temp.as_user((select official from t_ids));
select pg_temp.ok((select count(*) from public.message_templates) > 0, 'an official reads the message templates');
select pg_temp.ok(pg_temp.rows_changed($$update public.message_templates set label = 'x' where true$$) = 0, 'an official cannot edit templates');

select pg_temp.as_user((select lgu from t_ids));
insert into public.message_templates (category, label, title_en, body_en) values ('general', 'Test template', 'Hello {barangay}', 'Body');
select pg_temp.ok((select id like 'MT-%' from public.message_templates where label = 'Test template'), 'LDRRMO staff add a template and it gets an id');
select pg_temp.ok(pg_temp.rows_changed($$update public.app_settings set value = value where key = 'main'$$) = 0,
                  'LDRRMO staff cannot change the organisation profile');

select pg_temp.as_user((select superadmin from t_ids));
select pg_temp.ok(pg_temp.rows_changed($$update public.app_settings set value = jsonb_set(value, '{org,contact}', '"(075) 000-0000"') where key = 'main'$$) = 1,
                  'the Super Admin changes the organisation profile');
select pg_temp.ok((public.org_profile() ->> 'contact') = '(075) 000-0000', 'the new hotline is what residents see');

-- ------------------------------------------------- status workflow (migration 153)
select pg_temp.as_user((select citizen from t_ids));
insert into public.reports (reporter_id, hazard_type, description, barangay, severity, urgency, lat, lng)
select auth.uid(), 'Flood', 'Workflow test report', 'Poblacion', 'warning', 'normal', g.centroid_lat, g.centroid_lng
  from public.barangay_geoms g join public.barangays b on b.id = g.barangay_id where b.name = 'Poblacion';
select pg_temp.as_backend();
update public.reports set status = 'verified' where description = 'Workflow test report';
create temp table t_wf as select id from public.reports where description = 'Workflow test report';
grant select on t_wf to authenticated;
select pg_temp.as_user((select lgu from t_ids));
select pg_temp.must_fail($$select public.advance_report_status((select id from t_wf), 'dispatched', '')$$,
                         'a report cannot be marked dispatched without a team being sent');
select public.advance_report_status((select id from t_wf), 'rejected', 'Duplicate');
select pg_temp.must_fail($$select public.advance_report_status((select id from t_wf), 'verified', '')$$,
                         'a rejected report cannot be reopened as verified');
select pg_temp.as_backend();
update public.profiles set disabled = true where id = (select official from t_ids);
select pg_temp.as_user((select official from t_ids));
select pg_temp.must_fail($$select public.advance_report_status((select pob_pending from t_rep), 'rejected', '')$$,
                         'a disabled official cannot change a status');

-- ------------------------------------------------- unit deletion (migration 154)
select pg_temp.as_user((select lgu from t_ids));
select pg_temp.must_fail($$select public.delete_dispatch_unit((select unit from t_unit))$$, 'LDRRMO staff cannot delete a dispatch unit');
select pg_temp.as_user((select member from t_unit));
select pg_temp.must_fail($$select public.delete_dispatch_unit((select unit from t_unit))$$, 'a dispatch account cannot delete its unit');
select pg_temp.ok(pg_temp.rows_changed($$update public.profiles set full_name = 'x' where email = 'official@example.com'$$) = 0,
                  'a dispatch account cannot edit someone else''s profile');
select pg_temp.as_user((select superadmin from t_ids));
select pg_temp.must_fail($$select public.delete_dispatch_unit((select unit from t_unit))$$,
                         'a unit with a dispatch in progress cannot be deleted');

rollback;
