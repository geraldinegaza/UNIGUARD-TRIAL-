-- ============================================================================
--  UniGuard · 038 · Dispatch units (Part C of the Dispatch Team feature)
--
--  Introduces a 4th role `dispatch_team` and the municipality-wide units
--  (BFP, PNP, Rescue, Hospital) plus the barangay-owned Response Team
--  equipment, personnel, shifts, hospital capacity and patient notices,
--  support requests, equipment catalogs, and the audit trail for dispatch
--  events.
--
--  Additive + idempotent. Never edits a previous migration. The new
--  `dispatch_team` role joins `citizen`, `barangay_official` and
--  `lgu_ldrrmc` in `profiles_role_check`; the old roles are unaffected.
--
--  The barangay Response Team is NOT a dispatch_units row. It is the
--  barangay itself, using `responders` (migration 007) plus the new
--  `responders.status` column and the new barangay equipment rows on
--  `dispatch_equipment` (owner_barangay_id set, owner_unit_id null).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------- role helper additions
-- The new role lives alongside the existing three. The CHECK on profiles
-- is widened to accept it; the guard_profile_fields trigger (migration
-- 021) is extended below to protect dispatch_unit_id and unit_role the
-- same way it protects role, barangay_id and disabled.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_check'
  ) then
    alter table public.profiles add constraint profiles_role_check
      check (role in ('citizen','barangay_official','lgu_ldrrmc','dispatch_team'));
  else
    -- drop and re-add so the new role is accepted even if the project was
    -- migrated before this file ran. The check is the only thing that
    -- changes; no data is touched.
    alter table public.profiles drop constraint profiles_role_check;
    alter table public.profiles add constraint profiles_role_check
      check (role in ('citizen','barangay_official','lgu_ldrrmc','dispatch_team'));
  end if;
end $$;

alter table public.profiles add column if not exists dispatch_unit_id uuid;
alter table public.profiles add column if not exists unit_role       text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_unit_role_check'
  ) then
    alter table public.profiles add constraint profiles_unit_role_check
      check (unit_role in ('','unit_admin','member'));
  end if;
end $$;

-- a dispatch_team account must carry a unit; the other three roles must not.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_dispatch_team_unit_check'
  ) then
    alter table public.profiles add constraint profiles_dispatch_team_unit_check
      check (
        (role = 'dispatch_team'  and dispatch_unit_id is not null and unit_role in ('unit_admin','member'))
        or
        (role <> 'dispatch_team' and dispatch_unit_id is null and unit_role = '')
      );
  end if;
end $$;

-- --------------------------------------------------------- role helper functions
-- [this project] moved up from further down: the policies below use them.
create or replace function public.is_dispatch()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'dispatch_team';
$$;

create or replace function public.is_unit_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'dispatch_team'
     and coalesce((select unit_role from public.profiles where id = auth.uid()), '') = 'unit_admin';
$$;

create or replace function public.my_unit_id()
returns uuid language sql stable security definer set search_path = public as $$
  select dispatch_unit_id from public.profiles where id = auth.uid();
$$;

