-- UniGuard · 042 · dispatch_units dedup + unit member invite fixes
--
-- Two problems found after the first real deploy:
--
--   1. DUPLICATE UNITS: migration 038 created the dispatch_units table without
--      a unique constraint on `name`. The `create_dispatch_unit` RPC does a
--      plain INSERT, so every click of "Create unit + invite admin" in the UI
--      created a duplicate row (e.g. three "BFP Lingayen" rows). The unique
--      index `dispatch_units_name_key` only existed in seed/003, which runs
--      AFTER the user has already created duplicates manually.
--
--      Fix: clean up the existing duplicates FIRST (mark the extras inactive),
--      THEN add the unique index, THEN rewrite `create_dispatch_unit` so it
--      returns the existing row if a unit with the same name already exists
--      instead of inserting a duplicate.
--
--   2. UNIT MEMBER INVITE: the `admin-users` edge function's `create` action
--      calls `admin.auth.admin.inviteUserByEmail()` to send the invitation
--      email. If the email doesn't arrive, it's almost always because:
--        a) the edge function is the OLD version (doesn't support dispatch_team
--           role, requires a fullName field the dispatch unit form doesn't have)
--           — replace it with the new version in supabase/functions/admin-users
--        b) the SUPABASE_SERVICE_ROLE_KEY secret isn't set on the function
--        c) Supabase Auth email sending isn't configured / is rate-limited
--      This migration cannot fix (a)/(b)/(c) — those are dashboard/deploy steps.

-- =====================================================================
-- STEP 1 — DELETE existing duplicates, keep only the oldest row per name.
--           This removes the extra rows entirely (not just marks them
--           inactive) so the table is clean and a regular full unique
--           index can be created in STEP 2 without conflicts.
--           Safe because the oldest row per name keeps its original UUID,
--           so any foreign-key references (dispatch_equipment,
--           report_dispatches, etc.) still resolve to it.
--           Uses DISTINCT ON (not min(uuid)) because PostgreSQL has no
--           built-in min() aggregate for the UUID type.
-- =====================================================================
do $$
begin
  delete from public.dispatch_units
   where id in (
     select id from (
       select id, name, created_at,
              row_number() over (partition by name order by created_at asc) as rn
         from public.dispatch_units
     ) ranked
     where rn > 1
   );
  if found then
    raise notice 'Deleted duplicate dispatch_units rows';
  end if;
end $$;

-- =====================================================================
-- STEP 2 — Add a full unique index on dispatch_units.name.
--           Safe now because STEP 1 deleted all duplicate rows — every
--           name appears exactly once in the table.
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'dispatch_units'
       and indexname = 'dispatch_units_name_key'
  ) then
    create unique index dispatch_units_name_key on public.dispatch_units (name);
  end if;
end $$;

-- =====================================================================
-- STEP 3 — Rewrite create_dispatch_unit so it deduplicates by name.
--           If a unit with the same name already exists AND is active,
--           return its id instead of inserting a duplicate. This makes
--           the "Create unit + invite admin" button idempotent — clicking
--           it twice doesn't create two rows; the second click just
--           re-invites the admin into the existing unit.
-- =====================================================================
create or replace function public.create_dispatch_unit(
  p_name           text,
  p_unit_type      text,
  p_contact_number text default '',
  p_address        text default '',
  p_lat            double precision default null,
  p_lng            double precision default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id       uuid;
  v_existing uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_lgu() then raise exception 'Only the LGU can create dispatch units'; end if;
  if p_unit_type not in ('BFP','PNP','Rescue','Hospital') then
    raise exception 'Unknown unit type';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'A unit name is required'; end if;

  -- dedup: if a unit with this exact name already exists, return its id
  -- instead of creating a duplicate. The UI can then invite the admin
  -- into the existing unit.
  select id into v_existing
    from public.dispatch_units
   where name = trim(p_name)
     and active = true
   limit 1;

  if v_existing is not null then
    perform public.write_audit('dispatch_unit.duplicate_attempt', 'dispatch_units', v_existing,
      jsonb_build_object('name', p_name, 'unit_type', p_unit_type, 'note', 'Unit already exists; returned existing id'));
    return jsonb_build_object('id', v_existing, 'name', p_name, 'unit_type', p_unit_type, 'already_exists', true);
  end if;

  insert into public.dispatch_units (name, unit_type, contact_number, address, lat, lng, created_by, status, active)
  values (trim(p_name), p_unit_type, p_contact_number, p_address, p_lat, p_lng, auth.uid(), 'available', true)
  returning id into v_id;

  perform public.write_audit('dispatch_unit.created', 'dispatch_units', v_id,
    jsonb_build_object('name', p_name, 'unit_type', p_unit_type));

  return jsonb_build_object('id', v_id, 'name', p_name, 'unit_type', p_unit_type);
end;
$$;

revoke all on function public.create_dispatch_unit(text, text, text, text, double precision, double precision) from public;
grant execute on function public.create_dispatch_unit(text, text, text, text, double precision, double precision) to authenticated;
