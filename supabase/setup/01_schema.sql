-- UniGuard: full database setup for a NEW, EMPTY Supabase project.
-- Generated from supabase/migrations/001..023 in order. Paste into the SQL editor and run once.

-- ===================== 001_align_core_tables.sql =====================
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


-- ===================== 002_report_workflow.sql =====================
-- ============================================================================
--  UniGuard · 002 · Report workflow: human code, corroboration, status history
--
--  Additive only. Creates the corroboration table, the status history table,
--  the UG-YYYY-NNNN code generator and the crowd-corroboration verification
--  trigger described in Phase 1.
-- ============================================================================

-- ------------------------------------------------- human readable report code
create sequence if not exists public.report_code_seq start 1;

create or replace function public.assign_report_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'UG-' || to_char(now(), 'YYYY') || '-' ||
                lpad(nextval('public.report_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_assign_code'
  ) then
    create trigger reports_assign_code
      before insert on public.reports
      for each row execute function public.assign_report_code();
  end if;
end $$;

-- ------------------------------------------------------- report corroborations
create table if not exists public.report_corroborations (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  note       text not null default '',
  created_at timestamptz not null default now(),
  constraint report_corroborations_unique unique (report_id, user_id)
);

create index if not exists corroborations_report_idx on public.report_corroborations (report_id, created_at desc);
create index if not exists corroborations_user_idx   on public.report_corroborations (user_id, created_at desc);

-- the corroborating user is always taken from the session, and the reporter of
-- the report may not corroborate their own submission
create or replace function public.guard_corroboration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reporter uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to corroborate a report';
  end if;
  new.user_id := auth.uid();

  select reporter_id into v_reporter from public.reports where id = new.report_id;
  if v_reporter is null then
    raise exception 'That report does not exist';
  end if;
  if v_reporter = new.user_id then
    raise exception 'You cannot corroborate your own report';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'report_corroborations' and tg.tgname = 'corroborations_guard'
  ) then
    create trigger corroborations_guard
      before insert on public.report_corroborations
      for each row execute function public.guard_corroboration();
  end if;
end $$;

-- ------------------------------------------------------- report status history
create table if not exists public.report_status_history (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.profiles(id) on delete set null,
  reason      text not null default 'manual',
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists status_history_report_idx on public.report_status_history (report_id, created_at);

-- legal transitions only, unless the caller is LGU
create or replace function public.guard_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok  boolean;
  v_lgu boolean;
begin
  if new.status is distinct from old.status then
    v_ok := case
      when old.status = 'reported'   and new.status in ('verified','dispatched','resolved') then true
      when old.status = 'verified'   and new.status in ('dispatched','resolved')           then true
      when old.status = 'dispatched' and new.status = 'resolved'                            then true
      else false
    end;

    if not v_ok then
      select (role = 'lgu_ldrrmc') into v_lgu from public.profiles where id = auth.uid();
      if not coalesce(v_lgu, false) then
        raise exception 'Illegal status change from % to %', old.status, new.status;
      end if;
    end if;
  end if;

  if new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.log_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.report_status_history (report_id, from_status, to_status, changed_by, reason)
    values (new.id, old.status, new.status, auth.uid(),
            coalesce(current_setting('uniguard.reason', true), 'manual'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_guard_status'
  ) then
    create trigger reports_guard_status
      before update on public.reports
      for each row execute function public.guard_report_status();
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_log_status'
  ) then
    create trigger reports_log_status
      after update on public.reports
      for each row execute function public.log_report_status();
  end if;
end $$;

-- --------------------------------------------- crowd corroboration verification
-- Three distinct people (the reporter counts as one) confirming the same hazard
-- in the same barangay within a six hour window around the report verifies it.
create or replace function public.apply_corroboration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_barangay_id uuid;
  v_barangay    text;
  v_hazard      text;
  v_created     timestamptz;
  v_count       int;
  v_row         record;
begin
  select barangay_id, barangay, hazard_type, created_at
    into v_barangay_id, v_barangay, v_hazard, v_created
    from public.reports where id = new.report_id;

  if v_hazard is null then
    return new;
  end if;

  select count(distinct u) into v_count from (
    select r.reporter_id as u
      from public.reports r
     where r.hazard_type = v_hazard
       and (r.barangay_id is not distinct from v_barangay_id)
       and r.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
    union
    select c.user_id
      from public.report_corroborations c
      join public.reports r2 on r2.id = c.report_id
     where r2.hazard_type = v_hazard
       and (r2.barangay_id is not distinct from v_barangay_id)
       and r2.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
  ) s;

  if v_count >= 3 then
    perform set_config('uniguard.reason', 'auto_corroboration', true);
    for v_row in
      select id from public.reports
       where hazard_type = v_hazard
         and (barangay_id is not distinct from v_barangay_id)
         and status = 'reported'
         and created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
    loop
      update public.reports set status = 'verified' where id = v_row.id;
    end loop;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'report_corroborations' and tg.tgname = 'corroborations_verify'
  ) then
    create trigger corroborations_verify
      after insert on public.report_corroborations
      for each row execute function public.apply_corroboration();
  end if;
end $$;

-- ------------------------------------------------------------ helper: my code
-- used by later phases to render UG-YYYY-NNNN consistently
create or replace function public.format_report_code(seq_value bigint, at_time timestamptz default now())
returns text language sql immutable as $$
  select 'UG-' || to_char(at_time, 'YYYY') || '-' || lpad(seq_value::text, 4, '0');
$$;


-- ===================== 003_notifications_audit.sql =====================
-- ============================================================================
--  UniGuard · 003 · Notifications, push subscriptions and the audit log
--
--  Additive only.
-- ============================================================================

-- -------------------------------------------------------------- notifications
-- The in-app inbox. One row per recipient so read state is per person.
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null default '',
  body        text not null default '',
  tone        text not null default 'advisory',
  icon        text,
  report_id   uuid references public.reports(id) on delete cascade,
  advisory_id uuid references public.advisories(id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.notifications add column if not exists user_id     uuid;
alter table public.notifications add column if not exists title       text not null default '';
alter table public.notifications add column if not exists body        text not null default '';
alter table public.notifications add column if not exists tone        text not null default 'advisory';
alter table public.notifications add column if not exists icon        text;
alter table public.notifications add column if not exists report_id   uuid;
alter table public.notifications add column if not exists advisory_id uuid;
alter table public.notifications add column if not exists read_at     timestamptz;
alter table public.notifications add column if not exists created_at  timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_tone_check') then
    alter table public.notifications add constraint notifications_tone_check
      check (tone in ('emergency','warning','advisory','prepared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_user_id_fkey') then
    alter table public.notifications add constraint notifications_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------- push subscriptions
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null default '',
  auth       text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ------------------------------------------------------------------- audit log
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text not null default '',
  entity_id  uuid,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_entity_idx  on public.audit_log (entity, entity_id);

-- a helper every later phase uses to write an audit entry
create or replace function public.write_audit(
  p_action text, p_entity text default '', p_entity_id uuid default null, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), p_action, coalesce(p_entity, ''), p_entity_id, coalesce(p_meta, '{}'::jsonb));
$$;

-- ---------------------------------------------- notify same-barangay residents
-- Fan an advisory out to the residents of its target barangays (or everyone when
-- it is citywide). Called after an advisory is published.
create or replace function public.fanout_advisory(p_advisory_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_adv      record;
  v_inserted int := 0;
begin
  select * into v_adv from public.advisories where id = p_advisory_id;
  if v_adv is null then
    return 0;
  end if;

  with targets as (
    select p.id
      from public.profiles p
     where p.disabled = false
       and (
         v_adv.citywide
         or exists (select 1 from public.advisory_targets t
                     where t.advisory_id = v_adv.id and t.barangay_id = p.barangay_id)
       )
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, advisory_id)
    select id, v_adv.title, left(v_adv.body, 240), v_adv.severity, 'megaphone', v_adv.id from targets
    returning 1
  )
  select count(*) into v_inserted from ins;

  return v_inserted;
end;
$$;


-- ===================== 004_rls_policies.sql =====================
-- ============================================================================
--  UniGuard · 004 · Row level security
--
--  Security lives here, not in the UI. Every rule reads the caller's role and
--  barangay from public.profiles, never from the client and never from
--  auth.users.raw_user_meta_data, which the user controls.
--
--  Note on idempotency: tables are only ever created or altered. Policies are
--  dropped and recreated because that is the only way to change a policy
--  definition; no data is touched.
-- ============================================================================

-- --------------------------------------------------------------- role helpers
create or replace function public.current_role_key()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

create or replace function public.is_lgu()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'lgu_ldrrmc';
$$;

create or replace function public.is_official()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'barangay_official';
$$;

create or replace function public.my_barangay_id()
returns uuid language sql stable security definer set search_path = public as $$
  select barangay_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_barangay_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(barangay, '') from public.profiles where id = auth.uid();
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not disabled from public.profiles where id = auth.uid()), false);
$$;