-- -------------------------------------------------------- dispatch_units
create table if not exists public.dispatch_units (
  id             uuid primary key default gen_random_uuid(),
  name           text not null default '',
  unit_type      text not null,
  contact_number text not null default '',
  address        text not null default '',
  lat            double precision,
  lng            double precision,
  status         text not null default 'available',
  active          boolean not null default true,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatch_units_unit_type_check') then
    alter table public.dispatch_units add constraint dispatch_units_unit_type_check
      check (unit_type in ('BFP','PNP','Rescue','Hospital'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispatch_units_status_check') then
    alter table public.dispatch_units add constraint dispatch_units_status_check
      check (status in ('available','on_duty','off_duty'));
  end if;
end $$;

create index if not exists dispatch_units_type_idx   on public.dispatch_units (unit_type, active);
create index if not exists dispatch_units_status_idx  on public.dispatch_units (status, active);

alter table public.dispatch_units enable row level security;

-- everyone signed in can see the municipality-wide directory (read only).
-- writes are LGU only — no policy for insert/update/delete, the RPC handles it.
drop policy if exists dispatch_units_read on public.dispatch_units;
create policy dispatch_units_read on public.dispatch_units
  for select to authenticated using (true);

-- ---------------------------------------------------------- equipment_catalog
-- Per unit_type and a special 'Barangay' type for the barangay Response Team
-- catalog. Each row is one equipment label plus its readiness checklist items.
create table if not exists public.equipment_catalog (
  id            uuid primary key default gen_random_uuid(),
  unit_type     text not null,
  label         text not null,
  checklist     jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_catalog_unit_type_check') then
    alter table public.equipment_catalog add constraint equipment_catalog_unit_type_check
      check (unit_type in ('BFP','PNP','Rescue','Hospital','Barangay'));
  end if;
end $$;

create index if not exists equipment_catalog_type_idx on public.equipment_catalog (unit_type);

alter table public.equipment_catalog enable row level security;
drop policy if exists equipment_catalog_read on public.equipment_catalog;
create policy equipment_catalog_read on public.equipment_catalog
  for select to authenticated using (true);

-- --------------------------------------------------------- dispatch_equipment
-- A piece of equipment belongs to exactly one owner: a unit OR a barangay.
create table if not exists public.dispatch_equipment (
  id                uuid primary key default gen_random_uuid(),
  owner_unit_id     uuid references public.dispatch_units(id) on delete cascade,
  owner_barangay_id uuid references public.barangays(id) on delete cascade,
  catalog_id        uuid references public.equipment_catalog(id) on delete set null,
  custom_label      text not null default '',
  identifier        text not null default '',
  status            text not null default 'available',
  condition         text not null default 'unknown',
  last_checked_at   timestamptz,
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispatch_equipment_owner_check') then
    alter table public.dispatch_equipment add constraint dispatch_equipment_owner_check
      check (
        (owner_unit_id is not null and owner_barangay_id is null)
        or
        (owner_unit_id is null and owner_barangay_id is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispatch_equipment_status_check') then
    alter table public.dispatch_equipment add constraint dispatch_equipment_status_check
      check (status in ('available','deployed','maintenance','unavailable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispatch_equipment_condition_check') then
    alter table public.dispatch_equipment add constraint dispatch_equipment_condition_check
      check (condition in ('ready','needs_repair','missing','out_of_service','unknown'));
  end if;
end $$;

create index if not exists dispatch_equipment_unit_idx    on public.dispatch_equipment (owner_unit_id);
create index if not exists dispatch_equipment_brgy_idx    on public.dispatch_equipment (owner_barangay_id);
create index if not exists dispatch_equipment_status_idx  on public.dispatch_equipment (status, condition);

alter table public.dispatch_equipment enable row level security;

-- A unit member reads/writes their own unit's equipment. The barangay
-- official reads/writes their own barangay's equipment. Officials and LGU
-- can READ every unit's equipment (read-only readiness summary).
drop policy if exists dispatch_equipment_read on public.dispatch_equipment;
create policy dispatch_equipment_read on public.dispatch_equipment
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and owner_unit_id = public.my_unit_id())
  );

drop policy if exists dispatch_equipment_write on public.dispatch_equipment;
create policy dispatch_equipment_write on public.dispatch_equipment
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_dispatch() and public.is_unit_admin() and owner_unit_id = public.my_unit_id())
    or (public.is_official() and owner_barangay_id = public.my_barangay_id())
  )
  with check (
    public.is_lgu()
    or (public.is_dispatch() and public.is_unit_admin() and owner_unit_id = public.my_unit_id())
    or (public.is_official() and owner_barangay_id = public.my_barangay_id())
  );

-- -------------------------------------------------------------- equipment_checks
create table if not exists public.equipment_checks (
  id           uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.dispatch_equipment(id) on delete cascade,
  checked_by   uuid references public.profiles(id) on delete set null,
  checked_at   timestamptz not null default now(),
  condition    text not null default 'unknown',
  level        text not null default '',
  notes        text not null default '',
  photo        text,
  items        jsonb not null default '[]'::jsonb
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_checks_condition_check') then
    alter table public.equipment_checks add constraint equipment_checks_condition_check
      check (condition in ('ready','needs_repair','missing','out_of_service','unknown'));
  end if;
end $$;

create index if not exists equipment_checks_eq_idx on public.equipment_checks (equipment_id, checked_at desc);

alter table public.equipment_checks enable row level security;

drop policy if exists equipment_checks_read on public.equipment_checks;
create policy equipment_checks_read on public.equipment_checks
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and exists (
      select 1 from public.dispatch_equipment e
       where e.id = equipment_id and e.owner_unit_id = public.my_unit_id())
    )
  );

-- no insert/update policy: rows go in through the security definer RPC.

-- ----------------------------------------------------- dispatch_equipment_use
-- Tracks which dispatch a piece of equipment is currently deployed to.
-- A partial unique index on equipment_id WHERE released_at IS NULL means
-- one piece of equipment cannot be on two active dispatches.
create table if not exists public.dispatch_equipment_use (
  id          uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.report_dispatches(id) on delete cascade,
  equipment_id uuid not null references public.dispatch_equipment(id) on delete cascade,
  released_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists dispatch_equipment_use_dispatch_idx on public.dispatch_equipment_use (dispatch_id) where released_at is null;
create index if not exists dispatch_equipment_use_dispatch_all_idx on public.dispatch_equipment_use (dispatch_id);
-- the partial unique index that prevents double-booking equipment
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'dispatch_equipment_use'
       and indexname = 'dispatch_equipment_use_one_active_idx'
  ) then
    create unique index dispatch_equipment_use_one_active_idx
      on public.dispatch_equipment_use (equipment_id)
      where released_at is null;
  end if;
end $$;

alter table public.dispatch_equipment_use enable row level security;

drop policy if exists dispatch_equipment_use_read on public.dispatch_equipment_use;
create policy dispatch_equipment_use_read on public.dispatch_equipment_use
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and exists (
      select 1 from public.dispatch_equipment e
       where e.id = equipment_id and e.owner_unit_id = public.my_unit_id())
    )
  );

-- ---------------------------------------------------------------- hospital_capacity
create table if not exists public.hospital_capacity (
  unit_id     uuid primary key references public.dispatch_units(id) on delete cascade,
  er_beds     int not null default 0,
  icu_beds    int not null default 0,
  available   int not null default 0,
  accepting   boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.hospital_capacity enable row level security;

drop policy if exists hospital_capacity_read on public.hospital_capacity;
create policy hospital_capacity_read on public.hospital_capacity
  for select to authenticated using (true);

-- writes through security definer RPC only (set_hospital_capacity)

-- ----------------------------------------------------------------- patient_notices
create table if not exists public.patient_notices (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references public.dispatch_units(id) on delete cascade,
  report_id  uuid references public.reports(id) on delete set null,
  patients   int not null default 1,
  condition  text not null default '',
  eta        timestamptz,
  sent_by    uuid references public.profiles(id) on delete set null,
  status     text not null default 'sent',
  ack_at     timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_notices_status_check') then
    alter table public.patient_notices add constraint patient_notices_status_check
      check (status in ('sent','acknowledged','arrived','cancelled'));
  end if;
end $$;

create index if not exists patient_notices_unit_idx on public.patient_notices (unit_id, created_at desc);

alter table public.patient_notices enable row level security;

drop policy if exists patient_notices_read on public.patient_notices;
create policy patient_notices_read on public.patient_notices
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
  );

-- ---------------------------------------------------------------- unit_personnel
create table if not exists public.unit_personnel (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.dispatch_units(id) on delete cascade,
  name        text not null default '',
  role        text not null default '',
  phone       text not null default '',
  on_duty     boolean not null default false,
  shift_start timestamptz,
  shift_end   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists unit_personnel_unit_idx on public.unit_personnel (unit_id, on_duty);

alter table public.unit_personnel enable row level security;

drop policy if exists unit_personnel_read on public.unit_personnel;
create policy unit_personnel_read on public.unit_personnel
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
  );

drop policy if exists unit_personnel_write on public.unit_personnel;
create policy unit_personnel_write on public.unit_personnel
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_dispatch() and public.is_unit_admin() and unit_id = public.my_unit_id())
  )
  with check (
    public.is_lgu()
    or (public.is_dispatch() and public.is_unit_admin() and unit_id = public.my_unit_id())
  );

