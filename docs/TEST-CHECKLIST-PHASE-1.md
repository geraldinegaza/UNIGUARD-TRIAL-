# Phase 1 test checklist

Schema and security only. Everything here can be checked in the Supabase SQL editor;
no frontend is needed yet.

## 0. One-time setup

Create three test accounts in **Authentication → Users → Add user** (tick *Auto confirm*),
then give them profiles:

```sql
-- replace the three emails with the ones you created
update public.profiles p
   set role        = 'citizen',
       full_name   = 'Test Citizen',
       barangay    = 'Bonuan Gueset',
       barangay_id = (select id from public.barangays where name = 'Bonuan Gueset')
 where p.email = 'citizen@test.ph';

update public.profiles p
   set role        = 'barangay_official',
       full_name   = 'Test Barangay Official',
       barangay    = 'Bonuan Gueset',
       barangay_id = (select id from public.barangays where name = 'Bonuan Gueset')
 where p.email = 'barangay@test.ph';

update public.profiles p
   set role     = 'lgu_ldrrmc',
       full_name = 'Test LGU'
 where p.email = 'lgu@test.ph';

-- handy: note the three ids
select id, email, role, barangay from public.profiles order by role;
```

Impersonation template used throughout:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<USER-UUID>","role":"authenticated"}';
-- ... the query under test ...
rollback;
```

---

## A. Schema and triggers

| # | Test | How | Expected |
|---|---|---|---|
| A1 | Human code is generated | `insert into public.reports (reporter_id, hazard_type, barangay_id) values ('<citizen-uuid>','Flash Flood',(select id from public.barangays where name='Bonuan Gueset')) returning code;` | returns `UG-2026-0001` style value |
| A2 | Illegal status jump is rejected | `update public.reports set status='resolved' where status='reported'` as the citizen who filed it | works only within the 15-minute edit window; as an official outside their barangay it must raise `Illegal status change` |
| A3 | `resolved_at` is stamped | `update public.reports set status='resolved' where id='<report>'` as LGU | `resolved_at` is no longer null |
| A4 | History is written | `select from_status, to_status, changed_by, reason from public.report_status_history where report_id='<report>';` | one row per change |
| A5 | Self-corroboration is blocked | insert into `report_corroborations` with the reporter's own `user_id` | raises `You cannot corroborate your own report` |
| A6 | Duplicate corroboration is blocked | insert the same `(report_id, user_id)` twice | unique violation |
| A7 | Auto-verify at three | file one report as the citizen, then have two other accounts corroborate it | the report flips to `verified` and a history row with `reason = auto_corroboration` appears |
| A8 | Auto-verify respects the window | repeat A7 with a corroboration dated more than 6 hours after the report (`created_at` set manually) | the report stays `reported` |
| A9 | Role cannot be self-changed | as the citizen: `update public.profiles set role='lgu_ldrrmc' where id=auth.uid();` | raises `You cannot change your own role` |
| A10 | Barangay cannot be self-changed | as the citizen: `update public.profiles set barangay_id=null where id=auth.uid();` | raises `Barangay assignment is managed by your LGU administrator` |
| A11 | Reporter is forced server side | insert a report with `reporter_id` set to someone else | stored `reporter_id` is the caller, not the value sent |
| A12 | Citizen cannot file for another barangay | insert a report with a different `barangay_id` | stored `barangay_id` is the caller's own barangay |

## B. Row level security, per role

Run each block inside the impersonation template with the matching user id.

### Citizen

```sql
select count(*) from public.reports;                 -- expect: own reports only
select count(*) from public.reports_feed;            -- expect: own + same barangay, no higher
select reporter_id from public.reports_feed limit 1; -- expect: error, column does not exist
select count(*) from public.profiles;                -- expect: 1 (self)
select count(*) from public.notifications;           -- expect: own only
select count(*) from public.audit_log;               -- expect: 0 rows (no policy for citizens)
```

| # | Test | Expected |
|---|---|---|
| B1 | Citizen reads only their own `reports` rows | pass |
| B2 | `reports_feed` returns same-barangay incidents with no reporter column | pass |
| B3 | Citizen reading another citizen's raw `reports` row returns nothing | pass |
| B4 | Citizen sees only their own `profiles` row | pass |
| B5 | Citizen cannot read `audit_log` | pass |
| B6 | Citizen cannot insert into `advisories` | policy violation |
| B7 | Citizen cannot update `evacuation_centers` | policy violation |
| B8 | Citizen cannot insert into `emergency_hotlines` | policy violation |

### Barangay official (barangay: Bonuan Gueset)

```sql
select count(*) from public.reports;   -- expect: only Bonuan Gueset reports
select count(*) from public.profiles;  -- expect: self + residents of Bonuan Gueset
```

| # | Test | Expected |
|---|---|---|
| B9 | Official sees reports for their barangay only | pass |
| B10 | Official can `update public.reports set status='dispatched'` on their barangay | pass |
| B11 | Official updating a report in a different barangay affects 0 rows | pass |
| B12 | Official can manage `evacuation_centers` in their barangay | pass |
| B13 | Official cannot insert into `emergency_hotlines` | policy violation |
| B14 | Official cannot read `audit_log` | pass (0 rows) |
| B15 | Official cannot change anyone's role | raises |

### LGU / LDRRMC

| # | Test | Expected |
|---|---|---|
| B16 | Sees every report, profile, notification target and centre | pass |
| B17 | Can insert and update `emergency_hotlines` | pass |
| B18 | Can delete an `advisories` row | pass |
| B19 | Can read `audit_log` | pass |
| B20 | `public.fanout_advisory('<advisory-uuid>')` creates one notification per targeted resident | returns a count > 0 |

## C. Storage

Use the dashboard's Storage browser or the JS client in Phase 2.

| # | Test | Expected |
|---|---|---|
| C1 | Upload `reports/<my-user-id>/UG-2026-0001/photo.jpg` as an authenticated citizen | succeeds |
| C2 | Upload under `reports/<someone-else-id>/...` | denied |
| C3 | Upload a `.pdf` or `.txt` | denied by the bucket's MIME list |
| C4 | Upload a 6 MB image | denied by the 5 MB cap |
| C5 | Anonymous (not signed in) upload | denied |
| C6 | Read another citizen's photo as an unrelated citizen | denied |
| C7 | Read a resident's photo as the official of that resident's barangay | allowed |
| C8 | Overwrite an existing object (`update`) | denied by design |

## D. Regression checks

| # | Test | Expected |
|---|---|---|
| D1 | Re-run migrations `001`–`005` a second time | completes with no errors, no duplicated objects |
| D2 | `000_inspect_current_schema.sql` shows RLS enabled on all twelve tables | pass |
| D3 | `select * from pg_trigger where tgname like '%guard%' or tgname like '%touch%' or tgname like '%verify%';` | the expected triggers are present |

---

Report anything that fails and I will correct it before Phase 2 starts.
