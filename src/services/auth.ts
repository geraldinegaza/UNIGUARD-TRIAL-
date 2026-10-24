// Authentication: sign in, create account, forgot and reset password. Role and
// barangay are always read from public.profiles after the session exists.
// Nothing here trusts client input or auth metadata for authorisation.
import { supabase } from '../lib/supabaseClient';
import { CONFIG } from '../lib/config';
import { authError, friendlyError, isNetworkError } from '../lib/util';
import { User } from '../types';
import * as repo from './repo';

// The last profile loaded on this device, so a resident who opens the app with
// no signal still reaches their cached hotlines, shelters and advisories.
const PROFILE_KEY = 'uniguard.session';
function cachedProfile(userId: string): User | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    return saved && saved.id === userId ? (saved as User) : null;
  } catch {
    return null;
  }
}

const NOT_CONFIGURED = 'UniGuard is not connected to its database. Contact your LGU administrator.';

// Load the authoritative profile row for a signed in user.
// Failures are tagged so restore() can tell "no signal" (keep the session)
// from "this account is gone" (sign out). Fix Pack F6.
async function loadProfile(userId: string, email?: string): Promise<User> {
  let res;
  try {
    res = await supabase!.from('profiles').select('*').eq('id', userId).maybeSingle();
  } catch (e) {
    throw Object.assign(new Error(friendlyError(e)), { network: isNetworkError(e) });
  }
  const { data, error } = res;
  if (error) throw Object.assign(new Error(friendlyError(error)), { network: isNetworkError(error) });
  if (!data) {
    throw Object.assign(new Error('Profile not found. Contact your LGU administrator to finish setting up your account.'), {
      code: 'PROFILE_MISSING',
    });
  }
  return repo.toUser(data, email);
}

// Where Supabase email links send people back to. A loopback address works only
// on the machine running the dev server, never from a phone (Fix Pack F1).
export function redirectUrl(): string {
  const isLoopback = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(u || '');
  const configured = CONFIG.APP_PUBLIC_URL || '';
  const here = typeof location !== 'undefined' ? location.origin : '';
  if (configured && !isLoopback(configured)) return configured;
  if (here && !isLoopback(here)) return here;
  console.warn('[UniGuard] Email links point to a loopback address and will not open on other devices. Set VITE_APP_PUBLIC_URL to the deployed https address.');
  return configured || here;
}

async function apply(user: User): Promise<User> {
  if (user.disabled) {
    try {
      await supabase!.auth.signOut();
    } catch {}
    throw new Error('This account has been disabled. Contact your LGU administrator.');
  }
  repo.setUser(user);
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  } catch {}
  return user;
}

export async function signIn(email: string, password: string): Promise<User> {
  if (!supabase) throw new Error(NOT_CONFIGURED);
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(authError(error.message, error.status));
  return apply(await loadProfile(data.user.id, data.user.email));
}

export interface SignUpInput {
  fullName: string;
  email: string;
  phone: string;
  barangay: string; // barangay name
  password: string;
}

// Self signup always produces a citizen: the database trigger forces the role.
export async function signUp(input: SignUpInput): Promise<{ user: User | null; needsConfirmation: boolean }> {
  if (!supabase) throw new Error(NOT_CONFIGURED);
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: redirectUrl(),
      // metadata is convenience only; the profile row is created by a trigger on auth.users
      data: { full_name: input.fullName, phone: input.phone, barangay: input.barangay },
    },
  });
  if (error) throw new Error(authError(error.message, error.status));

  if (data && data.session && data.user) {
    try {
      return { user: await apply(await loadProfile(data.user.id, data.user.email)), needsConfirmation: false };
    } catch {
      // fall through to the confirmation message
    }
  }
  return { user: null, needsConfirmation: true };
}

// Sends a fresh signup confirmation link. Neutral either way, like resetPassword.
export async function resendConfirmation(email: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectUrl() } });
  } catch {
    // the UI stays neutral
  }
}

// Always resolves the same way so we never reveal which emails exist.
export async function resetPassword(email: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
  } catch {
    // swallow: the UI must stay neutral
  }
}

export async function updatePassword(newPassword: string): Promise<void> {
  if (!supabase) throw new Error(NOT_CONFIGURED);
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(authError(error.message, error.status));
}

// Restores a persisted session. `onRecovery` fires when the app was opened
// from a password recovery link, so the reset form can be shown.
export async function restore(onRecovery: () => void): Promise<User | null> {
  if (!supabase) return null;
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') onRecovery();
    if (event === 'SIGNED_OUT') repo.setUser(null);
  });
  let session;
  try {
    session = (await supabase.auth.getSession()).data.session;
  } catch {
    session = null;
  }
  if (!session) return null;
  try {
    return await apply(await loadProfile(session.user.id, session.user.email));
  } catch (err: any) {
    // Only a missing profile or a disabled account ends the session. Anything
    // else (no signal, a server hiccup) keeps the person signed in on the
    // profile cached on this device; every server rule is re-checked once the
    // connection is back (revalidate).
    if (err && err.code === 'PROFILE_MISSING') {
      try {
        await supabase.auth.signOut();
      } catch {}
      return null;
    }
    if (/disabled/i.test(String(err && err.message))) return null;
    const cached = cachedProfile(session.user.id);
    if (cached) {
      repo.setUser(cached);
      return cached;
    }
    throw err;
  }
}

// Called when the connection comes back: re-reads the profile so a role
// change or a disabled account takes effect.
export async function revalidate(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  try {
    await apply(await loadProfile(data.session.user.id, data.session.user.email));
  } catch (err: any) {
    if (err && (err.code === 'PROFILE_MISSING' || /disabled/i.test(String(err.message)))) await signOut();
  }
}

export async function signOut(): Promise<void> {
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch {}
  }
  repo.setUser(null);
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {}
}
