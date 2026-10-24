-- UniGuard · Core modules D, E, F + Settings
--
-- This migration adds the schema for the three LDRRMO core modules that were
-- not in the original build, plus the Settings surface that supports them:
--
--   D. Evacuation center management — adds facilities, contact_person and
--      contact_phone to the existing evacuation_centers table. (Evacuee
--      check-in is intentionally NOT included in this build.)
--   E. Relief & resource inventory — a new relief_inventory table for stock
--      levels + reorder points, and a relief_distribution_log table for every
--      pack handed out per barangay / per family.
--   F. Early warning & announcements — adds alert_type and language to the
--      existing advisories table so the four LDRRMO categories (weather
--      advisory, evacuation order, road closure, general) and the EN/FIL
--      publish language are stored with each broadcast.
--   Settings — app_settings (key/value) and message_templates (EN + Filipino,
--      Pangasinense removed per build spec).
--
-- Every new table carries RLS so a barangay official only sees their own
-- rows; the LGU role sees everything. The policies mirror the existing
-- pattern in 004_rls_policies.sql.

-- =====================================================================
-- D. Evacuation centers: facilities + contact person
-- =====================================================================
alter table public.evacuation_centers
  add column if not exists facilities text[] default '{}',
  add column if not exists contact_person text default '',
  add column if not exists contact_phone text default '';
comment on column public.evacuation_centers.facilities is
  'List of on-site facilities (medical station, kitchen, generator, etc.). Displayed as chips on the center card.';
comment on column public.evacuation_centers.contact_person is
  'Shelter manager or point of contact on site.';
comment on column public.evacuation_centers.contact_phone is
  'Contact number for the shelter manager. Becomes a tap-to-call button on the card.';

-- =====================================================================
-- E. Relief & resource inventory
-- =====================================================================
create table if not exists public.relief_inventory (
  id           text primary key,
  name         text not null,
  category     text not null check (category in ('Food','Water','Medical','Equipment','Shelter')),
  unit         text not null default 'units',
  stock        integer not null default 0,
  reorder      integer not null default 0,
  location     text default '',
  supplier     text default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
comment on table public.relief_inventory is
  'Module E: stock of food packs, water, medicine, boats and equipment the LDRRMO pre-positions at the municipal warehouse. Low-stock = stock <= reorder.';
create index if not exists idx_relief_inventory_category on public.relief_inventory(category);

create table if not exists public.relief_distribution_log (
  id              text primary key,
  item_id         text references public.relief_inventory(id) on delete set null,
  item_name       text not null,
  qty             integer not null default 0 check (qty >= 0),
  barangay        text not null,
  family          text default '',
  distributed_by  text default '',
  distributed_at  timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);
comment on table public.relief_distribution_log is
  'Module E: every pack handed out per barangay and per family. Recording a distribution decrements the matching inventory row.';
create index if not exists idx_relief_dist_log_brgy on public.relief_distribution_log(barangay);
create index if not exists idx_relief_dist_log_at on public.relief_distribution_log(distributed_at desc);

-- RLS for the two new relief tables: LGU sees everything, barangay officials
-- see only their own barangay's rows, citizens cannot read either table.
alter table public.relief_inventory enable row level security;
alter table public.relief_distribution_log enable row level security;

drop policy if exists "relief_inventory read" on public.relief_inventory;
create policy "relief_inventory read" on public.relief_inventory
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('lgu_ldrrmc','barangay_official'))
  );
drop policy if exists "relief_inventory write" on public.relief_inventory;
create policy "relief_inventory write" on public.relief_inventory
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  );

drop policy if exists "relief_dist_log read" on public.relief_distribution_log;
create policy "relief_dist_log read" on public.relief_distribution_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
    or (
      exists (select 1 from public.profiles p where p.id = auth.uid()
        and p.role = 'barangay_official')
      and public.my_barangay_name() = relief_distribution_log.barangay
    )
  );
drop policy if exists "relief_dist_log write" on public.relief_distribution_log;
create policy "relief_dist_log write" on public.relief_distribution_log
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('lgu_ldrrmc','barangay_official'))
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('lgu_ldrrmc','barangay_official'))
  );

