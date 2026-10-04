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