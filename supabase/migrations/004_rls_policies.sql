-- ============================================================================
--  UniGuard · 004 · Row level security
--
--  Security lives here, not in the UI. Every rule reads the caller's role and
--  barangay from public.profiles, never from the client and never from
--  auth.users.raw_user_meta_data, which the user controls.
--
--  Note on idempotency: tables are only ever created or altered. Policies are
--  dropped and recreated because that is the only way to change a policy
--  definition; no data is touched.
-- ============================================================================

-- --------------------------------------------------------------- role helpers
create or replace function public.current_role_key()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

create or replace function public.is_lgu()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'lgu_ldrrmc';
$$;

create or replace function public.is_official()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_key() = 'barangay_official';
$$;

create or replace function public.my_barangay_id()
returns uuid language sql stable security definer set search_path = public as $$
  select barangay_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_barangay_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(barangay, '') from public.profiles where id = auth.uid();
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not disabled from public.profiles where id = auth.uid()), false);
$$;

-- --------------------------------------------------- profile field protection
-- A user may edit their own name and phone. Role, barangay assignment and the
-- disabled flag can only be changed by an LGU administrator.
create or replace function public.guard_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
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

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles' and tg.tgname = 'profiles_guard_fields'
  ) then
    create trigger profiles_guard_fields
      before update on public.profiles
      for each row execute function public.guard_profile_fields();
  end if;
end $$;

-- ------------------------------------------------------- report insert guard
-- The reporter is taken from the session, and a citizen always files for their
-- own barangay so nobody can post into another barangay's queue.
create or replace function public.guard_report_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role     text;
  v_brgy_id  uuid;
  v_brgy     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to file a report';
  end if;

  new.reporter_id := auth.uid();

  select role, barangay_id, barangay into v_role, v_brgy_id, v_brgy
    from public.profiles where id = auth.uid();

  if coalesce(v_role, 'citizen') = 'citizen' then
    if v_brgy_id is not null then
      new.barangay_id := v_brgy_id;
    end if;
    if coalesce(v_brgy, '') <> '' then
      new.barangay := v_brgy;
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_guard_insert'
  ) then
    create trigger reports_guard_insert
      before insert on public.reports
      for each row execute function public.guard_report_insert();
  end if;
end $$;

-- --------------------------------------------------------------- enable RLS
alter table public.barangays              enable row level security;
alter table public.profiles               enable row level security;
alter table public.reports                enable row level security;
alter table public.report_corroborations  enable row level security;
alter table public.report_status_history  enable row level security;
alter table public.advisories             enable row level security;
alter table public.advisory_targets       enable row level security;
alter table public.evacuation_centers     enable row level security;
alter table public.emergency_hotlines     enable row level security;
alter table public.notifications          enable row level security;
alter table public.push_subscriptions     enable row level security;
alter table public.audit_log              enable row level security;

-- ------------------------------------------------------------------ barangays
drop policy if exists barangays_read on public.barangays;
create policy barangays_read on public.barangays
  for select to authenticated using (true);

drop policy if exists barangays_write on public.barangays;
create policy barangays_write on public.barangays
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());

-- ------------------------------------------------------------------- profiles
-- read: yourself, an official sees residents of their own barangay, LGU sees all
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_lgu())
  with check (id = auth.uid() or public.is_lgu());

-- -------------------------------------------------------------------- reports
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_active_user());

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports
  for select to authenticated using (
    reporter_id = auth.uid()
    or public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
  );

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (
    public.is_lgu()
    or (public.is_official() and barangay_id = public.my_barangay_id())
    or (reporter_id = auth.uid() and created_at > now() - interval '15 minutes')
  )
  with check (true);

drop policy if exists reports_delete on public.reports;
create policy reports_delete on public.reports
  for delete to authenticated using (public.is_lgu());

