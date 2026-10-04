-- ============================================================================
--  UniGuard · 007 · Report RPCs
--
--  Additive only. The client calls these instead of writing to the tables
--  directly, so every privileged action is authorised and audited server side.
-- ============================================================================

-- keep the note a client sends with a status change in the history row
create or replace function public.log_report_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.report_status_history (report_id, from_status, to_status, changed_by, reason, note)
    values (new.id, old.status, new.status, auth.uid(),
            coalesce(current_setting('uniguard.reason', true), 'manual'),
            coalesce(current_setting('uniguard.note', true), ''));
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------- corroboration
create or replace function public.corroborate_report(p_report_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_count  int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to corroborate a report';
  end if;
  if not public.is_active_user() then
    raise exception 'This account cannot corroborate reports';
  end if;

  insert into public.report_corroborations (report_id, user_id, note)
  values (p_report_id, auth.uid(), coalesce(p_note, ''));

  select status,
         (select count(*) from public.report_corroborations c where c.report_id = p_report_id)
    into v_status, v_count
    from public.reports where id = p_report_id;

  return jsonb_build_object(
    'corroborations', coalesce(v_count, 0),
    'status', v_status,
    'verified', v_status = 'verified',
    'threshold', 3
  );
end;
$$;

-- ------------------------------------------------------------ status advance
create or replace function public.advance_report_status(p_report_id uuid, p_next text, p_note text default '')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_row   public.reports;
  v_role  text;
  v_brgy  uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_next not in ('reported', 'verified', 'dispatched', 'resolved') then
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

  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'status', v_row.status,
                            'resolved_at', v_row.resolved_at);
end;
$$;

-- -------------------------------------------------------- responder dispatch
create table if not exists public.responders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  unit        text not null default '',
  contact     text not null default '',
  barangay_id uuid references public.barangays(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.report_assignments (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports(id) on delete cascade,
  responder_id uuid not null references public.responders(id) on delete cascade,
  assigned_by  uuid references public.profiles(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  released_at  timestamptz
);

create index if not exists report_assignments_report_idx on public.report_assignments (report_id) where released_at is null;

alter table public.responders         enable row level security;
alter table public.report_assignments enable row level security;

drop policy if exists responders_read on public.responders;
create policy responders_read on public.responders
  for select to authenticated using (public.is_lgu() or public.is_official());

drop policy if exists responders_write on public.responders;
create policy responders_write on public.responders
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());

drop policy if exists assignments_read on public.report_assignments;
create policy assignments_read on public.report_assignments
  for select to authenticated using (
    public.is_lgu()
    or public.is_official()
    or exists (select 1 from public.reports r where r.id = report_id and r.reporter_id = auth.uid())
  );

create or replace function public.assign_responder(p_report_id uuid, p_responder_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_brgy uuid;
  v_row  public.reports;
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select role, barangay_id into v_role, v_brgy from public.profiles where id = auth.uid();
  if v_role not in ('barangay_official', 'lgu_ldrrmc') then
    raise exception 'Only officials and LGU can assign responders';
  end if;

  select * into v_row from public.reports where id = p_report_id;
  if v_row.id is null then raise exception 'That report does not exist'; end if;
  if v_role = 'barangay_official' and v_row.barangay_id is distinct from v_brgy then
    raise exception 'That report is outside your barangay';
  end if;

  select id into v_id from public.report_assignments
   where report_id = p_report_id and responder_id = p_responder_id and released_at is null;

  if v_id is null then
    insert into public.report_assignments (report_id, responder_id, assigned_by)
    values (p_report_id, p_responder_id, auth.uid())
    returning id into v_id;

    perform public.write_audit('report.responder_assigned', 'reports', p_report_id,
      jsonb_build_object('responder_id', p_responder_id));
  end if;

  return jsonb_build_object('assignment_id', v_id,
    'units', (select count(*) from public.report_assignments a
               where a.report_id = p_report_id and a.released_at is null));
end;
$$;

revoke all on function public.corroborate_report(uuid, text) from public;
revoke all on function public.advance_report_status(uuid, text, text) from public;
revoke all on function public.assign_responder(uuid, uuid) from public;
grant execute on function public.corroborate_report(uuid, text) to authenticated;
grant execute on function public.advance_report_status(uuid, text, text) to authenticated;
grant execute on function public.assign_responder(uuid, uuid) to authenticated;
