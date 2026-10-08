// UniGuard brand tokens: the Triad Shield emblem, one palette per portal,
// and the copy each portal uses to describe what the system is doing.
//
// The three emblem pieces stand for the three parts of the system:
// left = barangay, right = LDRRMO command, keel = residents, joined by the
// beacon hub (alerts). Each portal recolors the same shape in its own palette.

export type Portal = 'auth' | 'resident' | 'barangay' | 'command';
export type EmblemVariant = 'light' | 'reverse';

/** Map a user role from the database to the portal look it gets. */
export function portalForRole(role?: string | null): Portal {
  if (!role) return 'auth';
  if (role === 'citizen') return 'resident';
  if (role === 'barangay') return 'barangay';
  return 'command'; // lgu_admin and every other LGU / LDRRMO staff role
}

export interface EmblemColors {
  left: string;
  right: string;
  keel: string;
  hub: string;
  dot: string;
}

export interface PortalTheme {
  emblem: Record<EmblemVariant, EmblemColors>;
  /** wordmark colors on light and reverse grounds */
  uni: Record<EmblemVariant, string>;
  guard: Record<EmblemVariant, string>;
  tagText: Record<EmblemVariant, string>;
  /** chip next to the wordmark */
  chip: Record<EmblemVariant, { bg: string; text: string; border: string }>;
  /** solid portal color (reverse ground) and the app surface behind it */
  solid: string;
  surface: string;
  /** full screen background used by the loading screen, matching App.tsx */
  screen: string;
  /** browser / PWA status bar color */
  themeColor: string;
  /** accent used for progress and live states */
  accent: string;
}

export const THEMES: Record<Portal, PortalTheme> = {
  auth: {
    emblem: {
      light: { left: '#0E2243', right: '#3E6496', keel: '#C8323A', hub: '#FFFFFF', dot: '#C8323A' },
      reverse: { left: '#FFFFFF', right: '#B9CDE6', keel: '#F0525A', hub: '#0E2243', dot: '#FFFFFF' },
    },
    uni: { light: '#0E2243', reverse: '#FFFFFF' },
    guard: { light: '#C8323A', reverse: '#F7A1A6' },
    tagText: { light: '#5B6B82', reverse: '#B9CDE6' },
    chip: {
      light: { bg: '#FFF7F7', text: '#C8323A', border: '#F2C2C5' },
      reverse: { bg: 'rgba(255,255,255,0.14)', text: '#FFFFFF', border: 'rgba(255,255,255,0.28)' },
    },
    solid: '#0E2243',
    surface: '#FFFFFF',
    screen: 'linear-gradient(135deg, #FAF0F2 0%, #F5E6E9 50%, #EEDCE2 100%)',
    themeColor: '#0E2243',
    accent: '#C8323A',
  },
  resident: {
    emblem: {
      light: { left: '#991B1B', right: '#C9545A', keel: '#4A0D12', hub: '#FFFFFF', dot: '#991B1B' },
      reverse: { left: '#FFFFFF', right: '#FECACA', keel: '#F58A8F', hub: '#991B1B', dot: '#FFFFFF' },
    },
    uni: { light: '#2A0A0E', reverse: '#FFFFFF' },
    guard: { light: '#991B1B', reverse: '#FECACA' },
    tagText: { light: '#8A4A50', reverse: '#FECACA' },
    chip: {
      light: { bg: '#FFF5F5', text: '#991B1B', border: '#F1DADC' },
      reverse: { bg: 'rgba(255,255,255,0.15)', text: '#FFFFFF', border: 'rgba(255,255,255,0.25)' },
    },
    solid: '#991B1B',
    surface: '#FFF5F5',
    screen: 'linear-gradient(160deg, #FFF5F5 0%, #FBE9EA 100%)',
    themeColor: '#991B1B',
    accent: '#991B1B',
  },
  barangay: {
    emblem: {
      light: { left: '#052659', right: '#5482B4', keel: '#1E4E8C', hub: '#FFFFFF', dot: '#5482B4' },
      reverse: { left: '#FFFFFF', right: '#C2E8FF', keel: '#5482B4', hub: '#052659', dot: '#FFFFFF' },
    },
    uni: { light: '#011025', reverse: '#FFFFFF' },
    guard: { light: '#5482B4', reverse: '#C2E8FF' },
    tagText: { light: '#5482B4', reverse: '#C2E8FF' },
    chip: {
      light: { bg: '#DDF1FF', text: '#052659', border: '#B9CDE3' },
      reverse: { bg: 'rgba(194,232,255,0.16)', text: '#C2E8FF', border: 'rgba(194,232,255,0.3)' },
    },
    solid: '#052659',
    surface: '#F4F7FB',
    screen: 'linear-gradient(135deg, #052659 0%, #031C42 55%, #011025 100%)',
    themeColor: '#052659',
    accent: '#5482B4',
  },
  command: {
    emblem: {
      light: { left: '#18181B', right: '#52525B', keel: '#A1A1AA', hub: '#FFFFFF', dot: '#18181B' },
      reverse: { left: '#FFFFFF', right: '#D4D4D8', keel: '#71717A', hub: '#18181B', dot: '#FFFFFF' },
    },
    uni: { light: '#18181B', reverse: '#FFFFFF' },
    guard: { light: '#71717A', reverse: '#A1A1AA' },
    tagText: { light: '#71717A', reverse: '#A1A1AA' },
    chip: {
      light: { bg: '#F4F4F5', text: '#52525B', border: '#E4E4E7' },
      reverse: { bg: 'rgba(255,255,255,0.1)', text: '#E4E4E7', border: 'rgba(255,255,255,0.2)' },
    },
    solid: '#18181B',
    surface: '#F4F4F6',
    screen: 'linear-gradient(135deg, #F8FAFC 0%, #F1F6FB 50%, #E6EFF8 100%)',
    themeColor: '#18181B',
    accent: '#18181B',
  },
};

