-- UniGuard: give your two accounts their roles.
-- 1) Sign up both accounts in the app first (every sign-up starts as a resident).
-- 2) Replace the two emails and the barangay name below, then run this once.
-- 3) Sign out and back in for the new role to take effect.

-- LGU / MDRRMO administrator (sees the whole municipality)
update public.profiles
   set role = 'lgu_ldrrmc'
 where lower(email) = lower('LGU-EMAIL-HERE');

-- Barangay official (sees only the barangay named here)
update public.profiles p
   set role = 'barangay_official',
       barangay_id = b.id,
       barangay = b.name
  from public.barangays b
 where lower(p.email) = lower('BARANGAY-EMAIL-HERE')
   and b.name = 'Poblacion';

-- check the result
select email, full_name, role, barangay from public.profiles order by role;
