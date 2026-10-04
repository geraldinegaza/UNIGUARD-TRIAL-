-- ============================================================================
--  UniGuard · 017 · Road status overlay
--
--  Additive only. Lets the LGU mark a road segment / intersection as passable,
--  blocked, or caution. Each row carries lat/lng so the map shows it.
--  Citizens read; LGU/officials write.
-- ============================================================================

create table if not exists public.road_status (
  id          uuid primary key default gen_random_uuid(),
  road_name   text not null default '',
  barangay    text not null default '',
  barangay_id uuid references public.barangays(id) on delete set null,
  status      text not null default 'passable',
  note        text not null default '',
  lat         double precision,
  lng         double precision,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.road_status add column if not exists road_name   text not null default '';
alter table public.road_status add column if not exists barangay    text not null default '';
alter table public.road_status add column if not exists barangay_id uuid;
alter table public.road_status add column if not exists status       text not null default 'passable';
alter table public.road_status add column if not exists note         text not null default '';
alter table public.road_status add column if not exists lat          double precision;
alter table public.road_status add column if not exists lng          double precision;
alter table public.road_status add column if not exists updated_by   uuid;
alter table public.road_status add column if not exists created_at   timestamptz not null default now();
alter table public.road_status add column if not exists updated_at   timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_status_status_check') then
    alter table public.road_status add constraint road_status_status_check
      check (status in ('passable','blocked','caution'));
  end if;
end $$;

create index if not exists road_status_status_idx on public.road_status (status);
create index if not exists road_status_geom_idx  on public.road_status (lat, lng);

alter table public.road_status enable row level security;

drop policy if exists road_status_read on public.road_status;
create policy road_status_read on public.road_status
  for select to authenticated using (true);

drop policy if exists road_status_write on public.road_status;
create policy road_status_write on public.road_status
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());
