# UniGuard: integrating `uni-guard-errors_10-24`, Phase 2 report

Date: 24 October 2026 · Branch: `ui/responsive-pwa` · Follows `INTEGRATION_REPORT_PHASE_1.md`

## What Phase 2 adds

### Super Admin can reach the operations console

The folder's Super Admin is an LDRRMO account with extra powers. This app's yellow console now has **Operations** and **Dispatch units** entries, which open the LDRRMO screens for the Super Admin:

- **Look:** the screens keep their layout but take the Super Admin's golden palette, so it's always clear who is acting. A "SUPER ADMIN" chip and an **Admin console** button lead back; on phones the way back is in the menu drawer.
- **Super Admin rules there:**
  - **Verify** is hidden in the triage queue and the drill-down (the server refuses it as well).
  - Hotlines are edited directly instead of through change requests.

### Dispatch Units (LDRRMO console, and the Super Admin through Operations)

- **Units:** create, edit, and activate or deactivate BFP, PNP, Rescue and Hospital units, grouped by type.
- **Support requests:** fuel, personnel, equipment and mutual-aid requests from units, to approve or decline.
- **Members (Super Admin only):** see each unit's members, invite a unit admin or member by email (which creates the dispatch account), and disable or enable members.

### Dispatching from the incident queue

The Dispatch button on a verified report now opens a real dispatch:

- **Team:** Barangay Response Team, BFP, PNP, Rescue unit, or Ambulance.
- **Unit:** for every team except the Barangay Response Team, a unit of the matching type, listed from the active units.
- **ETA and instructions.**

The server (`dispatch_report_v2`) re-checks every rule: the report is verified, the team and unit type match, and an official can dispatch only their own barangay's team. It then moves the report to dispatched, records who dispatched and when, and notifies the unit, the barangay, the reporter and the LGU.

### The dispatch console (orange) on real unit data

A dispatch account belongs to one unit and sees only what is addressed to that unit:

- **Dispatches:** the unit's dispatch queue in the approved layout. The details panel shows the incident, instructions, ETA and who dispatched it; a progress bar across Sent, Acknowledged, En route, On scene and Done; and one button for the next stage. Stages cannot be skipped. After Done, an **after-action report** is written and saved.
- **Roster:** crew with on-duty and off-duty toggles and call buttons. Unit admins add crew.
- **Equipment:** status pills, "checked, ready" and "needs repair" checks, and "mark available". Unit admins add equipment.
- **Requests:** send fuel, personnel, equipment or mutual-aid requests to the LGU, and see their status.
- **Hospital** (hospital units only): ER beds, ICU beds, available beds, and accepting patients.
- **No unit:** an account without a unit sees a clear "No unit assigned" screen instead of an empty console.

## Database: one more migration, 150

**150 lets a dispatch unit read the reports dispatched to it.** Without it, the dispatch console showed a dispatch with no hazard, barangay or location: migrations 138/139 let a dispatch account read its dispatches but not the reports behind them. The folder's app has the same gap.

150 adds exactly that read, through a checked helper function. A plain read rule would loop into the report-dispatch rule, which itself reads reports. The security test gained a check that a dispatch account reads only the report dispatched to its own unit.

`supabase/upgrade/upgrade_to_150.sql` now holds all 31 parts. **Your database already has everything up to 149, so run only `supabase/migrations/150_dispatch_reads_its_reports.sql`.**

## How it was tested

**Database (scratch copy of your upgraded schema)**, every step as the role that would do it:

1. The LGU creates a unit, and the dispatch account becomes its unit admin.
2. The LGU dispatches BFP to a verified report.
3. The unit admin adds crew and puts them on duty, adds equipment, records a check, and sets its status.
4. The unit admin moves the dispatch through acknowledged, en route, on scene and done, then saves the after-action report and sends a fuel request.
5. The LGU approves the request and deactivates the unit.

Every step passed. Three expected refusals also held: a PNP team sent to a BFP unit, skipping from "sent" to "on scene", and hospital capacity set on a fire unit. The one-file upgrade applies cleanly twice in a row, and the security test passes 36 of 36.

**App, in a browser with test data:**

- **LDRRMO:** Dispatch Units, approving a request, and the dispatch modal, which lists only BFP units for a BFP team and sends the right call. There is no invite form, which is correct because only the Super Admin creates accounts.
- **Super Admin:** Dispatch units opens in the golden palette, shows members, and sends invites.
- **Dispatch unit admin, desktop and 390 px phone:** the queue, details sheet, Acknowledge, Roster, Equipment and Requests all work.
- **Account without a unit:** sees its explanation screen.

No sideways scrolling and no runtime errors. Lint and build pass.

Not tested: invitation emails actually arriving, which needs the deployed `admin-users` function and Supabase email settings.

## What you need to do

1. **Run migration 150:** in the SQL Editor, run `supabase/migrations/150_dispatch_reads_its_reports.sql` (short, safe to re-run).
2. **Create a unit and a dispatch account:** test the preview as `geraldinegazazz05@gmail.com`:
   - open Dispatch units and create a unit, for example "BFP Lingayen"
   - open the unit and invite an email as **Unit admin**
   - the invited person sets a password from the email and signs in to the orange console
3. **Check the invite redirect:** invitation emails redirect to the site that sent them. Check that Supabase → Authentication → URL Configuration lists your Vercel address under Redirect URLs, or the link in the email won't open.

## Still to come

- **Phase 3:**
  - situation reports and damage assessments, with PDF export
  - relief inventory and distribution log
  - the full road-status form
  - guide PDFs
  - shelter facilities and contacts
  - the 9-card analytics
  - activity-log filters and links to the affected record
  - the one-hour overdue verification queue
- **Phase 4:**
  - settings and message templates
  - English and Filipino language support
  - email-link handling
  - the remaining Fix Pack items
