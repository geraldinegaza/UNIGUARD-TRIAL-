-- ============================================================================
--  UniGuard · 001 · Align the existing core tables
--
--  Additive only. Every statement is guarded, so this is safe to re-run and
--  safe against the tables you already have. Nothing is dropped or recreated.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------ barangays
create table if not exists public.barangays (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.barangays add column if not exists city   text not null default 'Lingayen';
alter table public.barangays add column if not exists active boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'barangays_name_key') then
    alter table public.barangays add constraint barangays_name_key unique (name);
  end if;
end $$;

-- ------------------------------------------------------------------- profiles
-- One row per account. Role lives here and nowhere else.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  email      text,
  role       text not null default 'citizen',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name   text not null default '';
alter table public.profiles add column if not exists email       text;
alter table public.profiles add column if not exists phone       text;
alter table public.profiles add column if not exists barangay_id uuid;
alter table public.profiles add column if not exists barangay    text not null default '';
alter table public.profiles add column if not exists role        text not null default 'citizen';
alter table public.profiles add column if not exists disabled    boolean not null default false;
alter table public.profiles add column if not exists created_at  timestamptz not null default now();
alter table public.profiles add column if not exists updated_at  timestamptz not null default now();

-- keep the foreign key to barangays without assuming it is already there
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_barangay_id_fkey') then
    alter table public.profiles
      add constraint profiles_barangay_id_fkey
      foreign key (barangay_id) references public.barangays(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('citizen','barangay_official','lgu_ldrrmc'));
  end if;
end $$;

create index if not exists profiles_barangay_idx on public.profiles (barangay_id);
create index if not exists profiles_role_idx     on public.profiles (role);

-- -------------------------------------------------------------------- reports
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete cascade,
  barangay_id uuid,
  hazard_type text not null default '',
  description text not null default '',
  created_at  timestamptz not null default now()
);