-- ------------------------------------------------ reports for same barangay
-- Residents need to see what is happening around them without seeing who filed
-- what. The view runs with owner rights and applies its own filter, exposing no
-- reporter identity at all.
create or replace view public.reports_feed as
select r.id,
       r.code,
       r.barangay_id,
       r.barangay,
       r.hazard_type,
       r.severity,
       r.urgency,
       r.status,
       r.description,
       r.lat,
       r.lng,
       r.photo_path,
       r.created_at,
       r.updated_at,
       r.resolved_at,
       (select count(*) from public.report_corroborations c where c.report_id = r.id) as corroborations,
       (r.reporter_id = auth.uid()) as is_mine
  from public.reports r
 where r.reporter_id = auth.uid()
    or public.is_lgu()
    or (public.is_official() and r.barangay_id = public.my_barangay_id())
    or (r.barangay_id is not null and r.barangay_id = public.my_barangay_id());

do $$ begin
  execute 'alter view public.reports_feed set (security_invoker = false)';
exception when others then null;
end $$;

grant select on public.reports_feed to authenticated;

-- ---------------------------------------------------- report corroborations
drop policy if exists corroborations_read on public.report_corroborations;
create policy corroborations_read on public.report_corroborations
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_lgu()
    or exists (
      select 1 from public.reports r
       where r.id = report_id
         and (r.reporter_id = auth.uid()
              or (public.is_official() and r.barangay_id = public.my_barangay_id()))
    )
  );

drop policy if exists corroborations_insert on public.report_corroborations;
create policy corroborations_insert on public.report_corroborations
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());

-- ------------------------------------------------------ report status history
drop policy if exists status_history_read on public.report_status_history;
create policy status_history_read on public.report_status_history
  for select to authenticated using (
    public.is_lgu()
    or exists (
      select 1 from public.reports r
       where r.id = report_id
         and (r.reporter_id = auth.uid()
              or (public.is_official() and r.barangay_id = public.my_barangay_id()))
    )
  );
-- no insert policy: history rows are written by a security definer trigger only

-- ----------------------------------------------------------------- advisories
drop policy if exists advisories_read on public.advisories;
create policy advisories_read on public.advisories
  for select to authenticated using (true);

drop policy if exists advisories_insert on public.advisories;
create policy advisories_insert on public.advisories
  for insert to authenticated
  with check (public.is_lgu() or public.is_official());

drop policy if exists advisories_update on public.advisories;
create policy advisories_update on public.advisories
  for update to authenticated
  using (public.is_lgu() or author_id = auth.uid())
  with check (public.is_lgu() or author_id = auth.uid());

drop policy if exists advisories_delete on public.advisories;
create policy advisories_delete on public.advisories
  for delete to authenticated using (public.is_lgu());

drop policy if exists advisory_targets_read on public.advisory_targets;
create policy advisory_targets_read on public.advisory_targets
  for select to authenticated using (true);

drop policy if exists advisory_targets_write on public.advisory_targets;
create policy advisory_targets_write on public.advisory_targets
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());

-- -------------------------------------------------------- evacuation centres
-- everyone reads; officials manage their own barangay; LGU manages citywide
drop policy if exists evacuation_read on public.evacuation_centers;
create policy evacuation_read on public.evacuation_centers
  for select to authenticated using (true);

drop policy if exists evacuation_insert on public.evacuation_centers;
create policy evacuation_insert on public.evacuation_centers
  for insert to authenticated
  with check (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()));

drop policy if exists evacuation_update on public.evacuation_centers;
create policy evacuation_update on public.evacuation_centers
  for update to authenticated
  using (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()))
  with check (public.is_lgu() or (public.is_official() and barangay_id = public.my_barangay_id()));

drop policy if exists evacuation_delete on public.evacuation_centers;
create policy evacuation_delete on public.evacuation_centers
  for delete to authenticated using (public.is_lgu());

-- ------------------------------------------------------------- hotlines
-- everyone reads; only LGU manages the directory
drop policy if exists hotlines_read on public.emergency_hotlines;
create policy hotlines_read on public.emergency_hotlines
  for select to authenticated using (true);

drop policy if exists hotlines_write on public.emergency_hotlines;
create policy hotlines_write on public.emergency_hotlines
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());

-- ------------------------------------------------------------ notifications
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());
-- no insert policy: notifications are created by security definer functions

-- ------------------------------------------------------ push subscriptions
drop policy if exists push_read on public.push_subscriptions;
create policy push_read on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_write on public.push_subscriptions;
create policy push_write on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------- audit log
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated using (public.is_lgu());
-- no insert policy: entries are written by security definer functions
