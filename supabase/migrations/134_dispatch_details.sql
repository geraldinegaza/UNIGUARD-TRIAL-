-- ============================================================================
--  UniGuard · 034 · Dispatch details (team, instructions, ETA, who, when)
--
--  A dispatch is now a record, not just a status flip. dispatch_report():
--    · checks role and barangay scope (same rules as advance_report_status)
--    · requires the incident to be Verified (first dispatch) or already
--      Dispatched (adding another team)
--    · stores team, instructions, ETA; dispatched_by and dispatched_at are
--      filled SERVER side from the session, never trusted from the client
--    · moves verified -> dispatched through advance_report_status, so the
--      one-step guard, history row, audit row and reporter notification
--      all still happen
--  Additive + idempotent.
-- ============================================================================

create table if not exists public.report_dispatches (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.reports(id) on delete cascade,
  team               text not null,
  instructions       text not null default '',
  eta                timestamptz not null,
  dispatched_by      uuid references public.profiles(id) on delete set null,
  dispatched_by_name text not null default '',
  dispatched_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_dispatches_team_check') then
    alter table public.report_dispatches add constraint report_dispatches_team_check
      check (team in ('MDRRMO Rescue','BFP','PNP','Barangay Tanod','Ambulance'));
  end if;
end $$;

create index if not exists report_dispatches_report_idx
  on public.report_dispatches (report_id, dispatched_at desc);

alter table public.report_dispatches enable row level security;

-- readable by LGU, officials of the report's barangay, and the reporter.
-- No insert/update/delete policy: rows are written only by dispatch_report().
drop policy if exists report_dispatches_read on public.report_dispatches;
create policy report_dispatches_read on public.report_dispatches
  for select to authenticated using (
    public.is_lgu()
    or exists (
      select 1 from public.reports r
       where r.id = report_id
         and (r.reporter_id = auth.uid()
              or (public.is_official() and r.barangay_id = public.my_barangay_id()))
    )
  );

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
  if p_team not in ('MDRRMO Rescue','BFP','PNP','Barangay Tanod','Ambulance') then
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

  return jsonb_build_object('id', v_id, 'team', p_team, 'eta', p_eta,
                            'dispatched_by', v_name, 'dispatched_at', now());
end;
$$;

revoke all on function public.dispatch_report(uuid, text, text, timestamptz) from public;
grant execute on function public.dispatch_report(uuid, text, text, timestamptz) to authenticated;
