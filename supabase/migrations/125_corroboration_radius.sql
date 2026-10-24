create or replace function public.distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

alter table public.report_corroborations
add column if not exists lat double precision;

alter table public.report_corroborations
add column if not exists lng double precision;

drop function if exists public.corroborate_report (uuid, text);

create or replace function public.corroborate_report(
  p_report_id uuid, p_note text default '',
  p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_count  int;
  v_rlat   double precision;
  v_rlng   double precision;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to corroborate a report';
  end if;
  if not public.is_active_user() then
    raise exception 'This account cannot corroborate reports';
  end if;

  select lat, lng into v_rlat, v_rlng from public.reports where id = p_report_id;
  if p_lat is not null and v_rlat is not null
     and public.distance_m(p_lat, p_lng, v_rlat, v_rlng) > 500 then
    raise exception 'You are too far from this hazard to confirm it. Confirmations must come from within 500 m.';
  end if;

  insert into public.report_corroborations (report_id, user_id, note, lat, lng)
  values (p_report_id, auth.uid(), coalesce(p_note, ''), p_lat, p_lng);

  select status,
         1 + (select count(*) from public.report_corroborations c where c.report_id = p_report_id)
    into v_status, v_count
    from public.reports where id = p_report_id;

  return jsonb_build_object('corroborations', coalesce(v_count, 1),
    'status', v_status, 'verified', v_status = 'verified', 'threshold', 3);
end;
$$;

revoke all on function public.corroborate_report (
    uuid,
    text,
    double precision,
    double precision
)
from public;

grant
execute on function public.corroborate_report (
    uuid,
    text,
    double precision,
    double precision
) to authenticated;

create or replace function public.apply_corroboration()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_radius constant double precision := 500;
  v_barangay_id uuid;
  v_hazard      text;
  v_created     timestamptz;
  v_lat         double precision;
  v_lng         double precision;
  v_count       int;
  v_row         record;
begin
  select barangay_id, hazard_type, created_at, lat, lng
    into v_barangay_id, v_hazard, v_created, v_lat, v_lng
    from public.reports where id = new.report_id;

  if v_hazard is null then
    return new;
  end if;

  select count(distinct u) into v_count from (
    select r.reporter_id as u
      from public.reports r
     where r.hazard_type = v_hazard
       and (r.barangay_id is not distinct from v_barangay_id)
       and r.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
       and (v_lat is null or r.lat is null
            or public.distance_m(v_lat, v_lng, r.lat, r.lng) <= c_radius)
    union
    select c.user_id
      from public.report_corroborations c
      join public.reports r2 on r2.id = c.report_id
     where r2.hazard_type = v_hazard
       and (r2.barangay_id is not distinct from v_barangay_id)
       and r2.created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
       and (v_lat is null or coalesce(c.lat, r2.lat) is null
            or public.distance_m(v_lat, v_lng, coalesce(c.lat, r2.lat), coalesce(c.lng, r2.lng)) <= c_radius)
  ) s;

  if v_count >= 3 then
    perform set_config('uniguard.reason', 'auto_corroboration', true);
    for v_row in
      select id from public.reports
       where hazard_type = v_hazard
         and (barangay_id is not distinct from v_barangay_id)
         and status = 'reported'
         and created_at between v_created - interval '6 hours' and v_created + interval '6 hours'
         and (v_lat is null or lat is null
              or public.distance_m(v_lat, v_lng, lat, lng) <= c_radius)
    loop
      update public.reports set status = 'verified' where id = v_row.id;
    end loop;
  end if;
  return new;
end;
$$;

create or replace view public.reports_feed as
select
    r.id,
    r.code,
    r.barangay_id,
    r.barangay,
    r.hazard_type,
    r.hazard_other_text,
    r.severity,
    r.urgency,
    r.status,
    r.description,
    r.lat,
    r.lng,
    r.photo_path,
    r.created_at,
    r.updated_at,
    r.resolved_at,
    1 + (
        select count(*)
        from public.report_corroborations c
        where
            c.report_id = r.id
    ) as corroborations,
    (r.reporter_id = auth.uid ()) as is_mine
from public.reports r
where
    r.reporter_id = auth.uid ()
    or public.is_lgu ()
    or (
        public.is_official ()
        and r.barangay_id = public.my_barangay_id ()
    )
    or (
        r.barangay_id is not null
        and r.barangay_id = public.my_barangay_id ()
    );