/** Which emblem/wordmark variant reads on the portal's loading screen. */
export const SCREEN_VARIANT: Record<Portal, EmblemVariant> = {
  auth: 'light',
  resident: 'light',
  barangay: 'reverse',
  command: 'light',
};

export interface BrandContext {
  /** barangay name for resident and barangay accounts, e.g. "Poblacion" */
  barangayName?: string | null;
  /** count used by sync / publish processes */
  count?: number;
}

export interface PortalIdentity {
  /** short name shown in tags and footers */
  name: string;
  /** chip next to the wordmark in headers */
  chip: (ctx: BrandContext) => string;
  /** one line under the wordmark (lockups, sidebars, mobile header) */
  descriptor: (ctx: BrandContext) => string;
  /** tagline used in stacked lockups and the PWA splash */
  tagline: string;
}

const brgy = (ctx: BrandContext) => (ctx.barangayName ? `Brgy. ${ctx.barangayName}` : 'your barangay');

export const IDENTITY: Record<Portal, PortalIdentity> = {
  auth: {
    name: 'UniGuard',
    chip: () => 'Lingayen',
    descriptor: () => 'Unified DRRM System · Lingayen',
    tagline: 'Unified DRRM System · Lingayen',
  },
  resident: {
    name: 'Resident',
    chip: (ctx) => (ctx.barangayName ? `Brgy. ${ctx.barangayName}` : 'Lingayen'),
    descriptor: () => 'Resident · Lingayen',
    tagline: 'Resident · Lingayen',
  },
  barangay: {
    name: 'Barangay',
    chip: (ctx) => (ctx.barangayName ? `Brgy. ${ctx.barangayName}` : 'Barangay'),
    descriptor: () => 'BDRRMC Command Post',
    tagline: 'Barangay Command Post',
  },
  command: {
    name: 'LDRRMO',
    chip: () => 'LDRRMO',
    descriptor: () => 'Operations Hub · Lingayen',
    tagline: 'LDRRMO Command Center',
  },
};

/** Everything the system can be busy doing, so each portal can say it in its own words. */
export type BrandProcess =
  | 'session'    // restoring the saved session before the portal is known
  | 'signin'     // signing in from the auth portal
  | 'workspace'  // first load of a portal's data after sign in
  | 'refresh'    // reloading the current view
  | 'sync'       // sending reports queued while offline
  | 'submit'     // submitting a hazard / incident report
  | 'publish'    // publishing an advisory or alert
  | 'export'     // exporting reports or analytics
  | 'offline'    // working offline
  | 'signout';   // signing out

export interface ProcessCopy {
  title: string;
  detail: string;
  /** three steps, one for each emblem piece (left, right, keel) */
  steps: [string, string, string];
}

type CopyFn = (ctx: BrandContext) => ProcessCopy;

const plural = (n: number | undefined, one: string, many: string) =>
  `${n ?? 0} ${(n ?? 0) === 1 ? one : many}`;

