-- ============================================================================
--  UniGuard · seed 002 · Relief, Guides, FAQs
--
--  SAMPLE data. Each block is guarded by WHERE NOT EXISTS so the file is safe
--  to re-run. Verify every name, address and coordinate against MDRRMO records
--  before going anywhere near production.
--
--  Road work and road status are intentionally NOT seeded here: add only real,
--  verified closures through the console.
-- ============================================================================

-- ----------------------------------------------------------------- Relief distributions
-- eligibility/required_docs are JSON arrays so the UI can render them as
-- bullet lists without parsing.
insert into public.relief_distributions
  (barangay, title, location_name, address, lat, lng, distribution_at, contact_person, contact_phone, eligibility, required_docs, note, active)
select * from (values
  ('Poblacion', 'Family Food Pack Distribution', 'Provincial Capitol Grounds', 'Aguila Rd, Lingayen, Pangasinan', 16.033513, 120.231519, now() + interval '2 days',
    'MDRRMO Relief Desk', '(075) 632-2222',
    '["Affected household", "Senior citizen", "Person with disability (PWD)"]'::jsonb,
    '["Valid government ID", "Barangay certificate of indigency", "Authorization letter if claiming on behalf of a beneficiary"]'::jsonb,
    'Distribution starts 8:00 AM. Bring your own bag.', true),
  ('Pangapisan North', 'Coastal Relief Distribution', 'Pangapisan North Multi-Purpose Center', 'Coastal Rd, Pangapisan North', 16.0555, 120.2245, now() + interval '3 days',
    'Brgy. Captain Office', '0917-408-2210',
    '["Coastal household affected by storm surge", "Evacuated family from shelter"]'::jsonb,
    '["Valid ID", "Proof of residence"]'::jsonb,
    'Priority for households within 200m of the shoreline.', true),
  ('Domalandan West', 'Emergency Relief Pack', 'Domalandan West Barangay Hall', 'Barangay Hall, Domalandan West', 16.0418, 120.2065, now() + interval '1 day',
    'Barangay Desk', '(075) 542-6377',
    '["Flood-affected household", "Senior citizen", "PWD"]'::jsonb,
    '["Valid ID", "Barangay indigency certificate"]'::jsonb,
    '', true)
) as v(barangay, title, location_name, address, lat, lng, distribution_at, contact_person, contact_phone, eligibility, required_docs, note, active)
where not exists (select 1 from public.relief_distributions r where r.title = v.title);

-- ----------------------------------------------- Authorized beneficiaries (sample)
insert into public.authorized_beneficiaries
  (barangay, beneficiary_name, claimant_name, claimant_id, category, valid_until, active)
select * from (values
  ('Poblacion',        'Aquino, Marites',   'Aquino, Marites',   'ID-2026-001234', 'Affected household',   now() + interval '30 days', true),
  ('Poblacion',        'Soriano, Reynaldo', 'Soriano, Reynaldo', 'ID-2026-001235', 'Senior citizen',       now() + interval '30 days', true),
  ('Poblacion',        'Fernandez, Andrea', 'Villanueva, Joel',  'ID-2026-001236', 'PWD (authorized rep)', now() + interval '14 days', true),
  ('Pangapisan North', 'Bautista, Liza',    'Bautista, Liza',    'ID-2026-001237', 'Coastal household',    now() + interval '30 days', true),
  ('Pangapisan North', 'Cruz, Antonio',     'Cruz, Antonio',     'ID-2026-001238', 'Senior citizen',       now() + interval '30 days', true)
) as v(barangay, beneficiary_name, claimant_name, claimant_id, category, valid_until, active)
where not exists (
  select 1 from public.authorized_beneficiaries b
   where b.barangay = v.barangay
     and b.beneficiary_name = v.beneficiary_name
     and b.claimant_name = v.claimant_name
);

-- --------------------------------------------------------------------- FAQs
insert into public.faqs (category, question, answer, sort_order, active)
select * from (values
  ('Reports',    'How long does a report stay editable?',
                 'Reports stay editable for 15 minutes after submission. After that, only an LGU official can update the status.', 1, true),
  ('Reports',    'What happens after I submit a report?',
                 'It joins your barangay queue. Three matching reports in the same barangay within six hours auto-verify it. An official then advances it through Verified, In Progress, and Resolved.', 2, true),
  ('Reports',    'Can I report on behalf of a neighbor?',
                 'Yes. Use your own account and pick the correct barangay. The report is logged to your account so officials can follow up with you.', 3, true),
  ('Relief',     'Who is eligible for a relief pack?',
                 'Eligibility is set per distribution by the LGU. Common categories are affected household, senior citizen and person with disability. Open the Relief tab and pick your barangay to see the current criteria.', 4, true),
  ('Relief',     'What should I bring to claim a relief pack?',
                 'A valid government ID, your barangay certificate, and — if you are claiming on behalf of a named beneficiary — an authorization letter. The relief screen lists exactly what each distribution requires.', 5, true),
  ('Evacuation', 'How do I find the nearest open shelter?',
                 'Open the Shelters tab. Open shelters are listed first; the Waze button routes you to them. The list also works offline once you have loaded it once.', 6, true),
  ('SOS',        'What does the SOS button do?',
                 'One tap sends your current GPS position, your name and your contact number to the LGU/LDRRMO duty officers. A confirmation screen appears when the SOS has been logged. SOS is rate-limited to 5 calls per 10 minutes.', 7, true)
) as v(category, question, answer, sort_order, active)
where not exists (select 1 from public.faqs f where f.question = v.question);

