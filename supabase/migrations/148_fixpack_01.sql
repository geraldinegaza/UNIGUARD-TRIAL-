-- Migration 048 · Fix Pack 01 (tester findings, QA PDF Oct 23 2026)
--
-- Idempotent and re-runnable: every change is guarded (IF NOT EXISTS /
-- constraint lookup), so running it twice is harmless. Apply it in the
-- Supabase SQL editor after 047.
--
-- Sections:
--   A. advisories.delivery_mode (Task F2) — the advisory composer writes this
--      column but no earlier migration created it, so every publish failed
--      with "Could not find the 'delivery_mode' column of 'advisories' in the
--      schema cache".

begin;

-- A. advisories.delivery_mode (composer: push notification vs in-app only)
alter table public.advisories
  add column if not exists delivery_mode text not null default 'push';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'advisories_delivery_mode_check') then
    alter table public.advisories add constraint advisories_delivery_mode_check
      check (delivery_mode in ('push','in_app'));
  end if;
end $$;
comment on column public.advisories.delivery_mode is
  'push = publish + Web Push/SMS fan-out; in_app = publish to the in-app inbox only.';
-- safety net in case 041 was skipped on the live project
alter table public.advisories add column if not exists alert_type text not null default 'general';
alter table public.advisories add column if not exists language  text not null default 'en';

commit;

notify pgrst, 'reload schema';
