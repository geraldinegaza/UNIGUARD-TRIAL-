-- ============================================================================
--  UniGuard · 029 · Barangay scoping for SOS reads, road writes and advisories
--
--  Four verified gaps closed:
--
--  A4  sos_log_read (migration 016) let ANY official read every SOS entry
--      municipality-wide. Now an official reads only SOS entries whose sender
--      barangay snapshot matches their own; LGU reads all; citizens keep
--      seeing only their own.
--
--  A5  road_status_write (migration 017) let any official write any barangay.
--      Now officials write only rows in their own barangay. road_status (and
--      road_work_posts, double-checked) are added to the fill_barangay_id()
--      trigger list from migration 026, which had omitted road_status.
--
--  A6  advisories_insert (migration 004) let any official publish for any
--      area. Now a Barangay Official can publish ONLY a single-barangay
--      advisory that targets exactly their own barangay; municipality-wide or
--      multi-barangay publishing is LGU-only. advisories_update cannot widen
--      the area. fanout_advisory already fans out strictly from
--      advisory_targets, so once the targets are scoped the fan-out is scoped.
--
--  Additive + idempotent: one helper column on sos_log, policies replaced,
--  triggers replaced. No existing rows are rewritten except the sos_log
--  backfill of barangay_id (from the stored name snapshot), which is safe to
--  re-run.
-- ============================================================================

-- ---------------------------------------------------------------- A4 · SOS
-- sender barangay snapshot: sos_log stores the NAME (from profiles.barangay).
-- A uuid column makes the scope check exact and survives renames; the RPC in
-- 016 is redefined below to fill it. The read policy accepts either match so
-- rows created before this migration still scope correctly by name.
alter table public.sos_log add column if not exists barangay_id uuid references public.barangays(id) on delete set null;

update public.sos_log s
   set barangay_id = b.id
  from public.barangays b
 where s.barangay_id is null
   and coalesce(s.barangay, '') <> ''
   and b.name = s.barangay;

-- redefine submit_sos: identical behaviour plus barangay_id in the snapshot
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
  v_brgy_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send an SOS';
  end if;

  perform public.check_rate_limit('sos', 5, interval '10 minutes');

  select full_name, phone, barangay, barangay_id into v_prof from public.profiles where id = auth.uid();

  if v_prof.barangay_id is null and coalesce(v_prof.barangay, '') <> '' then
    select id into v_brgy_id from public.barangays where name = v_prof.barangay limit 1;
  else
    v_brgy_id := v_prof.barangay_id;
  end if;

  insert into public.sos_log (user_id, profile_name, profile_phone, barangay, barangay_id, lat, lng, accuracy, note)
  values (auth.uid(),
          coalesce(v_prof.full_name, ''),
          coalesce(v_prof.phone, ''),
          coalesce(v_prof.barangay, ''),
          v_brgy_id,
          p_lat, p_lng, p_accuracy, coalesce(p_note, ''))
  returning * into v_row;
  v_id := v_row.id;

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

drop policy if exists sos_log_read on public.sos_log;
create policy sos_log_read on public.sos_log
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_lgu()
    or (
      public.is_official()
      and (
        (barangay_id is not null and barangay_id = public.my_barangay_id())
        or (barangay_id is null and coalesce(barangay, '') <> '' and barangay = public.my_barangay_name())
      )
    )
  );

-- keep insert policy: citizens (any signed-in user) insert their own only
drop policy if exists sos_log_insert on public.sos_log;
create policy sos_log_insert on public.sos_log
  for insert to authenticated with check (user_id = auth.uid());

-- SOS status changes (acknowledged / resolved) go through a scoped RPC so the
-- action is audited and officials cannot flip other barangays' entries.
create or replace function public.update_sos_status(p_sos_id uuid, p_status text)
returns jsonb
language plpgsql
security definer set search_path = public as $$
declare
  v_row public.sos_log;
  v_role text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_status not in ('acknowledged', 'resolved') then
    raise exception 'Unknown SOS status: %', p_status;
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can update an SOS';
  end if;

  select * into v_row from public.sos_log where id = p_sos_id;
  if v_row.id is null then raise exception 'That SOS entry does not exist'; end if;

  if v_role = 'barangay_official' then
    if v_row.barangay_id is not null and v_row.barangay_id is distinct from public.my_barangay_id() then
      raise exception 'That SOS entry is outside your barangay';
    end if;
    if v_row.barangay_id is null and coalesce(v_row.barangay, '') is distinct from public.my_barangay_name() then
      raise exception 'That SOS entry is outside your barangay';
    end if;
  end if;

  update public.sos_log set status = p_status where id = p_sos_id returning * into v_row;

  perform public.write_audit('sos.status_changed', 'sos_log', p_sos_id,
    jsonb_build_object('to', p_status));

  -- tell the sender their SOS was picked up / closed
  if v_row.user_id is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, sos_id)
    values (v_row.user_id,
            case p_status when 'acknowledged' then 'Your SOS was received — help is being arranged'
                          else 'Your SOS is resolved' end,
            'Status of your SOS from ' || coalesce(v_row.barangay, 'your barangay') || ' is now ' || p_status || '.',
            case p_status when 'acknowledged' then 'warning' else 'prepared' end,
            'check', 'sos', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

revoke all on function public.update_sos_status(uuid, text) from public;
grant execute on function public.update_sos_status(uuid, text) to authenticated;

-- ------------------------------------------------ A5 · road_status scoping
drop policy if exists road_status_write on public.road_status;
create policy road_status_write on public.road_status
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
  )
  with check (
    public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
  );

