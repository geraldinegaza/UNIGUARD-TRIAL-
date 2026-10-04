-- ============================================================================
--  UniGuard · 009 · Hardening: rate limiting, declarable emergencies, errors
--
--  Additive only.
-- ============================================================================

-- ------------------------------------------------------------- rate limiting
create table if not exists public.rate_limits (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  action       text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (user_id, action, window_start)
);

create or replace function public.check_rate_limit(p_action text, p_max int, p_window interval)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits   int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  /* bucket the window so concurrent calls land in the same row */
  v_window := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));

  insert into public.rate_limits (user_id, action, window_start, hits)
  values (auth.uid(), p_action, v_window, 1)
  on conflict (user_id, action, window_start)
  do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  if v_hits > p_max then
    raise exception 'Too many % actions in a short time. Please wait and try again.', p_action
      using hint = 'rate_limited';
  end if;
end;
$$;

alter table public.rate_limits enable row level security;

-- report spam guard: five reports per ten minutes per account
create or replace function public.guard_report_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.check_rate_limit('report', 5, interval '10 minutes');
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'reports' and tg.tgname = 'reports_rate_limit'
  ) then
    create trigger reports_rate_limit
      before insert on public.reports
      for each row execute function public.guard_report_rate();
  end if;
end $$;

-- ------------------------------------------------- declare an emergency (LGU)
create or replace function public.declare_emergency(
  p_title text,
  p_body text default '',
  p_area text default 'Municipality-wide'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id      uuid;
  v_devices int;
  v_reached int;
begin
  if not public.is_lgu() then
    raise exception 'Only LGU / LDRRMC can declare an emergency';
  end if;

  perform public.check_rate_limit('declare', 3, interval '30 minutes');

  insert into public.advisories (author_id, title, body, severity, kind, affected_area, citywide, published_at)
  values (auth.uid(), p_title, coalesce(p_body, ''), 'emergency', 'emergency', coalesce(p_area, 'Municipality-wide'), true, now())
  returning id into v_id;

  v_reached := public.fanout_advisory(v_id);

  select count(*) into v_devices from public.push_subscriptions;

  perform public.write_audit('emergency.declared', 'advisories', v_id,
    jsonb_build_object('title', p_title, 'area', p_area, 'subscribed_devices', v_devices, 'notified', v_reached));

  return jsonb_build_object('advisory_id', v_id, 'devices', v_devices, 'notified', v_reached);
end;
$$;

revoke all on function public.declare_emergency(text, text, text) from public;
grant execute on function public.declare_emergency(text, text, text) to authenticated;

-- ------------------------------------------------------------ client errors
create table if not exists public.client_errors (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete set null,
  message    text not null,
  context    jsonb not null default '{}'::jsonb,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;

drop policy if exists client_errors_read on public.client_errors;
create policy client_errors_read on public.client_errors
  for select to authenticated using (public.is_lgu());

create or replace function public.log_client_error(p_message text, p_context jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.client_errors (user_id, message, context, user_agent)
  values (auth.uid(), left(coalesce(p_message, 'unknown'), 500), coalesce(p_context, '{}'::jsonb), '');
end;
$$;

grant execute on function public.log_client_error(text, jsonb) to authenticated;

-- ------------------------------------------------------------- housekeeping
/* Drop rate limit buckets older than a day. Call from a scheduled job:
     select cron.schedule('uniguard-cleanup', '0 4 * * *', $$select public.cleanup_rate_limits()$$);
   or from an Edge Function on a schedule. */
create or replace function public.cleanup_rate_limits()
returns int language plpgsql security definer set search_path = public as $$
declare v_deleted int;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
