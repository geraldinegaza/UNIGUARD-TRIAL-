-- 153: fixes found by replaying every save against the real database.
--
-- 1. Incident status changes follow the real workflow.
--
-- advance_report_status accepted any status from any status (a resolved
-- report could go back to reported), let a report be marked "dispatched"
-- with no team or unit sent (the resident was told help was on the way), and
-- did not check for disabled accounts. It now:
--   * refuses disabled accounts,
--   * allows only reported -> verified -> dispatched -> resolved, and
--     rejected from any open status (the same order the reports trigger
--     enforces, now with a plain message before the update is attempted),
--   * allows "dispatched" only when a dispatch record exists
--     (dispatch_report_v2 creates it and sets the status itself).
-- Everything else in the function is unchanged. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.advance_report_status(p_report_id uuid, p_next text, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row      public.reports;
  v_role     text;
  v_brgy     uuid;
  v_is_super boolean := false;
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

  -- fetch the caller's profile in one round-trip; v_is_super tells us if they
  -- are a Super Admin (lgu_ldrrmc + is_super_admin).
  select role, barangay_id, coalesce(is_super_admin, false)
    into v_role, v_brgy, v_is_super
    from public.profiles where id = auth.uid();

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
  if not public.is_active_user() then
    raise exception 'This account has been disabled';
  end if;

  -- [153] a report moves forward one step at a time, and is only "dispatched"
  -- when a team or unit was actually sent (dispatch_report_v2)
  if v_row.status = p_next then
    return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status, 'resolved_at', v_row.resolved_at);
  end if;
  if not (
       (v_row.status = 'reported'   and p_next in ('verified', 'rejected'))
    or (v_row.status = 'verified'   and p_next in ('dispatched', 'rejected'))
    or (v_row.status = 'dispatched' and p_next in ('resolved', 'rejected'))
  ) then
    raise exception 'A report that is "%" cannot be moved to "%"', v_row.status, p_next;
  end if;
  if p_next = 'dispatched' and not exists (select 1 from public.report_dispatches d where d.report_id = p_report_id) then
    raise exception 'Use Dispatch to send a team; the report becomes "dispatched" when a team is on its way';
  end if;

  -- ── Super Admin verify block ───────────────────────────────────────────
  -- Moving reported → verified is the verify step. The Super Admin must NOT
  -- be able to perform it, even though they inherit lgu_ldrrmc privileges.
  -- Other transitions (dispatch, resolve, reject) are allowed because they
  -- are not "verify" actions.
  if v_is_super and v_row.status = 'reported' and p_next = 'verified' then
    raise exception 'Super Admin cannot verify reports. Use Edit to correct the record instead.';
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
$function$;

/* Emergency alert acknowledgements were refused: the app sends only the
   advisory id, user_id had no default, and the insert rule requires
   user_id = auth.uid(). The person acknowledging is now filled in. */
alter table public.alert_acknowledgments alter column user_id set default auth.uid();

/* Push subscriptions were refused, so no phone ever received push alerts:
   the app did not send user_id, it had no default, and the rule requires
   user_id = auth.uid(). save_push_subscription stores this phone's
   subscription for whoever is signed in, and moves it to them when another
   account used the same phone before. */
alter table public.push_subscriptions alter column user_id set default auth.uid();

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' then
    raise exception 'That is not a push subscription address';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, coalesce(p_p256dh, ''), coalesce(p_auth, ''), left(coalesce(p_user_agent, ''), 200))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