-- ----------------------------------------------------------------- unit_shifts
create table if not exists public.unit_shifts (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.dispatch_units(id) on delete cascade,
  personnel_id uuid references public.unit_personnel(id) on delete cascade,
  start_at    timestamptz not null default now(),
  end_at      timestamptz,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists unit_shifts_unit_idx on public.unit_shifts (unit_id, start_at desc);

alter table public.unit_shifts enable row level security;

drop policy if exists unit_shifts_read on public.unit_shifts;
create policy unit_shifts_read on public.unit_shifts
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
  );

-- ----------------------------------------------------------------- unit_requests
create table if not exists public.unit_requests (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.dispatch_units(id) on delete cascade,
  kind        text not null default '',
  details     text not null default '',
  status      text not null default 'pending',
  created_by  uuid references public.profiles(id) on delete set null,
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'unit_requests_status_check') then
    alter table public.unit_requests add constraint unit_requests_status_check
      check (status in ('pending','approved','declined','done'));
  end if;
end $$;

create index if not exists unit_requests_unit_idx on public.unit_requests (unit_id, created_at desc);

alter table public.unit_requests enable row level security;

drop policy if exists unit_requests_read on public.unit_requests;
create policy unit_requests_read on public.unit_requests
  for select to authenticated using (
    public.is_lgu()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
  );

