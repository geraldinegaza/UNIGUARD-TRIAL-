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