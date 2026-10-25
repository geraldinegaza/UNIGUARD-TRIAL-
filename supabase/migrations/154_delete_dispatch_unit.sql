-- 154: the Super Admin can delete a dispatch unit (reference build feature).
--
-- dispatch_units had no delete rule, so a delete from the app was silently
-- refused. delete_dispatch_unit(p_unit_id):
--   * Super Admin only, active accounts only;
--   * refuses while the unit has a dispatch still in progress;
--   * turns the unit's member accounts back into resident accounts (a
--     dispatch account must belong to a unit), keeping their history;
--   * deletes the unit. Its personnel, equipment, shifts, requests, hospital
--     capacity and patient notices go with it (on delete cascade); past
--     dispatches keep their record with the unit cleared.
-- Every step is written to the activity log. Safe to run more than once.

create or replace function public.delete_dispatch_unit(p_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit    public.dispatch_units;
  v_members int;
begin
  if auth.uid() is null or not public.is_active_user() or not public.is_super_admin() then
    raise exception 'Only the Super Admin can delete a dispatch unit';
  end if;

  select * into v_unit from public.dispatch_units where id = p_unit_id;
  if v_unit.id is null then
    raise exception 'That unit no longer exists';
  end if;

  if exists (
    select 1 from public.report_dispatches
     where unit_id = p_unit_id and dispatch_status in ('sent', 'acknowledged', 'en_route', 'on_scene')
  ) then
    raise exception 'This unit has a dispatch in progress. Finish or reassign it before deleting the unit.';
  end if;

  update public.profiles
     set role = 'citizen', dispatch_unit_id = null, unit_role = '', updated_at = now()
   where dispatch_unit_id = p_unit_id;
  get diagnostics v_members = row_count;

  delete from public.dispatch_units where id = p_unit_id;

  perform public.write_audit('dispatch_unit.deleted', 'dispatch_units', p_unit_id,
    jsonb_build_object('name', v_unit.name, 'unit_type', v_unit.unit_type, 'members_moved_to_resident', v_members));

  return jsonb_build_object('ok', true, 'name', v_unit.name, 'members', v_members);
end;
$$;

revoke all on function public.delete_dispatch_unit(uuid) from public, anon;
grant execute on function public.delete_dispatch_unit(uuid) to authenticated;