alter table public.reports add column if not exists code         text;
alter table public.reports add column if not exists reporter_id  uuid;
alter table public.reports add column if not exists barangay_id  uuid;
alter table public.reports add column if not exists barangay     text not null default '';
alter table public.reports add column if not exists hazard_type  text not null default '';
alter table public.reports add column if not exists description  text not null default '';
alter table public.reports add column if not exists severity     text not null default 'advisory';
alter table public.reports add column if not exists urgency      text not null default 'advisory';
alter table public.reports add column if not exists status       text not null default 'reported';
alter table public.reports add column if not exists lat          double precision;
alter table public.reports add column if not exists lng          double precision;
alter table public.reports add column if not exists photo_path   text;
alter table public.reports add column if not exists resolved_at  timestamptz;
alter table public.reports add column if not exists created_at   timestamptz not null default now();
alter table public.reports add column if not exists updated_at   timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_severity_check') then
    alter table public.reports add constraint reports_severity_check
      check (severity in ('advisory','warning','emergency'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reports_status_check') then
    alter table public.reports add constraint reports_status_check
      check (status in ('reported','verified','dispatched','resolved'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reports_reporter_id_fkey') then
    alter table public.reports add constraint reports_reporter_id_fkey
      foreign key (reporter_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reports_barangay_id_fkey') then
    alter table public.reports add constraint reports_barangay_id_fkey
      foreign key (barangay_id) references public.barangays(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reports_code_key') then
    alter table public.reports add constraint reports_code_key unique (code);
  end if;
end $$;

-- the corroboration window query depends on this index
create index if not exists reports_hazard_window_idx
  on public.reports (barangay_id, hazard_type, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index if not exists reports_status_idx   on public.reports (status, created_at desc);

-- ----------------------------------------------------------------- advisories
create table if not exists public.advisories (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default '',
  body       text not null default '',
  created_at timestamptz not null default now()
);

alter table public.advisories add column if not exists author_id     uuid;
alter table public.advisories add column if not exists title         text not null default '';
alter table public.advisories add column if not exists body          text not null default '';
alter table public.advisories add column if not exists severity      text not null default 'advisory';
alter table public.advisories add column if not exists kind          text not null default 'emergency';
alter table public.advisories add column if not exists affected_area text not null default 'Municipality-wide';
alter table public.advisories add column if not exists barangay_id   uuid;
alter table public.advisories add column if not exists citywide      boolean not null default true;
alter table public.advisories add column if not exists expires_at    timestamptz;
alter table public.advisories add column if not exists published_at  timestamptz not null default now();
alter table public.advisories add column if not exists created_at    timestamptz not null default now();
alter table public.advisories add column if not exists updated_at    timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'advisories_severity_check') then
    alter table public.advisories add constraint advisories_severity_check
      check (severity in ('advisory','warning','emergency','prepared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'advisories_kind_check') then
    alter table public.advisories add constraint advisories_kind_check
      check (kind in ('emergency','preparedness'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'advisories_author_id_fkey') then
    alter table public.advisories add constraint advisories_author_id_fkey
      foreign key (author_id) references public.profiles(id) on delete set null;
  end if;
end $$;

create index if not exists advisories_published_idx on public.advisories (published_at desc);

-- targeted advisories: one row per barangay the advisory is aimed at
create table if not exists public.advisory_targets (
  advisory_id uuid not null references public.advisories(id) on delete cascade,
  barangay_id uuid not null references public.barangays(id) on delete cascade,
  primary key (advisory_id, barangay_id)
);

-- -------------------------------------------------------- evacuation centres
create table if not exists public.evacuation_centers (
  id       uuid primary key default gen_random_uuid(),
  name     text not null default '',
  capacity int  not null default 0
);

alter table public.evacuation_centers add column if not exists name        text not null default '';
alter table public.evacuation_centers add column if not exists barangay_id uuid;
alter table public.evacuation_centers add column if not exists barangay    text not null default '';
alter table public.evacuation_centers add column if not exists address     text not null default '';
alter table public.evacuation_centers add column if not exists capacity    int  not null default 0;
alter table public.evacuation_centers add column if not exists occupancy   int  not null default 0;
alter table public.evacuation_centers add column if not exists status      text not null default 'open';
alter table public.evacuation_centers add column if not exists note        text not null default '';
alter table public.evacuation_centers add column if not exists lat         double precision;
alter table public.evacuation_centers add column if not exists lng         double precision;
alter table public.evacuation_centers add column if not exists created_at  timestamptz not null default now();
alter table public.evacuation_centers add column if not exists updated_at  timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'evacuation_centers_status_check') then
    alter table public.evacuation_centers add constraint evacuation_centers_status_check
      check (status in ('open','full','closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'evacuation_centers_barangay_id_fkey') then
    alter table public.evacuation_centers add constraint evacuation_centers_barangay_id_fkey
      foreign key (barangay_id) references public.barangays(id) on delete set null;
  end if;
end $$;

create index if not exists evacuation_centers_barangay_idx on public.evacuation_centers (barangay_id, status);

-- ------------------------------------------------------- emergency hotlines
create table if not exists public.emergency_hotlines (
  id             uuid primary key default gen_random_uuid(),
  agency_name    text not null default '',
  contact_number text not null default ''
);

alter table public.emergency_hotlines add column if not exists agency_name    text not null default '';
alter table public.emergency_hotlines add column if not exists contact_number text not null default '';
alter table public.emergency_hotlines add column if not exists scope          text not null default 'Municipality-wide';
alter table public.emergency_hotlines add column if not exists description    text not null default '';
alter table public.emergency_hotlines add column if not exists barangay_id    uuid;
alter table public.emergency_hotlines add column if not exists active         boolean not null default true;
alter table public.emergency_hotlines add column if not exists created_at     timestamptz not null default now();
alter table public.emergency_hotlines add column if not exists updated_at     timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'emergency_hotlines_barangay_id_fkey') then
    alter table public.emergency_hotlines add constraint emergency_hotlines_barangay_id_fkey
      foreign key (barangay_id) references public.barangays(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------- shared updated_at help
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','reports','advisories','evacuation_centers','emergency_hotlines']
  loop
    if not exists (
      select 1 from pg_trigger tg
        join pg_class c on c.oid = tg.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and tg.tgname = t || '_touch'
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
        t || '_touch', t);
    end if;
  end loop;
end $$;