-- ------------------------------------------------- Preparedness guides (sample)
-- hazard_type uses the same labels as js/hazard-types.js, because the citizen
-- Guides screen filters by label.
insert into public.preparedness_guides (hazard_type, phase, title, body, sort_order, active)
select * from (values
  -- Flood
  ('Flood', 'before', 'Before a flood',
   'Identify the nearest evacuation centre and the safest route to it. Keep a go-bag with three days of water, non-perishable food, copies of important documents in a waterproof bag, a flashlight, batteries and a first-aid kit. Charge power banks and sign up for UniGuard push alerts.', 1, true),
  ('Flood', 'during', 'During a flood',
   'Move to higher ground immediately if you are in a low-lying area. Never walk or drive through moving water — even 15 cm can knock you off your feet. Turn off the main electrical switch if water is rising inside the house. Keep monitoring official UniGuard advisories for instructions.', 2, true),
  ('Flood', 'after', 'After a flood',
   'Wait for the official all-clear before returning home. Do not drink tap water until the LGU says it is safe. Photograph damage for insurance and relief claims. Disinfect anything the flood water touched. Report any downed power lines immediately.', 3, true),

  -- Earthquake
  ('Earthquake', 'before', 'Before an earthquake',
   'Identify safe spots in every room: under a sturdy desk, away from windows and heavy furniture that could topple. Bolt heavy shelves to the wall. Keep a go-bag near the exit. Practise "duck, cover, hold" with your family at least twice a year.', 1, true),
  ('Earthquake', 'during', 'During an earthquake',
   'Duck, cover, and hold. Stay where you are until the shaking stops. If you are outside, move to an open area away from buildings, power lines and trees. Do not use elevators. Do not run outdoors while the building is still shaking — falling glass is the most common injury.', 2, true),
  ('Earthquake', 'after', 'After an earthquake',
   'Check yourself and others for injuries. Inspect your home for structural damage, gas leaks and electrical issues before going back inside. Aftershocks are normal — be ready to duck, cover and hold again. Report gas smells or downed lines to the hotline immediately.', 3, true),

  -- Fire
  ('Fire', 'before', 'Before a fire',
   'Install smoke alarms on every floor and test them monthly. Keep a fire extinguisher in the kitchen and learn how to use it (PASS: pull, aim, squeeze, sweep). Plan two ways out of every room and agree on a meeting point outside. Never leave cooking unattended.', 1, true),
  ('Fire', 'during', 'During a fire',
   'Get out fast — every second counts. Crawl low under smoke. Feel doors with the back of your hand before opening; if hot, use your second way out. Once out, stay out. Never go back inside for belongings or pets. Call the Bureau of Fire Protection from outside.', 2, true),
  ('Fire', 'after', 'After a fire',
   'Do not re-enter until the BFP says the structure is safe. Contact your insurance provider and document everything. The LGU relief desk can provide temporary shelter for displaced households. Discard any food, medicine or cosmetics that were near heat, smoke or firefighting water.', 3, true),

  -- Typhoon / strong wind
  ('Strong Wind / Typhoon Damage', 'before', 'Before a typhoon',
   'Trim tree branches near the house. Reinforce or board up windows. Charge all devices and power banks. Stock up on water, food and fuel for a generator if you have one. Secure loose objects outside that could become projectiles. Monitor PAGASA and UniGuard advisories.', 1, true),
  ('Strong Wind / Typhoon Damage', 'during', 'During a typhoon',
   'Stay indoors and away from windows. Keep curtains closed to contain flying glass if a window breaks. Use battery-powered lights, not candles. If the eye passes over you, do not go outside — the back side of the storm comes from the opposite direction and can be just as strong.', 2, true),
  ('Strong Wind / Typhoon Damage', 'after', 'After a typhoon',
   'Wait for the official all-clear. Watch for downed power lines, broken glass and weakened structures. Do not walk or drive through flooded roads. Report fallen trees and power line hazards through UniGuard so responders can prioritise.', 3, true)
) as v(hazard_type, phase, title, body, sort_order, active)
where not exists (
  select 1 from public.preparedness_guides g
   where g.hazard_type = v.hazard_type and g.phase = v.phase and g.title = v.title
);
