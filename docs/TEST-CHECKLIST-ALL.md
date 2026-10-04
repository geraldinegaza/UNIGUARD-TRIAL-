# Manual test checklist

Per-role checks for the whole system. Phase 1 (schema) is also covered in
`TEST-CHECKLIST-PHASE-1.md` with SQL level detail. Everything here is done through
the interface unless a step says otherwise.

**Accounts you need first**

| Role | How to create it |
|---|---|
| Resident | create it yourself from the app |
| Barangay official | as LGU: Users → Create Official, then set the role and barangay |
| LGU / LDRRMC | promote a trusted account once, directly in `public.profiles`, then use the app |

---

## 1. Accounts and access — every role

| # | Step | Expected |
|---|---|---|
| 1.1 | Open the app signed out | Sign In screen: email, password, Sign In, Create Account, Forgot Password. No prefilled values, no demo accounts. |
| 1.2 | Press Enter in the password field | the form submits |
| 1.3 | Toggle the eye icon on the password field | the value is revealed and hidden again |
| 1.4 | Sign in with a wrong password | inline "That email and password do not match an account." No navigation. |
| 1.5 | Sign in with an unconfirmed email | inline "Confirm your email address first." |
| 1.6 | Disable an account as LGU, then sign in as it | inline "This account has been disabled." |
| 1.7 | Turn off the network, then sign in | inline "No connection to the server." |
| 1.8 | Reload while signed in | the session persists, you land back on your home screen |
| 1.9 | Sign out | back to Sign In, and a reload stays signed out |

## 2. Create account

| # | Step | Expected |
|---|---|---|
| 2.1 | Create Account → submit empty | field level errors, nothing is sent |
| 2.2 | Enter `0917123` as the mobile number | "Use a Philippine mobile number, for example 0917 123 4567." |
| 2.3 | Enter `0917 123 4567` | accepted, and stored normalised as `09171234567` |
| 2.4 | Leave the barangay unselected | "Select your barangay." |
| 2.5 | Enter a 6 character password | "Use at least 8 characters." |
| 2.6 | Mismatch password and confirm | "The two passwords do not match." |
| 2.7 | Submit without ticking consent | "Consent to the Privacy Notice is required." |
| 2.8 | Open the Privacy Notice link | the notice opens, with the Data Privacy Act text |
| 2.9 | Submit a valid form | "Check Your Email to Confirm Your Account", with Resend Email |
| 2.10 | Press Resend Email | confirmation, and a second email arrives |
| 2.11 | In the database, check the new profile | `role = 'citizen'`, never official, whatever was submitted |
| 2.12 | Try to force a role by editing the request | still `citizen`: the trigger forces it |

## 3. Forgot and reset password

| # | Step | Expected |
|---|---|---|
| 3.1 | Forgot Password → submit a registered email | "If an account exists …, a reset link has been sent." |
| 3.2 | Submit an **un**registered email | exactly the same message. No hint either way. |
| 3.3 | Submit an empty email | "Enter the email address on your account." |
| 3.4 | Open the reset link from the email | the app opens on Set a New Password |
| 3.5 | Set a weak or mismatched password | inline error |
| 3.6 | Set a valid password | "Password updated", you are returned to Sign In, and the new password works |
| 3.7 | Try the reset link a second time | it is refused as expired; request a new one |

---

## 4. Resident — mobile

| # | Step | Expected |
|---|---|---|
| 4.1 | Sign in | home screen for your barangay, bottom navigation |
| 4.2 | Check the three readouts | active incidents and open shelters match the data |
| 4.3 | Open Advisories, filter by Preparedness | only preparedness posts remain |
| 4.4 | Open an advisory | severity, affected area, published time, what to do now |
| 4.5 | Save Offline | confirmation toast |
| 4.6 | Share | the native share sheet, or "Link copied" |
| 4.7 | Open Shelters, filter by Full | only full centres, with occupancy bars |
| 4.8 | Directions on a centre | OpenStreetMap directions open in a new tab |
| 4.9 | Open Hotlines, press Call | the dialler opens with the number |
| 4.10 | Look at the bottom navigation on the Report screen | still visible, nothing is covered |

## 5. Resident — report a hazard

| # | Step | Expected |
|---|---|---|
| 5.1 | Report a Hazard → submit with an empty description | "Add a short description before submitting" |
| 5.2 | Acquire GPS, allow the prompt | coordinates and accuracy appear |
| 5.3 | Acquire GPS, deny the prompt | a manual coordinate prompt appears instead |
| 5.4 | Attach a 4 MB phone photo | it is compressed, the size is reported, and the file name shows |
| 5.5 | Attach a PDF renamed to `.jpg` | rejected as unreadable |
| 5.6 | Check the report preview | your barangay is preselected and cannot be changed to another |
| 5.7 | Submit | a `UG-YYYY-NNNN` code appears, status Reported |
| 5.8 | Turn off the network, then submit another | "Saved on this device. It uploads when you are back online." |
| 5.9 | Turn the network back on | the banner offers Upload now, and the queued report appears |
| 5.10 | Submit six reports in ten minutes | the sixth is refused with a rate limit message |
| 5.11 | Open My Reports | your reports only, newest first, with relative times |
| 5.12 | Open a report | photo, description, tracking pipeline, corroboration meter |

