// Authentication: sign in, create account, forgot and reset password. Role and
// barangay are always read from public.profiles after the session exists.
// Nothing here trusts client input or auth metadata for authorisation.
import { supabase } from '../lib/supabaseClient';
import { CONFIG } from '../lib/config';
import { authError } from '../lib/util';
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
async function loadProfile(userId: string, email?: string): Promise<User> {
  const { data, error } = await supabase!.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error('Could not read your profile. ' + error.message);
  if (!data) throw new Error('Profile not found. Contact your LGU administrator to finish setting up your account.');
  return repo.toUser(data, email);
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
      emailRedirectTo: CONFIG.APP_PUBLIC_URL,
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

// Always resolves the same way so we never reveal which emails exist.
export async function resetPassword(email: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: CONFIG.APP_PUBLIC_URL });
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
  const { data } = await supabase.auth.getSession();
  if (!data || !data.session) return null;
  try {
    return await apply(await loadProfile(data.session.user.id, data.session.user.email));
  } catch (err: any) {
    // Offline: the session is still valid locally, so keep the resident signed
    // in on the cached profile. Every server rule is re-checked once back online.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const cached = cachedProfile(data.session.user.id);
    if (cached && (offline || /fetch|network/i.test(String(err && err.message)))) {
      repo.setUser(cached);
      return cached;
    }
    try {
      await supabase.auth.signOut();
    } catch {}
    return null;
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