-- --------------------------------------------------- profile field protection
-- A user may edit their own name and phone. Role, barangay assignment and the
-- disabled flag can only be changed by an LGU administrator.
create or replace function public.guard_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
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
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles' and tg.tgname = 'profiles_guard_fields'
  ) then
    create trigger profiles_guard_fields
      before update on public.profiles
      for each row execute function public.guard_profile_fields();
  end if;
end $$;

-- ------------------------------------------------------- report insert guard
-- The reporter is taken from the session, and a citizen always files for their
-- own barangay so nobody can post into another barangay's queue.
create or replace function public.guard_report_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role     text;
  v_brgy_id  uuid;
  v_brgy     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to file a report';
  end if;

  new.reporter_id := auth.uid();

  select role, barangay_id, barangay into v_role, v_brgy_id, v_brgy
    from public.profiles where id = auth.uid();

  if coalesce(v_role, 'citizen') = 'citizen' then
    if v_brgy_id is not null then
      new.barangay_id := v_brgy_id;
    end if;
    if coalesce(v_brgy, '') <> '' then
      new.barangay := v_brgy;
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_guard_insert'
  ) then
    create trigger reports_guard_insert
      before insert on public.reports
      for each row execute function public.guard_report_insert();
  end if;
end $$;

-- --------------------------------------------------------------- enable RLS
alter table public.barangays              enable row level security;
alter table public.profiles               enable row level security;
alter table public.reports                enable row level security;
alter table public.report_corroborations  enable row level security;
alter table public.report_status_history  enable row level security;
alter table public.advisories             enable row level security;
alter table public.advisory_targets       enable row level security;
alter table public.evacuation_centers     enable row level security;
alter table public.emergency_hotlines     enable row level security;
alter table public.notifications          enable row level security;
alter table public.push_subscriptions     enable row level security;
alter table public.audit_log              enable row level security;

-- ------------------------------------------------------------------ barangays
drop policy if exists barangays_read on public.barangays;
create policy barangays_read on public.barangays
  for select to authenticated using (true);

drop policy if exists barangays_write on public.barangays;
create policy barangays_write on public.barangays
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());

-- ------------------------------------------------------------------- profiles
-- read: yourself, an official sees residents of their own barangay, LGU sees all
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_lgu())
  with check (id = auth.uid() or public.is_lgu());

-- -------------------------------------------------------------------- reports
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_active_user());

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports
  for select to authenticated using (
    reporter_id = auth.uid()
    or public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
  );

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
    or (reporter_id = auth.uid() and created_at > now() - interval '15 minutes')
  )
  with check (true);

drop policy if exists reports_delete on public.reports;
create policy reports_delete on public.reports
  for delete to authenticated using (public.is_lgu());

-- ------------------------------------------------ reports for same barangay
-- Residents need to see what is happening around them without seeing who filed
-- what. The view runs with owner rights and applies its own filter, exposing no
-- reporter identity at all.
-- a later migration widens this view; drop it first so this file stays re-runnable
drop view if exists public.reports_feed;
create or replace view public.reports_feed as
select r.id,
       r.code,
       r.barangay_id,
       r.barangay,
       r.hazard_type,
       r.severity,
       r.urgency,
       r.status,
       r.description,
       r.lat,
       r.lng,
       r.photo_path,
       r.created_at,
       r.updated_at,
       r.resolved_at,
       (select count(*) from public.report_corroborations c where c.report_id = r.id) as corroborations,
       (r.reporter_id = auth.uid()) as is_mine
  from public.reports r
 where r.reporter_id = auth.uid()
    or public.is_lgu()
    or (public.is_official() and r.barangay_id = public.my_barangay_id())
    or (r.barangay_id is not null and r.barangay_id = public.my_barangay_id());

do $$ begin
  execute 'alter view public.reports_feed set (security_invoker = false)';
exception when others then null;
end $$;

grant select on public.reports_feed to authenticated;

-- ---------------------------------------------------- report corroborations
drop policy if exists corroborations_read on public.report_corroborations;
create policy corroborations_read on public.report_corroborations
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_lgu()
    or exists (
      select 1 from public.reports r
       where r.id = report_id
         and (r.reporter_id = auth.uid()
              or (public.is_official() and r.barangay_id = public.my_barangay_id()))
    )
  );

drop policy if exists corroborations_insert on public.report_corroborations;
create policy corroborations_insert on public.report_corroborations
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());

-- ------------------------------------------------------ report status history
drop policy if exists status_history_read on public.report_status_history;
create policy status_history_read on public.report_status_history
  for select to authenticated using (
    public.is_lgu()
    or exists (
      select 1 from public.reports r
       where r.id = report_id
         and (r.reporter_id = auth.uid()
              or (public.is_official() and r.barangay_id = public.my_barangay_id()))
    )
  );
-- no insert policy: history rows are written by a security definer trigger only

-- ----------------------------------------------------------------- advisories
drop policy if exists advisories_read on public.advisories;
create policy advisories_read on public.advisories
  for select to authenticated using (true);

drop policy if exists advisories_insert on public.advisories;
create policy advisories_insert on public.advisories
  for insert to authenticated
  with check (public.is_lgu() or public.is_official());

drop policy if exists advisories_update on public.advisories;
create policy advisories_update on public.advisories
  for update to authenticated
  using (public.is_lgu() or author_id = auth.uid())
  with check (public.is_lgu() or author_id = auth.uid());

drop policy if exists advisories_delete on public.advisories;
create policy advisories_delete on public.advisories
  for delete to authenticated using (public.is_lgu());

drop policy if exists advisory_targets_read on public.advisory_targets;
create policy advisory_targets_read on public.advisory_targets
  for select to authenticated using (true);

drop policy if exists advisory_targets_write on public.advisory_targets;
create policy advisory_targets_write on public.advisory_targets
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());

-- -------------------------------------------------------- evacuation centres
-- everyone reads; officials manage their own barangay; LGU manages citywide
drop policy if exists evacuation_read on public.evacuation_centers;
create policy evacuation_read on public.evacuation_centers
  for select to authenticated using (true);

drop policy if exists evacuation_insert on public.evacuation_centers;
create policy evacuation_insert on public.evacuation_centers
  for insert to authenticated
  with check (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()));

drop policy if exists evacuation_update on public.evacuation_centers;
create policy evacuation_update on public.evacuation_centers
  for update to authenticated
  using (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()))
  with check (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()));

drop policy if exists evacuation_delete on public.evacuation_centers;
create policy evacuation_delete on public.evacuation_centers
  for delete to authenticated using (public.is_lgu());

