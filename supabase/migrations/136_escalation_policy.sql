-- ============================================================================
--  UniGuard · 036 · Escalation policy: stale reports, severity bypass, LGU verify
--
--  Three operational gaps closed with no new infrastructure:
--
--  1. AUTO-ESCALATION OF STALE REPORTS
--     A report stuck in "reported" for > 30 minutes is surfaced to the LGU
--     main queue with a "Stale: not yet verified by barangay" badge, so an
--     absent barangay official is no longer a single point of failure.
--     Implemented in the reports_feed VIEW (a time check), not a cron job.
--
--  2. SEVERITY BYPASS
--     Life-safety hazards (fire, power line, vehicular accident, landslide)
--     skip the 30-minute wait and are surfaced to the LGU immediately even
--     if still unverified. A real fire must not depend on a barangay
--     official being online. Also a view-time check.
--
--  3. LGU-VERIFIED SECOND PATH
--     LGU/LDRRMC can mark a report "LGU-verified" when a barangay is
--     inactive. Both barangay-official verify and LGU verify move the
--     report to 'verified'; the new columns verified_by_role + verified_by
--     + verified_at record WHO did it so the two levels are distinguishable
--     in the audit log and on the incident detail screen.
--
--  Additive + idempotent. No existing rows are rewritten.
-- ============================================================================

-- ------------------------------------------------------- 3 · who verified it
alter table public.reports add column if not exists verified_by     uuid references public.profiles(id) on delete set null;
alter table public.reports add column if not exists verified_by_name text not null default '';
alter table public.reports add column if not exists verified_by_role text not null default '';
alter table public.reports add column if not exists verified_at     timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reports_verified_by_role_check'
  ) then
    alter table public.reports add constraint reports_verified_by_role_check
      check (verified_by_role in ('','barangay_official','lgu_ldrrmc'));
  end if;
end $$;

create index if not exists reports_verified_at_idx on public.reports (verified_at desc nulls last);

