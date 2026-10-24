-- ============================================================================
--  UniGuard · 028 · Strict incident status flow (single source of truth)
--
--  Status flow (DECISIONS in the fix prompt):
--      reported -> verified -> dispatched -> resolved      (one step at a time)
--      rejected  allowed from any non-terminal state       (terminal)
--      resolved  terminal
--
--  · NO role may skip a step — including LGU/LDRRMC. The old guard_report_status
--    (migration 010) let an LGU make any legal-or-illegal-looking jump and
--    allowed resolved -> nothing but also reported -> resolved for everyone.
--  · `resolved` and `rejected` are final: no transition out, for any role.
--  · The auto-verification by corroboration (migrations 022 / 025) still works:
--    it moves reported -> verified (one legal step) from a security-definer
--    trigger whose session runs as the reporting user; the guard below permits
--    the step itself and only checks transitions, so the trigger is unaffected.
--  · reports_log_status (migration 007 trigger) keeps writing history because
--    the guard does not touch that trigger.
--
--  Stored keys are unchanged: reported, verified, dispatched, resolved,
--  rejected. Only the guard + RPC definitions change.
--
--  Idempotent: functions are create-or-replace, triggers dropped and recreated.
-- ============================================================================

-- ------------------------------------------------------------- status guard
create or replace function public.guard_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if new.status is distinct from old.status then
    v_ok := case
      when old.status = 'reported'   and new.status = 'verified'   then true
      when old.status = 'verified'   and new.status = 'dispatched' then true
      when old.status = 'dispatched' and new.status = 'resolved'   then true
      when old.status in ('reported','verified','dispatched') and new.status = 'rejected' then true
      else false
    end;

    if not v_ok then
      raise exception 'Illegal status change from % to %. The flow is reported -> verified -> dispatched -> resolved, one step at a time; rejected is allowed from any open state; resolved and rejected are final.',
        old.status, new.status;
    end if;
  end if;

  if new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  -- reopening guard: resolved/rejected rows must keep their resolved_at
  if new.resolved_at is distinct from old.resolved_at and new.status <> 'resolved' then
    raise exception 'resolved_at can only be set when the status becomes resolved';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_guard_status on public.reports;
create trigger reports_guard_status
  before update on public.reports
  for each row execute function public.guard_report_status();

-- ------------------------------------------------------------------- the RPC
-- Redefined (not edited in place — migrations 007/010/015 stay as they are).
-- Same whitelist, same audit + notification behaviour as 015, plus the
-- one-step transition check so the guard's error never even gets a chance to
-- surface half a transaction. The per-step transition test happens in
-- guard_report_status; here we only pre-validate the target so callers get a
-- clean error message instead of a trigger exception.
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
  if p_next not in ('verified', 'dispatched', 'resolved', 'rejected') then
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

  -- one step at a time, for every role; terminal states are final
  if not (
       (v_row.status = 'reported'   and p_next in ('verified', 'rejected'))
    or (v_row.status = 'verified'   and p_next in ('dispatched', 'rejected'))
    or (v_row.status = 'dispatched' and p_next in ('resolved', 'rejected'))
  ) then
    raise exception 'A report in "%" cannot move to "%". Move one step at a time; resolved and rejected are final.', v_row.status, p_next;
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  update public.reports set status = p_next where id = p_report_id returning * into v_row;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('from', v_row.status, 'to', p_next, 'note', coalesce(p_note, '')));

  -- notify the reporter so a citizen sees every status change
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