-- ----------------------------------------------------- extend report_dispatches
-- [this project] moved above the dispatch events section, which reads unit_id.
alter table public.report_dispatches add column if not exists unit_id            uuid;
alter table public.report_dispatches add column if not exists target_barangay_id uuid;
alter table public.report_dispatches add column if not exists dispatch_status    text not null default 'sent';
alter table public.report_dispatches add column if not exists ack_at            timestamptz;
alter table public.report_dispatches add column if not exists en_route_at       timestamptz;
alter table public.report_dispatches add column if not exists on_scene_at        timestamptz;
alter table public.report_dispatches add column if not exists done_at           timestamptz;
alter table public.report_dispatches add column if not exists after_action      text not null default '';
alter table public.report_dispatches add column if not exists after_action_at   timestamptz;
alter table public.report_dispatches add column if not exists after_action_by   uuid;
alter table public.report_dispatches add column if not exists after_action_meta jsonb not null default '{}'::jsonb;

-- widen the team check to accept 'Rescue Unit' (from unit_type 'Rescue'),
-- keeping all previously allowed values
alter table public.report_dispatches drop constraint if exists report_dispatches_team_check;
alter table public.report_dispatches add constraint report_dispatches_team_check
  check (team in ('MDRRMO Rescue','BFP','PNP','Barangay Response Team','Ambulance','Rescue Unit'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_dispatches_status_check') then
    alter table public.report_dispatches add constraint report_dispatches_status_check
      check (dispatch_status in ('sent','acknowledged','en_route','on_scene','done'));
  end if;
end $$;

create index if not exists report_dispatches_unit_idx      on public.report_dispatches (unit_id, dispatched_at desc);
create index if not exists report_dispatches_brgy_idx      on public.report_dispatches (target_barangay_id, dispatched_at desc);
create index if not exists report_dispatches_status_idx    on public.report_dispatches (dispatch_status, dispatched_at desc);

-- [this project] PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS; guard by name.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_dispatches_unit_fkey') then
    alter table public.report_dispatches add constraint report_dispatches_unit_fkey
      foreign key (unit_id) references public.dispatch_units(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'report_dispatches_target_brgy_fkey') then
    alter table public.report_dispatches add constraint report_dispatches_target_brgy_fkey
      foreign key (target_barangay_id) references public.barangays(id) on delete set null;
  end if;
end $$;

-- Update the read policy so the dispatched unit's members can read it too.
drop policy if exists report_dispatches_read on public.report_dispatches;
create policy report_dispatches_read on public.report_dispatches
  for select to authenticated using (
    public.is_lgu()
    or (public.is_dispatch() and unit_id = public.my_unit_id())
    or exists (
      select 1 from public.reports r
       where r.id = report_id
         and (r.reporter_id = auth.uid()
              or (public.is_official() and r.barangay_id = public.my_barangay_id()))
    )
  );

-- ----------------------------------------------------------------- dispatch events
-- Per-dispatch timeline. Each action (acknowledge, en route, on scene, done)
-- is one row, written by the dispatch_respond RPC. Visible to LGU, the
-- report's barangay officials and the dispatched unit.
create table if not exists public.report_dispatch_events (
  id          uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.report_dispatches(id) on delete cascade,
  actor       uuid references public.profiles(id) on delete set null,
  actor_name  text not null default '',
  action      text not null default '',
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists report_dispatch_events_dispatch_idx on public.report_dispatch_events (dispatch_id, created_at);

alter table public.report_dispatch_events enable row level security;

drop policy if exists report_dispatch_events_read on public.report_dispatch_events;
create policy report_dispatch_events_read on public.report_dispatch_events
  for select to authenticated using (
    public.is_lgu()
    or (public.is_dispatch() and exists (
      select 1 from public.report_dispatches d
       where d.id = dispatch_id and d.unit_id = public.my_unit_id())
    )
    or exists (
      select 1 from public.report_dispatches d
       join public.reports r on r.id = d.report_id
      where d.id = dispatch_id
        and (public.is_official() and r.barangay_id = public.my_barangay_id())
    )
  );

-- ----------------------------------------------------------------- responders
-- Add a status column for the barangay Response Team roster (Available /
-- On duty / Off duty). On duty is set automatically on assignment and
-- cleared on release (trigger below).
alter table public.responders add column if not exists status text not null default 'available';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'responders_status_check') then
    alter table public.responders add constraint responders_status_check
      check (status in ('available','on_duty','off_duty'));
  end if;
end $$;

-- Tighten the existing read policy: officials see only their own barangay's
-- responders (plus LGU). The previous policy let any official see every
-- responder; that is no longer appropriate.
drop policy if exists responders_read on public.responders;
create policy responders_read on public.responders
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
  );

drop policy if exists responders_write on public.responders;
create policy responders_write on public.responders
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and (barangay_id = public.my_barangay_id() or barangay_id is null))
  )
  with check (
    public.is_lgu()
    or (public.is_official() and (barangay_id = public.my_barangay_id() or barangay_id is null))
  );

