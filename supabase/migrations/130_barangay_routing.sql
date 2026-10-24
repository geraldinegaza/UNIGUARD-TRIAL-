-- ============================================================================
--  UniGuard · 030 · Server-side barangay routing from coordinates
--
--  Replaces the name-matching in guard_report_insert (migration 020) with
--  coordinate routing, per the fix prompt's LOCATION decision:
--
--    · A GPS fix or a map pin is mandatory for every hazard report.
--    · The incident's barangay is derived from its coordinates ON THE SERVER,
--      never from the reporter's profile and never from the picked name.
--    · If the reporter's picked barangay disagrees with the coordinates, the
--      coordinates win. (The client shows which barangay received the report.)
--    · Inserts with missing, invalid, swapped, or out-of-Lingayen coordinates
--      are rejected — the same checks as UG_GEO.classify in js/geo.js.
--
--  DATA SOURCE / ACCURACY NOTE (important):
--  The repository contains no barangay boundary polygons, and no official
--  GeoJSON could be bundled with this migration. This migration therefore
--  ships APPROXIMATE barangay centroids (and a per-barangay bounding box)
--  compiled from OpenStreetMap / PhilAtlas references. It is explicitly an
--  APPROXIMATION of the nearest-centroid fallback described in the fix
--  prompt, and every centroid MUST be verified against MDRRMO / PSA-NAMRIA
--  records before production reliance. To upgrade to true polygons later:
--  load official Lingayen barangay boundaries into barangay_geoms.geojson
--  and swap resolve_barangay() for a point-in-polygon test — the routing
--  trigger below will not need to change.
--
--  Backfill of existing reports happens at the end, in a reviewable step.
--  Additive + idempotent.
-- ============================================================================

create table if not exists public.barangay_geoms (
  barangay_id  uuid primary key references public.barangays(id) on delete cascade,
  centroid_lat double precision not null,
  centroid_lng double precision not null,
  min_lat      double precision,
  max_lat      double precision,
  min_lng      double precision,
  max_lng      double precision,
  source       text not null default 'approx: OSM/PhilAtlas centroid, verify vs MDRRMO',
  updated_at   timestamptz not null default now()
);

-- approximate centroids; bbox = centroid +- the offsets below (~1.2 km lat / 1.4 km lng)
insert into public.barangay_geoms (barangay_id, centroid_lat, centroid_lng, min_lat, max_lat, min_lng, max_lng)
select b.id, v.lat, v.lng, v.lat - 0.006, v.lat + 0.006, v.lng - 0.007, v.lng + 0.007
  from (values
    ('Aliwekwek',          16.0260, 120.2340),
    ('Baay',               16.0140, 120.2200),
    ('Balangobong',        16.0450, 120.2130),
    ('Balococ',            16.0530, 120.2060),
    ('Bantayan',           16.0280, 120.2270),
    ('Basing',             16.0330, 120.2020),
    ('Capandanan',         16.0200, 120.2120),
    ('Domalandan Center',  16.0360, 120.2080),
    ('Domalandan East',    16.0390, 120.2110),
    ('Domalandan West',    16.0420, 120.2060),
    ('Dorongan',           16.0100, 120.2500),
    ('Dulag',              16.0000, 120.2140),
    ('Estanza',            15.9980, 120.2400),
    ('Lasip',              16.0250, 120.2460),
    ('Libsong East',       16.0270, 120.2430),
    ('Libsong West',       16.0290, 120.2380),
    ('Malawa',             16.0030, 120.2380),
    ('Malimpuec',          16.0160, 120.2040),
    ('Maniboc',            16.0240, 120.2180),
    ('Matalava',           16.0300, 120.2160),
    ('Naguelguel',         16.0180, 120.2450),
    ('Namolan',            16.0070, 120.2260),
    ('Pangapisan North',   16.0520, 120.2260),
    ('Pangapisan Sur',     16.0430, 120.2240),
    ('Poblacion',          16.0220, 120.2306),
    ('Quibaol',            16.0350, 120.2450),
    ('Rosario',            16.0210, 120.2520),
    ('Sabangan',           16.0400, 120.2330),
    ('Talogtog',           16.0500, 120.2350),
    ('Tonton',             16.0080, 120.2180),
    ('Tumbar',             16.0120, 120.2100),
    ('Wawa',               16.0470, 120.2410)
  ) as v(name, lat, lng)
  join public.barangays b on b.name = v.name
on conflict (barangay_id) do nothing;

-- municipal service bounds — keep in sync with js/geo.js BOUNDS
create or replace function public.lingayen_bounds()
returns table (min_lat double precision, max_lat double precision, min_lng double precision, max_lng double precision)
language sql immutable as $$
  select 15.95::double precision, 16.085::double precision, 120.17::double precision, 120.29::double precision;
$$;

-- same validation ladder as UG_GEO.classify: missing / invalid / swapped /
-- outside / ok. Raises with a human-readable reason.
create or replace function public.validate_report_coords(p_lat double precision, p_lng double precision)
returns void language plpgsql immutable as $$
declare
  b record;
