-- ============================================================================
--  UniGuard · 033 · Audit coverage + shelter occupancy history
--
--  A8: every write below lands an audit_log row (actor, action, entity,
--  entity id, before/after where practical). The audit_log table has no
--  insert policy on purpose — rows must be written by security definer
--  functions/triggers, which is exactly what this migration installs.
--
--  Covered by one generic row-change trigger, attached to:
--      advisories             (publish / edit / delete)
--      evacuation_centers     (occupancy + status changes, create, delete)
--      road_status            (create / edit / delete)
--      road_work_posts        (create / edit / delete)
--      emergency_hotlines     (create / edit / delete)
--      preparedness_guides    (create / edit / delete)
--      faqs                   (create / edit / delete)
--      sos_log                (status changes)
--
--  Incident edits + status changes were already audited (migrations 007/015/
--  027). Role changes are audited by the admin-users edge function.
--
--  Also adds `shelter_occupancy_log` so the analytics screen can chart
--  occupancy trends (Phase G) instead of showing only a snapshot.
--
--  Additive + idempotent.
-- ============================================================================

create table if not exists public.shelter_occupancy_log (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references public.evacuation_centers(id) on delete cascade,
  occupancy  integer not null default 0,
  capacity   integer not null default 0,
  status     text not null default 'open',
  recorded_at timestamptz not null default now()
);

create index if not exists shelter_occ_center_idx on public.shelter_occupancy_log (center_id, recorded_at desc);

alter table public.shelter_occupancy_log enable row level security;

drop policy if exists shelter_occ_read on public.shelter_occupancy_log;
create policy shelter_occ_read on public.shelter_occupancy_log
  for select to authenticated using (public.is_lgu() or public.is_official());
-- no insert policy: written by the security definer trigger below

-- ------------------------------------------------------- generic audit trigger
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_meta jsonb;
  v_entity text;
  v_id uuid;
  v_changed jsonb;
begin
  v_entity := tg_table_name;

  if tg_op = 'DELETE' then
    v_old  := to_jsonb(old);
    v_id   := v_old->>'id';
    perform public.write_audit(v_entity || '.deleted', v_entity, v_id,
      jsonb_build_object('before', v_old));
    return old;
  end if;

  v_new := to_jsonb(new);
  v_id  := v_new->>'id';
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    -- keep the meta small: only the columns that actually changed
    select jsonb_object_agg(key, jsonb_build_object('from', old_value, 'to', new_value))
      into v_changed
      from jsonb_each(v_new) n(key, new_value)
      join jsonb_each(v_old) o(key, old_value) using (key)
     where n.new_value is distinct from o.old_value
       and key not in ('updated_at', 'created_at');
    if v_changed is null or v_changed = '{}'::jsonb then
      return new;  -- nothing meaningful changed
    end if;
    v_meta := jsonb_build_object('changed', v_changed);
  else
    v_meta := jsonb_build_object('after', v_new);
  end if;

  perform public.write_audit(v_entity || '.' || lower(tg_op), v_entity, v_id, v_meta);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'advisories','evacuation_centers','road_status','road_work_posts',
    'emergency_hotlines','preparedness_guides','faqs'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- sos_log: audit only status changes (every SOS insert already writes
-- 'sos.received' from the RPC; auditing inserts again would double-log)
create or replace function public.audit_sos_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.write_audit('sos.status_changed', 'sos_log', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists sos_log_audit_status on public.sos_log;
create trigger sos_log_audit_status
  after update on public.sos_log
  for each row execute function public.audit_sos_status();

-- ------------------------------------------------ shelter occupancy history
create or replace function public.log_shelter_occupancy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.occupancy is distinct from old.occupancy
     or new.status is distinct from old.status then
    insert into public.shelter_occupancy_log (center_id, occupancy, capacity, status)
    values (new.id, new.occupancy, new.capacity, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists evacuation_centers_occ_log on public.evacuation_centers;
create trigger evacuation_centers_occ_log
  after update on public.evacuation_centers
  for each row execute function public.log_shelter_occupancy();

-- occupancy trend for the analytics screen (LGU / officials only, via the
-- same analytics scope helper as migration 024)
create or replace view public.analytics_shelter_trend with (security_invoker = true) as
select date_trunc('day', l.recorded_at)::date as day,
       sum(l.occupancy)::bigint as occupancy,
       sum(l.capacity)::bigint as capacity
  from public.shelter_occupancy_log l
  join public.evacuation_centers c on c.id = l.center_id
 where public.analytics_row_visible(c.barangay_id)
 group by 1
 order by 1;

grant select on public.analytics_shelter_trend to authenticated;
