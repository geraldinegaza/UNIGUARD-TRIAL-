// UniGuard · Edge Function: push-dispatch
//
// Sends a Web Push notification to every subscribed device, optionally narrowed
// to the audience the caller names, then hands recipients without a push
// subscription to sms-fallback.
//
// Extended (migration 038+): the audience can be narrowed with
//   · barangayId  → residents + officials of that barangay (only an LGU may
//                   broadcast municipality-wide; an official may target only
//                   their own barangay; the server re-checks here)
//   · unitId       → only the dispatch team accounts of that unit
//
// Deploy:
//   supabase functions deploy push-dispatch
//   supabase secrets set VAPID_PUBLIC_KEY=*** VAPID_PRIVATE_KEY=***
//                        VAPID_SUBJECT=mailto:drrmo@example.gov.ph
//
// Only an authenticated LGU / LDRRMC account may broadcast municipality-wide.
// A barangay_official may call this with their own barangayId as the audience.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:drrmo@example.gov.ph';

  if (!service) return json({ error: 'Service role key is not configured on this function' }, 500);
  if (!vapidPublic || !vapidPrivate) return json({ error: 'VAPID keys are not configured' }, 500);

  // ---- who is calling -----------------------------------------------------
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing bearer token' }, 401);

  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);

  const { data: profile } = await asCaller
    .from('profiles').select('role, barangay_id, dispatch_unit_id').eq('id', userData.user.id).maybeSingle();

  if (!profile) return json({ error: 'Profile not found' }, 403);

  // ---- read the request ---------------------------------------------------
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty body is allowed */ }

  const title = String(body.title || 'UniGuard alert');
  const message = String(body.body || '');
  const severity = String(body.severity || 'advisory');
  const advisoryId = (body.advisoryId as string) || null;
  const area = String(body.area || 'Municipality-wide');
  const urlTarget = String(body.url || './index.html');
  const barangayId = (body.barangayId as string) || null;
  const unitId = (body.unitId as string) || null;

  // audience authorisation
  //   · LGU can broadcast municipality-wide (no audience) OR target any
  //     barangay or unit.
  //   · barangay_official can ONLY target their own barangay.
  //   · dispatch_team cannot broadcast through this function.
  if (profile.role === 'dispatch_team') {
    return json({ error: 'Dispatch teams cannot broadcast through this function' }, 403);
  }
  if (barangayId && profile.role === 'barangay_official' && profile.barangay_id !== barangayId) {
    return json({ error: 'You can only target your own barangay' }, 403);
  }
  if (!barangayId && !unitId && profile.role !== 'lgu_ldrrmc') {
    return json({ error: 'Only LGU / LDRRMC can broadcast municipality-wide' }, 403);
  }

  const payload = JSON.stringify({
    title, body: message, severity, advisory_id: advisoryId, url: urlTarget,
    tag: advisoryId || 'uniguard', renotify: severity === 'emergency'
  });

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // ---- collect recipients -------------------------------------------------
  // Build a list of user_ids the audience allows, then join with the push
  // subscriptions. This way a barangay audience never reaches another
  // barangay's devices, and a unit audience never reaches another unit.
  let targetUserIds: string[] | null = null;
  if (barangayId) {
    const { data: rows } = await admin.from('profiles')
      .select('id').eq('barangay_id', barangayId).eq('disabled', false);
    targetUserIds = (rows ?? []).map((r: { id: string }) => r.id);
  } else if (unitId) {
    const { data: rows } = await admin.from('profiles')
      .select('id').eq('dispatch_unit_id', unitId).eq('role', 'dispatch_team').eq('disabled', false);
    targetUserIds = (rows ?? []).map((r: { id: string }) => r.id);
  }

  let subsQuery = admin.from('push_subscriptions').select('id, endpoint, p256dh, auth, user_id');
  if (targetUserIds) {
    if (targetUserIds.length === 0) return json({ ok: true, sent: 0, failed: 0, removed: 0, smsQueued: 0 });
    subsQuery = subsQuery.in('user_id', targetUserIds);
  }
  const { data: subs, error } = await subsQuery;

  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const stale: string[] = [];

  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: severity === 'emergency' ? 3600 : 900, urgency: severity === 'emergency' ? 'high' : 'normal' }
      );
      sent++;
    } catch (e) {
      failed++;
      const status = (e as { statusCode?: number }).statusCode;
      // 404 and 410 mean the subscription is dead; stop trying it
      if (status === 404 || status === 410) stale.push(s.id);
    }
  }

  if (stale.length) {
    const { error: delErr } = await admin.from('push_subscriptions').delete().in('id', stale);
    if (!delErr) removed = stale.length;
  }

  // ---- SMS fallback for accounts with no push device ----------------------
  let smsQueued = 0;
  if (body.alsoSms !== false) {
    try {
      const { data: smsResult } = await admin.functions.invoke('sms-fallback', {
        body: { title, message, severity, area, advisoryId, barangayId, unitId }
      }) as { data: { queued?: number } | null };
      smsQueued = smsResult?.queued ?? 0;
    } catch {
      smsQueued = 0; // SMS is a fallback; never let it fail the alert
    }
  }

  await admin.from('audit_log').insert({
    action: 'push.dispatched',
    entity: 'advisories',
    entity_id: advisoryId,
    meta: { sent, failed, removed, smsQueued, area, severity, barangayId, unitId, by: userData.user.id }
  });

  return json({ ok: true, sent, failed, removed, smsQueued });
});
