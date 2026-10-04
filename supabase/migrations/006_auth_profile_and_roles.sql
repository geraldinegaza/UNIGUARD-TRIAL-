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
