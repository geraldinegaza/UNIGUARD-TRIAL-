# Backup and recovery

## What to back up

| Asset | Where it lives | How often |
|---|---|---|
| Database (profiles, reports, advisories, centres, hotlines, audit, assignments) | Supabase Postgres | daily, keep 30 days, monthly keep 12 |
| Report photos | Storage bucket `reports` | daily, same retention |
| Application source | your git repository | every change |
| `env.js` and Supabase secrets | your secret manager, never in git | on rotation |

## Database

Supabase takes daily automated backups on paid plans (Dashboard → Database →
Backups). For a copy you control:

```bash
# logical dump of the public schema, data included
pg_dump "$SUPABASE_DB_URL" \
  --schema=public --no-owner --no-privileges \
  --file "uniguard-$(date +%F).sql"

# schema only, for review in a pull request
pg_dump "$SUPABASE_DB_URL" --schema=public --schema-only \
  --file "uniguard-schema-$(date +%F).sql"
```

`SUPABASE_DB_URL` is under Dashboard → Project Settings → Database → Connection string (URI).
Treat it as a secret: it carries a database password.

Restore into a clean project:

```bash
psql "$TARGET_DB_URL" -f uniguard-2026-09-19.sql
```

Restoring replays the data only. Auth users live in the `auth` schema, which is
managed by Supabase; restore those through the dashboard or the admin API, then
re-link profiles by id.

## Storage

```bash
# requires the supabase CLI and the service role key
supabase storage cp -r ss:///reports ./backup/reports
```

Photos are referenced by `reports.photo_path`, so a restore is only complete when
both the database row and the object are back in place under the same path.

## Recovery targets

| Scenario | Action | Expected loss |
|---|---|---|
| Accidental row edit | restore the row from a logical dump | minutes |
| Bad migration | write a reversing migration | none |
| Project loss | restore the latest dump into a new project, re-point `SUPABASE_URL`, redeploy `env.js` | since the last dump |
| Object loss | restore the `reports` bucket from object backup | since the last object backup |
| Compromised service key | rotate it in the dashboard, redeploy functions | none |

## Rotation checklist

1. Rotate the JWT secret (Dashboard → Project Settings → API → JWT Settings). Every
   signed-in session is invalidated, so announce it first.
2. Rotate the `service_role` key and redeploy the Edge Functions.
3. Re-issue the anon key if you suspect it was scraped; regenerate `env.js` and redeploy.
4. Rotate the SMS gateway key and the VAPID pair (subscribers re-subscribe on next open).
5. Confirm `audit_log` shows no unexpected `user.role_changed` or `emergency.declared` rows.

## Restore drill

Once per quarter, restore the latest dump into a scratch project and run:

```sql
select count(*) from public.reports;
select count(*) from public.profiles;
select count(*) from public.audit_log;
select * from public.analytics_pipeline;
```

Then open the app against the scratch project with a `DEV: true` `env.js` and
check that a resident sees their own reports and an official sees their barangay.
A backup you have never restored is a guess, not a backup.
