drop policy if exists evacuation_read on public.evacuation_centers;

create policy evacuation_read on public.evacuation_centers for
select to authenticated using (true);