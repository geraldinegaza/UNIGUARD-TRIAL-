# UniGuard: integrating `uni-guard-errors_10-24`, Phase 1 report

Date: 24 October 2026 · Branch: `ui/responsive-pwa` · Status: Phase 1 complete and tested, not yet live

## 1. What the folder is

`uni-guard-errors_10-24` is a separate, plain-JavaScript build of UniGuard that kept developing after this React app was created. The two share the same backend lineage, but the folder went much further:

| | This system (React) | The folder (vanilla JS) |
|---|---|---|
| Supabase project | `lqcqptznbgpukwiknahw` | `irjeupyvczmewcxuvjpu` (a different project) |
| Database migrations | 001–023, plus this project's 024 and 025 | 001–048 |
| App code | about 21,000 lines | about 17,000 lines, 20 screens and 160 actions this app lacks |

Migrations 001–021 are identical in both; this app's copies of 004, 010 and 011 only add re-runnability. Everything from 022 onward exists only in the folder.

You chose to keep this system's database and to bring the folder over in phases. This report covers Phase 1: the database, the role model, and the features of the folder that change how existing screens must behave.

## 2. What Phase 1 brings over

### Database (`supabase/migrations`)

- **122–148:** the folder's migrations 022–048, renumbered by +100 so they sort after this project's own files. Each maps directly to its original (122 is the folder's 022, and so on).
- **026:** reconciles this project's roles with the folder's model before 122 runs (see section 3).
- **149:** stores hazard types as keys (see section 4).
- **`supabase/upgrade/upgrade_to_149.sql`:** all 30 parts in one file, to paste into the Supabase SQL Editor once. Rebuild it with `supabase/upgrade/build.sh`.
- **`supabase/tests/role_security_test.sql`:** 35 per-role security checks that roll back and write nothing.

What the upgrade adds:

- **Reports and status:** strict one-step status flow (reported, verified, dispatched, resolved, with reject from any open state), with reporter notifications.
- **Location rules:** every report must have coordinates inside Lingayen, and its barangay is set from those coordinates on the server.
- **Escalation:** unverified reports reach the LDRRMO after 30 minutes, at once for life-safety hazards, and as an overdue queue after one hour. The LDRRMO has a fallback verify that records who verified.
- **Corroboration:** 500 m radius for confirmations, with auto-verify at three independent reports.
- **Super Admin:** the Super Admin model, including the rule that a Super Admin cannot verify reports.
- **Hotline approvals:** hotlines become official records; staff submit change requests and only the Super Admin approves them.
- **Barangay scoping:** for SOS, road status, road work and advisories. Officials publish only to their own barangay.
- **Activity log:** full audit coverage of every writable table, plus shelter occupancy history.
- **Dispatch units:** the full schema (BFP, PNP, Rescue, Hospital), with equipment, personnel, shifts, hospital capacity, patient notices, support requests, after-action reports, and dispatch records with team, ETA and instructions.
- **Other new tables:** relief inventory, damage assessments, situation reports, settings and message templates, guides with Before/During/After sections and a PDF, and the full road-status form.
- **Analytics:** scoped by role. Residents see none, and officials see only their barangay.

### Edge Functions (`supabase/functions`)

`admin-users`, `push-dispatch` and `sms-fallback` are replaced with the folder's versions. They add per-barangay and per-unit audiences and the Super Admin checks.

### App changes made so existing screens work on the new schema

- **Accounts:** a Super Admin is an LDRRMO account with `is_super_admin`; the app recognises it and opens the yellow console.
- **My reports:** "is mine" now comes from the server, because the report feed no longer exposes who filed what.
- **Report form:** a location is required. GPS fills it, and a draggable map pin is the fallback. A pin outside Lingayen snaps back, and a GPS fix outside town starts the pin at the town centre.
- **Hazard types:** stored as keys (`fire`), still shown as labels ("Fire").
- **Status:** the drill-down panel offers only the next legal step.
- **Triage queue:** shows "Escalated" and "Life-safety" badges; the LDRRMO's Verify uses the LGU fallback path.
- **Hotlines (LDRRMO and barangay):**
  - adding, editing, verifying and removing a line all become change requests, with a reason field
  - the screen lists the account's own requests and their outcome
- **Super Admin console (yellow, same style):**
  - new **Requests** section that compares current and proposed values, then approves or rejects with a note
  - **Accounts** rows open a panel to change role, barangay or Super Admin status, or to disable the account
- **LDRRMO menus:** Users and Audit Log are removed; both are Super Admin only now.
- **Advisories:** barangay officials can only target their own barangay; push notifications go only to the targeted barangay's devices.
- **Guides:** the merged Before/During/After guides appear in the existing guide screens unchanged; edits write into the right section.
- **Road status:** uses the four new values. The screen keeps its existing labels: Impassable, Passable with Caution, Under Clearing, Cleared.

The interface style was kept strictly: every change uses the existing portal colours, components and layouts.

## 3. Role reconciliation (migration 026)

This project had added a separate `super_admin` role (025) and a unit-less `dispatch_team` role (024), and both are applied on your live database. The folder's schema needs something different. 026 handles it before the folder's migrations run:

- **Super admin accounts:** each `super_admin` account becomes LDRRMO staff with the Super Admin flag. No access is lost.
- **Dispatch accounts:** each `dispatch_team` account without a unit returns to resident, and an activity-log entry records it. The folder requires every dispatch account to belong to a dispatch unit, and units only exist from 138 on. **Your earlier test dispatch account will be a resident after the upgrade**; it can be invited into a real unit once Phase 2 adds the Dispatch Units screen.
- **Read rules:** the broad read rules added by 024 and 025 are removed, and the folder's properly scoped rules replace them.
- **Auto-verify trigger:** this project's duplicate trigger is retired, because the folder's version (122) does the same job.

## 4. Bugs found in the folder's migrations, and fixed here

Testing the folder's migrations on a copy of your database surfaced seven bugs, each serious enough to stop the upgrade or corrupt data. Each fix is marked `[this project]` in the file:

| File (original no.) | Problem | Effect | Fix |
|---|---|---|---|
| 127 (027) | The report edit guard had no exception for trusted backend runs | 130's barangay backfill failed for every report whose picked barangay disagreed with its coordinates, stopping the whole upgrade | Same trusted-backend rule as the other guards |
| 130 (030) | The barangay resolver took an arbitrary match among overlapping boxes | A report beside the Poblacion centre was routed to Aliwekwek | Nearest centre among the boxes that contain the point; all 32 centres now route to themselves |
| 131 (031) | The new road-status check was added before the old `caution` rows were converted | Failed on any existing `caution` row. This is why the folder's own project never applied 031 | Convert first, then add the check |
| 132 (032) | Merged guides are stored with phase `all`, which the old check rejects | Failed as soon as any guide existed | Widen the check first |
| 138 (038) | Helper functions and the `unit_id` column were used before they were created | Failed on a fresh run | Moved above their first use |
| 138 (038) | `ADD CONSTRAINT IF NOT EXISTS`, which PostgreSQL does not support | Syntax error | Guarded by name instead |
| 143 (043) | Hard-coded master Super Admin `geraldinegazazz05@gmail.com`; the whole upgrade stops if that account doesn't exist | Blocked on any database without that account | Promote it if it exists; otherwise continue if another active Super Admin exists (026 provides one); stop only if there would be none |

A further inconsistency was fixed by **149**. Escalation compared hazard **keys** (`fire`), while the "Others" rule and review screen compared the **label** `Others`. This app stored labels, so its reports never got the life-safety fast track; the folder's app stored keys, so its "Others" reports skipped the review screen. Keys are now the stored form everywhere, and both "Others" rules accept either spelling.

The folder's own `docs/RLS-TEST.sql` could not run: it puts `BEGIN … EXCEPTION` blocks in plain SQL, which only works inside a function. `supabase/tests/role_security_test.sql` replaces it.

## 5. How it was tested

**Database.** I used a scratch PostgreSQL 16 server with a stand-in for Supabase's auth, storage and roles:

- **Replay:** rebuilt your live database from this project's setup scripts plus 024/025, then seeded it with live-like accounts (residents, an official, LDRRMO staff, your test super admin and dispatch accounts, the master email), reports, guides on the old shape, and a `caution` road.
- **Upgrade, every scenario run twice:**

  | Scenario | Result |
  |---|---|
  | Master email exists | applied cleanly, both runs |
  | Master email missing, test super admin present | applied cleanly, both runs |
  | No Super Admin anywhere | stops with a clear message, as designed |
  | Brand-new database (setup scripts, then the upgrade) | applied cleanly, both runs |

- **Data outcomes checked:**
  - the test super admin was folded in, and the master email received the flag
  - the dispatch reset was logged
  - three Flood phase rows merged into one guide
  - `caution` became `one_lane`
  - reports routed to the right barangay
  - hazard labels became keys
- **Security:** 35 of 35 checks pass for resident, official, LDRRMO staff, Super Admin and dispatch. The checks cover who can read which reports, profiles, activity log and analytics; step-skipping blocked; the Super Admin verify block; approving a change request updates the hotline; role changes are Super Admin only; and a dispatch account sees only dispatches addressed to its unit.
- **Leak closed:** before the upgrade a resident of one barangay could read every report of another barangay through the report feed; after it, only their own report there.

**App.** Lint and production build pass. In a browser, with data shaped like the upgraded database:

- **LDRRMO:** sees the escalation badges; its hotline add and edit go out as change requests; Users and Audit Log are gone from its menu.
- **Resident:** guides show text from a merged guide; a report without a location is blocked with a clear message and the pin map.
- **Super Admin:** reviews a request with the current/proposed comparison and approves it; changes a role from the Accounts panel. The correct server calls are sent.
- **All five roles at 375 px and 1280 px:** no runtime errors and no sideways scrolling.

**Not tested:** anything against your real Supabase project, because I have no access to run SQL there; push and SMS delivery; and the new Edge Functions running on Supabase.

## 6. What you need to do, in this order

1. **Back up.** In Supabase, use Database → Backups, or at least export `preparedness_guides` and `reports`.
2. **Run the upgrade.** In the SQL Editor, paste `supabase/upgrade/upgrade_to_149.sql` and run it. It's safe to run again if anything interrupts it.
3. **Redeploy the three Edge Functions** (`admin-users`, `push-dispatch`, `sms-fallback`). Do this straight after step 2 (see 7.2).
4. **Check your Super Admin.** Sign out and back in with your super admin account; you should land on the yellow console. If it fails, run `select email, role, is_super_admin from profiles where is_super_admin;` in the SQL Editor.
5. **Test the preview** (link in the chat). This version needs the upgraded database, so test only after step 2.
6. **Go live.** Say "go live" and the branch is merged into `main`.

Do not merge this branch to production before step 2: the new app writes columns and values the old database rejects.

## 7. Needs serious attention

1. **Barangay locations are approximate.** From the upgrade on, a report's barangay is set from its coordinates using centres and boxes the folder compiled from OpenStreetMap and PhilAtlas, marked "verify before production". A wrong centre sends reports, and so notifications and dispatches, to the wrong barangay. The upgrade also re-routes existing reports. Please have the MDRRMO check the 32 points in `barangay_geoms` against official boundaries, or load real polygons.
2. **Edge Functions must be redeployed at the same time as the upgrade.** The old `admin-users` function lets any LDRRMO account change roles, and because it runs with the service key it bypasses the database's new Super Admin-only rule. Until the new version is deployed, plain LDRRMO staff can still change roles through it.
3. **Two live databases are drifting apart.** The folder's project (`irjeupyvczmewcxuvjpu`) and this system's (`lqcqptznbgpukwiknahw`) both hold real accounts and reports, and the folder's app still points at the other one. Decide which is the system of record, and retire the other app or point it here, before people use both.
4. **The free Supabase plan pauses the database.** It was paused once already, which took the whole system down. For an emergency system, move to Pro or keep it awake with a daily ping.
5. **Backup before 130 and 132.** Those two parts change existing data: report barangays and the guide structure. They are tested, but take a backup first.
6. **The offline queue can stall.** A queued report the server refuses (for example one saved by an older version without coordinates) blocks every report behind it, because sending stops at the first failure. The folder lists the same issue for its next fix pack.
7. **Dispatch accounts.** The test dispatch account becomes a resident. Real dispatch accounts need the Dispatch Units screens from Phase 2.

## 8. Remaining phases

Not yet integrated; the database is ready for all of them after this upgrade:

- **Phase 2, dispatch units:**
  - Dispatch Units management (Super Admin and LDRRMO): units, members, invites
  - the full dispatch console: dispatches addressed to the unit, acknowledge, en route, on scene, done; equipment checks; personnel duty; hospital capacity and patient notices; support requests; after-action reports
  - the Barangay Response Team
  - dispatching from the incident queue with team, ETA, instructions and equipment
- **Phase 3, records:**
  - situation reports and damage assessments, with PDF export
  - relief inventory and distribution log
  - the full road-status form
  - guides with PDF attachments
  - shelter facilities and contacts, and the occupancy trend
  - the 9-card analytics with period comparison and exports
  - the activity log with filters and links to the affected record
  - the one-hour overdue verification queue
  - Super Admin direct hotline management
- **Phase 4:**
  - Settings and message templates
  - English and Filipino language support
  - email confirmation link handling (the folder's Fix Pack F1)
  - the remaining Fix Pack 01 items
