-- ============================================================================
--  UniGuard · 016 · One-tap SOS log + RPC
--
--  Additive only. A signed-in citizen can fire an SOS: the call writes a row
--  in sos_log (with GPS + profile snapshot at that moment) and fans out a
--  notification to every LGU/LDRRMO account so the duty officer sees it.
-- ============================================================================

create table if not exists public.sos_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  profile_name text not null default '',
  profile_phone text not null default '',
  barangay     text not null default '',
  lat          double precision,
  lng          double precision,
  accuracy     double precision,
  note         text not null default '',
  status       text not null default 'sent',
  created_at   timestamptz not null default now()
);

alter table public.sos_log add column if not exists user_id       uuid;
alter table public.sos_log add column if not exists profile_name   text not null default '';
alter table public.sos_log add column if not exists profile_phone text not null default '';
alter table public.sos_log add column if not exists barangay      text not null default '';
alter table public.sos_log add column if not exists lat            double precision;
alter table public.sos_log add column if not exists lng             double precision;
alter table public.sos_log add column if not exists accuracy      double precision;
alter table public.sos_log add column if not exists note           text not null default '';
alter table public.sos_log add column if not exists status        text not null default 'sent';
alter table public.sos_log add column if not exists created_at    timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sos_log_status_check') then
    alter table public.sos_log add constraint sos_log_status_check
      check (status in ('sent','acknowledged','resolved'));
  end if;
end $$;

create index if not exists sos_log_created_idx on public.sos_log (created_at desc);

alter table public.sos_log enable row level security;

drop policy if exists sos_log_read on public.sos_log;
create policy sos_log_read on public.sos_log
  for select to authenticated using (
    user_id = auth.uid() or public.is_lgu() or public.is_official()
  );

-- citizens insert their own; nobody else can
drop policy if exists sos_log_insert on public.sos_log;
create policy sos_log_insert on public.sos_log
  for insert to authenticated with check (user_id = auth.uid());

-- the RPC: writes the row, snapshots the caller's profile, fans out a
-- notification to every LGU/LDRRMO account, and writes an audit row.
create or replace function public.submit_sos(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id     uuid;
  v_row    public.sos_log;
  v_prof   record;
  v_reach  int := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to send an SOS';
  end if;

  perform public.check_rate_limit('sos', 5, interval '10 minutes');

  select full_name, phone, barangay into v_prof from public.profiles where id = auth.uid();

  insert into public.sos_log (user_id, profile_name, profile_phone, barangay, lat, lng, accuracy, note)
  values (auth.uid(),
          coalesce(v_prof.full_name, ''),
          coalesce(v_prof.phone, ''),
          coalesce(v_prof.barangay, ''),
          p_lat, p_lng, p_accuracy, coalesce(p_note, ''))
  returning * into v_row;
  v_id := v_row.id;

  -- fan out a notification to every LGU/LDRRMO officer
  with targets as (
    select p.id from public.profiles p
     where p.disabled = false and p.role = 'lgu_ldrrmc'
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, type, sos_id)
    select id,
           'SOS received from ' || coalesce(v_prof.full_name, 'a resident'),
           coalesce(v_prof.phone, '') || ' · ' || coalesce(v_prof.barangay, '') ||
           ' · ' || coalesce(p_accuracy::text, '') || ' m',
           'emergency', 'alert', 'sos', v_id
      from targets
    returning 1
  )
  select count(*) into v_reach from ins;

  perform public.write_audit('sos.received', 'sos_log', v_id,
    jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy, 'reach', v_reach));

  return jsonb_build_object('id', v_id, 'reach', v_reach);
end;
$$;

revoke all on function public.submit_sos(double precision, double precision, double precision, text) from public;
grant execute on function public.submit_sos(double precision, double precision, double precision, text) to authenticated;