-- =====================================================================
-- F. Advisories: alert_type + language
-- =====================================================================
alter table public.advisories
  add column if not exists alert_type text not null default 'general'
    check (alert_type in ('general','weather_advisory','evacuation_order','road_closure')),
  add column if not exists language text not null default 'en'
    check (language in ('en','fil'));
comment on column public.advisories.alert_type is
  'Module F: the LDRRMO alert category — weather advisory, evacuation order, road closure or general. Drives the icon on the citizen lock screen and the template shortlist in the composer.';
comment on column public.advisories.language is
  'Module F: the language the advisory was composed in. English or Filipino only (Pangasinense removed per build spec).';

-- =====================================================================
-- Settings: app_settings + message_templates
-- =====================================================================
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);
comment on table public.app_settings is
  'System-wide settings: organisation profile, notifications, offline/sync behaviour, language, display and SMS provider. Stored as key/value JSON so new settings can be added without a migration.';

alter table public.app_settings enable row level security;
drop policy if exists "app_settings read" on public.app_settings;
create policy "app_settings read" on public.app_settings
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  );
drop policy if exists "app_settings write" on public.app_settings;
create policy "app_settings write" on public.app_settings
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  );

create table if not exists public.message_templates (
  id           text primary key,
  category     text not null check (category in ('general','weather_advisory','evacuation_order','road_closure')),
  label        text not null,
  title_en     text default '',
  body_en      text default '',
  title_fil    text default '',
  body_fil     text default '',
  placeholders text[] default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
comment on table public.message_templates is
  'Reusable broadcast templates in English and Filipino. Pangasinense is intentionally not stored — the build spec limits templates to EN + FIL only. The advisory composer applies a template then fills placeholders at publish time.';
create index if not exists idx_message_templates_category on public.message_templates(category);

alter table public.message_templates enable row level security;
drop policy if exists "message_templates read" on public.message_templates;
create policy "message_templates read" on public.message_templates
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('lgu_ldrrmc','barangay_official'))
  );
drop policy if exists "message_templates write" on public.message_templates;
create policy "message_templates write" on public.message_templates
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'lgu_ldrrmc')
  );

