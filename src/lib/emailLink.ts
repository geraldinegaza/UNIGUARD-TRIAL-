// What a Supabase email link brought the person back with (Fix Pack F1).
// Read once, before the Supabase client consumes and clears the URL.
export type LinkReturn =
  | { kind: 'confirmed' } // a signup / email-change / invite link worked
  | { kind: 'expired'; detail: string } // the link expired or was already used
  | { kind: 'recovery' } // password reset: the reset form handles it
  | null;

function read(): LinkReturn {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(`${location.search.slice(1)}&${location.hash.replace(/^#/, '')}`);
  const type = params.get('type');
  const error = params.get('error') || params.get('error_code');
  if (type === 'recovery') return { kind: 'recovery' };
  if (error) {
    return { kind: 'expired', detail: (params.get('error_description') || error).replace(/\+/g, ' ') };
  }
  if (type === 'signup' || type === 'email' || type === 'invite' || type === 'email_change') return { kind: 'confirmed' };
  return null;
}

export const LINK_RETURN: LinkReturn = read();

// Removes the token or error from the address bar once it has been handled.
export function cleanLinkFromUrl() {
  if (!LINK_RETURN || LINK_RETURN.kind === 'recovery' || typeof history === 'undefined') return;
  try {
    history.replaceState(null, '', location.pathname);
  } catch {}
}

// An invited official, LGU or dispatch account arrives from its invitation
// email with no password yet. Remembered for this browser tab, so a reload
// before they finish still shows the Complete Your Account screen.
const INVITE_KEY = 'uniguard.invite-pending';
function readInvite(): boolean {
  if (typeof location === 'undefined') return false;
  const params = new URLSearchParams(`${location.search.slice(1)}&${location.hash.replace(/^#/, '')}`);
  try {
    if (params.get('type') === 'invite' && !params.get('error')) sessionStorage.setItem(INVITE_KEY, '1');
    return sessionStorage.getItem(INVITE_KEY) === '1';
  } catch {
    return params.get('type') === 'invite';
  }
}
export const ARRIVED_BY_INVITE: boolean = readInvite();
export function clearInvitePending() {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {}
}
