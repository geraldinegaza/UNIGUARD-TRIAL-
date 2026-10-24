-- A. fill barangay_id from the barangay name, so scoping works even when the
--    client only sends the name (relief and road work never send the id)
create or replace function public.fill_barangay_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.barangay_id is null and coalesce(new.barangay, '') <> '' then
    select id into new.barangay_id from public.barangays where name = new.barangay limit 1;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['relief_distributions','evacuation_centers','road_work_posts','authorized_beneficiaries']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_fill_brgy', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.fill_barangay_id()', t || '_fill_brgy', t);
  end loop;
end $$;

-- B. backfill existing rows
update public.relief_distributions x
set
    barangay_id = b.id
from public.barangays b
where
    b.name = x.barangay
    and x.barangay_id is null;

update public.evacuation_centers x
set
    barangay_id = b.id
from public.barangays b
where
    b.name = x.barangay
    and x.barangay_id is null;

update public.road_work_posts x
set
    barangay_id = b.id
from public.barangays b
where
    b.name = x.barangay
    and x.barangay_id is null;

update public.authorized_beneficiaries x
set
    barangay_id = b.id
from public.barangays b
where
    b.name = x.barangay
    and x.barangay_id is null;

-- C. read policies: LGU sees all; everyone else sees their own barangay
--    plus rows that belong to no barangay (municipality-wide)

drop policy if exists relief_distributions_read on public.relief_distributions;

create policy relief_distributions_read on public.relief_distributions for
select to authenticated using (
        public.is_lgu ()
        or barangay_id = public.my_barangay_id ()
        or (
            barangay_id is null
            and coalesce(barangay, '') = ''
        )
    );

drop policy if exists evacuation_read on public.evacuation_centers;

create policy evacuation_read on public.evacuation_centers for
select to authenticated using (
        public.is_lgu ()
        or barangay_id = public.my_barangay_id ()
        or (
            barangay_id is null
            and coalesce(barangay, '') = ''
        )
    );

drop policy if exists advisories_read on public.advisories;

create policy advisories_read on public.advisories for
select to authenticated using (
        public.is_lgu ()
        or author_id = auth.uid ()
        or citywide
        or exists (
            select 1
            from public.advisory_targets t
            where
                t.advisory_id = advisories.id
                and t.barangay_id = public.my_barangay_id ()
        )
    );

drop policy if exists road_work_posts_read on public.road_work_posts;

create policy road_work_posts_read on public.road_work_posts for
select to authenticated using (
        public.is_lgu ()
        or author_id = auth.uid ()
        or citywide
        or barangay_id = public.my_barangay_id ()
    );