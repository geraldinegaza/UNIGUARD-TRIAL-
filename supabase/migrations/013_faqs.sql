-- ============================================================================
--  UniGuard · 013 · Frequently asked questions (CRUD by LGU)
--
--  Additive only. The FAQ is fully manageable by the LGU without a code release.
--  Rows are ordered by sort_order, then by created_at; category groups them
--  visually (e.g. "Reports", "Relief", "Evacuation").
-- ============================================================================

create table if not exists public.faqs (
  id          uuid primary key default gen_random_uuid(),
  category    text not null default 'General',
  question    text not null default '',
  answer      text not null default '',
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.faqs add column if not exists category   text not null default 'General';
alter table public.faqs add column if not exists question   text not null default '';
alter table public.faqs add column if not exists answer     text not null default '';
alter table public.faqs add column if not exists sort_order int  not null default 0;
alter table public.faqs add column if not exists active     boolean not null default true;
alter table public.faqs add column if not exists created_at timestamptz not null default now();
alter table public.faqs add column if not exists updated_at timestamptz not null default now();

create index if not exists faqs_active_idx on public.faqs (active, sort_order, created_at);

alter table public.faqs enable row level security;

drop policy if exists faqs_read on public.faqs;
create policy faqs_read on public.faqs
  for select to authenticated using (true);

drop policy if exists faqs_write on public.faqs;
create policy faqs_write on public.faqs
  for all to authenticated
  using (public.is_lgu())
  with check (public.is_lgu());
