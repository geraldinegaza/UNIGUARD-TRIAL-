-- ============================================================================
--  UniGuard · 044 · Reports and documentation (LDRRMO core module G)
--
--  Two tables behind js/reporting.js:
--
--    damage_assessments   one row per barangay damage and needs assessment:
--                         affected and displaced population, casualties, houses,
--                         infrastructure and agriculture cost, lifelines, needs.
--                         Feeds the situation report.
--    situation_reports    the register of issued situation reports: number,
--                         event, period, scope and the headline figures at the
--                         time it was saved. Append-only.
--
--  Scope follows the rest of the system: a barangay official reads and writes
--  only their own barangay's rows; LGU accounts see every barangay. Only an LGU
--  account can mark an assessment `validated`, and a validated assessment is
--  read-only for the barangay.
--
--  Every change lands in audit_log through the generic row trigger from
--  migration 033, so it shows in the Activity Log (module H).
--
--  Until this file is applied the app keeps these records on the device.
--  Additive + idempotent.
-- ============================================================================

begin;

-- ------------------------------------------------------- damage assessments
create table if not exists public.damage_assessments (
  id                  uuid primary key default gen_random_uuid(),
  barangay_id         uuid references public.barangays(id) on delete set null,
  barangay            text not null default '',
  report_id           uuid references public.reports(id) on delete set null,
  report_code         text not null default '',
  event_name          text not null default '',
  hazard_type         text not null default '',
  assessed_on         date not null default current_date,

  affected_families   integer not null default 0 check (affected_families  >= 0),
  affected_persons    integer not null default 0 check (affected_persons   >= 0),
  displaced_families  integer not null default 0 check (displaced_families >= 0),
  displaced_persons   integer not null default 0 check (displaced_persons  >= 0),
  dead                integer not null default 0 check (dead     >= 0),
  injured             integer not null default 0 check (injured  >= 0),
  missing             integer not null default 0 check (missing  >= 0),
  houses_totally      integer not null default 0 check (houses_totally   >= 0),
  houses_partially    integer not null default 0 check (houses_partially >= 0),

  infra_damage_php    numeric(14,2) not null default 0 check (infra_damage_php >= 0),
  agri_damage_php     numeric(14,2) not null default 0 check (agri_damage_php  >= 0),
  infra_notes         text not null default '',
  agri_notes          text not null default '',

  power_status        text not null default 'Not assessed',
  water_status        text not null default 'Not assessed',
  comms_status        text not null default 'Not assessed',

  needs               text[] not null default '{}',
  needs_notes         text not null default '',
  remarks             text not null default '',

  status              text not null default 'draft'
                        check (status in ('draft', 'submitted', 'validated')),
  assessed_by_name    text not null default '',
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists damage_assessments_brgy_idx   on public.damage_assessments (barangay_id, assessed_on desc);
create index if not exists damage_assessments_date_idx   on public.damage_assessments (assessed_on desc);
create index if not exists damage_assessments_report_idx on public.damage_assessments (report_id);

-- Keep barangay_id and the barangay name in step, whichever one the client
-- sent, and stop a barangay official validating their own assessment.
create or replace function public.guard_damage_assessment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.barangay_id is null and coalesce(new.barangay, '') <> '' then
    select id into new.barangay_id from public.barangays where name = new.barangay;
  elsif new.barangay_id is not null and coalesce(new.barangay, '') = '' then
    select name into new.barangay from public.barangays where id = new.barangay_id;
  end if;

  if auth.uid() is not null and not public.is_lgu() then
    if tg_op = 'INSERT' then
      if new.status = 'validated' then
        raise exception 'Only LDRRMO staff can validate an assessment';
      end if;
    else
      if old.status = 'validated' then
        raise exception 'A validated assessment can only be changed by LDRRMO staff';
      end if;
      if new.status = 'validated' then
        raise exception 'Only LDRRMO staff can validate an assessment';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists damage_assessments_guard on public.damage_assessments;
create trigger damage_assessments_guard
  before insert or update on public.damage_assessments
  for each row execute function public.guard_damage_assessment();

drop trigger if exists damage_assessments_touch on public.damage_assessments;
create trigger damage_assessments_touch
  before update on public.damage_assessments
  for each row execute function public.touch_updated_at();

alter table public.damage_assessments enable row level security;

drop policy if exists damage_assessments_read on public.damage_assessments;
create policy damage_assessments_read on public.damage_assessments
  for select to authenticated using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );

drop policy if exists damage_assessments_insert on public.damage_assessments;
create policy damage_assessments_insert on public.damage_assessments
  for insert to authenticated with check (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );

drop policy if exists damage_assessments_update on public.damage_assessments;
create policy damage_assessments_update on public.damage_assessments
  for update to authenticated
  using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  )
  with check (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );

-- a barangay may withdraw its own draft; anything further along is LGU only
drop policy if exists damage_assessments_delete on public.damage_assessments;
create policy damage_assessments_delete on public.damage_assessments
  for delete to authenticated using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id() and status = 'draft')
    )
  );

-- ------------------------------------------------ situation report register
create table if not exists public.situation_reports (
  id                uuid primary key default gen_random_uuid(),
  sitrep_no         integer not null default 1 check (sitrep_no > 0),
  event_name        text not null default '',
  period_from       date,
  period_to         date,
  barangay_id       uuid references public.barangays(id) on delete set null,
  barangay          text not null default '',          -- '' = municipality-wide
  summary           jsonb not null default '{}'::jsonb, -- headline figures when saved
  remarks           text not null default '',
  prepared_by_name  text not null default '',
  created_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);

create index if not exists situation_reports_created_idx on public.situation_reports (created_at desc);
create index if not exists situation_reports_event_idx   on public.situation_reports (lower(event_name), sitrep_no);

alter table public.situation_reports enable row level security;

drop policy if exists situation_reports_read on public.situation_reports;
create policy situation_reports_read on public.situation_reports
  for select to authenticated using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );

-- a municipality-wide report (barangay_id null) can only be saved by the LGU
drop policy if exists situation_reports_insert on public.situation_reports;
create policy situation_reports_insert on public.situation_reports
  for insert to authenticated with check (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay_id = public.my_barangay_id())
    )
  );
-- no update or delete policy: the register is append-only

-- ------------------------------------------------------------ activity log
do $$
declare t text;
begin
  foreach t in array array['damage_assessments', 'situation_reports']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

commit;

-- Verify:
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('damage_assessments', 'situation_reports') order by 1, 2;
