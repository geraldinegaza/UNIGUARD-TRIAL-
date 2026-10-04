-- ============================================================================
--  UniGuard · 014 · Disaster Preparedness Guides
--
--  Additive only. Organised by hazard_type, with a phase ('before'|'during'|
--  'after') so the citizen UI can show three tabs per hazard. LGU manages rows
--  without an app release.
-- ============================================================================

create table if not exists public.preparedness_guides (
  id           uuid primary key default gen_random_uuid(),
  hazard_type  text not null default '',
  phase        text not null default 'before',
  title        text not null default '',
  body         text not null default '',
  sort_order   int  not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.preparedness_guides add column if not exists hazard_type text not null default '';
alter table public.preparedness_guides add column if not exists phase        text not null default 'before';
alter table public.preparedness_guides add column if not exists title        text not null default '';
alter table public.preparedness_guides add column if not exists body          text not null default '';
alter table public.preparedness_guides add column if not exists sort_order   int  not null default 0;
alter table public.preparedness_guides add column if not exists active       boolean not null default true;
alter table public.preparedness_guides add column if not exists created_at   timestamptz not null default now();
alter table public.preparedness_guides add column if not exists updated_at   timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'preparedness_guides_phase_check') then
    alter table public.preparedness_guides add constraint preparedness_guides_phase_check
      check (phase in ('before','during','after'));
  end if;
end $$;

create index if not exists preparedness_guides_hazard_idx on public.preparedness_guides (hazard_type, phase, sort_order);

alter table public.preparedness_guides enable row level security;

drop policy if exists preparedness_guides_read on public.preparedness_guides;
create policy preparedness_guides_read on public.preparedness_guides
  for select to authenticated using (true);

drop policy if exists preparedness_guides_write on public.preparedness_guides;
create policy preparedness_guides_write on public.preparedness_guides
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());
