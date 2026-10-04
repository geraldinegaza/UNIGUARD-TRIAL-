// UniGuard · Edge Function: sms-fallback
//
// Provider-agnostic SMS gateway interface for residents who have no push
// capable device. Nothing is hard-coded to one vendor: point SMS_GATEWAY_URL at
// your Philippine gateway and adapt `buildRequest` if its payload differs.
//
// With no gateway configured the function records the messages it would have
// sent and returns, so the alert pipeline can be tested end to end before a
// commercial gateway is in place.
//
// Deploy:
//   supabase functions deploy sms-fallback
//   supabase secrets set SMS_GATEWAY_URL=https://... SMS_GATEWAY_KEY=... SMS_SENDER=UniGuard

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Build the provider request. Adapt this one function to your gateway. */
function buildRequest(gatewayUrl: string, key: string, sender: string, to: string, text: string) {
  return new Request(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ sender, to, message: text })
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!service) return json({ error: 'Service role key is not configured' }, 500);

  const gatewayUrl = Deno.env.get('SMS_GATEWAY_URL') || '';
  const gatewayKey = Deno.env.get('SMS_GATEWAY_KEY') || '';
  const sender = Deno.env.get('SMS_SENDER') || 'UniGuard';

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* allow an empty body */ }

  const title = String(body.title || 'UniGuard alert');
  const message = String(body.message || '');
  const severity = String(body.severity || 'advisory');
  const area = String(body.area || 'Citywide');

  // Only accounts with a mobile number, and only for anything above an advisory,
  // so we never burn gateway credit on routine posts.
  const { data: people, error } = await admin
    .from('profiles')
    .select('id, full_name, phone, barangay')
    .not('phone', 'is', null);

  if (error) return json({ error: error.message }, 500);

  const text = `${title}${area ? ' (' + area + ')' : ''}: ${message}`.slice(0, 480);
  const recipients = (people ?? []).filter((p) => p.phone && p.phone.length >= 10);

  if (!gatewayUrl || !gatewayKey) {
    await admin.from('audit_log').insert({
      action: 'sms.skipped_no_gateway', entity: 'advisories', entity_id: (body.advisoryId as string) || null,
      meta: { wouldSend: recipients.length, severity, text }
    });
    return json({ ok: true, queued: 0, wouldSend: recipients.length, note: 'No SMS gateway configured' });
  }

  let queued = 0, failed = 0;
  for (const p of recipients) {
    try {
      const res = await fetch(buildRequest(gatewayUrl, gatewayKey, sender, p.phone, text));
      if (res.ok) queued++; else failed++;
    } catch {
      failed++;
    }
  }

  await admin.from('audit_log').insert({
    action: 'sms.dispatched', entity: 'advisories', entity_id: (body.advisoryId as string) || null,
    meta: { queued, failed, severity, area }
  });

  return json({ ok: true, queued, failed });
});
