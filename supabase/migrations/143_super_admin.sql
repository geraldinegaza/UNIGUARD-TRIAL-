-- ============================================================================
--  UniGuard · 043 · Super Admin (LDRRMO core module H: admin and security)
--
--  Roles after this migration:
--      Super Admin        lgu_ldrrmc + profiles.is_super_admin = true
--      LDRRMO Staff       lgu_ldrrmc
--      Barangay Official  barangay_official
--      Responder          dispatch_team
--      Citizen            citizen
--
--  Super Admin is a FLAG on an LGU account, not a new role key. Every existing
--  policy and function that checks `lgu_ldrrmc` (about sixty of them across
--  migrations 001-042) therefore keeps working unchanged: a Super Admin can do
--  everything LDRRMO staff can. What changes is the short list of things that
--  now require the flag:
--      · changing a role, a barangay assignment, a unit assignment or the
--        disabled flag on any account
--      · editing another person's profile row
--      · reading the activity log (audit_log)
--
--  The system can never be left without an active Super Admin: the profile
--  guard refuses the change that would remove the last one.
--
--  Deploy order: run this file, THEN deploy supabase/functions/admin-users.
--  Additive + idempotent. No row is deleted.
-- ============================================================================

begin;

-- ------------------------------------------------------------------- column
alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

comment on column public.profiles.is_super_admin is
  'Super Admin tier of the lgu_ldrrmc role: manages accounts, roles and the activity log. Only meaningful when role = lgu_ldrrmc.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_super_admin_role_check') then
    alter table public.profiles add constraint profiles_super_admin_role_check
      check (not is_super_admin or role = 'lgu_ldrrmc');
  end if;
end $$;

-- ------------------------------------------------------------------- helper
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'lgu_ldrrmc' and p.is_super_admin and not p.disabled
      from public.profiles p where p.id = auth.uid()), false);
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

-- ----------------------------------------------------- profile field guard
-- Supersedes the version in migration 038. Same protected fields, but the
-- caller must now be the Super Admin (not just any LGU account), and
-- is_super_admin itself is protected.
create or replace function public.guard_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- the flag can only ride on an LGU account
  if new.role is distinct from 'lgu_ldrrmc' then
    new.is_super_admin := false;
  end if;

  -- never leave the system without an active Super Admin. This applies to
  -- every caller, including the service role and the SQL editor.
  if old.is_super_admin and old.role = 'lgu_ldrrmc' and not old.disabled
     and not (new.is_super_admin and new.role = 'lgu_ldrrmc' and not new.disabled) then
    if not exists (
      select 1 from public.profiles p
       where p.id <> old.id and p.role = 'lgu_ldrrmc' and p.is_super_admin and not p.disabled
    ) then
      raise exception 'This is the last active Super Admin. Grant Super Admin to another account first.';
    end if;
  end if;

  -- no signed-in user means a trusted backend call (service role / Edge
  -- Function / SQL editor). Normal clients always carry a uid.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_super_admin() then
    if new.role is distinct from old.role then
      raise exception 'Roles are managed by the Super Admin';
    end if;
    if new.is_super_admin is distinct from old.is_super_admin then
      raise exception 'Super Admin access is managed by the Super Admin';
    end if;
    if new.barangay_id is distinct from old.barangay_id then
      raise exception 'Barangay assignment is managed by the Super Admin';
    end if;
    if new.disabled is distinct from old.disabled then
      raise exception 'Account status is managed by the Super Admin';
    end if;
    if new.dispatch_unit_id is distinct from old.dispatch_unit_id then
      raise exception 'Unit assignment is managed by the Super Admin';
    end if;
    if new.unit_role is distinct from old.unit_role then
      raise exception 'Unit role is managed by the Super Admin';
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------- policies
-- Editing someone else's profile row: Super Admin only (was: any LGU account).
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

-- The activity log: Super Admin only (was: any LGU account).
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated using (public.is_super_admin());

-- ------------------------------------------------------- role administration
-- The three RPCs from migration 006, now gated on the Super Admin.
-- p_role accepts 'super_admin' as shorthand for lgu_ldrrmc + the flag.
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
  v_row      public.profiles;
  v_barangay text;
  v_before   public.profiles;
  v_super    boolean := (p_role = 'super_admin');
  v_role     text    := case when p_role = 'super_admin' then 'lgu_ldrrmc' else p_role end;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can change roles';
  end if;
  if v_role not in ('citizen', 'barangay_official', 'lgu_ldrrmc') then
    raise exception 'Unknown role: %', p_role;
  end if;

  select * into v_before from public.profiles where id = p_user;
  if v_before.id is null then
    raise exception 'That account does not exist';
  end if;
  if p_user = auth.uid() and v_before.is_super_admin and not v_super then
    raise exception 'You cannot remove your own Super Admin access';
  end if;

  v_barangay := null;
  if p_barangay_id is not null then
    select name into v_barangay from public.barangays where id = p_barangay_id;
  end if;

  update public.profiles
     set role           = v_role,
         is_super_admin = v_super,
         barangay_id    = coalesce(p_barangay_id, barangay_id),
         barangay       = coalesce(v_barangay, barangay),
         updated_at     = now()
   where id = p_user
  returning * into v_row;

  perform public.write_audit('user.role_changed', 'profiles', p_user,
    jsonb_build_object(
      'from', case when v_before.is_super_admin then 'super_admin' else v_before.role end,
      'to', p_role, 'barangay_id', p_barangay_id));

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
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can disable an account';
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
  v_row  public.profiles;
  v_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can assign barangays';
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

-- ------------------------------------------------- the first Super Admin
-- Promotes the account that owns this email. The account must already exist
-- (sign up or be invited first). If it does not, the whole migration rolls
-- back with a clear message rather than leaving the system with no Super
-- Admin, which would lock everyone out of user management.
do $$
declare
  v_email constant text := 'geraldinegazazz05@gmail.com';
  v_id    uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    -- [this project] 026 already turned this project's 'super_admin' accounts
    -- into flagged Super Admins. If one is active, the system is not left
    -- without a Super Admin, so carry on; otherwise stop as upstream does.
    if exists (select 1 from public.profiles
                where role = 'lgu_ldrrmc' and is_super_admin and not disabled) then
      raise notice 'No account for %; keeping the existing Super Admin account(s).', v_email;
      return;
    end if;
    raise exception 'No account exists for %. Create or sign up that account, then run this migration again.', v_email;
  end if;

  update public.profiles
     set role = 'lgu_ldrrmc', is_super_admin = true, disabled = false,
         dispatch_unit_id = null, unit_role = '',   -- required by profiles_dispatch_team_unit_check
         updated_at = now()
   where id = v_id
     and not (role = 'lgu_ldrrmc' and is_super_admin and not disabled);

  if found then
    insert into public.audit_log (actor_id, action, entity, entity_id, meta)
    values (null, 'user.role_changed', 'profiles', v_id,
            jsonb_build_object('to', 'super_admin', 'email', v_email, 'via', 'migration 043'));
  elsif not exists (select 1 from public.profiles where id = v_id) then
    raise exception 'The account % has no profile row. Sign in once with it, then run this migration again.', v_email;
  end if;
end $$;

commit;

-- Verify:
--   select email, role, is_super_admin, disabled from public.profiles where is_super_admin;
