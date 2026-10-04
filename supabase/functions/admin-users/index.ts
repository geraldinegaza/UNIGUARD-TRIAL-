// UniGuard · Edge Function: admin-users
//
// The only way an account becomes anything other than a citizen. It runs with
// the service role, so it re-checks the caller's role itself before touching
// anything, and records an audit entry for every change.
//
// Deploy:
//   supabase functions deploy admin-users --no-verify-jwt=false
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... (usually already present)
//
// Call from the app with the signed in user's access token; the platform passes
// the Authorization header through and we read the caller from it.

import { createClient } from 'npm:@supabase/supabase-js@2';

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
  if (!service) return json({ error: 'Service role key is not configured on this function' }, 500);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing bearer token' }, 401);

  // 1. identify the caller with their own token (RLS applies)
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);

  const { data: profile } = await asCaller
    .from('profiles').select('id, role, barangay_id').eq('id', userData.user.id).maybeSingle();

  if (!profile || profile.role !== 'lgu_ldrrmc') {
    return json({ error: 'Only LGU / LDRRMC administrators can manage accounts' }, 403);
  }

  // 2. act with the service role
  const admin = createClient(url, service, { auth: { persistSession: false } });

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const action = String(payload.action || '');
  const audit = async (a: string, entityId: string | null, meta: Record<string, unknown>) => {
    await admin.from('audit_log').insert({
      actor_id: profile.id, action: a, entity: 'profiles', entity_id: entityId, meta
    });
  };

  try {
    switch (action) {
      case 'create': {
        const email = String(payload.email || '').trim().toLowerCase();
        const role = String(payload.role || 'barangay_official');
        const barangayId = (payload.barangayId as string) || null;
        const fullName = String(payload.fullName || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400);
        if (!['barangay_official', 'lgu_ldrrmc'].includes(role)) {
          return json({ error: 'Only official and LGU roles can be created here' }, 400);
        }

        const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { role: 'citizen' } // the trigger creates the profile; role is set below
        });
        if (inviteErr) return json({ error: inviteErr.message }, 400);

        if (invited?.user) {
          await admin.from('profiles').upsert({
            id: invited.user.id, email, role,
            barangay_id: barangayId,
            full_name: fullName || email.split('@')[0]
          }, { onConflict: 'id' });
        }
        await audit('user.invited', invited?.user?.id ?? null, { email, role, barangayId });
        return json({ ok: true, email, role });
      }

      case 'set-role': {
        const userId = String(payload.userId || '');
        const role = String(payload.role || '');
        if (!['citizen', 'barangay_official', 'lgu_ldrrmc'].includes(role)) {
          return json({ error: 'Unknown role' }, 400);
        }
        const { data, error } = await admin.from('profiles')
          .update({ role, updated_at: new Date().toISOString() }).eq('id', userId).select('*').single();
        if (error) return json({ error: error.message }, 400);
        await audit('user.role_changed', userId, { to: role });
        return json({ ok: true, profile: data });
      }

      case 'set-barangay': {
        const userId = String(payload.userId || '');
        const barangayId = (payload.barangayId as string) || null;
        let name = '';
        if (barangayId) {
          const { data: b } = await admin.from('barangays').select('name').eq('id', barangayId).maybeSingle();
          name = b?.name ?? '';
        }
        const { data, error } = await admin.from('profiles')
          .update({ barangay_id: barangayId, barangay: name, updated_at: new Date().toISOString() })
          .eq('id', userId).select('*').single();
        if (error) return json({ error: error.message }, 400);
        await audit('user.barangay_changed', userId, { barangayId, name });
        return json({ ok: true, profile: data });
      }

      case 'set-disabled': {
        const userId = String(payload.userId || '');
        const disabled = payload.disabled === true;
        if (userId === profile.id) return json({ error: 'You cannot disable your own account' }, 400);
        const { data, error } = await admin.from('profiles')
          .update({ disabled, updated_at: new Date().toISOString() }).eq('id', userId).select('*').single();
        if (error) return json({ error: error.message }, 400);
        if (disabled) await admin.auth.admin.signOut(userId).catch(() => null);
        await audit(disabled ? 'user.disabled' : 'user.enabled', userId, { disabled });
        return json({ ok: true, profile: data });
      }

      default:
        return json({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message || 'Unexpected error' }, 500);
  }
});
