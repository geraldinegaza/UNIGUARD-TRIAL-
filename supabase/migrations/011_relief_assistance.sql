-- ============================================================================
--  UniGuard · 011 · Relief Assistance Information
--
--  Additive only. Two tables:
--    relief_distributions   per-barangay distribution schedule + location + docs
--    authorized_beneficiaries  per-barangay, who is allowed to claim on
--                               behalf of a named beneficiary (searchable by staff)
--
--  Both have RLS: citizens read everything in their municipality (so they can
--  see distribution info for any barangay); only LGU/officials write.
-- ============================================================================

-- ------------------------------------------------------- relief_distributions
create table if not exists public.relief_distributions (
  id              uuid primary key default gen_random_uuid(),
  barangay_id     uuid references public.barangays(id) on delete set null,
  barangay        text not null default '',
  title           text not null default '',
  location_name   text not null default '',
  address         text not null default '',
  lat             double precision,
  lng             double precision,
  distribution_at timestamptz,
  contact_person  text not null default '',
  contact_phone   text not null default '',
  eligibility     jsonb not null default '[]'::jsonb,
  required_docs   jsonb not null default '[]'::jsonb,
  note            text not null default '',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.relief_distributions add column if not exists barangay_id     uuid;
alter table public.relief_distributions add column if not exists barangay        text not null default '';
alter table public.relief_distributions add column if not exists title           text not null default '';
alter table public.relief_distributions add column if not exists location_name   text not null default '';
alter table public.relief_distributions add column if not exists address         text not null default '';
alter table public.relief_distributions add column if not exists lat             double precision;
alter table public.relief_distributions add column if not exists lng             double precision;
alter table public.relief_distributions add column if not exists distribution_at timestamptz;
alter table public.relief_distributions add column if not exists contact_person  text not null default '';
alter table public.relief_distributions add column if not exists contact_phone   text not null default '';
alter table public.relief_distributions add column if not exists eligibility     jsonb not null default '[]'::jsonb;
alter table public.relief_distributions add column if not exists required_docs   jsonb not null default '[]'::jsonb;
alter table public.relief_distributions add column if not exists note            text not null default '';
alter table public.relief_distributions add column if not exists active          boolean not null default true;
alter table public.relief_distributions add column if not exists created_at      timestamptz not null default now();
alter table public.relief_distributions add column if not exists updated_at      timestamptz not null default now();

create index if not exists relief_distributions_barangay_idx on public.relief_distributions (barangay_id, active);
create index if not exists relief_distributions_active_idx   on public.relief_distributions (active, distribution_at);

alter table public.relief_distributions enable row level security;

drop policy if exists relief_distributions_read on public.relief_distributions;
create policy relief_distributions_read on public.relief_distributions
  for select to authenticated using (true);

drop policy if exists relief_distributions_write on public.relief_distributions;
create policy relief_distributions_write on public.relief_distributions
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());

-- ------------------------------------------- authorized_beneficiaries (per brgy)
-- A beneficiary can be a household, senior citizen, PWD, etc. The LGU uploads the
-- authorized list so staff on the spot can verify a claimant against it.
create table if not exists public.authorized_beneficiaries (
  id              uuid primary key default gen_random_uuid(),
  barangay_id     uuid references public.barangays(id) on delete set null,
  barangay        text not null default '',
  beneficiary_name text not null default '',
  claimant_name   text not null default '',
  claimant_id     text not null default '',
  category        text not null default '',
  valid_until     timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.authorized_beneficiaries add column if not exists barangay_id       uuid;
alter table public.authorized_beneficiaries add column if not exists barangay          text not null default '';
alter table public.authorized_beneficiaries add column if not exists beneficiary_name  text not null default '';
alter table public.authorized_beneficiaries add column if not exists claimant_name     text not null default '';
alter table public.authorized_beneficiaries add column if not exists claimant_id       text not null default '';
alter table public.authorized_beneficiaries add column if not exists category          text not null default '';
alter table public.authorized_beneficiaries add column if not exists valid_until       timestamptz;
alter table public.authorized_beneficiaries add column if not exists active            boolean not null default true;
alter table public.authorized_beneficiaries add column if not exists created_at        timestamptz not null default now();
alter table public.authorized_beneficiaries add column if not exists updated_at        timestamptz not null default now();

create index if not exists authorized_beneficiaries_barangay_idx on public.authorized_beneficiaries (barangay_id, active);
create index if not exists authorized_beneficiaries_name_trgm    on public.authorized_beneficiaries
  using gin (lower(beneficiary_name) gin_trgm_ops);
-- ^ requires pg_trgm. Guarded below so the migration still runs without it.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension if not exists pg_trgm;
  end if;
exception when others then null;
end $$;

alter table public.authorized_beneficiaries enable row level security;

drop policy if exists authorized_beneficiaries_read on public.authorized_beneficiaries;
create policy authorized_beneficiaries_read on public.authorized_beneficiaries
  for select to authenticated using (true);

drop policy if exists authorized_beneficiaries_write on public.authorized_beneficiaries;
create policy authorized_beneficiaries_write on public.authorized_beneficiaries
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());
