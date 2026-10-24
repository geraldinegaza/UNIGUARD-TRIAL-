// UniGuard · Edge Function: admin-users
//
// The only way an account becomes anything other than a citizen. It runs with
// the service role, so it re-checks the caller's role itself before touching
// anything, and records an audit entry for every change.
//
// Extended (migration 038+): supports the new `dispatch_team` role.
//   · LGU creates a dispatch_units row first (create_dispatch_unit RPC), then
//     invites the unit_admin through this function with action='create' and
//     role='dispatch_team' + unitId + unitRole='unit_admin'.
//   · A unit_admin can invite members INTO THEIR OWN UNIT only, with
//     action='unit-invite'. The function re-checks they are an admin of that
//     unit. Members can be deactivated/reactivated by the admin of the same
//     unit (action='unit-set-disabled') and reactivated.
//   · Self sign up can NEVER produce dispatch_team — the auth.users trigger
//     (migration 006) forces role=citizen; the trigger plus the
//     profiles_dispatch_team_unit_check constraint enforce the rest.
//
// Super Admin (migration 043): accounts, roles, barangay assignment and the
// disabled flag are managed by the Super Admin only. A Super Admin is an
// `lgu_ldrrmc` account with `profiles.is_super_admin = true`; LDRRMO staff are
// `lgu_ldrrmc` accounts without it. The app sends role = 'super_admin' as a
// convenience; it is stored as lgu_ldrrmc + the flag, never as a new role key.
// Run migration 043 BEFORE deploying this version: it reads is_super_admin.
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

