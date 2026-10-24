-- ============================================================================
--  UniGuard · 149 · One stored form for hazard types: the key
--
--  reports.hazard_type held two forms. This project's app stored the display
--  label ('Fire', 'Electrical / Power Line Hazard'); upstream stores the key
--  ('fire', 'power_line'). The rules disagreed the same way: the escalation
--  policy (136/147) matches keys, so a label never got the life-safety fast
--  track, while the "Others" rule (010) and the review view (018) match the
--  label 'Others', so a key 'other' skipped both.
--
--  From here the key is the stored form (the app now writes keys). This file
--  converts existing labels to keys and lets the two "Others" rules accept
--  either spelling. Idempotent; display is unaffected (the app shows labels).
-- ============================================================================
update public.reports r
   set hazard_type = m.key
  from (values
    ('flood', 'Flood'), ('river_overflow', 'River Overflow'), ('drainage_blockage', 'Drainage Blockage'),
    ('storm_surge', 'Storm Surge'), ('coastal_erosion', 'Coastal Erosion'),
    ('strong_wind', 'Strong Wind / Typhoon Damage'), ('fallen_tree', 'Fallen Tree'),
    ('landslide', 'Landslide / Soil Erosion'), ('earthquake', 'Earthquake'), ('road_damage', 'Road Damage'),
    ('vehicular_accident', 'Vehicular Accident'), ('fire', 'Fire'),
    ('power_line', 'Electrical / Power Line Hazard'), ('other', 'Others')
  ) as m(key, label)
 where lower(trim(r.hazard_type)) = lower(m.label);

alter table public.reports drop constraint if exists reports_other_requires_text;
alter table public.reports add constraint reports_other_requires_text
  check (hazard_type not in ('Others', 'other')
         or (hazard_other_text is not null and length(trim(hazard_other_text)) > 0))
  not valid;
do $$
begin
  alter table public.reports validate constraint reports_other_requires_text;
exception when others then
  raise notice 'reports_other_requires_text kept NOT VALID: some older "Others" rows have no description';
end $$;

create or replace view public.others_hazard_review as
  select hazard_other_text as description,
         count(*)          as occurrences,
         max(created_at)   as latest_at
    from public.reports
   where hazard_type in ('Others', 'other')
     and hazard_other_text is not null
     and length(trim(hazard_other_text)) > 0
   group by lower(trim(hazard_other_text)), hazard_other_text
   order by occurrences desc, latest_at desc;
grant select on public.others_hazard_review to authenticated;
