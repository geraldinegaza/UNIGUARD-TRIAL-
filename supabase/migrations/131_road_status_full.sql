-- ============================================================================
--  UniGuard · 031 · Road status: the full form's columns
--
--  The old road_status table carried only road_name, barangay, status, note,
--  lat, lng. The redesigned road-status form (fix prompt, Phase F) needs the
--  segment, cause, severity, timing and updater fields below.
--
--  Status keys: the UI shows Open / One lane / Closed / Under repair. The
--  stored keys gain 'one_lane' and 'under_repair'; legacy rows with
--  'caution' are remapped to 'one_lane' (closest meaning) so the old check
--  constraint can be widened safely.
--
--  Additive + idempotent.
-- ============================================================================

alter table public.road_status add column if not exists segment_from      text not null default '';
alter table public.road_status add column if not exists segment_to        text not null default '';
alter table public.road_status add column if not exists cause             text not null default '';
alter table public.road_status add column if not exists severity          text not null default 'advisory';
alter table public.road_status add column if not exists started_at        timestamptz;
alter table public.road_status add column if not exists estimated_reopen  timestamptz;
alter table public.road_status add column if not exists updater_name      text not null default '';
alter table public.road_status add column if not exists created_by        uuid;

-- legacy 'caution' -> 'one_lane'. [this project] moved ahead of the new check:
-- run after it, the check is rejected by any existing 'caution' row. The old
-- check is dropped first so 'one_lane' is accepted during the remap.
alter table public.road_status drop constraint if exists road_status_status_check;
update public.road_status set status = 'one_lane' where status = 'caution';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_status_status_check') then
    alter table public.road_status add constraint road_status_status_check
      check (status in ('passable','one_lane','blocked','under_repair'));
  else
    -- widen the legacy constraint (it only allowed passable/blocked/caution)
    alter table public.road_status drop constraint road_status_status_check;
    alter table public.road_status add constraint road_status_status_check
      check (status in ('passable','one_lane','blocked','under_repair'));
  end if;
end $$;


do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_status_cause_check') then
    alter table public.road_status add constraint road_status_cause_check
      check (cause in ('', 'flood', 'landslide', 'repair', 'accident', 'other'));
  end if;
end $$;

-- the updater is auto-filled from the session profile on every write
create or replace function public.stamp_road_status_updater()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  select coalesce(full_name, '') into v_name from public.profiles where id = auth.uid();
  if coalesce(v_name, '') <> '' then
    new.updater_name := v_name;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists road_status_stamp_updater on public.road_status;
create trigger road_status_stamp_updater
  before insert or update on public.road_status
  for each row execute function public.stamp_road_status_updater();
