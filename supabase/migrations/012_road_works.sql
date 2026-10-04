-- ============================================================================
--  UniGuard · 012 · Road Work posts
--
--  Additive only. A road-work post is created by an LGU/official and fans out
--  to a notification row per affected-barangay resident (same pattern as the
--  advisory fan-out in migration 003).
-- ============================================================================

create table if not exists public.road_work_posts (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid references public.profiles(id) on delete set null,
  title           text not null default '',
  description     text not null default '',
  barangay_id     uuid references public.barangays(id) on delete set null,
  barangay        text not null default '',
  road_name       text not null default '',
  address         text not null default '',
  lat             double precision,
  lng             double precision,
  expected_start  timestamptz,
  expected_end    timestamptz,
  citywide        boolean not null default false,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.road_work_posts add column if not exists author_id      uuid;
alter table public.road_work_posts add column if not exists title          text not null default '';
alter table public.road_work_posts add column if not exists description    text not null default '';
alter table public.road_work_posts add column if not exists barangay_id    uuid;
alter table public.road_work_posts add column if not exists barangay       text not null default '';
alter table public.road_work_posts add column if not exists road_name      text not null default '';
alter table public.road_work_posts add column if not exists address        text not null default '';
alter table public.road_work_posts add column if not exists lat            double precision;
alter table public.road_work_posts add column if not exists lng             double precision;
alter table public.road_work_posts add column if not exists expected_start timestamptz;
alter table public.road_work_posts add column if not exists expected_end   timestamptz;
alter table public.road_work_posts add column if not exists citywide       boolean not null default false;
alter table public.road_work_posts add column if not exists status         text not null default 'active';
alter table public.road_work_posts add column if not exists created_at      timestamptz not null default now();
alter table public.road_work_posts add column if not exists updated_at     timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'road_work_posts_status_check') then
    alter table public.road_work_posts add constraint road_work_posts_status_check
      check (status in ('active','completed','cancelled'));
  end if;
end $$;

create index if not exists road_work_posts_active_idx on public.road_work_posts (status, created_at desc);

alter table public.road_work_posts enable row level security;

drop policy if exists road_work_posts_read on public.road_work_posts;
create policy road_work_posts_read on public.road_work_posts
  for select to authenticated using (true);

drop policy if exists road_work_posts_write on public.road_work_posts;
create policy road_work_posts_write on public.road_work_posts
  for all to authenticated
  using (public.is_lgu() or public.is_official())
  with check (public.is_lgu() or public.is_official());

-- add a nullable road_work_id column to notifications so tapping one navigates there
alter table public.notifications add column if not exists road_work_id uuid;
alter table public.notifications add column if not exists relief_id     uuid;
alter table public.notifications add column if not exists sos_id        uuid;
alter table public.notifications add column if not exists type          text;

-- Fan a road-work post out to the residents of its target barangays (or everyone
-- when it is citywide). Mirrors fanout_advisory in migration 003.
create or replace function public.fanout_road_work(p_post_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_post     record;
  v_inserted int := 0;
begin
  select * into v_post from public.road_work_posts where id = p_post_id;
  if v_post is null then return 0; end if;

  with targets as (
    select p.id
      from public.profiles p
     where p.disabled = false
       and (
         v_post.citywide
         or exists (select 1 from public.barangays b
                     where b.id = p.barangay_id and b.name = v_post.barangay)
       )
  ), ins as (
    insert into public.notifications (user_id, title, body, tone, icon, type, road_work_id)
    select id, v_post.title, left(coalesce(v_post.description, ''), 240), 'warning', 'road', 'road_work', v_post.id from targets
    returning 1
  )
  select count(*) into v_inserted from ins;

  return v_inserted;
end;
$$;

grant execute on function public.fanout_road_work(uuid) to authenticated;