-- ------------------------------------------------------------- hotlines
-- everyone reads; only LGU manages the directory
drop policy if exists hotlines_read on public.emergency_hotlines;
create policy hotlines_read on public.emergency_hotlines
  for select to authenticated using (true);

drop policy if exists hotlines_write on public.emergency_hotlines;
create policy hotlines_write on public.emergency_hotlines
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());

-- ------------------------------------------------------------ notifications
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());
-- no insert policy: notifications are created by security definer functions

-- ------------------------------------------------------ push subscriptions
drop policy if exists push_read on public.push_subscriptions;
create policy push_read on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_write on public.push_subscriptions;
create policy push_write on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------- audit log
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated using (public.is_lgu());
-- no insert policy: entries are written by security definer functions


-- ===================== 005_storage_bucket.sql =====================
-- ============================================================================
--  UniGuard · 005 · Storage bucket for report photos
--
--  Bucket "reports": private, authenticated upload only, images only, 5 MB cap,
--  and every object path must start with the uploader's own user id
--  (<user_id>/<report_code>/<file>). Reading is limited to the uploader, the
--  officials of that uploader's barangay, and LGU.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------- upload
drop policy if exists reports_objects_insert on storage.objects;
create policy reports_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reports'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- --------------------------------------------------------------------- read
drop policy if exists reports_objects_read on storage.objects;
create policy reports_objects_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reports'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_lgu()
      or (
        public.is_official()
        and exists (
          select 1 from public.profiles p
           where p.id::text = (storage.foldername(name))[1]
             and p.barangay_id = public.my_barangay_id()
        )
      )
    )
  );

-- ------------------------------------------------------------------- delete
drop policy if exists reports_objects_delete on storage.objects;
create policy reports_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reports'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_lgu()
    )
  );

-- Note: updates to objects are intentionally not allowed. Upload a new object
-- and update reports.photo_path instead, so evidence is never silently replaced.


-- ===================== 006_auth_profile_and_roles.sql =====================
-- ============================================================================
--  UniGuard · 006 · Auth profile trigger and secure role administration
--
--  Additive only.
--
--  1. Every new auth user gets a profiles row automatically, with the role
--     FORCED to 'citizen'. A self signup can never become an official.
--  2. Officials and LGU staff are created or promoted only through a function
--     that checks the caller is lgu_ldrrmc and writes an audit entry.
-- ============================================================================

-- ---------------------------------------------------- profile for every user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_barangay text;
  v_barangay_id uuid;
begin
  v_barangay := coalesce(new.raw_user_meta_data->>'barangay', '');
  if v_barangay <> '' then
    select id into v_barangay_id from public.barangays where name = v_barangay limit 1;
  end if;

  insert into public.profiles (id, full_name, email, phone, barangay, barangay_id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', ''),
    v_barangay,
    v_barangay_id,
    /* role is never taken from the client or from user metadata */
    'citizen'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users' and tg.tgname = 'on_auth_user_created'
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

-- backfill any account that predates the trigger
insert into public.profiles (id, full_name, email, role)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name', ''),
       u.email,
       'citizen'
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null and u.email is not null;

-- ------------------------------------------------------- role administration
create or replace function public.admin_set_user_role(
  p_user uuid,
  p_role text,
  p_barangay_id uuid default null
)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.profiles;
  v_barangay text;
  v_before text;
begin
  if not public.is_lgu() then
    raise exception 'Only LGU / LDRRMC administrators can change roles';
  end if;
  if p_role not in ('citizen', 'barangay_official', 'lgu_ldrrmc') then
    raise exception 'Unknown role: %', p_role;
  end if;

  select role into v_before from public.profiles where id = p_user;
  if v_before is null then
    raise exception 'That account does not exist';
  end if;

  v_barangay := null;
  if p_barangay_id is not null then
    select name into v_barangay from public.barangays where id = p_barangay_id;
  end if;

  update public.profiles
     set role        = p_role,
         barangay_id = coalesce(p_barangay_id, barangay_id),
         barangay    = coalesce(v_barangay, barangay),
         updated_at  = now()
   where id = p_user
  returning * into v_row;

  perform public.write_audit('user.role_changed', 'profiles', p_user,
    jsonb_build_object('from', v_before, 'to', p_role, 'barangay_id', p_barangay_id));

  return v_row;
end;
$$;

create or replace function public.admin_set_user_disabled(p_user uuid, p_disabled boolean)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if not public.is_lgu() then
    raise exception 'Only LGU / LDRRMC administrators can disable an account';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot disable your own account';
  end if;

  update public.profiles
     set disabled = p_disabled, updated_at = now()
   where id = p_user
  returning * into v_row;

  if v_row.id is null then
    raise exception 'That account does not exist';
  end if;

  perform public.write_audit(case when p_disabled then 'user.disabled' else 'user.enabled' end,
    'profiles', p_user, jsonb_build_object('disabled', p_disabled));

  return v_row;
end;
$$;

create or replace function public.admin_set_user_barangay(p_user uuid, p_barangay_id uuid)
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.profiles;
  v_name text;
begin
  if not public.is_lgu() then
    raise exception 'Only LGU / LDRRMC administrators can assign barangays';
  end if;

  select name into v_name from public.barangays where id = p_barangay_id;

  update public.profiles
     set barangay_id = p_barangay_id,
         barangay    = coalesce(v_name, ''),
         updated_at  = now()
   where id = p_user
  returning * into v_row;

  if v_row.id is null then
    raise exception 'That account does not exist';
  end if;

  perform public.write_audit('user.barangay_changed', 'profiles', p_user,
    jsonb_build_object('barangay_id', p_barangay_id, 'barangay', v_name));

  return v_row;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text, uuid) from public;
revoke all on function public.admin_set_user_disabled(uuid, boolean) from public;
revoke all on function public.admin_set_user_barangay(uuid, uuid) from public;
grant execute on function public.admin_set_user_role(uuid, text, uuid) to authenticated;
grant execute on function public.admin_set_user_disabled(uuid, boolean) to authenticated;
grant execute on function public.admin_set_user_barangay(uuid, uuid) to authenticated;


-- ===================== 007_report_rpcs.sql =====================
-- ============================================================================
--  UniGuard · 007 · Report RPCs
--
--  Additive only. The client calls these instead of writing to the tables
--  directly, so every privileged action is authorised and audited server side.
-- ============================================================================

-- keep the note a client sends with a status change in the history row
create or replace function public.log_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.report_status_history (report_id, from_status, to_status, changed_by, reason, note)
    values (new.id, old.status, new.status, auth.uid(),
            coalesce(current_setting('uniguard.reason', true), 'manual'),
            coalesce(current_setting('uniguard.note', true), ''));
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------- corroboration
create or replace function public.corroborate_report(p_report_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_count  int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to corroborate a report';
  end if;
  if not public.is_active_user() then
    raise exception 'This account cannot corroborate reports';
  end if;

  insert into public.report_corroborations (report_id, user_id, note)
  values (p_report_id, auth.uid(), coalesce(p_note, ''));

  select status,
         (select count(*) from public.report_corroborations c where c.report_id = p_report_id)
    into v_status, v_count
    from public.reports where id = p_report_id;

  return jsonb_build_object(
    'corroborations', coalesce(v_count, 0),
    'status', v_status,
    'verified', v_status = 'verified',
    'threshold', 3
  );
end;
$$;

-- ------------------------------------------------------------ status advance
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row   public.reports;
  v_role  text;
  v_brgy  uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('reported', 'verified', 'dispatched', 'resolved') then
    raise exception 'Unknown status: %', p_next;
  end if;

  select role, barangay_id into v_role, v_brgy from public.profiles where id = auth.uid();

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can change an incident status';
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  update public.reports set status = p_next where id = p_report_id returning * into v_row;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('to', p_next, 'note', coalesce(p_note, '')));

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;

