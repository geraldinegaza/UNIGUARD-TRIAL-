# UniGuard: integrating `uni-guard-errors_10-24`, Phase 3 report

Date: 25 October 2026 · Branch: `ui/responsive-pwa` · Follows `INTEGRATION_REPORT_PHASE_2.md`

## What Phase 3 adds

Every screen below uses the existing role styles: charcoal for the LDRRMO, navy for a barangay official, gold for the Super Admin in Operations, and crimson for residents. Each was checked on desktop and on a 390 px phone.

### One-hour overdue verification queue (Incidents)

- **Who sees it:** the LDRRMO's Incident Queue now opens with an amber panel listing reports that the barangay has not verified for over an hour. Each row shows how long it has waited.
- **Verify:** the LDRRMO can verify a report straight from the panel. This is recorded as an LDRRMO verification, and the reporter is notified.
- **Super Admin:** sees the list without the Verify button (monitoring only).
- **Barangay officials:** do not see the panel.
- **Refresh:** the list updates every minute on its own.

### Road status details (Road Work)

- **New fields:** segment from and to, cause (flooding, landslide, road repair, accident, other), and severity.
- **Reopening:** the expected reopening time is worked out from the duration.
- **Under Clearing:** now a choice in the form; the database already supported it.
- **Road cards:** opening a card shows the segment, cause, severity, expected reopening and who updated it.

### Shelters

- **Edit Shelter** (renamed from Edit Occupants) now also sets:
  - facilities: one-tap choices such as Toilets, Generator, Kitchen, PWD access, plus free text
  - a contact person and number
- **Staff:** a new occupancy trend chart shows evacuees against capacity per day.
- **Residents:** see the facilities, and the contact number as a tap-to-call link.

### Relief stock and distribution log (Relief)

- **Inventory:** grouped by category, with stock against the reorder point. A low-stock warning appears when an item reaches its reorder point.
- **LDRRMO:** adds, edits, restocks and removes items.
- **Barangay official:** sees the stock, and records goods given out to their own barangay.
- **Distribute:** records goods handed out, and the stock drops by the same amount in one server step. It refuses a quantity larger than the stock.
- **Distribution log:** a list of everything handed out, exportable as CSV.

### Reports & Documents (new screen, in the More menu and the phone menu)

**Situation Report**
- Choose the period, the scope (an official is fixed to their barangay), the event name and remarks.
- An on-screen preview shows the same 11 sections as the PDF:
  - incidents, and incidents by barangay
  - damage
  - shelters
  - response actions
  - relief given out, and stock on hand
  - roads
  - advisories
  - priority needs
- **Export PDF** (landscape, with page numbers and "Prepared by").
- **Save to register:** numbers reports per event (No. 1, No. 2, and so on).

**Damage & Needs Assessment**
- The full form:
  - affected and displaced families and persons
  - dead, injured and missing
  - damaged houses
  - damage cost in PHP
  - power, water and communications
  - needs
  - remarks
- Totals cards, a list, and a PDF of one assessment or all of them.
- Only the LDRRMO can validate an assessment. An official can delete only a draft.

**Incident Summary**
- Pick a report to get its details, status timeline, the teams dispatched with their after-action reports, and any linked assessment, as one PDF.

### Analytics: the nine cards

Below the existing charts, one date range and one barangay filter drive nine cards:

- **A:** reports by hazard
- **B:** reports by barangay
- **C:** status breakdown, with the oldest open report and the count unverified over an hour
- **D:** response time by unit
- **E:** dispatch workload, plus how fast support requests are answered
- **F:** verification quality
- **G:** shelter occupancy
- **H:** relief handed out
- **I:** the range compared with the period of the same length just before it

Export as CSV or PDF.

### Activity log (Super Admin console)

- **Filters:** search, the actor's role, record type, and a date range.
- **Export:** the filtered list as CSV, and **Load older activity** for history beyond the latest entries.
- **Readable entries:** entries the database records automatically now read as plain words, for example "Shelter updated" instead of a table name.
- **Open:** each entry has an **Open** button that goes to the screen holding that record, for example a shelter entry opens Shelters in the gold Operations view.
- **Hotlines:** a new **Hotlines** entry in the console opens hotline management directly.

### Guide PDFs

- **Residents:** a **PDF** button saves the selected hazard's guide for offline reading.
- **Staff:** **All Guides PDF** prints every guide.

