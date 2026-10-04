-- ============================================================================
--  UniGuard · 003 · Notifications, push subscriptions and the audit log
--
--  Additive only.
-- ============================================================================

-- -------------------------------------------------------------- notifications
-- The in-app inbox. One row per recipient so read state is per person.
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null default '',
  body        text not null default '',
  tone        text not null default 'advisory',
  icon        text,
  report_id   uuid references public.reports(id) on delete cascade,
  advisory_id uuid references public.advisories(id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.notifications add column if not exists user_id     uuid;
alter table public.notifications add column if not exists title       text not null default '';
alter table public.notifications add column if not exists body        text not null default '';
alter table public.notifications add column if not exists tone        text not null default 'advisory';
alter table public.notifications add column if not exists icon        text;
alter table public.notifications add column if not exists report_id   uuid;
alter table public.notifications add column if not exists advisory_id uuid;
alter table public.notifications add column if not exists read_at     timestamptz;
alter table public.notifications add column if not exists created_at  timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_tone_check') then
    alter table public.notifications add constraint notifications_tone_check
      check (tone in ('emergency','warning','advisory','prepared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_user_id_fkey') then
    alter table public.notifications add constraint notifications_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------- push subscriptions
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null default '',
  auth       text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ------------------------------------------------------------------- audit log
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text not null default '',
  entity_id  uuid,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_entity_idx  on public.audit_log (entity, entity_id);

-- a helper every later phase uses to write an audit entry
create or replace function public.write_audit(
  p_action text, p_entity text default '', p_entity_id uuid default null, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), p_action, coalesce(p_entity, ''), p_entity_id, coalesce(p_meta, '{}'::jsonb));
$$;

-- ---------------------------------------------- notify same-barangay residents
-- Fan an advisory out to the residents of its target barangays (or everyone when
-- it is citywide). Called after an advisory is published.
create or replace function public.fanout_advisory(p_advisory_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_adv      record;
  v_inserted int := 0;
begin
  select * into v_adv from public.advisories where id = p_advisory_id;
  if v_adv is null then
    return 0;
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