-- -------------------------------------------------------- responder dispatch
create table if not exists public.responders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  unit        text not null default '',
  contact     text not null default '',
  barangay_id uuid references public.barangays(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.report_assignments (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports(id) on delete cascade,
  responder_id uuid not null references public.responders(id) on delete cascade,
  assigned_by  uuid references public.profiles(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  released_at  timestamptz
);

create index if not exists report_assignments_report_idx on public.report_assignments (report_id) where released_at is null;

alter table public.responders         enable row level security;
alter table public.report_assignments enable row level security;

drop policy if exists responders_read on public.responders;
create policy responders_read on public.responders
  for select to authenticated using (public.is_lgu() or public.is_official());

drop policy if exists responders_write on public.responders;
create policy responders_write on public.responders
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());

drop policy if exists assignments_read on public.report_assignments;
create policy assignments_read on public.report_assignments
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or exists (select 1 from public.reports r where r.id = report_id and r.reporter_id = auth.uid())
  );

create or replace function public.assign_responder(p_report_id uuid, p_responder_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_brgy uuid;
  v_row  public.reports;
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select role, barangay_id into v_role, v_brgy from public.profiles where id = auth.uid();
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can assign responders';
  end if;

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then raise exception 'That report does not exist'; end if;
  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;

  select id into v_id from public.report_assignments
   where report_id = p_report_id and responder_id = p_responder_id and released_at is null;

  if v_id is null then
    insert into public.report_assignments (report_id, responder_id, assigned_by)
    values (p_report_id, p_responder_id, auth.uid())
    returning id into v_id;

    perform public.write_audit('report.responder_assigned', 'reports', p_report_id,
      jsonb_build_object('responder_id', p_responder_id));
  end if;

  return jsonb_build_object('assignment_id', v_id,
    'units', (select count(*) from public.report_assignments a
               where a.report_id = p_report_id and a.released_at is null));
end;
$$;

revoke all on function public.corroborate_report(uuid, text) from public;
revoke all on function public.advance_report_status(uuid, text, text) from public;
revoke all on function public.assign_responder(uuid, uuid) from public;
grant execute on function public.corroborate_report(uuid, text) to authenticated;
grant execute on function public.advance_report_status(uuid, text, text) to authenticated;
grant execute on function public.assign_responder(uuid, uuid) to authenticated;


-- ===================== 008_analytics_views.sql =====================
-- ============================================================================
--  UniGuard · 008 · Analytics views
--
--  Additive only. The console reads these instead of aggregating client side,
--  which keeps the numbers consistent and the payload small.
-- ============================================================================

-- incidents per hazard type over the last 30 days
create or replace view public.analytics_by_hazard as
select hazard_type,
       count(*)::bigint as total,
       count(*) filter (where severity = 'emergency')::bigint as emergency_total
  from public.reports
 where created_at >= now() - interval '30 days'
 group by hazard_type
 order by total desc;

-- live pipeline load
create or replace view public.analytics_pipeline as
select status, count(*)::bigint as total
  from public.reports
 group by status;

-- daily report volume for the trend chart
create or replace view public.analytics_daily as
select date_trunc('day', created_at)::date as day, count(*)::bigint as total
  from public.reports
 where created_at >= now() - interval '14 days'
 group by 1
 order by 1;

-- response performance: how long each stage took, from the history table
create or replace view public.analytics_response_times as
select r.id,
       r.code,
       r.barangay,
       r.severity,
       min(h.created_at) filter (where h.to_status = 'verified')   as verified_at,
       min(h.created_at) filter (where h.to_status = 'dispatched') as dispatched_at,
       r.resolved_at,
       extract(epoch from (min(h.created_at) filter (where h.to_status = 'dispatched') - r.created_at)) as seconds_to_dispatch,
       extract(epoch from (r.resolved_at - r.created_at)) as seconds_to_resolve
  from public.reports r
  left join public.report_status_history h on h.report_id = r.id
 group by r.id, r.code, r.barangay, r.severity, r.created_at, r.resolved_at;

-- corroboration quality: share of reports that auto verified as intended
create or replace view public.analytics_corroboration as
select
  count(*)::bigint as total_reports,
  count(*) filter (where status <> 'reported')::bigint as verified_or_beyond,
  count(*) filter (where exists (
    select 1 from public.report_status_history h
     where h.report_id = reports.id and h.reason = 'auto_corroboration'))::bigint as auto_verified
  from public.reports;

-- shelter occupancy snapshot
create or replace view public.analytics_shelters as
select status,
       count(*)::bigint as centres,
       coalesce(sum(capacity), 0)::bigint as capacity,
       coalesce(sum(occupancy), 0)::bigint as occupancy
  from public.evacuation_centers
 group by status;

grant select on public.analytics_by_hazard      to authenticated;
grant select on public.analytics_pipeline       to authenticated;
grant select on public.analytics_daily          to authenticated;
grant select on public.analytics_response_times to authenticated;
grant select on public.analytics_corroboration  to authenticated;
grant select on public.analytics_shelters       to authenticated;


-- ===================== 009_hardening.sql =====================
-- ============================================================================
--  UniGuard · 009 · Hardening: rate limiting, declarable emergencies, errors
--
--  Additive only.
-- ============================================================================

-- ------------------------------------------------------------- rate limiting
create table if not exists public.rate_limits (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  action       text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (user_id, action, window_start)
);

create or replace function public.check_rate_limit(p_action text, p_max int, p_window interval)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits   int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  /* bucket the window so concurrent calls land in the same row */
  v_window := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));

  insert into public.rate_limits (user_id, action, window_start, hits)
  values (auth.uid(), p_action, v_window, 1)
  on conflict (user_id, action, window_start)
  do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  if v_hits > p_max then
    raise exception 'Too many % actions in a short time. Please wait and try again.', p_action
      using hint = 'rate_limited';
  end if;
end;
$$;

alter table public.rate_limits enable row level security;

-- report spam guard: five reports per ten minutes per account
create or replace function public.guard_report_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.check_rate_limit('report', 5, interval '10 minutes');
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_rate_limit'
  ) then
    create trigger reports_rate_limit
      before insert on public.reports
      for each row execute function public.guard_report_rate();
  end if;
end $$;

