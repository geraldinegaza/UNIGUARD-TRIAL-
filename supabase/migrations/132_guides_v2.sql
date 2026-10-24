-- ============================================================================
--  UniGuard · 032 · Preparedness guides v2 (one guide, three phases, PDF)
--
--  Old shape (migration 014): one ROW per phase — (hazard_type, phase, title,
--  body). The redesign wants one guide with a title, hazard category, brief
--  summary, separate Before / During / After sections, and an optional PDF.
--
--  New columns on the same table (no content lost, no table swap):
--      summary       one-paragraph teaser shown on the list view
--      body_before   "Before" section text (was phase = 'before')
--      body_during   "During" section text (was phase = 'during')
--      body_after    "After"  section text (was phase = 'after')
--      pdf_path      storage path of the optional attached PDF
--      author_id     who published it (for the audit trail)
--
--  Conversion: rows are grouped by (hazard_type, canonical guide title). The
--  legacy titles are "Before a flood" / "During a flood" / "After a flood"
--  style, so the group key strips a leading Before/During/After and the
--  article: 'Before a flood' -> 'flood'. Each group becomes ONE guide; the
--  per-phase bodies move into their new columns and the phase rows are
--  retired (kept in the table only as guide rows with body_phase='v1' marker
--  is avoided — instead the phase rows are deleted after their content is
--  merged, which is why this step is clearly announced and re-runnable: it
--  only deletes rows that still look like v1 rows).
--
--  Idempotent: re-running finds no v1 rows and does nothing.
-- ============================================================================

alter table public.preparedness_guides add column if not exists summary      text not null default '';
alter table public.preparedness_guides add column if not exists body_before  text not null default '';
alter table public.preparedness_guides add column if not exists body_during  text not null default '';
alter table public.preparedness_guides add column if not exists body_after   text not null default '';
alter table public.preparedness_guides add column if not exists pdf_path     text;
alter table public.preparedness_guides add column if not exists author_id    uuid references public.profiles(id) on delete set null;

-- [this project] the merged guide is stored with phase 'all', which the v1
-- check from 014 (before/during/after only) rejects. Widen it first; an empty
-- table hid this upstream.
alter table public.preparedness_guides drop constraint if exists preparedness_guides_phase_check;
alter table public.preparedness_guides add constraint preparedness_guides_phase_check
  check (phase in ('before', 'during', 'after', 'all'));

do $$
declare
  v_hazard text;
  v_group  text;
  v_b text; v_d text; v_a text;
  v_title text;
  v_gid uuid;
begin
  -- group every v1 row (a v1 row has something in `body` and nothing in body_before)
  for v_hazard, v_group in
    select distinct hazard_type,
           lower(trim(regexp_replace(title, '^(before|during|after)\s+(a|an|the)?\s*', '', 'i')))
      from public.preparedness_guides
     where coalesce(body, '') <> ''
       and coalesce(body_before, '') = '' and coalesce(body_during, '') = '' and coalesce(body_after, '') = ''
  loop
    select max(title) filter (where phase = 'before'),
           max(body)  filter (where phase = 'before'),
           max(body)  filter (where phase = 'during'),
           max(body)  filter (where phase = 'after')
      into v_title, v_b, v_d, v_a
      from public.preparedness_guides
     where hazard_type = v_hazard
       and lower(trim(regexp_replace(title, '^(before|during|after)\s+(a|an|the)?\s*', '', 'i'))) = v_group;

    -- fall back to the phase-less title when only one phase existed
    v_title := coalesce(v_title, initcap(v_group));

    insert into public.preparedness_guides
      (hazard_type, phase, title, body, summary, body_before, body_during, body_after, sort_order, active)
    values
      (v_hazard, 'all', v_title, coalesce(v_b, ''),
       left(coalesce(coalesce(v_b, v_d, v_a), ''), 160) || case when coalesce(length(coalesce(v_b, v_d, v_a)), 0) > 160 then '…' else '' end,
       coalesce(v_b, ''), coalesce(v_d, ''), coalesce(v_a, ''),
       0, true)
    returning id into v_gid;

    -- retire the v1 phase rows for this group (content is merged above)
    delete from public.preparedness_guides
     where hazard_type = v_hazard
       and coalesce(body_before, '') = '' and coalesce(body_during, '') = '' and coalesce(body_after, '') = ''
       and coalesce(body, '') <> ''
       and lower(trim(regexp_replace(title, '^(before|during|after)\s+(a|an|the)?\s*', '', 'i'))) = v_group
       and id <> v_gid;
  end loop;
end $$;

-- RLS for the new table shape stays the read-all / officials-write model.
-- (The existing policies from migration 014 continue to apply; nothing here
-- changes them, because guides are readable by everyone and writable by LGU.)
