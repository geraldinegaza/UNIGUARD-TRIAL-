-- ============================================================================
--  UniGuard · 035 · Rename "Barangay Tanod" → "Barangay Response Team" + per-barangay dispatch notification
--
--  LGU feedback: the "Barangay Tanod" responder label is retired. The team is
--  now an organized per-barangay response unit called "Barangay Response Team",
--  and every time a response team is dispatched to a barangay the residents and
--  officials of that barangay must receive an in-app notification so they are
--  alerted a team has been pushed to them.
--
--  This migration is additive + idempotent:
--    · swaps the report_dispatches.team CHECK constraint for one that accepts
--      'Barangay Response Team' instead of 'Barangay Tanod'
--    · back-fills any existing rows
--    · adds a fanout_dispatch() helper that inserts a per-recipient
--      notification row for every (non-disabled) profile whose barangay_id
--      matches the dispatched report's barangay_id
--    · redefines dispatch_report() to accept the new team name and to call
--      fanout_dispatch() after the dispatch record is written
-- ============================================================================

  -- ---------------------------------------------------------------- team rename
  alter table public.report_dispatches drop constraint if exists report_dispatches_team_check;

  alter table public.report_dispatches add constraint report_dispatches_team_check
    check (team in ('MDRRMO Rescue','BFP','PNP','Barangay Response Team','Ambulance'));

  update public.report_dispatches
     set team = 'Barangay Response Team'
   where team = 'Barangay Tanod';

  -- --------------------------------------- fan-out a dispatch notification
  -- Inserts one row per resident/official of the report's barangay (and the
  -- reporter themselves) so the in-app inbox + bell badge reflect that a
  -- response team has been pushed to them. Mirrors fanout_advisory's shape.
  create or replace function public.fanout_dispatch(
    p_report_id    uuid,
    p_team         text,
    p_instructions text
  )
  returns int
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_row      public.reports;
    v_brgy_id  uuid;
    v_title    text;
    v_body     text;
    v_inserted int := 0;
  begin
    select * into v_row from public.reports where id = p_report_id;
    if v_row.id is null then
      return 0;
    end if;

    v_brgy_id := v_row.barangay_id;
    v_title  := 'Response team dispatched to ' || coalesce(v_row.barangay, 'your barangay');
    v_body   := left(p_team || ': ' || coalesce(p_instructions, ''), 240);

    with targets as (
      select p.id
        from public.profiles p
       where p.disabled = false
         and (
           p.id = v_row.reporter_id
           or (v_brgy_id is not null and p.barangay_id = v_brgy_id)
           or p.role in ('lgu_ldrrmc')
         )
    ), ins as (
      insert into public.notifications (user_id, title, body, tone, icon, report_id)
      select id, v_title, v_body, 'warning', 'truck', v_row.id from targets
      returning 1
    )
    select count(*) into v_inserted from ins;

    return v_inserted;
  end;
  $$;

  revoke all on function public.fanout_dispatch(uuid, text, text) from public;
  grant execute on function public.fanout_dispatch(uuid, text, text) to authenticated;

  -- ----------------------------------------- redefine dispatch_report()
  -- Same behaviour as 034 (role + barangay scope + verified/dispatched guard +
  -- first-dispatch status move + audit row), with two changes:
  --   · the team CHECK accepts 'Barangay Response Team'
  --   · after the dispatch record is written, fanout_dispatch() notifies the
  --     report's barangay that a response team is en route
  create or replace function public.dispatch_report(
    p_report_id    uuid,
    p_team         text,
    p_instructions text,
    p_eta          timestamptz
  )
  returns jsonb
  language plpgsql
  security definer set search_path = public
  as $$
  declare
    v_role text;
    v_brgy uuid;
    v_name text;
    v_row  public.reports;
    v_id   uuid;
    v_notified int := 0;
  begin
    if auth.uid() is null then
      raise exception 'You must be signed in';
    end if;

    select role, barangay_id, coalesce(full_name, '')
      into v_role, v_brgy, v_name
      from public.profiles where id = auth.uid();

    if v_role not in ('barangay_official', 'lgu_ldrrmc') then
      raise exception 'Only officials and LGU can dispatch a response';
    end if;
    if p_team not in ('MDRRMO Rescue','BFP','PNP','Barangay Response Team','Ambulance') then
      raise exception 'Choose a responder team from the list';
    end if;
    if coalesce(trim(p_instructions), '') = '' then
      raise exception 'Write what the responders are supposed to do';
    end if;
    if p_eta is null or p_eta < now() - interval '5 minutes' then
      raise exception 'The ETA must be a time from now onward';
    end if;

    select * into v_row from public.reports where id = p_report_id;
    if v_row.id is null then
      raise exception 'That report does not exist';
    end if;
    if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
      raise exception 'That report is outside your barangay';
    end if;
    if v_row.status not in ('verified', 'dispatched') then
      raise exception 'Verify the report before dispatching a response (it is "%")', v_row.status;
    end if;

    insert into public.report_dispatches
      (report_id, team, instructions, eta, dispatched_by, dispatched_by_name)
    values
      (p_report_id, p_team, trim(p_instructions), p_eta, auth.uid(), v_name)
    returning id into v_id;

    -- first dispatch moves the status; extra teams on an already-dispatched
    -- incident only add a record
    if v_row.status = 'verified' then
      perform public.advance_report_status(
        p_report_id, 'dispatched', p_team || ': ' || left(trim(p_instructions), 120));
    end if;

    perform public.write_audit('report.dispatched', 'reports', p_report_id,
      jsonb_build_object('dispatch_id', v_id, 'team', p_team,
                         'eta', p_eta, 'instructions', left(trim(p_instructions), 300)));

    -- notify the report's barangay (residents + officials + LGU + reporter)
    -- that a response team has been pushed to them.
    v_notified := public.fanout_dispatch(p_report_id, p_team, trim(p_instructions));

    return jsonb_build_object('id', v_id, 'team', p_team, 'eta', p_eta,
                              'dispatched_by', v_name, 'dispatched_at', now(),
                              'notified', v_notified);
  end;
  $$;

  revoke all on function public.dispatch_report(uuid, text, text, timestamptz) from public;
  grant execute on function public.dispatch_report(uuid, text, text, timestamptz) to authenticated;
