-- 151: Phase 3 operations — overdue queue, relief stock, view rights.
--
-- 1. The one-hour overdue queue (147) only flipped a report to 'overdue' when
--    something wrote to it, so a report nobody touched never reached the LGU.
--    The queue now works from the clock, the way reports_feed computes
--    is_stale (136). It also ran with its owner's rights and no role filter,
--    so any account could list every overdue report; it now runs with the
--    reader's rights, and the extra read rule from 147 is narrowed to the LGU
--    (it let an official read every barangay's overdue reports).
-- 2. lgu_verify_overdue_report verifies through lgu_verify_report, so both
--    paths record who verified, notify the reporter and refuse the Super Admin.
-- 3. others_hazard_review also ran with its owner's rights; it now runs with
--    the reader's.
-- 4. relief_inventory / relief_distribution_log had text ids with no default,
--    write rules that ignored disabled accounts, and let an official log a
--    distribution for any barangay. A distribution is now recorded through
--    log_relief_distribution, which checks the scope and the stock and lowers
--    the stock in the same step.
--
-- Safe to run more than once.

/* 1. overdue queue ---------------------------------------------------------- */
create or replace view public.lgu_escalation_queue
with (security_invoker = true) as
select
  r.id, r.code, r.hazard_type, r.barangay, r.barangay_id,
  r.severity, r.description, r.status,
  r.created_at,
  extract(epoch from (now() - r.created_at)) / 60.0 as minutes_since_submission,
  'overdue'::text as escalation_status
from public.reports r
where r.status = 'reported'
  and r.created_at <= now() - interval '1 hour'
order by r.created_at asc;

revoke all on public.lgu_escalation_queue from anon;
grant select on public.lgu_escalation_queue to authenticated;

drop policy if exists "reports_lgu_escalation_read" on public.reports;
create policy "reports_lgu_escalation_read"
  on public.reports for select
  to authenticated
  using (
    escalation_status = 'overdue'
    and public.is_active_user()
    and public.is_lgu()
  );

/* 2. one verify path --------------------------------------------------------- */
create or replace function public.lgu_verify_overdue_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.reports where id = p_report_id;
  if v_status in ('verified', 'dispatched', 'resolved') then
    return jsonb_build_object('ok', true, 'already_verified', true, 'report_id', p_report_id);
  end if;
  return public.lgu_verify_report(p_report_id, 'Verified by the LDRRMO after one hour without barangay verification');
end;
$$;

/* 3. others review ----------------------------------------------------------- */
alter view public.others_hazard_review set (security_invoker = true);
revoke all on public.others_hazard_review from anon;

/* 4. relief stock ------------------------------------------------------------ */
alter table public.relief_inventory alter column id set default gen_random_uuid()::text;
alter table public.relief_distribution_log alter column id set default gen_random_uuid()::text;

drop policy if exists "relief_inventory read" on public.relief_inventory;
create policy "relief_inventory read" on public.relief_inventory
  for select to authenticated
  using (public.is_active_user() and (public.is_lgu() or public.is_official()));

drop policy if exists "relief_inventory write" on public.relief_inventory;
create policy "relief_inventory write" on public.relief_inventory
  for all to authenticated
  using (public.is_active_user() and public.is_lgu())
  with check (public.is_active_user() and public.is_lgu());

drop policy if exists "relief_dist_log read" on public.relief_distribution_log;
create policy "relief_dist_log read" on public.relief_distribution_log
  for select to authenticated
  using (
    public.is_active_user() and (
      public.is_lgu()
      or (public.is_official() and barangay = public.my_barangay_name())
    )
  );

-- rows are written by log_relief_distribution; the LGU may still correct them
drop policy if exists "relief_dist_log write" on public.relief_distribution_log;
create policy "relief_dist_log write" on public.relief_distribution_log
  for all to authenticated
  using (public.is_active_user() and public.is_lgu())
  with check (public.is_active_user() and public.is_lgu());

create or replace function public.log_relief_distribution(
  p_item_id text,
  p_qty integer,
  p_barangay text,
  p_family text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.relief_inventory;
  v_name text;
  v_id   text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'You must be signed in with an active account';
  end if;
  if not (public.is_lgu() or public.is_official()) then
    raise exception 'Only LDRRMO staff and barangay officials can record a distribution';
  end if;
  if public.is_official() and not public.is_lgu() and coalesce(p_barangay, '') <> coalesce(public.my_barangay_name(), '') then
    raise exception 'You can record distributions for your own barangay only';
  end if;
  if coalesce(trim(p_barangay), '') = '' then
    raise exception 'Choose the barangay that received the goods';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Enter a quantity above zero';
  end if;

  select * into v_item from public.relief_inventory where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'That item is not in the inventory';
  end if;
  if v_item.stock < p_qty then
    raise exception 'Only % % of % left in stock', v_item.stock, v_item.unit, v_item.name;
  end if;

  update public.relief_inventory
     set stock = stock - p_qty, updated_at = now()
   where id = p_item_id;

  select coalesce(full_name, '') into v_name from public.profiles where id = auth.uid();

  insert into public.relief_distribution_log (item_id, item_name, qty, barangay, family, distributed_by, distributed_at, created_by)
  values (p_item_id, v_item.name, p_qty, trim(p_barangay), coalesce(trim(p_family), ''), v_name, now(), auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'stock', v_item.stock - p_qty);
end;
$$;

revoke all on function public.log_relief_distribution(text, integer, text, text) from public, anon;
grant execute on function public.log_relief_distribution(text, integer, text, text) to authenticated;