-- ------------------------------------------------- declare an emergency (LGU)
create or replace function public.declare_emergency(
  p_title text,
  p_body text default '',
  p_area text default 'Municipality-wide'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id      uuid;
  v_devices int;
  v_reached int;
begin
  if not public.is_lgu() then
    raise exception 'Only LGU / LDRRMC can declare an emergency';
  end if;

  perform public.check_rate_limit('declare', 3, interval '30 minutes');

  insert into public.advisories (author_id, title, body, severity, kind, affected_area, citywide, published_at)
  values (auth.uid(), p_title, coalesce(p_body, ''), 'emergency', 'emergency', coalesce(p_area, 'Municipality-wide'), true, now())
  returning id into v_id;

  v_reached := public.fanout_advisory(v_id);

  select count(*) into v_devices from public.push_subscriptions;

  perform public.write_audit('emergency.declared', 'advisories', v_id,
    jsonb_build_object('title', p_title, 'area', p_area, 'subscribed_devices', v_devices, 'notified', v_reached));

  return jsonb_build_object('advisory_id', v_id, 'devices', v_devices, 'notified', v_reached);
end;
$$;

revoke all on function public.declare_emergency(text, text, text) from public;
grant execute on function public.declare_emergency(text, text, text) to authenticated;

-- ------------------------------------------------------------ client errors
create table if not exists public.client_errors (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  message    text not null,
  context    jsonb not null default '{}'::jsonb,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;

drop policy if exists client_errors_read on public.client_errors;
create policy client_errors_read on public.client_errors
  for select to authenticated using (public.is_lgu());

create or replace function public.log_client_error(p_message text, p_context jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.client_errors (user_id, message, context, user_agent)
  values (auth.uid(), left(coalesce(p_message, 'unknown'), 500), coalesce(p_context, '{}'::jsonb), '');
end;
$$;

grant execute on function public.log_client_error(text, jsonb) to authenticated;

-- ------------------------------------------------------------- housekeeping
/* Drop rate limit buckets older than a day. Call from a scheduled job:
     select cron.schedule('uniguard-cleanup', '0 4 * * *', $$select public.cleanup_rate_limits()$$);
   or from an Edge Function on a schedule. */
create or replace function public.cleanup_rate_limits()
returns int language plpgsql security definer set search_path = public as $$
declare v_deleted int;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


-- ===================== 010_hazard_types.sql =====================
-- ============================================================================
--  UniGuard · 010 · Hazard "Others" text + a Rejected report status
--
--  Additive only. Two independent changes needed by the revised client:
--
--  1. reports.hazard_other_text — the free-text description a resident types
--     when they pick "Others" on the hazard dropdown (js/hazard-types.js).
--     hazard_type keeps storing the canonical label ("Others"); the specific
--     text is a separate column so hazard-type colour/icon/analytics lookups
--     never depend on what a resident typed.
--
--  2. A 'rejected' report status, so the LGU dashboard's pipeline can be
--     Pending -> Verified -> In Progress -> Resolved, with Rejected as the
--     other way a report can be closed (duplicate, not actionable, hoax).
--     Existing rows are untouched — nothing currently has this status, and
--     the normal forward path (reported -> verified -> dispatched -> resolved)
--     is unchanged.
-- ============================================================================

-- ------------------------------------------------------- hazard "Others" text
alter table public.reports add column if not exists hazard_other_text text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_other_requires_text') then
    alter table public.reports add constraint reports_other_requires_text
      check (hazard_type is distinct from 'Others' or (hazard_other_text is not null and length(trim(hazard_other_text)) > 0))
      not valid;
  end if;
end $$;

-- validate separately so an already-clean table applies this instantly, and a
-- table with a pre-existing inconsistent row does not fail the whole migration
alter table public.reports validate constraint reports_other_requires_text;

-- reports_feed (migration 004) is the read view the client queries; recreate
-- it with the new column so it keeps returning every column the client reads
-- the column list changes, which CREATE OR REPLACE VIEW cannot do, so drop it first
drop view if exists public.reports_feed;
create or replace view public.reports_feed as
  select r.id, r.code, r.hazard_type, r.hazard_other_text, r.barangay_id, r.barangay, r.description,
         r.severity, r.urgency, r.status, r.lat, r.lng, r.photo_path, r.reporter_id,
         r.resolved_at, r.created_at, r.updated_at,
         (select count(*) from public.report_corroborations c where c.report_id = r.id) as corroborations
    from public.reports r;

-- keep whatever security_invoker setting migration 004 established
do $$
begin
  perform 1 from pg_class where relname = 'reports_feed';
  if found then
    execute 'alter view public.reports_feed set (security_invoker = false)';
  end if;
end $$;

grant select on public.reports_feed to authenticated;

-- ---------------------------------------------------------------- rejected
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status in ('reported', 'verified', 'dispatched', 'resolved', 'rejected'));

-- a report may be rejected from any open state, but not un-rejected or moved
-- on from resolved/rejected — those are final states
create or replace function public.guard_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok  boolean;
  v_lgu boolean;
begin
  if new.status is distinct from old.status then
    v_ok := case
      when old.status = 'reported'   and new.status in ('verified','dispatched','resolved','rejected') then true
      when old.status = 'verified'   and new.status in ('dispatched','resolved','rejected')             then true
      when old.status = 'dispatched' and new.status in ('resolved','rejected')                          then true
      else false
    end;

    if not v_ok then
      select (role = 'lgu_ldrrmc') into v_lgu from public.profiles where id = auth.uid();
      if not coalesce(v_lgu, false) then
        raise exception 'Illegal status change from % to %', old.status, new.status;
      end if;
    end if;
  end if;

  if new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

-- advance_report_status (migration 007) whitelists the statuses it accepts;
-- add 'rejected' to that whitelist
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row   public.reports;
  v_role  text;
  v_brgy  uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('reported', 'verified', 'dispatched', 'resolved', 'rejected') then
    raise exception 'Unknown status: %', p_next;
  end if;

  select role, barangay_id into v_role, v_brgy from public.profiles where id = auth.uid();

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can change an incident status';
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  update public.reports set status = p_next where id = p_report_id returning * into v_row;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('to', p_next, 'note', coalesce(p_note, '')));

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;


-- ===================== 011_relief_assistance.sql =====================
-- ============================================================================
--  UniGuard · 011 · Relief Assistance Information
--
--  Additive only. Two tables:
--    relief_distributions   per-barangay distribution schedule + location + docs
--    authorized_beneficiaries  per-barangay, who is allowed to claim on
--                               behalf of a named beneficiary (searchable by staff)
--
--  Both have RLS: citizens read everything in their municipality (so they can
--  see distribution info for any barangay); only LGU/officials write.
-- ============================================================================

-- ------------------------------------------------------- relief_distributions
create table if not exists public.relief_distributions (
  id              uuid primary key default gen_random_uuid(),
  barangay_id     uuid references public.barangays(id) on delete set null,
  barangay        text not null default '',
  title           text not null default '',
  location_name   text not null default '',
  address         text not null default '',
  lat             double precision,
  lng             double precision,
  distribution_at timestamptz,
  contact_person  text not null default '',
  contact_phone   text not null default '',
  eligibility     jsonb not null default '[]'::jsonb,
  required_docs   jsonb not null default '[]'::jsonb,
  note            text not null default '',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.relief_distributions add column if not exists barangay_id     uuid;
alter table public.relief_distributions add column if not exists barangay        text not null default '';
alter table public.relief_distributions add column if not exists title           text not null default '';
alter table public.relief_distributions add column if not exists location_name   text not null default '';
alter table public.relief_distributions add column if not exists address         text not null default '';
alter table public.relief_distributions add column if not exists lat             double precision;
alter table public.relief_distributions add column if not exists lng             double precision;
alter table public.relief_distributions add column if not exists distribution_at timestamptz;
alter table public.relief_distributions add column if not exists contact_person  text not null default '';
alter table public.relief_distributions add column if not exists contact_phone   text not null default '';
alter table public.relief_distributions add column if not exists eligibility     jsonb not null default '[]'::jsonb;
alter table public.relief_distributions add column if not exists required_docs   jsonb not null default '[]'::jsonb;
alter table public.relief_distributions add column if not exists note            text not null default '';
alter table public.relief_distributions add column if not exists active          boolean not null default true;
alter table public.relief_distributions add column if not exists created_at      timestamptz not null default now();
alter table public.relief_distributions add column if not exists updated_at      timestamptz not null default now();

create index if not exists relief_distributions_barangay_idx on public.relief_distributions (barangay_id, active);
create index if not exists relief_distributions_active_idx   on public.relief_distributions (active, distribution_at);

alter table public.relief_distributions enable row level security;

drop policy if exists relief_distributions_read on public.relief_distributions;
create policy relief_distributions_read on public.relief_distributions
  for select to authenticated using (true);

drop policy if exists relief_distributions_write on public.relief_distributions;
create policy relief_distributions_write on public.relief_distributions
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());

-- ------------------------------------------- authorized_beneficiaries (per brgy)
-- A beneficiary can be a household, senior citizen, PWD, etc. The LGU uploads the
-- authorized list so staff on the spot can verify a claimant against it.
create table if not exists public.authorized_beneficiaries (
  id              uuid primary key default gen_random_uuid(),
  barangay_id     uuid references public.barangays(id) on delete set null,
  barangay        text not null default '',
  beneficiary_name text not null default '',
  claimant_name   text not null default '',
  claimant_id     text not null default '',
  category        text not null default '',
  valid_until     timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.authorized_beneficiaries add column if not exists barangay_id       uuid;
alter table public.authorized_beneficiaries add column if not exists barangay          text not null default '';
alter table public.authorized_beneficiaries add column if not exists beneficiary_name  text not null default '';
alter table public.authorized_beneficiaries add column if not exists claimant_name     text not null default '';
alter table public.authorized_beneficiaries add column if not exists claimant_id       text not null default '';
alter table public.authorized_beneficiaries add column if not exists category          text not null default '';
alter table public.authorized_beneficiaries add column if not exists valid_until       timestamptz;
alter table public.authorized_beneficiaries add column if not exists active            boolean not null default true;
alter table public.authorized_beneficiaries add column if not exists created_at        timestamptz not null default now();
alter table public.authorized_beneficiaries add column if not exists updated_at        timestamptz not null default now();

create index if not exists authorized_beneficiaries_barangay_idx on public.authorized_beneficiaries (barangay_id, active);
-- Name search index. It needs pg_trgm, so enable the extension first; if either
-- step is unavailable the migration still runs, search just is not indexed.
do $$
begin
  begin
    create extension if not exists pg_trgm;
  exception when others then null;
  end;
  begin
    execute 'create index if not exists authorized_beneficiaries_name_trgm on public.authorized_beneficiaries using gin (lower(beneficiary_name) gin_trgm_ops)';
  exception when others then null;
  end;
end $$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension if not exists pg_trgm;
  end if;
exception when others then null;
end $$;

alter table public.authorized_beneficiaries enable row level security;

drop policy if exists authorized_beneficiaries_read on public.authorized_beneficiaries;
create policy authorized_beneficiaries_read on public.authorized_beneficiaries
  for select to authenticated using (true);

drop policy if exists authorized_beneficiaries_write on public.authorized_beneficiaries;
create policy authorized_beneficiaries_write on public.authorized_beneficiaries
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());


-- ===================== 012_road_works.sql =====================
-- ============================================================================
--  UniGuard · 012 · Road Work posts
--
--  Additive only. A road-work post is created by an LGU/official and fans out
--  to a notification row per affected-barangay resident (same pattern as the
--  advisory fan-out in migration 003).
-- ============================================================================

create table if not exists public.road_work_posts (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid references public.profiles(id) on delete set null,
  title           text not null default '',
  description     text not null default '',
  barangay_id     uuid references public.barangays(id) on delete set null,
  barangay        text not null default '',
  road_name       text not null default '',
  address         text not null default '',
  lat             double precision,
  lng             double precision,
  expected_start  timestamptz,
  expected_end    timestamptz,
  citywide        boolean not null default false,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.road_work_posts add column if not exists author_id      uuid;
alter table public.road_work_posts add column if not exists title          text not null default '';
alter table public.road_work_posts add column if not exists description    text not null default '';
alter table public.road_work_posts add column if not exists barangay_id    uuid;
alter table public.road_work_posts add column if not exists barangay       text not null default '';
alter table public.road_work_posts add column if not exists road_name      text not null default '';
alter table public.road_work_posts add column if not exists address        text not null default '';
alter table public.road_work_posts add column if not exists lat            double precision;
alter table public.road_work_posts add column if not exists lng             double precision;
alter table public.road_work_posts add column if not exists expected_start timestamptz;
alter table public.road_work_posts add column if not exists expected_end   timestamptz;
alter table public.road_work_posts add column if not exists citywide       boolean not null default false;
alter table public.road_work_posts add column if not exists status         text not null default 'active';
alter table public.road_work_posts add column if not exists created_at      timestamptz not null default now();
alter table public.road_work_posts add column if not exists updated_at     timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_work_posts_status_check') then
    alter table public.road_work_posts add constraint road_work_posts_status_check
      check (status in ('active','completed','cancelled'));
  end if;
end $$;

create index if not exists road_work_posts_active_idx on public.road_work_posts (status, created_at desc);

alter table public.road_work_posts enable row level security;

drop policy if exists road_work_posts_read on public.road_work_posts;
create policy road_work_posts_read on public.road_work_posts
  for select to authenticated using (true);

drop policy if exists road_work_posts_write on public.road_work_posts;
create policy road_work_posts_write on public.road_work_posts
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());

-- add a nullable road_work_id column to notifications so tapping one navigates there
alter table public.notifications add column if not exists road_work_id uuid;
alter table public.notifications add column if not exists relief_id     uuid;
alter table public.notifications add column if not exists sos_id        uuid;
alter table public.notifications add column if not exists type          text;

-- Fan a road-work post out to the residents of its target barangays (or everyone
-- when it is citywide). Mirrors fanout_advisory in migration 003.
create or replace function public.fanout_road_work(p_post_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_post     record;
  v_inserted int := 0;
begin
  select * into v_post from public.road_work_posts where id = p_post_id;
  if v_post is null then return 0; end if;

  with targets as (
    select p.id
      from public.profiles p
     where p.disabled = false
       and (
         v_post.citywide
         or exists (select 1 from public.barangays b
                     where b.id = p.barangay_id and b.name = v_post.barangay)
       )
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, type, road_work_id)
    select id, v_post.title, left(coalesce(v_post.description, ''), 240), 'warning', 'road', 'road_work', v_post.id from targets
    returning 1
  )
  select count(*) into v_inserted from ins;

  return v_inserted;
end;
$$;

grant execute on function public.fanout_road_work(uuid) to authenticated;


-- ===================== 013_faqs.sql =====================
-- ============================================================================
--  UniGuard · 013 · Frequently asked questions (CRUD by LGU)
--
--  Additive only. The FAQ is fully manageable by the LGU without a code release.
--  Rows are ordered by sort_order, then by created_at; category groups them
--  visually (e.g. "Reports", "Relief", "Evacuation").
-- ============================================================================

create table if not exists public.faqs (
  id          uuid primary key default gen_random_uuid(),
  category    text not null default 'General',
  question    text not null default '',
  answer      text not null default '',
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.faqs add column if not exists category   text not null default 'General';
alter table public.faqs add column if not exists question   text not null default '';
alter table public.faqs add column if not exists answer     text not null default '';
alter table public.faqs add column if not exists sort_order int  not null default 0;
alter table public.faqs add column if not exists active     boolean not null default true;
alter table public.faqs add column if not exists created_at timestamptz not null default now();
alter table public.faqs add column if not exists updated_at timestamptz not null default now();

create index if not exists faqs_active_idx on public.faqs (active, sort_order, created_at);

alter table public.faqs enable row level security;

drop policy if exists faqs_read on public.faqs;
create policy faqs_read on public.faqs
  for select to authenticated using (true);

drop policy if exists faqs_write on public.faqs;
create policy faqs_write on public.faqs
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());


-- ===================== 014_preparedness_guides.sql =====================
-- ============================================================================
--  UniGuard · 014 · Disaster Preparedness Guides
--
--  Additive only. Organised by hazard_type, with a phase ('before'|'during'|
--  'after') so the citizen UI can show three tabs per hazard. LGU manages rows
--  without an app release.
-- ============================================================================

create table if not exists public.preparedness_guides (
  id           uuid primary key default gen_random_uuid(),
  hazard_type  text not null default '',
  phase        text not null default 'before',
  title        text not null default '',
  body         text not null default '',
  sort_order   int  not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.preparedness_guides add column if not exists hazard_type text not null default '';
alter table public.preparedness_guides add column if not exists phase        text not null default 'before';
alter table public.preparedness_guides add column if not exists title        text not null default '';
alter table public.preparedness_guides add column if not exists body          text not null default '';
alter table public.preparedness_guides add column if not exists sort_order   int  not null default 0;
alter table public.preparedness_guides add column if not exists active       boolean not null default true;
alter table public.preparedness_guides add column if not exists created_at   timestamptz not null default now();
alter table public.preparedness_guides add column if not exists updated_at   timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'preparedness_guides_phase_check') then
    alter table public.preparedness_guides add constraint preparedness_guides_phase_check
      check (phase in ('before','during','after'));
  end if;
end $$;

create index if not exists preparedness_guides_hazard_idx on public.preparedness_guides (hazard_type, phase, sort_order);

alter table public.preparedness_guides enable row level security;

drop policy if exists preparedness_guides_read on public.preparedness_guides;
create policy preparedness_guides_read on public.preparedness_guides
  for select to authenticated using (true);

drop policy if exists preparedness_guides_write on public.preparedness_guides;
create policy preparedness_guides_write on public.preparedness_guides
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());


