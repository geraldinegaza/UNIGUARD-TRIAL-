# Deploy

Everything below is a one-time setup. Nothing here needs a build step: the app is
plain HTML, CSS and classic scripts.

## 0. What you need

- A Supabase project (Postgres 15+).
- A host that serves static files over HTTPS. Any of these work: Netlify, Vercel,
  Cloudflare Pages, GitHub Pages, an Nginx box, or Supabase Storage's static hosting.
- For push: a VAPID key pair (`npx web-push generate-vapid-keys`).

HTTPS is required, not optional: service workers, geolocation and web push are all
restricted to secure origins. `localhost` is treated as secure for testing.

## 1. Database

Run the migrations in order in the Supabase SQL editor, or with the CLI.

```bash
# SQL editor: paste each file in turn
#   migrations/000_inspect_current_schema.sql   (read only)
#   migrations/001_align_core_tables.sql
#   migrations/002_report_workflow.sql
#   migrations/003_notifications_audit.sql
#   migrations/004_rls_policies.sql
#   migrations/005_storage_bucket.sql
#   migrations/006_auth_profile_and_roles.sql
#   migrations/007_report_rpcs.sql
#   migrations/008_analytics_views.sql
#   migrations/009_hardening.sql

# or with the CLI (copy migrations into supabase/migrations first)
supabase link --project-ref <your-project-ref>
supabase db push
```

Then, in development or staging only:

```bash
# seed/001_sample_data.sql
```

## 2. Auth settings

Dashboard → Authentication:

| Setting | Value | Why |
|---|---|---|
| Email provider | enabled | accounts and password reset |
| Confirm email | ON for production, OFF while testing | the app tells the user to confirm when it is on |
| Site URL | your https URL | reset links return here |
| Redirect URLs | `https://your-host/` and `http://localhost:5173/` | password recovery and email confirmation |
| Minimum password length | 8 | matches the client side hint |

Nothing else needs changing. The profile row for every new account is created by
the `on_auth_user_created` trigger, with the role forced to `citizen`.

## 3. Application configuration

Copy the template and fill it in:

```bash
cp .env.example .env.local
```

Then generate `env.js` from it (this file is served to the browser):

```bash
cat > env.js <<EOF
window.UG_ENV = {
  SUPABASE_URL: "$SUPABASE_URL",
  SUPABASE_ANON_KEY: "$SUPABASE_ANON_KEY",
  APP_PUBLIC_URL: "$APP_PUBLIC_URL",
  VAPID_PUBLIC_KEY: "$VAPID_PUBLIC_KEY",
  DEV: false
};
EOF
```

Only the **anon** key belongs here. The `service_role` key bypasses every RLS rule
and must never reach the browser.

## 4. Edge Functions

```bash
supabase functions deploy admin-users
supabase functions deploy push-dispatch
supabase functions deploy sms-fallback

supabase secrets set \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:drrmo@example.gov.ph \
  SMS_GATEWAY_URL=... \
  SMS_GATEWAY_KEY=... \
  SMS_SENDER=UniGuard
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to
Edge Functions automatically.

## 5. Upload the site

```bash
# any static host; this is the whole app
index.html  privacy.html  manifest.json  sw.js  env.js
css/  js/  fonts/  vendor/  icons-*.png
```

Two host settings matter:

- **Cache control**: serve `index.html`, `sw.js` and `env.js` with
  `Cache-Control: no-cache` so a new deploy is picked up. Everything under
  `css/`, `js/`, `fonts/` and `vendor/` can be cached for a year, because the
  service worker falls back to the network on a miss.
- **SPA fallback**: not needed. Every route is a hash-free single page and deep
  links are off by default.

## 6. Scheduled maintenance

Rate limit buckets are pruned by `public.cleanup_rate_limits()`. Call it nightly:

```sql
-- Supabase Cron / pg_cron
select cron.schedule('uniguard-cleanup', '0 4 * * *', $$select public.cleanup_rate_limits()$$);
```

## 7. Optional: database webhook for push

Instead of the app calling `push-dispatch`, wire it to the database so every
advisory triggers a push regardless of which client published it.

Dashboard → Database → Webhooks → Create:

| Field | Value |
|---|---|
| Table | `notifications` |
| Events | `insert` |
| Type | Supabase Edge Function |
| Function | `push-dispatch` |
| Method | POST |

## 8. Verification after deploy

1. `https://your-host/manifest.json` loads and Chrome shows an install prompt.
2. DevTools → Application → Service Workers shows `sw.js` activated.
3. DevTools → Application → Manifest shows the three icons with no warnings.
4. Create an account, confirm the email, sign in, and check that a resident lands
   on the resident app while an official lands on the console.
5. Turn off the network in DevTools and reload: the shell must still open and show
   cached hotlines, shelters and advisories.
6. Submit a report with the network off, then turn it back on and watch the queue
   upload from the banner.

## Rollback

Static hosting makes this trivial: redeploy the previous commit. The database is
additive, so an older client keeps working against a newer schema. If a migration
must be undone, write a new migration that reverses it; never edit an applied one.