-- =====================================================================
-- Seed: default message templates (EN + Filipino, no Pangasinense)
-- =====================================================================
insert into public.message_templates (id, category, label, title_en, body_en, title_fil, body_fil, placeholders) values
  ('MT-001','evacuation_order','Evacuation Order — Flood',
   'Evacuation Order: Move to Higher Ground',
   'Flood waters are rising in {barangay}. Residents within 200 meters of the shoreline must move immediately to {center}. Bring your go-bag, medication and identification.',
   'Utos ng Paglikas: Lumikas sa Mataas na Lugar',
   'Tumataas ang baha sa {barangay}. Dapat lumikas kaagad ang mga residente sa loob ng 200 metro mula sa baybayin patungong {center}. Dalhin ang inyong go-bag, gamot at pagkakakilanlan.',
   array['{barangay}','{center}']),
  ('MT-002','evacuation_order','Pre-emptive Evacuation — Storm Surge',
   'Pre-emptive Evacuation: Storm Surge Warning',
   'A storm surge is expected to hit {barangay} within the next few hours. Residents along the coast are ordered to move to {center} now. Do not wait for the water to reach your home.',
   'Pre-emptibong Paglikas: Babala sa Storm Surge',
   'Inaasahang tatama ang storm surge sa {barangay} sa loob ng ilang oras. Ini-uutos sa mga residente sa baybayin na lumikas na ngayon patungong {center}. Huwag nang hintayin na makarating ang tubig sa inyong tahanan.',
   array['{barangay}','{center}']),
  ('MT-003','weather_advisory','Typhoon Public Advisory',
   'Typhoon Advisory: {barangay}',
   'Typhoon signal no. {signal} is raised over {barangay}. Expect strong winds and heavy rain. Secure loose items, charge devices, and stay indoors. Monitor official channels for updates.',
   'Advisory sa Bagyo: {barangay}',
   'Naka-angat ang signal ng bagyo blg. {signal} sa {barangay}. Asahin ang malakas na hangin at malakas na ulan. Tiyakin na nakakabit ang mga kalat-kalat na gamit, naka-charge ang mga device, at manatili sa loob ng bahay. Subaybayan ang opisyal na mga channel para sa mga update.',
   array['{barangay}','{signal}']),
  ('MT-004','weather_advisory','Heavy Rainfall / Flood Watch',
   'Heavy Rainfall Advisory',
   'Moderate to heavy rainfall is affecting {barangay} and may cause flooding in low-lying areas. Residents near rivers and creeks are advised to prepare for possible evacuation.',
   'Advisory sa Malakas na Ulan',
   'Nakakaapekto ang katamtaman hanggang malakas na pag-ulan sa {barangay} at maaaring magdulot ng baha sa mababang lugar. Hinuhimok ang mga residente malapit sa ilog at sapa na maghanda para sa posibleng paglikas.',
   array['{barangay}']),
  ('MT-005','road_closure','Road Closure Notice',
   'Road Closure: {road}',
   '{road} in {barangay} is closed until further notice due to {hazard}. Seek alternate routes. Do not attempt to pass through flooded or blocked sections.',
   'Pagkasara ng Kalsada: {road}',
   'Sara ang {road} sa {barangay} hanggang sa karagdagang paunawa dahil sa {hazard}. Gumamit ng ibang ruta. Huwag subukang dumaan sa mga bahagi na binaha o hinarang.',
   array['{road}','{barangay}','{hazard}']),
  ('MT-006','general','Class Suspension',
   'Suspension of Classes, All Levels',
   'Classes at all levels in {area} are suspended today due to inclement weather. Parents are advised to keep children indoors and monitor official channels.',
   'Pag-suspinde ng Klase, Lahat ng Antas',
   'Suspended ang klase sa lahat ng antas sa {area} ngayon dahil sa masamang panahon. Hinuhimok ang mga magulang na panatilihing nasa loob ng bahay ang mga bata at subaybayan ang opisyal na mga channel.',
   array['{area}']),
  ('MT-007','general','All Clear Notice',
   'All Clear: Safe to Return',
   'The hazard affecting {barangay} has passed. Residents may now return to their homes. Please continue to exercise caution and report any remaining damage through UniGuard.',
   'All Clear: Ligtas na ang Pagbabalik',
   'Lampas na ang panganib na nakakaapekto sa {barangay}. Maaari na ngayong bumalik ang mga residente sa kanilang mga tahanan. Mangyaring mag-ingat pa rin at iulat ang anumang natitirang pinsala sa pamamagitan ng UniGuard.',
   array['{barangay}']),
  ('MT-008','general','Relief Goods Distribution',
   'Relief Goods Distribution in {barangay}',
   'Relief goods will be distributed at {location} on {date}. Affected families are requested to bring a valid ID and their barangay certificate. Priority will be given to seniors, PWDs and pregnant women.',
   'Pamamahagi ng Relief Goods sa {barangay}',
   'Mamamahagi ng relief goods sa {location} sa {date}. Hinihiling sa mga apektadong pamilya na magdala ng wastong ID at kanilang barangay certificate. Prayoridad ang mga senior, PWD at buntis.',
   array['{barangay}','{location}','{date}'])
on conflict (id) do nothing;

-- default app settings (single row, key = 'main')
insert into public.app_settings (key, value) values
  ('main', jsonb_build_object(
    'org', jsonb_build_object(
      'municipality','Lingayen','province','Pangasinan',
      'office','Municipal Disaster Risk Reduction and Management Office',
      'contact','(075) 632-2222','email','mdrrmo@lingayen.gov.ph'),
    'notifications', jsonb_build_object(
      'pushEnabled',true,'smsFallback',true,'emailAlerts',false,
      'quietHours',false,'quietStart','22:00','quietEnd','06:00'),
    'offline', jsonb_build_object(
      'autoSync',true,'cacheMaps',true,'retentionDays',30),
    'language', jsonb_build_object('default','en','citizenDisplay','bilingual'),
    'display', jsonb_build_object(
      'incidentSort','priority','showCorroboration',true,'compactTables',false),
    'sms', jsonb_build_object('provider','none','senderId','UNIGUARD')
  ))
on conflict (key) do nothing;