-- ===================== 015_urgent_alert_acks.sql =====================
-- ============================================================================
--  UniGuard · 015 · Urgent alert acknowledgments + Report-status fan-out
--
--  Additive only. Two things:
--
--  1. alert_acknowledgments  — every time a citizen dismisses an emergency
--     advisory, the action is logged so we can prove "did they see it".
--
--  2. advance_report_status is redefined to also fan out a per-user
--     notification to the original reporter whenever the status of their own
--     report changes (Processing → Deployed → Resolved). Mirrors the
--     fanout_advisory pattern.
-- ============================================================================

create table if not exists public.alert_acknowledgments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  advisory_id   uuid references public.advisories(id) on delete cascade,
  acknowledged_at timestamptz not null default now()
);

alter table public.alert_acknowledgments add column if not exists user_id       uuid;
alter table public.alert_acknowledgments add column if not exists advisory_id   uuid;
alter table public.alert_acknowledgments add column if not exists acknowledged_at timestamptz not null default now();

create index if not exists alert_acknowledgments_user_idx on public.alert_acknowledgments (user_id, advisory_id);

alter table public.alert_acknowledgments enable row level security;

drop policy if exists alert_acknowledgments_read on public.alert_acknowledgments;
create policy alert_acknowledgments_read on public.alert_acknowledgments
  for select to authenticated using (user_id = auth.uid() or public.is_lgu());