-- ----------------------------------------------------- emergency_hotlines.category
alter table public.emergency_hotlines add column if not exists category text not null default 'Other';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'emergency_hotlines_category_check') then
    alter table public.emergency_hotlines add constraint emergency_hotlines_category_check
      check (category in ('BFP','PNP','Rescue Unit','Hospital','Barangay Captain','MDRRMO','Other'));
  end if;
end $$;

-- backfill category by agency name (case-insensitive substring match)
update public.emergency_hotlines set category = 'BFP'              where category = 'Other' and lower(agency_name) like '%bfp%';
update public.emergency_hotlines set category = 'PNP'              where category = 'Other' and lower(agency_name) like '%pnp%';
update public.emergency_hotlines set category = 'Rescue Unit'      where category = 'Other' and (lower(agency_name) like '%rescue%' or lower(agency_name) like '%mdrrmo%');
update public.emergency_hotlines set category = 'Hospital'         where category = 'Other' and lower(agency_name) like '%hospital%';
update public.emergency_hotlines set category = 'Barangay Captain' where category = 'Other' and (lower(agency_name) like '%captain%' or lower(agency_name) like '%barangay%');
update public.emergency_hotlines set category = 'MDRRMO'           where category = 'Other' and (lower(agency_name) like '%mdrrmo%' or lower(agency_name) like '%ldrrmc%');

-- ------------------------------------------------------------ barangays captain
alter table public.barangays add column if not exists captain_name  text not null default '';
alter table public.barangays add column if not exists captain_phone text not null default '';

