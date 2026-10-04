-- ============================================================================
--  UniGuard · SAMPLE DATA  ·  DO NOT RUN IN PRODUCTION UNCHANGED
--
--  The hotlines and evacuation centres below are placeholders taken from the
--  design prototype. Every phone number, capacity and coordinate is invented
--  (the evacuation centres are named after real Lingayen places and schools,
--  but their capacity, occupancy and exact coordinates are not verified).
--  Verify each entry against the official Lingayen MDRRMO records before
--  production use, then delete anything that is wrong.
--
--  The barangay list itself is the Philippine Statistics Authority's official
--  list of Lingayen's 32 barangays and should not need correction, but is
--  still worth a final check against the Municipal Planning and Development
--  Office before production use.
--
--  Safe to re-run: everything is guarded by ON CONFLICT DO NOTHING.
-- ============================================================================

-- --------------------------------------------------------------- barangays
insert into public.barangays (name, city) values
  ('Aliwekwek',         'Lingayen'), ('Baay',              'Lingayen'),
  ('Balangobong',       'Lingayen'), ('Balococ',           'Lingayen'),
  ('Bantayan',          'Lingayen'), ('Basing',            'Lingayen'),
  ('Capandanan',        'Lingayen'), ('Domalandan Center', 'Lingayen'),
  ('Domalandan East',   'Lingayen'), ('Domalandan West',   'Lingayen'),
  ('Dorongan',          'Lingayen'), ('Dulag',             'Lingayen'),
  ('Estanza',           'Lingayen'), ('Lasip',             'Lingayen'),
  ('Libsong East',      'Lingayen'), ('Libsong West',      'Lingayen'),
  ('Malawa',            'Lingayen'), ('Malimpuec',         'Lingayen'),
  ('Maniboc',           'Lingayen'), ('Matalava',          'Lingayen'),
  ('Naguelguel',        'Lingayen'), ('Namolan',           'Lingayen'),
  ('Pangapisan North',  'Lingayen'), ('Pangapisan Sur',    'Lingayen'),
  ('Poblacion',         'Lingayen'), ('Quibaol',           'Lingayen'),
  ('Rosario',           'Lingayen'), ('Sabangan',          'Lingayen'),
  ('Talogtog',          'Lingayen'), ('Tonton',            'Lingayen'),
  ('Tumbar',            'Lingayen'), ('Wawa',              'Lingayen')
on conflict (name) do nothing;

-- --------------------------------------------------------------- hotlines
-- SAMPLE: verify every number with the agency before publishing.
insert into public.emergency_hotlines (agency_name, contact_number, scope, description)
select v.agency_name, v.contact_number, v.scope, v.description
  from (values
    ('Lingayen MDRRMO',           '(075) 632-2222', 'Municipality-wide',  'Municipal disaster risk reduction and management office'),
    ('Bureau of Fire Protection', '(075) 632-2333', 'Fire and rescue',    'Fire and rescue response'),
    ('PNP Lingayen',              '0998-598-5391',  'Police assistance',  'Police emergency line'),
    ('Philippine Coast Guard',    '(075) 542-6377', 'Coastal rescue',     'Coastal and water rescue'),
    ('Philippine Red Cross Pangasinan Chapter', '(075) 522-2133', 'Medical and relief', 'Medical assistance and relief goods'),
    ('Poblacion Barangay Desk',   '0917-408-2210',  'Barangay hotline',   'Barangay emergency desk')
  ) as v(agency_name, contact_number, scope, description)
 where not exists (
   select 1 from public.emergency_hotlines h where h.agency_name = v.agency_name
 );

-- ------------------------------------------------------- evacuation centres
-- SAMPLE: verify names, addresses, real capacities and coordinates with the
-- MDRRMO. Coordinates for the Provincial Capitol grounds, the Narciso Ramos
-- Sports and Civic Center, and Pangasinan National High School are real
-- (public record); the rest are approximate placeholders within Lingayen.
insert into public.evacuation_centers (name, barangay, barangay_id, address, capacity, occupancy, status, note, lat, lng)
select v.name, v.barangay, b.id, v.address, v.capacity, v.occupancy, v.status, v.note, v.lat, v.lng
  from (values
    ('Pangapisan North Multi-Purpose Center', 'Pangapisan North', 'Pangapisan North', 250, 118, 'open',   'Priority for coastal households',   16.0555, 120.2245),
    ('Narciso Ramos Sports and Civic Center', 'Poblacion',        'Poblacion',        620, 620, 'full',   'No remaining slots',                16.03192, 120.22529),
    ('Lingayen Central Elementary School',    'Poblacion',        'Poblacion',        300,  84, 'open',   'Medical station on site',            16.0219, 120.2320),
    ('Domalandan West Barangay Hall',         'Domalandan West',  'Domalandan West',   90,   0, 'closed', 'Undergoing roof repair',              16.0418, 120.2065),
    ('Pangasinan National High School',       'Poblacion',        'Alvear Street',     400, 210, 'open',  'Pet friendly area available',         16.031292, 120.230322)
  ) as v(name, barangay, address, capacity, occupancy, status, note, lat, lng)
  left join public.barangays b on b.name = v.barangay
 where not exists (select 1 from public.evacuation_centers e where e.name = v.name);

-- ------------------------------------------------------------- advisories
-- SAMPLE: written for the design prototype, not approved public messaging.
insert into public.advisories (title, body, severity, kind, affected_area, citywide, published_at)
select v.title, v.body, v.severity, v.kind, v.affected_area, v.citywide, v.published_at
  from (values
    ('Flood Warning: Pangapisan North',
     'Water has reached the first flood marker along the coastal road. Residents within 200 m of the shoreline must prepare to move to the Pangapisan North Multi-Purpose Center.',
     'emergency', 'emergency', 'Pangapisan North, Pangapisan Sur', false, now() - interval '12 minutes'),
    ('Suspension of Classes, All Levels',
     'The Municipal Disaster Risk Reduction and Management Office has suspended classes at all levels for today.',
     'warning', 'emergency', 'Municipality-wide', true, now() - interval '1 hour'),
    ('Coastal Advisory: Storm Surge Watch',
     'A storm surge watch is in effect for barangays along Lingayen Gulf. Small sea vessels are prohibited from sailing.',
     'advisory', 'emergency', 'Coastal barangays', true, now() - interval '3 hours'),
    ('Preparedness Drill: Duck, Cover, Hold',
     'A municipality-wide earthquake drill will run at 9:00 AM this Friday. Households, schools and offices are encouraged to join.',
     'prepared', 'preparedness', 'Municipality-wide', true, now() - interval '2 days'),
    ('Go-Bag Checklist for the Wet Season',
     'Keep a go-bag ready: three days of water and non-perishable food, flashlight, batteries, first-aid kit, whistle, copies of documents and a power bank.',
     'prepared', 'preparedness', 'Municipality-wide', true, now() - interval '4 days')
  ) as v(title, body, severity, kind, affected_area, citywide, published_at)
 where not exists (select 1 from public.advisories a where a.title = v.title);

-- target the barangay scoped advisory at its barangays
insert into public.advisory_targets (advisory_id, barangay_id)
select a.id, b.id
  from public.advisories a
  join public.barangays b on b.name in ('Pangapisan North', 'Pangapisan Sur')
 where a.title = 'Flood Warning: Pangapisan North'
on conflict do nothing;

-- No sample reports or accounts are seeded. Reports need a real auth user, and
-- the brief requires that no demo accounts exist anywhere in the system.
