# UniGuard: integrating `uni-guard-errors_10-24`, Phase 4 report

Date: 25 October 2026 · Branch: `ui/responsive-pwa` · Follows `INTEGRATION_REPORT_PHASE_3.md`

This is the last integration phase. Together with Phases 1–3, every feature of the folder now exists in this app, in this app's own style.

## What Phase 4 adds

### Settings (every role)

Open it from the menu: the resident menu drawer, the staff More menu and phone menu, or **Settings** in the Super Admin console.

- **Alerts:** shows whether alerts are on for this phone (On, Off, Blocked in browser settings, or Not supported), with a **Turn on alerts** button. The wording is plain, with no technical terms.
- **Language:** English or Filipino.
- **Offline:**
  - whether the app works without internet
  - when it last saved for offline use
  - how many reports are waiting to send
  - the app version
- **Message templates:**
  - LDRRMO: create, edit and delete
  - barangay officials: read only
  - each template has an English and a Filipino version, viewable side by side
- **Organisation** (Super Admin only): the MDRRMO's name, hotline and email. The hotline is what residents call from the SOS screen.

### Message templates in the advisory composer

A new **Start from a template** row above the advisory title:

1. Pick a template and choose English or Filipino.
2. Fill in the blanks: barangay, evacuation center, road, and so on. An official's barangay is filled in for them.
3. Tap **Use this template** to write the title and message and set the severity.

The 8 templates from the folder are already in your database.

### English and Filipino

- **Translated:** the resident app, the sign-in screen and Settings, about 370 phrases in everyday Taglish matching the folder's wording ("Mga Babala", "Mga Shelter").
- **Choosing it:** a language switch is on the sign-in screen and in Settings. The choice is remembered on the device.
- **Covered screens:**
  - navigation, home and the hazard report form
  - SOS, shelters, hotlines, relief, guides and FAQs
  - notifications and the offline screen
  - error messages
- **Not translated:**
  - the staff consoles stay in English, the language the MDRRMO works in
  - advisories and guides appear in the language they were written in; the templates are how an advisory is sent in Filipino

### Email links

- **Confirmation link:** opening it shows "Your email is confirmed. You can now sign in."
- **Confirmed and already signed in:** a short welcome message appears instead.
- **Expired or reused link:** shows a plain explanation and a **Send a new link** button, where before it was an error page.
- **Clean address bar:** the link's code is removed from the address bar afterwards.
- **Links that open on phones:** an email link can no longer point to a `localhost` address.

### Fix Pack (tester findings F1–F14)

| Item | In this app |
|---|---|
| F1 confirmation link error page | **Fixed** (above) |
| F2 `delivery_mode` advisory error | Not present: this app never sends that column |
| F3, F4 buttons that do nothing | Not present: they came from the folder's click handling, which this app doesn't use |
| F5 technical words and raw errors | **Fixed.** Every error becomes a plain sentence, for example "No internet connection. Check your signal and try again.", and the offline screen uses everyday words |
| F6 refresh signs you out | **Fixed.** Only a deleted or disabled account ends the session; no signal or a server hiccup keeps you signed in, and the profile is re-checked when the connection returns |
| F7 SOS without internet | **Fixed** (below) |
| F8 Declare Emergency for officials | Not a problem here: an official's button sends a warning to their own barangay only, which the server allows |
| F9 "1 corroborations" | **Fixed:** "No corroborations yet", "1 corroboration", "3 corroborations" |
| F10 relief View button | Not present in this app |
| F11 offline report lost on refresh | **Fixed** (below) |
| F12 pin outside Lingayen | Already fixed in Phase 1 |
| F13, F14 empty Users and Activity | Already fixed in Phases 2 and 3 |