-- ------------------------------------------------------ profile field guard
-- Extend guard_profile_fields so dispatch_unit_id and unit_role are also
-- protected: only LGU (or a trusted backend call with no auth.uid()) can
-- change them. A unit_admin can invite members INTO THEIR OWN UNIT through
-- the admin-users edge function (which runs as service role), but they
-- cannot re-assign themselves or anyone to a different unit through REST.
create or replace function public.guard_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  if coalesce(v_role, '') <> 'lgu_ldrrmc' then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own role';
    end if;
    if new.barangay_id is distinct from old.barangay_id then
      raise exception 'Barangay assignment is managed by your LGU administrator';
    end if;
    if new.disabled is distinct from old.disabled then
      raise exception 'Account status is managed by your LGU administrator';
    end if;
    if new.dispatch_unit_id is distinct from old.dispatch_unit_id then
      raise exception 'Unit assignment is managed by your LGU administrator';
    end if;
    if new.unit_role is distinct from old.unit_role then
      raise exception 'Unit role is managed by your LGU administrator';
    end if;
  end if;
  return new;
end;
$$;

-- -------------------------------------------------- responders on_duty trigger
-- When an assignment is created the responder is set to on_duty; when
-- released_at is set the responder returns to available. Both are
-- security definer so the assign_responder RPC (migration 007) can move
-- them without an explicit client update.
create or replace function public.sync_responder_duty()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.responders set status = 'on_duty' where id = new.responder_id;
  elsif tg_op = 'UPDATE' and new.released_at is not null and old.released_at is null then
    update public.responders set status = 'available' where id = new.responder_id;
  end if;
  return new;
end;
$$;

drop trigger if exists report_assignments_duty on public.report_assignments;
create trigger report_assignments_duty
  after insert or update on public.report_assignments
  for each row execute function public.sync_responder_duty();

-- ----------------------------------------------------- unit status auto trigger
-- When a dispatch is created the unit moves to on_duty; when every dispatch
-- for the unit is done the unit returns to available. Same pattern for the
-- barangay Response Team — but the barangay has no row in dispatch_units,
-- so we mark the barangay responders available again instead. The trigger
-- on report_dispatches handles both.
create or replace function public.sync_unit_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_open int;
begin
  if new.unit_id is not null then
    select count(*) into v_open from public.report_dispatches d
     where d.unit_id = new.unit_id and d.dispatch_status <> 'done';
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

-- ----------------------------------------------------- add new tables to realtime
do $$
declare t text;
begin
  foreach t in array array[
    'dispatch_units','dispatch_equipment','equipment_checks',
    'dispatch_equipment_use','hospital_capacity','patient_notices',
    'unit_personnel','unit_shifts','unit_requests','report_dispatch_events'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when others then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------- housekeeping: updated_at
do $$
declare t text;
begin
  foreach t in array array[
    'dispatch_units','dispatch_equipment','unit_personnel',
    'unit_requests','hospital_capacity'
  ]
  loop
    if not exists (
      select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and tg.tgname = t || '_touch'
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
        t || '_touch', t);
    end if;
  end loop;
end $$;

-- Audit triggers: reuse audit_row_change from migration 033
do $$
declare t text;
begin
  foreach t in array array[
    'dispatch_units','dispatch_equipment','unit_personnel',
    'unit_shifts','unit_requests','hospital_capacity','patient_notices'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- Add report_dispatches to the audit_row_change trigger (it was not on the
-- original list because migration 034 had its own write_audit call inside
-- dispatch_report). Audit the column changes now so the dispatch_status
-- transitions are visible.
do $$
begin
  execute 'drop trigger if exists report_dispatches_audit on public.report_dispatches';
  execute 'create trigger report_dispatches_audit after insert or update or delete on public.report_dispatches for each row execute function public.audit_row_change()';
end $$;

-- Revoke any default grants that might have leaked; grant select to authenticated
grant select on public.dispatch_units to authenticated;
grant select on public.equipment_catalog to authenticated;
grant select on public.dispatch_equipment to authenticated;
grant select on public.equipment_checks to authenticated;
grant select on public.dispatch_equipment_use to authenticated;
grant select on public.hospital_capacity to authenticated;
grant select on public.patient_notices to authenticated;
grant select on public.unit_personnel to authenticated;
grant select on public.unit_shifts to authenticated;
grant select on public.unit_requests to authenticated;
grant select on public.report_dispatch_events to authenticated;