drop policy if exists alert_acknowledgments_write on public.alert_acknowledgments;
create policy alert_acknowledgments_write on public.alert_acknowledgments
  for insert to authenticated with check (user_id = auth.uid());

-- -------------------------------------- fan out a notification to the reporter
-- Re-define advance_report_status so that, in addition to writing the audit
-- row, it also inserts a notification addressed to the reporter. The tone
-- depends on the new status: dispatched → warning, resolved → prepared,
-- rejected → warning, anything else → advisory. The notification carries
-- type='report_status' and the report id so tapping it deep-links to the
-- report detail screen.
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.reports;
  v_role     text;
  v_brgy     uuid;
  v_reporter uuid;
  v_code     text;
  v_tone     text;
  v_title    text;
  v_body     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('reported', 'verified', 'dispatched', 'resolved', 'rejected') then
    raise exception 'Unknown status: %', p_next;
  end if;

  select role, barangay_id into v_role, v_brgy from public.profiles where id = auth.uid();

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can change an incident status';
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  update public.reports set status = p_next where id = p_report_id returning * into v_row;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('to', p_next, 'note', coalesce(p_note, '')));

  -- notify the reporter (if any) so a citizen sees every status change
  v_reporter := v_row.reporter_id;
  v_code     := coalesce(v_row.code, '');
  if v_reporter is not null then
    v_tone  := case p_next when 'dispatched' then 'warning' when 'resolved' then 'prepared'
                            when 'rejected'  then 'warning' else 'advisory' end;
    v_title := case p_next
      when 'verified'   then 'Your report was verified'
      when 'dispatched' then 'Response dispatched to your report'
      when 'resolved'   then 'Your report is resolved'
      when 'rejected'   then 'Your report was rejected'
      else 'Your report status changed'
    end;
    v_body  := case p_next
      when 'verified'   then 'Report ' || v_code || ' has been reviewed and verified.'
      when 'dispatched' then 'A responder unit has been dispatched for ' || v_code || '.'
      when 'resolved'   then 'Report ' || v_code || ' is resolved. Closing note: ' || left(coalesce(p_note, ''), 140)
      when 'rejected'   then 'Report ' || v_code || ' was rejected: ' || left(coalesce(p_note, ''), 140)
      else 'Report ' || v_code || ' is now ' || p_next || '.'
    end;
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_reporter, v_title, v_body, v_tone, 'check', 'report_status', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;

revoke all on function public.advance_report_status(uuid, text, text) from public;
grant execute on function public.advance_report_status(uuid, text, text) to authenticated;


-- ===================== 016_sos_log.sql =====================
-- ============================================================================
--  UniGuard · 016 · One-tap SOS log + RPC
--
--  Additive only. A signed-in citizen can fire an SOS: the call writes a row
--  in sos_log (with GPS + profile snapshot at that moment) and fans out a
--  notification to every LGU/LDRRMO account so the duty officer sees it.
-- ============================================================================

create table if not exists public.sos_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  profile_name text not null default '',
  profile_phone text not null default '',
  barangay     text not null default '',
  lat          double precision,
  lng          double precision,
  accuracy     double precision,
  note         text not null default '',
  status       text not null default 'sent',
  created_at   timestamptz not null default now()
);

alter table public.sos_log add column if not exists user_id       uuid;
alter table public.sos_log add column if not exists profile_name   text not null default '';
alter table public.sos_log add column if not exists profile_phone text not null default '';
alter table public.sos_log add column if not exists barangay      text not null default '';
alter table public.sos_log add column if not exists lat            double precision;
alter table public.sos_log add column if not exists lng             double precision;
alter table public.sos_log add column if not exists accuracy      double precision;
alter table public.sos_log add column if not exists note           text not null default '';
alter table public.sos_log add column if not exists status        text not null default 'sent';
alter table public.sos_log add column if not exists created_at    timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sos_log_status_check') then
    alter table public.sos_log add constraint sos_log_status_check
      check (status in ('sent','acknowledged','resolved'));
  end if;
end $$;

create index if not exists sos_log_created_idx on public.sos_log (created_at desc);

alter table public.sos_log enable row level security;

drop policy if exists sos_log_read on public.sos_log;
create policy sos_log_read on public.sos_log
  for select to authenticated using (
    user_id = auth.uid() or public.is_lgu() or public.is_official()
  );

-- citizens insert their own; nobody else can
drop policy if exists sos_log_insert on public.sos_log;
create policy sos_log_insert on public.sos_log
  for insert to authenticated with check (user_id = auth.uid());

-- the RPC: writes the row, snapshots the caller's profile, fans out a
-- notification to every LGU/LDRRMO account, and writes an audit row.
create or replace function public.submit_sos(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id     uuid;
  v_row    public.sos_log;
  v_prof   record;
  v_reach  int := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send an SOS';
  end if;

  perform public.check_rate_limit('sos', 5, interval '10 minutes');

  select full_name, phone, barangay into v_prof from public.profiles where id = auth.uid();

  insert into public.sos_log (user_id, profile_name, profile_phone, barangay, lat, lng, accuracy, note)
  values (auth.uid(),
          coalesce(v_prof.full_name, ''),
          coalesce(v_prof.phone, ''),
          coalesce(v_prof.barangay, ''),
          p_lat, p_lng, p_accuracy, coalesce(p_note, ''))
  returning * into v_row;
  v_id := v_row.id;

  -- fan out a notification to every LGU/LDRRMO officer
  with targets as (
    select p.id from public.profiles p
     where p.disabled = false and p.role = 'lgu_ldrrmc'
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, type, sos_id)
    select id,
           'SOS received from ' || coalesce(v_prof.full_name, 'a resident'),
           coalesce(v_prof.phone, '') || ' · ' || coalesce(v_prof.barangay, '') ||
           ' · ' || coalesce(p_accuracy::text, '') || ' m',
           'emergency', 'alert', 'sos', v_id
      from targets
    returning 1
  )
  select count(*) into v_reach from ins;

  perform public.write_audit('sos.received', 'sos_log', v_id,
    jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy, 'reach', v_reach));

  return jsonb_build_object('id', v_id, 'reach', v_reach);