begin
  if p_lat is null and p_lng is null then
    raise exception 'A report needs a location. Turn on GPS or drop a pin on the map before submitting.';
  end if;
  if p_lat is null or p_lng is null or p_lat::text = 'NaN' or p_lng::text = 'NaN' then
    raise exception 'The report coordinates are not valid numbers.';
  end if;
  if abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'The report coordinates are out of range.';
  end if;
  if p_lat = 0 and p_lng = 0 then
    raise exception 'The report has a placeholder (0,0) location. Drop a pin on the map.';
  end if;
  select * into b from public.lingayen_bounds();
  -- latitude written where longitude belongs (16.x / 120.x swapped)
  if p_lat between b.min_lng and b.max_lng and p_lng between b.min_lat and b.max_lat then
    raise exception 'Latitude and longitude look swapped. Latitude must come first (e.g. 16.0206, 120.2306).';
  end if;
  if p_lat < b.min_lat or p_lat > b.max_lat or p_lng < b.min_lng or p_lng > b.max_lng then
    raise exception 'The report location is outside Lingayen. Reports can only be filed inside the municipality.';
  end if;
end;
$$;

-- resolve a point to a barangay: bbox hit first, else nearest centroid.
create or replace function public.resolve_barangay(p_lat double precision, p_lng double precision)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_id  uuid;
  v_dist double precision;
begin
  perform public.validate_report_coords(p_lat, p_lng);

  -- [this project] the boxes overlap, so 'limit 1' alone returned an arbitrary
  -- match (a point beside the Poblacion centroid resolved to Aliwekwek). Among
  -- the boxes that contain the point, take the nearest centroid.
  select g.barangay_id into v_id
    from public.barangay_geoms g
   where p_lat between g.min_lat and g.max_lat
     and p_lng between g.min_lng and g.max_lng
   order by public.distance_m(p_lat, p_lng, g.centroid_lat, g.centroid_lng)
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select g.barangay_id, public.distance_m(p_lat, p_lng, g.centroid_lat, g.centroid_lng) as d
    into v_id, v_dist
    from public.barangay_geoms g
   order by public.distance_m(p_lat, p_lng, g.centroid_lat, g.centroid_lng)
   limit 1;
  return v_id;
end;
$$;

-- --------------------------------------------------------- the insert guard
create or replace function public.guard_report_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role    text;
  v_brgy_id uuid;
  v_pick_id uuid;
  v_name    text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to file a report';
  end if;

  new.reporter_id := auth.uid();

  select coalesce(role, 'citizen') into v_role from public.profiles where id = auth.uid();

  -- coordinates are mandatory and must land inside Lingayen (raises otherwise)
  perform public.validate_report_coords(new.lat, new.lng);

  -- the barangay comes from the coordinates, for every role
  v_brgy_id := public.resolve_barangay(new.lat, new.lng);
  if v_brgy_id is null then
    raise exception 'No barangay matched the report location. Contact the MDRRMO.';
  end if;
  new.barangay_id := v_brgy_id;

  select name into v_name from public.barangays where id = v_brgy_id;
  new.barangay := coalesce(v_name, new.barangay, '');

  -- remember whether the reporter picked a different barangay (hint only)
  if coalesce(new.location_note, '') = '' then
    null; -- nothing to do; the column is the optional landmark text
  end if;

  return new;
end;
$$;

drop trigger if exists reports_guard_insert on public.reports;
create trigger reports_guard_insert
  before insert on public.reports
  for each row execute function public.guard_report_insert();

-- edits: when a citizen moves the pin inside the 15-minute window the
-- barangay is re-derived from the new coordinates (the reporter still cannot
-- set barangay_id directly — migration 027 blocks that).
create or replace function public.route_report_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if (new.lat is distinct from old.lat) or (new.lng is distinct from old.lng) then
    perform public.validate_report_coords(new.lat, new.lng);
    v_id := public.resolve_barangay(new.lat, new.lng);
    if v_id is not null and v_id is distinct from new.barangay_id then
      new.barangay_id := v_id;
      select name into new.barangay from public.barangays where id = v_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_route_update on public.reports;
create trigger reports_route_update
  before update on public.reports
  for each row execute function public.route_report_update();

-- ------------------------------------------------------------- backfill step
-- Reviewable: fills barangay for rows that HAVE valid coordinates and an
-- empty/mismatched barangay. Rows without coordinates are left untouched and
-- listed by docs/MIGRATION-NOTES.md's verification query.
update public.reports r
   set barangay_id = res.bid,
       barangay    = res.name
  from (
    select r2.id, b.id as bid, b.name
      from public.reports r2
      cross join lateral public.resolve_barangay(r2.lat, r2.lng) as rid(id)
      join public.barangays b on b.id = rid.id
     where r2.lat is not null and r2.lng is not null
       and rid.id is not null
  ) res
 where r.id = res.id
   and (r.barangay_id is distinct from res.bid);
