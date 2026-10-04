-- ============================================================================
--  UniGuard · 002 · Report workflow: human code, corroboration, status history
--
--  Additive only. Creates the corroboration table, the status history table,
--  the UG-YYYY-NNNN code generator and the crowd-corroboration verification
--  trigger described in Phase 1.
-- ============================================================================

-- ------------------------------------------------- human readable report code
create sequence if not exists public.report_code_seq start 1;

create or replace function public.assign_report_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'UG-' || to_char(now(), 'YYYY') || '-' ||
                lpad(nextval('public.report_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_assign_code'
  ) then
    create trigger reports_assign_code
      before insert on public.reports
      for each row execute function public.assign_report_code();
  end if;
end $$;

-- ------------------------------------------------------- report corroborations
create table if not exists public.report_corroborations (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  note       text not null default '',
  created_at timestamptz not null default now(),
  constraint report_corroborations_unique unique (report_id, user_id)
);

create index if not exists corroborations_report_idx on public.report_corroborations (report_id, created_at desc);
create index if not exists corroborations_user_idx   on public.report_corroborations (user_id, created_at desc);

-- the corroborating user is always taken from the session, and the reporter of
-- the report may not corroborate their own submission
create or replace function public.guard_corroboration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reporter uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to corroborate a report';
  end if;
  new.user_id := auth.uid();

  select reporter_id into v_reporter from public.reports where id = new.report_id;
  if v_reporter is null then
    raise exception 'That report does not exist';
  end if;
  if v_reporter = new.user_id then
    raise exception 'You cannot corroborate your own report';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'report_corroborations' and tg.tgname = 'corroborations_guard'
  ) then
    create trigger corroborations_guard
      before insert on public.report_corroborations
      for each row execute function public.guard_corroboration();
  end if;
end $$;

-- ------------------------------------------------------- report status history
create table if not exists public.report_status_history (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.profiles(id) on delete set null,
  reason      text not null default 'manual',
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists status_history_report_idx on public.report_status_history (report_id, created_at);

-- legal transitions only, unless the caller is LGU
create or replace function public.guard_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok  boolean;
  v_lgu boolean;
begin
  if new.status is distinct from old.status then
    v_ok := case
      when old.status = 'reported'   and new.status in ('verified','dispatched','resolved') then true
      when old.status = 'verified'   and new.status in ('dispatched','resolved')           then true
      when old.status = 'dispatched' and new.status = 'resolved'                            then true
      else false
    end;

    if not v_ok then
      select (role = 'lgu_ldrrmc') into v_lgu from public.profiles where id = auth.uid();
      if not coalesce(v_lgu, false) then
        raise exception 'Illegal status change from % to %', old.status, new.status;
      end if;
    end if;
  end if;

  if new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.log_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.report_status_history (report_id, from_status, to_status, changed_by, reason)
    values (new.id, old.status, new.status, auth.uid(),
            coalesce(current_setting('uniguard.reason', true), 'manual'));
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_guard_status'
  ) then
    create trigger reports_guard_status
      before update on public.reports
      for each row execute function public.guard_report_status();
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_log_status'
  ) then
    create trigger reports_log_status
      after update on public.reports
      for each row execute function public.log_report_status();
  end if;
end $$;

-- --------------------------------------------- crowd corroboration verification
-- Three distinct people (the reporter counts as one) confirming the same hazard
-- in the same barangay within a six hour window around the report verifies it.
create or replace function public.apply_corroboration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_barangay_id uuid;
  v_barangay    text;
  v_hazard      text;
  v_created     timestamptz;
  v_count       int;
  v_row         record;
begin
  select barangay_id, barangay, hazard_type, created_at
    into v_barangay_id, v_barangay, v_hazard, v_created
    from public.reports where id = new.report_id;

  if v_hazard is null then
    return new;
  end if;

  select count(distinct u) into v_count from (
    select r.reporter_id as u
      from public.reports r
     where r.hazard_type = v_hazard
       and (r.barangay_id is not distinct from v_barangay_id)
       and r.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
    union
    select c.user_id
      from public.report_corroborations c
      join public.reports r2 on r2.id = c.report_id
     where r2.hazard_type = v_hazard
       and (r2.barangay_id is not distinct from v_barangay_id)
       and r2.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
  ) s;

  if v_count >= 3 then
    perform set_config('uniguard.reason', 'auto_corroboration', true);
    for v_row in
      select id from public.reports
       where hazard_type = v_hazard
         and (barangay_id is not distinct from v_barangay_id)
         and status = 'reported'
         and created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
    loop
      update public.reports set status = 'verified' where id = v_row.id;
    end loop;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'report_corroborations' and tg.tgname = 'corroborations_verify'
  ) then
    create trigger corroborations_verify
      after insert on public.report_corroborations
      for each row execute function public.apply_corroboration();
  end if;
end $$;

-- ------------------------------------------------------------ helper: my code
-- used by later phases to render UG-YYYY-NNNN consistently
create or replace function public.format_report_code(seq_value bigint, at_time timestamptz default now())
returns text language sql immutable as $$
  select 'UG-' || to_char(at_time, 'YYYY') || '-' || lpad(seq_value::text, 4, '0');
$$;