const ALL_ROLES = ['citizen', 'barangay_official', 'lgu_ldrrmc', 'dispatch_team'];

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
    .from('profiles').select('id, role, barangay_id, dispatch_unit_id, unit_role, is_super_admin, disabled').eq('id', userData.user.id).maybeSingle();

  if (!profile) {
    return json({ error: 'Your account could not be loaded' }, 403);
  }
  if (profile.disabled) return json({ error: 'This account is disabled' }, 403);

  // The one check every account-management action below relies on.
  const isSuper = profile.role === 'lgu_ldrrmc' && profile.is_super_admin === true;
  const SUPER_ONLY = 'Only the Super Admin can manage accounts';

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

  // helper: is this caller an admin of THIS unit?
  const isAdminOf = (unitId: string) =>
    profile.role === 'dispatch_team' &&
    profile.unit_role === 'unit_admin' &&
    profile.dispatch_unit_id === unitId;

  try {
    switch (action) {
      case 'create': {
        const email = String(payload.email || '').trim().toLowerCase();
        const role = String(payload.role || 'barangay_official');
        const barangayId = (payload.barangayId as string) || null;
        const unitId = (payload.unitId as string) || null;
        const unitRole = (payload.unitRole as string) || '';
        /* redirectUrl is sent by the frontend (window.location.origin) so the
           invitation email's "Accept Invitation" button points back to the
           site that sent the invite — localhost:5500 during dev, the Netlify
           URL in production. Fall back to the Supabase dashboard default if
           the frontend didn't send one. */
        const redirectUrl = (payload.redirectUrl as string) || undefined;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400);
        // Creating ANY non-citizen account is a Super Admin action. (Before
        // this check the function only verified the caller for dispatch_team,
        // so any signed-in account could invite a barangay official or an LGU
        // account.)
        if (!isSuper) return json({ error: SUPER_ONLY }, 403);
        if (!ALL_ROLES.includes(role)) return json({ error: 'Unknown role' }, 400);
        if (role !== 'dispatch_team' && !['barangay_official', 'lgu_ldrrmc'].includes(role)) {
          return json({ error: 'Self sign-up cannot produce dispatch_team or other restricted roles' }, 400);
        }
        // dispatch_team accounts (the first unit_admin and any further members
        // the Super Admin wants to seed directly) must name their unit.
        if (role === 'dispatch_team') {
          if (!unitId || !['unit_admin', 'member'].includes(unitRole)) {
            return json({ error: 'A unitId and a unitRole of unit_admin/member are required for dispatch_team' }, 400);
          }
          // the unit must exist and be active
          const { data: unitRow } = await admin.from('dispatch_units').select('id, active').eq('id', unitId).maybeSingle();
          if (!unitRow || !unitRow.active) return json({ error: 'That unit does not exist or is inactive' }, 400);
        }

        const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { role: 'citizen' }, // the trigger creates the profile; role is set below
          redirectTo: redirectUrl    // points the email's "Accept" button back to this site
        });
        if (inviteErr) return json({ error: inviteErr.message }, 400);

        if (invited?.user) {
          const patch: Record<string, unknown> = {
            id: invited.user.id, email, role,
            full_name: email.split('@')[0],
            updated_at: new Date().toISOString()
          };
          if (role === 'barangay_official' || role === 'lgu_ldrrmc') {
            patch.barangay_id = barangayId;
            if (barangayId) {
              const { data: b } = await admin.from('barangays').select('name').eq('id', barangayId).maybeSingle();
              patch.barangay = b?.name ?? '';
            }
          }
          if (role === 'dispatch_team') {
            patch.dispatch_unit_id = unitId;
            patch.unit_role = unitRole;
          }
          await admin.from('profiles').upsert(patch, { onConflict: 'id' });
        }
        await audit('user.invited', invited?.user?.id ?? null, { email, role, barangayId, unitId, unitRole });
        return json({ ok: true, email, role });
      }

      case 'unit-invite': {
        // A unit_admin invites a member into their OWN unit. The role is
        // always 'dispatch_team' with unit_role='member'; they cannot
        // promote a member to admin through this path (LGU only).
        const unitId = String(payload.unitId || '');
        const email = String(payload.email || '').trim().toLowerCase();
        const redirectUrl = (payload.redirectUrl as string) || undefined;
        if (!isAdminOf(unitId)) {
          return json({ error: 'You can only invite into your own unit' }, 403);
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400);

        const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { role: 'citizen' },
          redirectTo: redirectUrl
        });
        if (inviteErr) return json({ error: inviteErr.message }, 400);
        if (invited?.user) {
          await admin.from('profiles').upsert({
            id: invited.user.id, email, role: 'dispatch_team',
            dispatch_unit_id: unitId, unit_role: 'member',
            full_name: email.split('@')[0], updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        }
        await audit('unit.member_invited', invited?.user?.id ?? null, { email, unitId });
        return json({ ok: true, email, unitId });
      }

      case 'unit-set-disabled': {
        // A unit_admin can disable/reactivate a member of their own unit.
        // The LGU can do the same for any dispatch_team user via set-disabled
        // (already in the existing 'set-disabled' action).
        const unitId = String(payload.unitId || '');
        const userId = String(payload.userId || '');
        const disabled = payload.disabled === true;
        if (!isAdminOf(unitId)) {
          return json({ error: 'You can only manage members of your own unit' }, 403);
        }
        if (userId === profile.id) return json({ error: 'You cannot disable your own account' }, 400);

        // confirm the target is in this unit
        const { data: target } = await admin.from('profiles')
          .select('id, role, dispatch_unit_id, unit_role').eq('id', userId).maybeSingle();
        if (!target || target.role !== 'dispatch_team' || target.dispatch_unit_id !== unitId) {
          return json({ error: 'That account is not a member of your unit' }, 400);
        }
        if (target.unit_role === 'unit_admin') {
          return json({ error: 'A unit_admin can only be disabled by the LGU' }, 400);
        }

        const { data, error } = await admin.from('profiles')
          .update({ disabled, updated_at: new Date().toISOString() }).eq('id', userId).select('*').single();
        if (error) return json({ error: error.message }, 400);
        if (disabled) await admin.auth.admin.signOut(userId).catch(() => null);
        await audit(disabled ? 'unit.member_disabled' : 'unit.member_enabled', userId, { unitId });
        return json({ ok: true, profile: data });
      }

      case 'set-role': {
        const userId = String(payload.userId || '');
        const asked = String(payload.role || '');
        if (!isSuper) return json({ error: SUPER_ONLY }, 403);
        // 'super_admin' is the app's name for lgu_ldrrmc + is_super_admin
        const wantSuper = asked === 'super_admin';
        const role = wantSuper ? 'lgu_ldrrmc' : asked;
        if (!ALL_ROLES.includes(role)) return json({ error: 'Unknown role' }, 400);
        if (role === 'dispatch_team') {
          return json({ error: 'Dispatch team accounts are created through the dispatch unit workflow' }, 400);
        }
        const { data: target } = await admin.from('profiles')
          .select('id, role, is_super_admin').eq('id', userId).maybeSingle();
        if (!target) return json({ error: 'That account does not exist' }, 400);
        const wasSuper = target.role === 'lgu_ldrrmc' && target.is_super_admin === true;
        // never leave the system without a Super Admin
        if (wasSuper && !wantSuper) {
          if (userId === profile.id) return json({ error: 'You cannot remove your own Super Admin access. Ask another Super Admin to do it.' }, 400);
          const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
            .eq('role', 'lgu_ldrrmc').eq('is_super_admin', true).eq('disabled', false);
          if ((count ?? 0) <= 1) return json({ error: 'This is the last Super Admin. Grant Super Admin to another account first.' }, 400);
        }
        const { data, error } = await admin.from('profiles')
          .update({ role, is_super_admin: wantSuper, updated_at: new Date().toISOString() }).eq('id', userId).select('*').single();
        if (error) return json({ error: error.message }, 400);
        await audit('user.role_changed', userId, {
          from: wasSuper ? 'super_admin' : target.role, to: wantSuper ? 'super_admin' : role
        });
        return json({ ok: true, profile: data });
      }

      case 'set-barangay': {
        const userId = String(payload.userId || '');
        const barangayId = (payload.barangayId as string) || null;
        if (!isSuper) return json({ error: SUPER_ONLY }, 403);
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
        if (!isSuper) return json({ error: SUPER_ONLY }, 403);
        if (disabled) {
          const { data: target } = await admin.from('profiles')
            .select('role, is_super_admin').eq('id', userId).maybeSingle();
          if (target && target.role === 'lgu_ldrrmc' && target.is_super_admin === true) {
            const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
              .eq('role', 'lgu_ldrrmc').eq('is_super_admin', true).eq('disabled', false);
            if ((count ?? 0) <= 1) return json({ error: 'This is the last active Super Admin and cannot be disabled.' }, 400);
          }
        }
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