## Database: migration 151

Reviewing the folder's migrations 141–147 turned up four problems. Migration 151 fixes them:

1. **Overdue reports never reached the LDRRMO by themselves.** Migration 147 marked a report overdue only when something changed the report, so a report nobody touched stayed out of the queue. The queue now goes by the clock, the same way the existing 30-minute escalation does.
2. **The overdue queue leaked.** It ignored the reader's access rules, so anyone, even someone not signed in, could list every overdue report with its description and barangay. Its extra rule also let any barangay official read every barangay's overdue reports. Both are closed. The "Others" review list had the same leak, also closed.
3. **The overdue Verify skipped the usual records.** It now uses the normal LDRRMO verify, so it records who verified, notifies the reporter, and still refuses the Super Admin.
4. **Relief stock could not work for officials.** Officials were not allowed to lower the stock, could log distributions for any barangay, and disabled accounts kept write access. A new server function, `log_relief_distribution`, checks the barangay and the stock and lowers it in one step. New items also get an id automatically.

**Upgrade file:** `supabase/upgrade/upgrade_to_150.sql` is now `upgrade_to_151.sql` (32 parts). **Your database already has everything up to 150, so run only `supabase/migrations/151_phase3_operations.sql`.** It is safe to run more than once.

## How it was tested

**Database.** The security test grew from 36 to 57 checks, all passing, on two databases: a scratch copy of your upgraded schema, and a copy of the original live schema after the full one-file upgrade (which applies cleanly twice). The new checks cover:

- signed-out visitors cannot read the overdue queue or the Others list
- an official cannot see another barangay's overdue report
- an official can give out goods for their own barangay, and the stock drops
- refused: another barangay's goods, more than the stock, writing the log directly, changing stock
- an official files an assessment, but cannot validate it or file for another barangay
- the LDRRMO sees a two-hour-old untouched report in the queue, verifies it, and it leaves the queue
- the Super Admin is refused

On the database before 151, the first check failed as expected: a signed-out visitor could read an overdue report.

**App, in a browser with test data.** Every action was clicked and the request it sends was checked:

- **LDRRMO, desktop and phone:** every feature above, end to end. The exported files were real: situation report PDF 94 KB (4 pages), assessment and incident PDFs, analytics PDF and CSV, distribution CSV, guides PDF.
- **Super Admin:** filters, CSV, opening a record into Operations (gold), and the overdue list without Verify.
- **Barangay official:** no Add item button, barangay fixed when giving out goods and in reports, no Validate choice, no overdue panel.
- **Resident, phone:** guide PDF, shelter facilities and the call link.

No sideways scrolling on any screen, and no runtime errors. Lint and build pass. The PDF library loads only when someone exports, so the app does not get slower to open.

## What you need to do

1. **Run migration 151:** in the Supabase SQL Editor, open `supabase/migrations/151_phase3_operations.sql`, paste it and run it.
2. **Add relief stock:** as the LDRRMO, open Relief → Relief Stock → Add item for each warehouse item. The list starts empty; the folder's 18 sample items were demo data, so I did not copy them in.
3. **Fill in the shelter details:** use Edit Shelter on each shelter to add facilities and a contact, so residents see them.
4. **Try a situation report:** Reports & Documents → enter an event name → Export PDF, then Save to register.

## Recommendations that need serious attention

1. **The overdue panel shows only on the Incidents screen.** If the LDRRMO stays on another screen, overdue reports wait unseen. Consider a push notification at the one-hour mark, which needs a scheduled job (pg_cron or a scheduled Edge Function).
2. **Some data has no offline copy yet.** Relief stock, assessments and situation reports are read live and not saved to the offline copy. A field team without signal cannot see stock or file an assessment yet.
3. **The situation report numbering can collide.** It counts per event in the browser, so two staff saving at the same moment could both save "No. 3". It's low risk, but a server-side counter would rule it out.
4. **The app bundle is large (1.4 MB before compression).** Splitting the console screens from the resident app would make the resident app open faster on slow phones.
5. **Earlier recommendations still stand:**
   - verify the approximate barangay centroids
   - redeploy `push-dispatch` and `sms-fallback`
   - check the Supabase invite Redirect URLs
   - the free plan pauses an idle project

## Still to come (Phase 4)

- Settings and message templates
- English and Filipino language support
- Email-link handling
- The remaining Fix Pack items
