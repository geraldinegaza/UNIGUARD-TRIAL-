-- ============================================================================
--  UniGuard · 044 · Super Admin improvements
--
--  Companion to migration 043 (the Super Admin role). This file:
--    · Reclassifies inventory rows from the broad "Shelter" category into
--      the more accurate "Shelter Supplies" (tents, tarpaulins, sleeping
--      mats, blankets) and "Hygiene" (hygiene kits, soap, sanitary products,
--      water containers). The CHECK constraint is widened so the new
--      categories are valid going forward; existing rows are backfilled.
--    · Adds an audit_log_with_actor view that joins profiles into the
--      audit_log so the Super Admin Activity Log can show the actor's role
--      and barangay in one query (the JS client joins them already; this
--      view is the canonical server-side definition for the same data).
--    · Re-attaches the generic audit trigger to road_status if it is
--      missing (migration 033 already covers it, but this re-affirms it
--      so an upgrade-from-older-schema path doesn't miss the table).
--    · Grants the Super Admin SELECT on the new view (RLS already covers
--      the underlying audit_log via the audit_read policy from 043).
--
--  Additive + idempotent. No row is deleted. Existing item IDs, stock
--  quantities, supplier information, warehouse locations and reorder
--  levels are all preserved.
-- ============================================================================

begin;

-- ----------------------------------------------------------------- inventory
-- 1. Widen the CHECK on relief_inventory.category to accept the new
--    "Shelter Supplies" and "Hygiene" categories. Drop the old constraint
--    if it exists, then add the new one. Wrapped in DO so it is re-runnable.
do $$
declare
  c record;
begin
  for c in
    select oid, conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.relief_inventory'::regclass
       and contype = 'c'
  loop
    if position('Shelter' in coalesce(c.def, '')) > 0 then
      execute format('alter table public.relief_inventory drop constraint if exists %I', c.conname);
    end if;
  end loop;
end $$;

alter table public.relief_inventory
  drop constraint if exists relief_inventory_category_check;
alter table public.relief_inventory
  add constraint relief_inventory_category_check
    check (category in ('Food','Water','Medical','Equipment','Shelter','Shelter Supplies','Hygiene'));

comment on column public.relief_inventory.category is
  'Module E: the kind of stock. Shelter Supplies = tents, tarpaulins, sleeping mats, blankets (temporary shelter and sleeping items). Hygiene = hygiene kits, soap, sanitary products, water containers (personal sanitation). Shelter (legacy) is preserved for back-compat but new items should use Shelter Supplies.';

-- 2. Backfill existing rows: tarpaulins, sleeping mats, tents, blankets,
--    mosquito nets → Shelter Supplies; hygiene kits, soap, sanitary
--    products, water containers → Hygiene. Match on a case-insensitive
--    name pattern. Existing rows that don't match either pattern keep
--    their current category (so a custom item the LGU added is not
--    silently re-classified). Stock quantities, reorder levels, supplier
--    and location are NOT touched.
update public.relief_inventory
   set category = 'Shelter Supplies', updated_at = now()
 where category = 'Shelter'
   and (lower(name) ~ 'tarp|trapal|sleeping mat|tent|blanket|mosquito');

update public.relief_inventory
   set category = 'Hygiene', updated_at = now()
 where category = 'Shelter'
   and (lower(name) ~ 'hygiene|soap|detergent|sanitary|napkin|water container|sanitation');

-- 3. Audit the reclassification itself, one entry per affected row, so
--    the Super Admin can see in the activity log that the migration
--    changed the category. The actor is NULL (system / migration) so
--    it shows up as "System" in the activity log, which is correct.
--    relief_inventory.id is text (e.g. 'INV-01'), but audit_log.entity_id
--    is uuid — so we store null in entity_id and put the text id inside meta.
insert into public.audit_log (actor_id, action, entity, entity_id, meta)
select null, 'relief_inventory.category_reclassified', 'relief_inventory', null,
       jsonb_build_object('from', 'Shelter', 'to', category, 'name', name, 'item_id', id)
  from public.relief_inventory
 where category in ('Shelter Supplies', 'Hygiene');

-- 4. Audit triggers: re-affirm road_status has the generic audit trigger.
--    Migration 033 already creates it; this is defensive so an upgrade
--    from an older snapshot (033 not yet applied) still has coverage.
drop trigger if exists road_status_audit on public.road_status;
create trigger road_status_audit
  after insert or update or delete on public.road_status
  for each row execute function public.audit_row_change();

-- 4a. Redefine audit_row_change() to handle tables whose primary key is TEXT
--     (e.g. relief_inventory.id = 'INV-01'). The original function (migration
--     033) declares v_id uuid and assigns v_new->>'id' — which raises
--     "invalid input syntax for type uuid" on text ids. This version tries
--     the cast; if the id isn't a valid uuid, it passes null as entity_id
--     and puts the text id inside meta so the activity log still captures it.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old    jsonb;
  v_new    jsonb;
  v_meta   jsonb;
  v_entity text;
  v_id     uuid;
  v_raw_id text;
  v_changed jsonb;
begin
  v_entity := tg_table_name;

  if tg_op = 'DELETE' then
    v_old  := to_jsonb(old);
    v_raw_id := v_old->>'id';
    v_id := null;
    begin
      v_id := v_raw_id::uuid;
    exception when others then
      v_id := null;
    end;
    perform public.write_audit(v_entity || '.deleted', v_entity, v_id,
      jsonb_build_object('before', v_old, 'text_id', v_raw_id));
    return old;
  end if;

  v_new := to_jsonb(new);
  v_raw_id := v_new->>'id';
  v_id := null;
  begin
    v_id := v_raw_id::uuid;
  exception when others then
    v_id := null;
  end;
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
    v_meta := jsonb_build_object('changed', v_changed, 'text_id', v_raw_id);
  else
    v_meta := jsonb_build_object('after', v_new, 'text_id', v_raw_id);
  end if;

  perform public.write_audit(v_entity || '.' || lower(tg_op), v_entity, v_id, v_meta);
  return coalesce(new, old);
end;
$$;

-- 5. The same for relief_inventory itself — every stock movement should
--    be auditable, including category changes made through the LGU UI.
--    (Migration 033 did NOT include relief_inventory, so this is a real
--    new trigger.)
drop trigger if exists relief_inventory_audit on public.relief_inventory;
create trigger relief_inventory_audit
  after insert or update or delete on public.relief_inventory
  for each row execute function public.audit_row_change();

-- 6. Relief distribution log: also covered by the generic trigger so the
--    Super Admin can see when a distribution record was created, edited
--    or deleted.
drop trigger if exists relief_distribution_log_audit on public.relief_distribution_log;
create trigger relief_distribution_log_audit
  after insert or update or delete on public.relief_distribution_log
  for each row execute function public.audit_row_change();

-- ----------------------------------------------------- audit_log_with_actor
-- 7. A view that joins profiles into audit_log so the Super Admin
--    Activity Log can read role + barangay in one query. Mirrors the
--    embedded select the JS client already does. The view is
--    security_invoker = true so the underlying audit_read policy from
--    migration 043 (Super Admin only) applies.
create or replace view public.audit_log_with_actor with (security_invoker = true) as
select a.id,
       a.created_at,
       a.actor_id,
       p.full_name     as actor_name,
       case when p.role = 'lgu_ldrrmc' and p.is_super_admin then 'super_admin'
            else p.role end as actor_role,
       p.unit_role     as actor_unit_role,
       p.barangay      as actor_barangay,
       a.action,
       a.entity,
       a.entity_id,
       a.meta
  from public.audit_log a
  left join public.profiles p on p.id = a.actor_id
 order by a.created_at desc;

grant select on public.audit_log_with_actor to authenticated;

comment on view public.audit_log_with_actor is
  'Joins audit_log to profiles so the Super Admin Activity Log can show the actor''s role and barangay in one query. RLS still applies through security_invoker.';

commit;

-- Verify:
--   select name, category from public.relief_inventory order by category, name;
--   select * from public.audit_log_with_actor limit 5;