**SOS without internet (F7).** Phones often believe they're online when there is no real connection; before, the SOS then failed with "Failed to fetch".
- **Saved instead:** it's kept on the phone and sent automatically, with a "Waiting for signal" notice.
- **Call button first:** **Call the Lingayen MDRRMO** moves to the top. It's also always on the SOS screen now, which had no call button before.
- **No duplicates:** tapping SOS again within 10 minutes updates the saved one rather than queueing several.
- **Delivered:** when it goes out, the screen says "Your SOS was delivered to the MDRRMO."

**Waiting to send (F11 and the queue stall flagged in earlier phases).**
- **SOS first:** when the connection returns, SOS messages are sent before reports.
- **No more stalling:** one item the server refuses no longer blocks everything behind it.
- **Failed items:** after 5 refusals an item is marked **Could not send**, with **Try again** and **Delete**, on the offline screen's new **Waiting to Send** list.
- **Reload warning:** reloading the app first says how many items are waiting and that they will be kept.

## Database: migration 152

1. **Organisation profile:** any LDRRMO account could change it, disabled accounts included. Now only the Super Admin can. A new `org_profile()` lets the app show the hotline to everyone, even before sign-in.
2. **Message templates:** disabled accounts can no longer read or edit them, and new templates get an id automatically.
3. **Advisory notifications:** `fanout_advisory` had no caller check, so **any account could re-send an advisory's notifications to every resident**. Now only LDRRMO staff or the advisory's author can. The test caught a mistake in my first version of this fix (an advisory with no author slipped through), which is corrected.

**Upgrade file:** `upgrade_to_151.sql` is now `upgrade_to_152.sql` (33 parts). **Your database has everything up to 151 once you've run Phase 3's migration, so run only `supabase/migrations/152_phase4_settings.sql`.** If 151 isn't applied yet, run 151 first.

## How it was tested

**Database.** The security test now has 66 checks, all passing, on two databases: a copy of your upgraded schema, and a copy of the original live schema after the full upgrade (which applies cleanly twice). The new checks cover:

- anyone, even signed out, can read the hotline
- a resident cannot re-send an advisory or read templates
- an official reads templates but cannot edit them
- LDRRMO staff add templates but cannot change the organisation profile
- the Super Admin changes the hotline, and that is what residents then see

**App, in a browser with test data:**

- **Resident, phone:**
  - switching to Filipino
  - an SOS whose request fails, giving the waiting notice and the call card with no raw error
  - the Waiting to Send list
  - an item that failed 5 times, with Try again
- **Sign-in screen:** the expired-link notice and resend, the confirmed-link notice, and Filipino.
- **LDRRMO:** creating a template, and filling an advisory from a template in Filipino.
- **Super Admin:** saving the hotline, in the gold Operations view.
- **Barangay official, phone:** templates read-only.

The full Phase 3 test was run again with no regressions. No sideways scrolling, no runtime errors; lint and build pass.

## What you need to do

1. **Run migration 152:** in the Supabase SQL Editor, open `supabase/migrations/152_phase4_settings.sql`, paste it and run it. Run 151 first if you haven't.
2. **Check the email link settings** in Supabase → Authentication → URL Configuration:
   - **Site URL:** your live https address
   - **Redirect URLs:** include `https://<your-vercel-address>/**`
   - without these, confirmation and invite emails can't bring people back into the app
3. **Check the hotline:** as the Super Admin, open Settings → Organisation and confirm the MDRRMO hotline is the number residents should call.

## Needs serious attention

1. **The app isn't live yet.** All four phases are on the preview branch `ui/responsive-pwa`; main still runs the version from before the integration. When you're satisfied with the preview, the branch needs to be merged to go live.
2. **The staff consoles are English only.** Translating them is possible with the same system if the barangay officials want it.
3. **Two Edge Functions still need redeploying:** `push-dispatch` and `sms-fallback`. Until then, push alerts use the old code.
4. **Earlier items still stand:**
   - verify the approximate barangay boundaries
   - Supabase pauses an idle project on the free plan
   - relief stock, assessments and situation reports have no offline copy
   - the app bundle is large for slow phones
