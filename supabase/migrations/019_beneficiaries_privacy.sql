-- ============================================================================
--  UniGuard · 019 · Authorized beneficiaries: staff-only read access
--
--  The list contains names and ID numbers of third parties. Residents have no
--  need to read it, so reading is limited to LGU and barangay officials. This
--  is enforced in the database, not just by hiding the button.
-- ============================================================================

drop policy if exists authorized_beneficiaries_read on public.authorized_beneficiaries;
create policy authorized_beneficiaries_read on public.authorized_beneficiaries
  for select to authenticated
  using (public.is_lgu() or public.is_official());