## 6. Corroboration

| # | Step | Expected |
|---|---|---|
| 6.1 | As the reporter, open your own report | no way to corroborate your own report |
| 6.2 | As another resident in the same barangay | Confirm this hazard is still there succeeds |
| 6.3 | Reach three distinct people in six hours | the report becomes Verified by itself, and a history row has `reason = auto_corroboration` |
| 6.4 | Repeat with the third confirmation more than six hours later | the report stays Reported |
| 6.5 | Try to corroborate the same report twice | the second attempt is refused |

---

## 7. Barangay official

| # | Step | Expected |
|---|---|---|
| 7.1 | Sign in | the command console, scoped to your barangay |
| 7.2 | Dashboard | KPI figures and the incident list cover your barangay only |
| 7.3 | Incident queue | only your barangay; the scope label says so |
| 7.4 | Advance a report | confirm dialog, then Reported → Verified → Dispatched → Resolved |
| 7.5 | Try an illegal jump (Reported → Resolved) | offered only through the legal path |
| 7.6 | Open the incident, check Activity Log | every change is listed with its actor and time |
| 7.7 | Shelters → set a centre to Full | the badge and the resident view update |
| 7.8 | Add an Evacuation Center | it appears in the list and in the resident app |
| 7.9 | Try to edit a hotline | the screen offers no hotline editing, and the API refuses it |
| 7.10 | Try to open Users or Audit Log | the entries are absent from the navigation |
| 7.11 | Resize the window to phone width | the sidebar collapses to an icon rail and the console stays usable |
| 7.12 | Load the responder roster, then assign a unit | the assignment count on the incident increases |

## 8. LGU / LDRRMC

| # | Step | Expected |
|---|---|---|
| 8.1 | Sign in | console, citywide scope |
| 8.2 | Dashboard | every barangay's incidents; the map shows markers by severity |
| 8.3 | Click a map marker | it opens that incident |
| 8.4 | Hover a marker | a popup with code, barangay, status and corroboration count |
| 8.5 | Advisories → compose → Publish | confirm dialog, then it appears in the published list |
| 8.6 | Publish an advisory targeted at one barangay | only that barangay's residents are notified |
| 8.7 | Declare Emergency | confirm dialog showing the real subscribed device count, not a fixed number |
| 8.8 | After declaring, check the audit log | an `emergency.declared` row with the device count |
| 8.9 | Users → Create Official | an invitation email is sent |
| 8.10 | Change a user's role | the change takes effect on their next sign in |
| 8.11 | Assign a barangay | the official's scope changes to that barangay |
| 8.12 | Disable an account | that account can no longer sign in |
| 8.13 | Try to disable your own account | refused |
| 8.14 | Audit Log | role changes, declarations and directory edits are listed newest first |
| 8.15 | Export CSV on Users, Audit and Analytics | three well formed CSV files |
| 8.16 | Hotlines → add, edit, verify | each change is saved and appears in the resident app |
| 8.17 | Analytics | figures come from the SQL views; the 14 day trend reflects real reports |

---

## 9. Offline and PWA

| # | Step | Expected |
|---|---|---|
| 9.1 | Load the app once online | DevTools shows the service worker activated and the shell cached |
| 9.2 | Turn off the network and reload | the app opens, with the offline banner |
| 9.3 | Open Hotlines and Shelters offline | both render from the cache |
| 9.4 | Open a critical advisory offline | it renders from the cache |
| 9.5 | Try to open the map offline | the built in map is shown, no empty panel |
| 9.6 | Submit a report offline | it is queued, and the banner counts it |
| 9.7 | Restore the network | the queue uploads without a reload |
| 9.8 | Install the app from the browser | it opens standalone, with the shield icon |
| 9.9 | Enable notifications from the app | permission prompt, then the device is counted in Declare Emergency |
| 9.10 | Publish an emergency as LGU | the installed app receives a notification, tapping it opens the advisory |

## 10. Security, one pass per role

| # | Step | Expected |
|---|---|---|
| 10.1 | As a resident, request another resident's report id directly | refused |
| 10.2 | As a resident, request the `profiles` table | only your own row |
| 10.3 | As a resident, read `audit_log` | empty |
| 10.4 | As an official, request a report from another barangay | refused |
| 10.5 | As an official, call `admin_set_user_role` | refused |
| 10.6 | As anyone, try to change your own role | refused |
| 10.7 | As a resident, upload a photo into another user's folder | refused |
| 10.8 | As a resident, upload a PDF to the reports bucket | refused |
| 10.9 | Run `docs/RLS-TEST.sql` | every assertion passes |
| 10.10 | Inspect any response in DevTools | no reporter identity leaks to a resident |

## 11. Accessibility and layout

| # | Step | Expected |
|---|---|---|
| 11.1 | Tab through the sign in form | visible focus rings, logical order |
| 11.2 | Tab to a button and press Enter | it activates |
| 11.3 | Open a dialog and press Escape | it closes |
| 11.4 | Zoom to 200% | no clipped text, no horizontal scrolling |
| 11.5 | Narrow to 360 px | nothing overlaps; the console uses the icon rail |
| 11.6 | Read the app with a screen reader | the dialogs announce their title and the toasts are announced |
| 11.7 | Turn on reduced motion | animations collapse, nothing is lost |