end;
$$;

revoke all on function public.submit_sos(double precision, double precision, double precision, text) from public;
grant execute on function public.submit_sos(double precision, double precision, double precision, text) to authenticated;


-- ===================== 017_road_status.sql =====================
-- ============================================================================
--  UniGuard · 017 · Road status overlay
--
--  Additive only. Lets the LGU mark a road segment / intersection as passable,
--  blocked, or caution. Each row carries lat/lng so the map shows it.
--  Citizens read; LGU/officials write.
-- ============================================================================

create table if not exists public.road_status (
  id          uuid primary key default gen_random_uuid(),
  road_name   text not null default '',
  barangay    text not null default '',
  barangay_id uuid references public.barangays(id) on delete set null,
  status      text not null default 'passable',
  note        text not null default '',
  lat         double precision,
  lng         double precision,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.road_status add column if not exists road_name   text not null default '';
alter table public.road_status add column if not exists barangay    text not null default '';
alter table public.road_status add column if not exists barangay_id uuid;
alter table public.road_status add column if not exists status       text not null default 'passable';
alter table public.road_status add column if not exists note         text not null default '';
alter table public.road_status add column if not exists lat          double precision;
alter table public.road_status add column if not exists lng          double precision;
alter table public.road_status add column if not exists updated_by   uuid;
alter table public.road_status add column if not exists created_at   timestamptz not null default now();
alter table public.road_status add column if not exists updated_at   timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_status_status_check') then
    alter table public.road_status add constraint road_status_status_check
      check (status in ('passable','blocked','caution'));
  end if;
end $$;

create index if not exists road_status_status_idx on public.road_status (status);
create index if not exists road_status_geom_idx  on public.road_status (lat, lng);

alter table public.road_status enable row level security;

drop policy if exists road_status_read on public.road_status;
create policy road_status_read on public.road_status
  for select to authenticated using (true);

drop policy if exists road_status_write on public.road_status;
create policy road_status_write on public.road_status
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());


-- ===================== 018_others_review.sql =====================
-- ============================================================================
--  UniGuard · 018 · "Others" hazard review helper
--
--  Additive only. A simple view that aggregates the free-text residents typed
--  when they picked "Others" on the hazard dropdown, so the LGU can scan for
--  patterns worth promoting into a permanent hazard type. No data is moved;
--  it is a read-only summary.
-- ============================================================================

create or replace view public.others_hazard_review as
  select hazard_other_text as description,
         count(*)          as occurrences,
         max(created_at)   as latest_at
    from public.reports
   where hazard_type = 'Others'
     and hazard_other_text is not null
     and length(trim(hazard_other_text)) > 0
   group by lower(trim(hazard_other_text)), hazard_other_text
   order by occurrences desc, latest_at desc;

grant select on public.others_hazard_review to authenticated;


-- ===================== 019_beneficiaries_privacy.sql =====================
-- ============================================================================
--  UniGuard · 019 · Authorized beneficiaries: staff-only read access
--
--  The list contains names and ID numbers of third parties. Residents have no
--  need to read it, so reading is limited to LGU and barangay officials. This
--  is enforced in the database, not just by hiding the button.
-- ============================================================================

drop policy if exists authorized_beneficiaries_read on public.authorized_beneficiaries;
create policy authorized_beneficiaries_read on public.authorized_beneficiaries
  for select to authenticated
  using (public.is_lgu() or public.is_official());


-- ===================== 020_report_barangay_pick.sql =====================
-- UniGuard · 020 · Let residents report a hazard in the barangay it is actually in.
-- The picked barangay is accepted only if it matches a real row in public.barangays;
-- otherwise the reporter's own barangay is used, as before.

create or replace function public.guard_report_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role     text;
  v_brgy_id  uuid;
  v_brgy     text;
  v_pick_id  uuid;
  v_pick     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to file a report';
  end if;

  new.reporter_id := auth.uid();

  select role, barangay_id, barangay into v_role, v_brgy_id, v_brgy
    from public.profiles where id = auth.uid();

  if coalesce(v_role, 'citizen') = 'citizen' then
    -- look up the barangay the resident picked
    if coalesce(new.barangay, '') <> '' then
      select id, name into v_pick_id, v_pick
        from public.barangays
       where lower(name) = lower(new.barangay)
       limit 1;
    end if;

    if v_pick_id is not null then
      new.barangay_id := v_pick_id;
      new.barangay    := v_pick;
    else
      -- unknown or empty: fall back to the home barangay
      if v_brgy_id is not null then new.barangay_id := v_brgy_id; end if;
      if coalesce(v_brgy, '') <> '' then new.barangay := v_brgy; end if;
    end if;
  end if;
  return new;
end;
$$;

-- ===================== 021_allow_backend_profile_changes.sql =====================
create or replace function public.guard_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  -- no signed-in user means a trusted backend call (service role / Edge Function).
  -- Normal clients always carry a uid and cannot reach this branch.
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
  end if;
  return new;
end;
$$;

-- ===================== 022_realtime_publication.sql =====================
-- ============================================================================
--  UniGuard · 022 · Realtime publication
--
--  Additive and re-runnable. The app keeps every role in sync through Supabase
--  Realtime (postgres_changes). A table only emits those events when it belongs
--  to the supabase_realtime publication, which no earlier migration set up.
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'reports', 'advisories', 'notifications', 'evacuation_centers', 'emergency_hotlines',
    'relief_distributions', 'authorized_beneficiaries', 'preparedness_guides', 'faqs',
    'road_work_posts', 'road_status', 'sos_log'
  ] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = t)
       and not exists (select 1 from pg_publication_tables
                        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- ===================== 023_auto_verify_on_report.sql =====================
-- ============================================================================
--  UniGuard · 023 · Crowd corroboration on report submission
--
--  Additive and re-runnable. Migration 002 verifies a hazard when a resident
--  explicitly confirms someone else's report. The system design also calls for
--  the status to move from "reported" to "verified" once three or more
--  independent residents REPORT the same hazard in the same barangay within a
--  short window. This trigger applies the same rule (same hazard type, same
--  barangay, six hours either side, three distinct people) when a report is
--  filed, so no extra action is needed from anyone.
-- ============================================================================
create or replace function public.auto_verify_on_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if new.hazard_type is null or new.hazard_type = '' then
    return new;
  end if;

  select count(distinct u) into v_count from (
    select r.reporter_id as u
      from public.reports r
     where r.hazard_type = new.hazard_type
       and (r.barangay_id is not distinct from new.barangay_id)
       and r.status <> 'rejected'
       and r.created_at between new.created_at - interval '6 hours' and new.created_at + interval '6 hours'
    union
    select c.user_id
      from public.report_corroborations c
      join public.reports r2 on r2.id = c.report_id
     where r2.hazard_type = new.hazard_type
       and (r2.barangay_id is not distinct from new.barangay_id)
       and r2.created_at between new.created_at - interval '6 hours' and new.created_at + interval '6 hours'
  ) s
  where u is not null;

  if v_count >= 3 then
    perform set_config('uniguard.reason', 'auto_corroboration', true);
    update public.reports
       set status = 'verified'
     where hazard_type = new.hazard_type
       and (barangay_id is not distinct from new.barangay_id)
       and status = 'reported'
       and created_at between new.created_at - interval '6 hours' and new.created_at + interval '6 hours';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_auto_verify'
  ) then
    create trigger reports_auto_verify
      after insert on public.reports
      for each row execute function public.auto_verify_on_report();
  end if;
end $$;

