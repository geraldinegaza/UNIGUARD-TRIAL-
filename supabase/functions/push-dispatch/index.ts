// UniGuard · Edge Function: push-dispatch
//
// Sends a Web Push notification to every subscribed device, optionally narrowed
// to the audience the caller names, then hands recipients without a push
// subscription to sms-fallback.
//
// Deploy:
//   supabase functions deploy push-dispatch
//   supabase secrets set VAPID_PUBLIC_KEY=*** VAPID_PRIVATE_KEY=***
//                        VAPID_SUBJECT=mailto:drrmo@example.gov.ph
//
// Only an authenticated LGU / LDRRMC account may call it. Without that check any
// signed in user could ring every device in the city.

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
    .from('profiles').select('role').eq('id', userData.user.id).maybeSingle();

  if (!profile || profile.role !== 'lgu_ldrrmc') {
    return json({ error: 'Only LGU / LDRRMC can dispatch an alert' }, 403);
  }

  // ---- read the request ---------------------------------------------------
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty body is allowed */ }

  const title = String(body.title || 'UniGuard alert');
  const message = String(body.body || '');
  const severity = String(body.severity || 'advisory');
  const advisoryId = (body.advisoryId as string) || null;
  const area = String(body.area || 'Citywide');
  const urlTarget = String(body.url || './index.html');

  const payload = JSON.stringify({
    title, body: message, severity, advisory_id: advisoryId, url: urlTarget,
    tag: advisoryId || 'uniguard', renotify: severity === 'emergency'
  });

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // ---- send ---------------------------------------------------------------
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_id');

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
        body: { title, message, severity, area, advisoryId }
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
    meta: { sent, failed, removed, smsQueued, area, severity, by: userData.user.id }
  });

  return json({ ok: true, sent, failed, removed, smsQueued });
});
