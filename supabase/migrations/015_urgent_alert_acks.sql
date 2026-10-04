-- ============================================================================
--  UniGuard · 015 · Urgent alert acknowledgments + Report-status fan-out
--
--  Additive only. Two things:
--
--  1. alert_acknowledgments  — every time a citizen dismisses an emergency
--     advisory, the action is logged so we can prove "did they see it".
--
--  2. advance_report_status is redefined to also fan out a per-user
--     notification to the original reporter whenever the status of their own
--     report changes (Processing → Deployed → Resolved). Mirrors the
--     fanout_advisory pattern.
-- ============================================================================

create table if not exists public.alert_acknowledgments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  advisory_id   uuid references public.advisories(id) on delete cascade,
  acknowledged_at timestamptz not null default now()
);

alter table public.alert_acknowledgments add column if not exists user_id       uuid;
alter table public.alert_acknowledgments add column if not exists advisory_id   uuid;
alter table public.alert_acknowledgments add column if not exists acknowledged_at timestamptz not null default now();

create index if not exists alert_acknowledgments_user_idx on public.alert_acknowledgments (user_id, advisory_id);

alter table public.alert_acknowledgments enable row level security;

drop policy if exists alert_acknowledgments_read on public.alert_acknowledgments;
create policy alert_acknowledgments_read on public.alert_acknowledgments
  for select to authenticated using (user_id = auth.uid() or public.is_lgu());

drop policy if exists alert_acknowledgments_write on public.alert_acknowledgments;
create policy alert_acknowledgments_write on public.alert_acknowledgments
  for insert to authenticated with check (user_id = auth.uid());

-- -------------------------------------- fan out a notification to the reporter
-- Re-define advance_report_status so that, in addition to writing the audit
-- row, it also inserts a notification addressed to the reporter. The tone
-- depends on the new status: dispatched → warning, resolved → prepared,
-- rejected → warning, anything else → advisory. The notification carries
-- type='report_status' and the report id so tapping it deep-links to the
-- report detail screen.
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.reports;
  v_role     text;
  v_brgy     uuid;
  v_reporter uuid;
  v_code     text;
  v_tone     text;
  v_title    text;
  v_body     text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('reported', 'verified', 'dispatched', 'resolved', 'rejected') then
    raise exception 'Unknown status: %', p_next;
  end if;

  select role, barangay_id into v_role, v_brgy from public.profiles where id = auth.uid();

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;

  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can change an incident status';
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  update public.reports set status = p_next where id = p_report_id returning * into v_row;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('to', p_next, 'note', coalesce(p_note, '')));

  -- notify the reporter (if any) so a citizen sees every status change
  v_reporter := v_row.reporter_id;
  v_code     := coalesce(v_row.code, '');
  if v_reporter is not null then
    v_tone  := case p_next when 'dispatched' then 'warning' when 'resolved' then 'prepared'
                            when 'rejected'  then 'warning' else 'advisory' end;
    v_title := case p_next
      when 'verified'   then 'Your report was verified'
      when 'dispatched' then 'Response dispatched to your report'
      when 'resolved'   then 'Your report is resolved'
      when 'rejected'   then 'Your report was rejected'
      else 'Your report status changed'
    end;
    v_body  := case p_next
      when 'verified'   then 'Report ' || v_code || ' has been reviewed and verified.'
      when 'dispatched' then 'A responder unit has been dispatched for ' || v_code || '.'
      when 'resolved'   then 'Report ' || v_code || ' is resolved. Closing note: ' || left(coalesce(p_note, ''), 140)
      when 'rejected'   then 'Report ' || v_code || ' was rejected: ' || left(coalesce(p_note, ''), 140)
      else 'Report ' || v_code || ' is now ' || p_next || '.'
    end;
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_reporter, v_title, v_body, v_tone, 'check', 'report_status', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;

revoke all on function public.advance_report_status(uuid, text, text) from public;
grant execute on function public.advance_report_status(uuid, text, text) to authenticated;
