-- 152: Phase 4 — settings, message templates, advisory fan-out.
--
-- 1. app_settings (organisation profile, SMS sender) could be rewritten by any
--    LDRRMO account, disabled ones included. Writing is now the Super Admin's
--    job; active LDRRMO staff still read it. Everyone (residents included,
--    signed in or not) can read the organisation's name and hotline through
--    org_profile(), so the app can show the right MDRRMO number.
-- 2. message_templates: reads and writes now ignore disabled accounts, and a
--    new template gets an id automatically.
-- 3. fanout_advisory had no caller check, so any account could re-send an
--    existing advisory's notifications to every resident. Only LDRRMO staff
--    and the advisory's author may fan it out now.
--
-- Safe to run more than once.

/* 1. settings ---------------------------------------------------------------- */
drop policy if exists "app_settings read" on public.app_settings;
create policy "app_settings read" on public.app_settings
  for select to authenticated
  using (public.is_active_user() and public.is_lgu());

drop policy if exists "app_settings write" on public.app_settings;
create policy "app_settings write" on public.app_settings
  for all to authenticated
  using (public.is_active_user() and public.is_super_admin())
  with check (public.is_active_user() and public.is_super_admin());

create or replace function public.org_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value -> 'org' from public.app_settings where key = 'main'),
    jsonb_build_object('municipality', 'Lingayen', 'province', 'Pangasinan',
                       'office', 'Municipal Disaster Risk Reduction and Management Office',
                       'contact', '(075) 632-2222', 'email', '')
  );
$$;
grant execute on function public.org_profile() to anon, authenticated;

/* 2. message templates ------------------------------------------------------- */
alter table public.message_templates alter column id set default ('MT-' || substr(gen_random_uuid()::text, 1, 8));

drop policy if exists "message_templates read" on public.message_templates;
create policy "message_templates read" on public.message_templates
  for select to authenticated
  using (public.is_active_user() and (public.is_lgu() or public.is_official()));

drop policy if exists "message_templates write" on public.message_templates;
create policy "message_templates write" on public.message_templates
  for all to authenticated
  using (public.is_active_user() and public.is_lgu())
  with check (public.is_active_user() and public.is_lgu());

/* 3. advisory fan-out -------------------------------------------------------- */
create or replace function public.fanout_advisory(p_advisory_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adv      record;
  v_inserted int := 0;
begin
  select * into v_adv from public.advisories where id = p_advisory_id;
  if v_adv is null then
    return 0;
  end if;

  -- the trusted backend (no auth.uid) may always fan out
  if auth.uid() is not null and not (
       (public.is_active_user() and public.is_lgu())
       or coalesce(v_adv.author_id = auth.uid(), false)  -- an advisory with no author is LDRRMO-only
     ) then
    raise exception 'Only LDRRMO staff or the advisory''s author can send its notifications';
  end if;

  with targets as (
    select p.id
      from public.profiles p
     where p.disabled = false
       and (
         v_adv.citywide
         or exists (select 1 from public.advisory_targets t
                     where t.advisory_id = v_adv.id and t.barangay_id = p.barangay_id)
       )
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, advisory_id)
    select id, v_adv.title, left(v_adv.body, 240), v_adv.severity, 'megaphone', v_adv.id from targets
    returning 1
  )
  select count(*) into v_inserted from ins;

  return v_inserted;
end;
$$;

revoke all on function public.fanout_advisory(uuid) from public, anon;
grant execute on function public.fanout_advisory(uuid) to authenticated;