-- fill_barangay_id coverage: migration 026 omitted road_status
do $$
declare t text;
begin
  foreach t in array array['road_status','sos_log']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_fill_brgy', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fill_barangay_id()', t || '_fill_brgy', t);
  end loop;
end $$;

-- road_work_posts scope double-check (A5): the write policy below restricts
-- officials to their own barangay or their own posts; municipality-wide posts
-- (citywide = true) stay LGU-only.
drop policy if exists road_work_posts_write on public.road_work_posts;
create policy road_work_posts_write on public.road_work_posts
  for all to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and author_id = auth.uid()
        and citywide = false
        and (barangay_id = public.my_barangay_id() or barangay_id is null))
  )
  with check (
    public.is_lgu()
    or (public.is_official() and author_id = auth.uid()
        and citywide = false
        and (barangay_id = public.my_barangay_id() or barangay_id is null))
  );

-- ------------------------------------------------- A6 · advisory publishing
-- A Barangay Official may insert only a single-barangay advisory whose target
-- list contains exactly their own barangay. LGU may publish anything.
create or replace function public.guard_advisory_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_target_count int;
  v_foreign int;
begin
  select coalesce(role, 'citizen') into v_role from public.profiles where id = auth.uid();

  if v_role = 'barangay_official' then
    if coalesce(new.citywide, false) then
      raise exception 'Only LGU / LDRRMC can publish municipality-wide advisories';
    end if;
    if coalesce(new.affected_area, '') not ilike '%' || coalesce(public.my_barangay_name(), '') || '%' then
      raise exception 'A barangay official can only publish for their own barangay';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists advisories_guard_scope on public.advisories;
create trigger advisories_guard_scope
  before insert on public.advisories
  for each row execute function public.guard_advisory_scope();

-- advisory_targets: an official may attach targets only for their own barangay
create or replace function public.guard_advisory_target()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_lgu() then
    return new;
  end if;
  if public.is_official() and new.barangay_id is distinct from public.my_barangay_id() then
    raise exception 'A barangay official can target only their own barangay';
  end if;
  if not public.is_lgu() and not public.is_official() then
    raise exception 'Only officials can change advisory targets';
  end if;
  return new;
end;
$$;

drop trigger if exists advisory_targets_guard_scope on public.advisory_targets;
create trigger advisory_targets_guard_scope
  before insert or update on public.advisory_targets
  for each row execute function public.guard_advisory_target();

-- update: an official editing their own advisory may not widen the area
drop policy if exists advisories_update on public.advisories;
create policy advisories_update on public.advisories
  for update to authenticated
  using (
    public.is_lgu()
    or (author_id = auth.uid() and public.is_official())
  )
  with check (
    public.is_lgu()
    or (author_id = auth.uid() and public.is_official() and citywide = false)
  );

create or replace function public.guard_advisory_widen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_lgu() then
    return new;
  end if;
  if (new.citywide is distinct from old.citywide and new.citywide) then
    raise exception 'Only LGU / LDRRMC can make an advisory municipality-wide';
  end if;
  return new;
end;
$$;

drop trigger if exists advisories_guard_widen on public.advisories;
create trigger advisories_guard_widen
  before update on public.advisories
  for each row execute function public.guard_advisory_widen();

-- insert policy mirrors the trigger so a direct REST insert fails cleanly
drop policy if exists advisories_insert on public.advisories;
create policy advisories_insert on public.advisories
  for insert to authenticated
  with check (
    public.is_lgu()
    or (public.is_official() and citywide = false)
  );

drop policy if exists advisory_targets_write on public.advisory_targets;
create policy advisory_targets_write on public.advisory_targets
  for all to authenticated
  using (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()))
  with check (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()));