-- ------------------------------------------------ 3 · lgu_verify_report RPC
-- Moves reported -> verified and stamps verified_by / verified_by_name /
-- verified_by_role / verified_at. Only LGU/LDRRMC may call it. The existing
-- guard_report_status trigger (migration 028) still permits reported -> verified
-- so the one-step rule is respected; this RPC just records the extra metadata
-- and writes an audit row.
create or replace function public.lgu_verify_report(p_report_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row    public.reports;
  v_role   text;
  v_name   text;
  v_brgy   uuid;
  v_reporter uuid;
  v_code   text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select role, barangay_id, coalesce(full_name, '')
    into v_role, v_brgy, v_name
    from public.profiles where id = auth.uid();

  if v_role is null then
    raise exception 'Your account could not be loaded';
  end if;
  if v_role <> 'lgu_ldrrmc' then
    raise exception 'Only LGU / LDRRMC can LGU-verify a report';
  end if;

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then
    raise exception 'That report does not exist';
  end if;
  if v_row.status <> 'reported' then
    raise exception 'Only a report still in "reported" can be LGU-verified (it is "%")', v_row.status;
  end if;

  perform set_config('uniguard.reason', 'lgu_verify', true);
  perform set_config('uniguard.note',  coalesce(p_note, ''), true);

  update public.reports
     set status           = 'verified',
         verified_by      = auth.uid(),
         verified_by_name = v_name,
         verified_by_role = 'lgu_ldrrmc',
         verified_at     = now()
   where id = p_report_id
   returning * into v_row;

  perform public.write_audit('report.lgu_verified', 'reports', p_report_id,
    jsonb_build_object('note', left(coalesce(p_note, ''), 300),
                        'verified_by', v_name));

  -- tell the reporter so the gap is not a blind spot for them either
  v_reporter := v_row.reporter_id;
  v_code     := coalesce(v_row.code, '');
  if v_reporter is not null then
    insert into public.notifications (user_id, title, body, tone, icon, type, report_id)
    values (v_reporter,
            'Your report was LGU-verified',
            'Report ' || v_code || ' was verified by the Municipal DRRMO' ||
              case when coalesce(p_note, '') <> '' then ' — ' || left(p_note, 140) else '' end,
            'prepared', 'shield', 'report_status', v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'verified_by', v_name, 'verified_by_role', 'lgu_ldrrmc');
end;
$$;

revoke all on function public.lgu_verify_report(uuid, text) from public;
grant execute on function public.lgu_verify_report(uuid, text) to authenticated;

-- ------------------------------------------- 3 · extend advance_report_status
-- The barangay-official verify path also goes through advance_report_status
-- (migration 028). Stamp the verified_* columns there too, so both verify
-- paths record who did it and at what level. The LGU path uses lgu_verify_report
-- above (so it can carry a note + audit action of its own); the barangay path
-- lands here. Redefining the function preserves 028's one-step guard + scope
-- checks + reporter notification, and only adds the verified_* stamping.
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row      public.reports;
  v_role     text;
  v_brgy     uuid;
  v_name     text;
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

  select role, barangay_id, coalesce(full_name, '')
    into v_role, v_brgy, v_name
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

  if not (
       (v_row.status = 'reported'   and p_next in ('verified', 'rejected'))
    or (v_row.status = 'verified'   and p_next in ('dispatched', 'rejected'))
    or (v_row.status = 'dispatched' and p_next in ('resolved', 'rejected'))
  ) then
    raise exception 'A report in "%" cannot move to "%". Move one step at a time; resolved and rejected are final.', v_row.status, p_next;
  end if;

  perform set_config('uniguard.reason', 'rpc', true);
  perform set_config('uniguard.note', coalesce(p_note, ''), true);

  if p_next = 'verified' then
    -- record WHO verified + at what level. LGU calling advance_report_status
    -- to verify is allowed but the dedicated lgu_verify_report RPC is
    -- preferred (it carries its own audit action); either way the columns
    -- are stamped correctly here.
    update public.reports
       set status           = 'verified',
           verified_by      = auth.uid(),
           verified_by_name = v_name,
           verified_by_role = v_role,
           verified_at     = now()
     where id = p_report_id
     returning * into v_row;
  else
    update public.reports set status = p_next where id = p_report_id returning * into v_row;
  end if;

  perform public.write_audit('report.status_changed', 'reports', p_report_id,
    jsonb_build_object('from', v_row.status, 'to', p_next, 'note', coalesce(p_note, ''),
                       'verified_by_role', case when p_next = 'verified' then v_role else null end));

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
      when 'verified'   then 'Report ' || v_code || ' was reviewed and verified' ||
                            case when v_role = 'lgu_ldrrmc' then ' by the Municipal DRRMO.' else '.' end
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

-- ------------------------------------------- 1 + 2 · escalate via the feed view
-- Rebuild reports_feed so the same SELECT returns every row the caller may
-- already see, PLUS two computed booleans:
--   is_stale       — reported > 30 minutes, never verified, not a bypass hazard
--   escalates_to_lgu — is_stale OR a life-safety hazard (fire, power line,
--                      vehicular accident, landslide) still in 'reported'.
-- The LGU queue reads escalates_to_lgu so stale + life-safety reports always
-- land in front of the duty officer without waiting on a barangay official.
-- The barangay official's own queue is unaffected: they still see their own
-- reported rows; the escalation only widens LGU visibility.
-- (The original feed's WHERE clause is preserved verbatim.)
drop view if exists public.reports_feed;

create view public.reports_feed as
select
    r.id,
    r.code,
    r.barangay_id,
    r.barangay,
    r.hazard_type,
    r.hazard_other_text,
    r.severity,
    r.urgency,
    r.status,
    r.description,
    r.lat,
    r.lng,
    r.photo_path,
    r.created_at,
    r.updated_at,
    r.resolved_at,
    r.verified_by,
    r.verified_by_name,
    r.verified_by_role,
    r.verified_at,
    (
        select count(*)
        from public.report_corroborations c
        where c.report_id = r.id
    ) as corroborations,
    (r.reporter_id = auth.uid()) as is_mine,
    /* 1. stale: reported > 30 min, never verified */
    ( r.status = 'reported'
      and r.verified_at is null
      and r.created_at < now() - interval '30 minutes'
    ) as is_stale,
    /* 2. severity bypass: life-safety hazard still unverified */
    ( r.status = 'reported'
      and r.hazard_type in ('fire','power_line','vehicular_accident','landslide')
    ) as is_severity_bypass,
    /* the OR the LGU queue actually filters on */
    ( r.status = 'reported'
      and (
        ( r.verified_at is null
          and r.created_at < now() - interval '30 minutes' )
        or r.hazard_type in ('fire','power_line','vehicular_accident','landslide')
      )
    ) as escalates_to_lgu
from public.reports r
where
    r.reporter_id = auth.uid()
    or public.is_lgu()
    or (
        public.is_official()
        and r.barangay_id = public.my_barangay_id()
    )
    or (
        r.barangay_id is not null
        and r.barangay_id = public.my_barangay_id()
    );

alter view public.reports_feed set(security_invoker = false);

grant select on public.reports_feed to authenticated;