const COPY: Record<Portal, Partial<Record<BrandProcess, CopyFn>>> = {
  auth: {
    session: () => ({ title: 'Securing your session', detail: 'Checking your UniGuard account on this device', steps: ['Account', 'Role', 'Portal'] }),
    signin: () => ({ title: 'Signing you in', detail: 'Verifying your account and opening your portal', steps: ['Verify', 'Role', 'Portal'] }),
    offline: () => ({ title: 'You are offline', detail: 'Sign in again once this device is back online', steps: ['Account', 'Role', 'Portal'] }),
  },
  resident: {
    workspace: (c) => ({ title: 'Preparing your safety feed', detail: `Loading advisories, open shelters and hazard reports for ${brgy(c)}`, steps: ['Advisories', 'Shelters', 'Hazard map'] }),
    refresh: (c) => ({ title: 'Checking for updates', detail: `Looking for new advisories in ${brgy(c)}`, steps: ['Advisories', 'Shelters', 'Reports'] }),
    sync: (c) => ({ title: 'Sending your saved reports', detail: `${plural(c.count, 'report', 'reports')} filed while offline, now on the way`, steps: ['Queued', 'Sending', 'Received'] }),
    submit: () => ({ title: 'Sending your hazard report', detail: 'Attaching your location and photo, then notifying your barangay', steps: ['Location', 'Photo', 'Barangay'] }),
    offline: () => ({ title: 'You are offline', detail: 'Hotlines and shelters still work. New reports are saved and sent when signal returns', steps: ['Saved', 'Waiting', 'Send'] }),
    signout: () => ({ title: 'Signing you out', detail: 'Clearing your session from this device', steps: ['Session', 'Cache', 'Done'] }),
  },
  barangay: {
    workspace: (c) => ({ title: 'Opening the command post', detail: `Syncing the incident queue, responders and evacuation centers of ${brgy(c)}`, steps: ['Queue', 'Responders', 'Shelters'] }),
    refresh: (c) => ({ title: 'Refreshing the queue', detail: `Pulling the latest reports filed in ${brgy(c)}`, steps: ['Reports', 'Corroboration', 'Status'] }),
    sync: (c) => ({ title: 'Syncing field updates', detail: `${plural(c.count, 'update', 'updates')} recorded offline, now reaching the LDRRMO`, steps: ['Queued', 'Uploading', 'Confirmed'] }),
    submit: (c) => ({ title: 'Logging the incident', detail: `Recording it for ${brgy(c)} and alerting the LDRRMO`, steps: ['Details', 'Location', 'LDRRMO'] }),
    publish: (c) => ({ title: `Broadcasting to ${brgy(c)}`, detail: 'Sending the advisory to residents of the barangay', steps: ['Drafted', 'Sending', 'Delivered'] }),
    export: () => ({ title: 'Preparing the barangay report', detail: 'Compiling incidents and responses into a file', steps: ['Collect', 'Format', 'Download'] }),
    offline: () => ({ title: 'Command post offline', detail: 'Updates are kept on this device and synced when the connection returns', steps: ['Saved', 'Waiting', 'Sync'] }),
    signout: () => ({ title: 'Signing you out', detail: 'Closing the command post session', steps: ['Session', 'Cache', 'Done'] }),
  },
  command: {
    workspace: () => ({ title: 'Connecting to operations', detail: 'Pulling live reports, shelters and advisories from every barangay of Lingayen', steps: ['Feed', 'Barangays', 'Analytics'] }),
    refresh: () => ({ title: 'Refreshing operations data', detail: 'Updating the municipal incident feed', steps: ['Feed', 'Barangays', 'Analytics'] }),
    sync: (c) => ({ title: 'Reconciling offline changes', detail: `${plural(c.count, 'change', 'changes')} made offline, now applied to the municipal record`, steps: ['Queued', 'Applying', 'Recorded'] }),
    submit: () => ({ title: 'Recording the incident', detail: 'Adding it to the municipal incident feed', steps: ['Details', 'Location', 'Feed'] }),
    publish: (c) => ({ title: 'Broadcasting advisory', detail: c.count ? `Notifying residents and officials across ${plural(c.count, 'barangay', 'barangays')}` : 'Notifying residents and barangay officials', steps: ['Drafted', 'Sending', 'Delivered'] }),
    export: () => ({ title: 'Generating the situation report', detail: 'Compiling incidents, shelters and analytics into a file', steps: ['Collect', 'Format', 'Download'] }),
    offline: () => ({ title: 'Operations hub offline', detail: 'Showing the last synced data. Changes sync when the connection returns', steps: ['Cached', 'Waiting', 'Sync'] }),
    signout: () => ({ title: 'Signing you out', detail: 'Closing the operations session', steps: ['Session', 'Cache', 'Done'] }),
  },
};

const FALLBACK: CopyFn = () => ({ title: 'Working on it', detail: 'UniGuard is loading your data', steps: ['Prepare', 'Load', 'Ready'] });

export function processCopy(portal: Portal, process: BrandProcess, ctx: BrandContext = {}): ProcessCopy {
  const fn = COPY[portal][process] ?? COPY.auth[process] ?? FALLBACK;
  return fn(ctx);
}
