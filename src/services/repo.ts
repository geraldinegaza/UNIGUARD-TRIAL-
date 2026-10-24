// UniGuard data repository.
//
// Every screen reads the store exposed here; this module is the only thing that
// writes to it. The store is hydrated from Postgres and kept live with Realtime.
// When the server is unreachable it serves the last cached snapshot so the
// interface stays usable offline. Every privileged action is authorised again
// by RLS or a server function, never by hiding a button.
import { supabase } from '../lib/supabaseClient';
import { CONFIG } from '../lib/config';
import { BARANGAY_NAMES, CENTER, PLACE, barangaySlug, hasCoords } from '../lib/geo';
import { classifyHazard, hazardDisplayLabel } from '../lib/hazards';
import { friendlyError, isNetworkError } from '../lib/util';
import * as offline from './offline';
import {
  Advisory,
  AdvisorySeverity,
  AdvisoryType,
  AppNotification,
  Barangay,
  Beneficiary,
  EmergencyHotline,
  EvacuationCenter,
  EvacuationStatus,
  Faq,
  GuidePhase,
  IncidentReport,
  IncidentStatus,
  OthersReviewRow,
  PreparednessGuide,
  QueuedReport,
  ReliefDistribution,
  ReportSeverity,
  Responder,
  RoadCondition,
  ChangeRequest,
  DispatchUnit,
  Dispatch,
  UnitPersonnel,
  UnitEquipment,
  UnitRequest,
  HospitalCapacity,
  UnitType,
  InventoryItem,
  DistributionLogEntry,
  DamageAssessment,
  SituationReport,
  OverdueReport,
  ShelterTrendPoint,
  RoadStatus,
  RoadWork,
  SosEntry,
  StatusHistoryEntry,
  SystemAuditLog,
  User,
  UserRole,
} from '../types';

type Row = Record<string, any>;

export interface RepoState {
  source: 'supabase' | 'offline' | 'unconfigured';
  loading: boolean;
  error: string | null;
  lastSync: string | null;
  online: boolean;
  queue: QueuedReport[];
  user: User | null;
  barangays: Barangay[];
  reports: IncidentReport[];
  advisories: Advisory[];
  centers: EvacuationCenter[];
  hotlines: EmergencyHotline[];
  notifications: AppNotification[];
  relief: ReliefDistribution[];
  beneficiaries: Beneficiary[];
  guides: PreparednessGuide[];
  faqs: Faq[];
  roadWork: RoadWork[];
  roadStatus: RoadStatus[];
  subscribedDevices: number;
  // loaded on demand by the console screens that need them
  sosLog: SosEntry[];
  othersReview: OthersReviewRow[];
  users: User[];
  audit: SystemAuditLog[];
  responders: Responder[];
  changeRequests: ChangeRequest[];
  // dispatch units (LGU / Super Admin see every unit; a dispatch account its own)
  units: DispatchUnit[];
  unitMembers: User[];
  unitRequests: UnitRequest[];
  myUnit: DispatchUnit | null;
  dispatches: Dispatch[];
  personnel: UnitPersonnel[];
  equipment: UnitEquipment[];
  capacity: HospitalCapacity | null;
  // Phase 3 operations data, loaded by the screens that use it
  inventory: InventoryItem[];
  distributionLog: DistributionLogEntry[];
  assessments: DamageAssessment[];
  sitreps: SituationReport[];
  overdue: OverdueReport[];
  shelterTrend: ShelterTrendPoint[];
  // the MDRRMO's name and hotline from the Super Admin's settings (org_profile)
  org: OrgProfile;
}

export interface OrgProfile {
  municipality: string;
  province: string;
  office: string;
  contact: string;
  email: string;
}
const DEFAULT_ORG: OrgProfile = {
  municipality: 'Lingayen',
  province: 'Pangasinan',
  office: 'Municipal Disaster Risk Reduction and Management Office',
  contact: '(075) 632-2222',
  email: '',
};

const fallbackBarangays = (): Barangay[] =>
  BARANGAY_NAMES.map((name) => ({ id: barangaySlug(name), uuid: null, name, city: PLACE.town }));

let state: RepoState = {
  source: supabase ? 'offline' : 'unconfigured',
  loading: false,
  error: null,
  lastSync: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  queue: [],
  user: null,
  barangays: fallbackBarangays(),
  reports: [],
  advisories: [],
  centers: [],
  hotlines: [],
  notifications: [],
  relief: [],
  beneficiaries: [],
  guides: [],
  faqs: [],
  roadWork: [],
  roadStatus: [],
  subscribedDevices: 0,
  sosLog: [],
  othersReview: [],
  users: [],
  audit: [],
  responders: [],
  changeRequests: [],
  units: [],
  unitMembers: [],
  unitRequests: [],
  myUnit: null,
  dispatches: [],
  personnel: [],
  equipment: [],
  capacity: null,
  inventory: [],
  distributionLog: [],
  assessments: [],
  sitreps: [],
  overdue: [],
  shelterTrend: [],
  org: DEFAULT_ORG,
};

const listeners = new Set<() => void>();
function set(patch: Partial<RepoState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export const getState = () => state;
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const isOnline = () => !!supabase && state.online;

function client() {
  if (!supabase) throw new Error('UniGuard is not connected to a Supabase project. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  return supabase;
}

// Every failed request surfaces as a plain sentence (Fix Pack F5); the raw
// text goes to the console. A network failure keeps a flag so callers can
// queue the work instead of dropping it.
function fail(error: { message?: string } | null): never {
  const e = new Error(friendlyError(error || 'Request failed')) as Error & { network?: boolean };
  e.network = isNetworkError(error);
  throw e;
}

/* ------------------------------------------------------- role adaptation */
const ROLE_FROM_DB: Record<string, UserRole> = {
  citizen: 'citizen',
  barangay_official: 'barangay',
  lgu_ldrrmc: 'lgu_admin',
  dispatch_team: 'dispatch',
};
const ROLE_TO_DB: Record<UserRole, string> = {
  citizen: 'citizen',
  barangay: 'barangay_official',
  lgu_admin: 'lgu_ldrrmc',
  dispatch: 'dispatch_team',
  // the Super Admin is lgu_ldrrmc + profiles.is_super_admin; admin-users
  // accepts 'super_admin' as its name for that combination
  super_admin: 'super_admin',
};
export const roleToDb = (role: UserRole) => ROLE_TO_DB[role];

/* ------------------------------------------------------- shape adaptation */
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

export function toUser(p: Row, email?: string): User {
  return {
    id: p.id,
    full_name: p.full_name || (email ? email.split('@')[0] : ''),
    email: p.email || email || '',
    phone: p.phone || '',
    // the Super Admin is an LGU account carrying the is_super_admin flag
    role: p.role === 'lgu_ldrrmc' && p.is_super_admin ? 'super_admin' : ROLE_FROM_DB[p.role] || 'citizen',
    barangay_id: p.barangay ? barangaySlug(p.barangay) : undefined,
    barangay_name: p.barangay || '',
    barangay_uuid: p.barangay_id || null,
    disabled: !!p.disabled,
    dispatch_unit_id: p.dispatch_unit_id || null,
    unit_role: p.unit_role || '',
    created_at: p.created_at || new Date().toISOString(),
  };
}

function toReport(r: Row, units = 0): IncidentReport {
  const located = hasCoords(r.lat, r.lng);
  const severity: ReportSeverity = ['advisory', 'warning', 'emergency'].includes(r.severity) ? r.severity : 'advisory';
  return {
    id: r.id,
    code: r.code || String(r.id).slice(0, 8),
    reporter_id: r.reporter_id || null,
    // reports_feed carries is_mine and no reporter id; the fallback covers older rows
    is_mine: typeof r.is_mine === 'boolean' ? r.is_mine : !!state.user && r.reporter_id === state.user.id,
    barangay_id: barangaySlug(r.barangay || ''),
    barangay_name: r.barangay || '',
    hazard_type: hazardDisplayLabel(r.hazard_type, r.hazard_other_text),
    hazard_key: classifyHazard(r.hazard_type).key,
    hazard_other_text: r.hazard_other_text || '',
    description: r.description || '',
    photo_path: r.photo_path || null,
    has_location: located,
    latitude: located ? r.lat : CENTER[0],
    longitude: located ? r.lng : CENTER[1],
    status: (r.status === 'reported' ? 'unverified' : r.status || 'unverified') as IncidentStatus,
    severity,
    urgency: r.urgency || severity,
    corroboration_count: typeof r.corroborations === 'number' ? r.corroborations : Number(r.corroborations) || 0,
    assigned_units: units,
    created_at: r.created_at,
    updated_at: r.updated_at || r.created_at,
    resolved_at: r.resolved_at || undefined,
    is_offline_synced: true,
    verified_by_role: r.verified_by_role || null,
    verified_by_name: r.verified_by_name || null,
    is_stale: !!r.is_stale,
    is_severity_bypass: !!r.is_severity_bypass,
    escalates_to_lgu: !!r.escalates_to_lgu,
  };
}

const SEVERITY_FROM_DB: Record<string, AdvisorySeverity> = {
  emergency: 'critical',
  warning: 'high',
  advisory: 'medium',
  prepared: 'low',
};
const SEVERITY_TO_DB: Record<AdvisorySeverity, string> = {
  critical: 'emergency',
  high: 'warning',
  medium: 'advisory',
  low: 'prepared',
};

function toAdvisory(a: Row): Advisory {
  const citywide = a.citywide !== false;
  return {
    id: a.id,
    author_id: a.author_id || null,
    title: a.title || '',
    content: a.body || '',
    type: a.kind === 'preparedness' ? 'preparedness' : 'emergency_alert',
    severity: SEVERITY_FROM_DB[a.severity] || 'medium',
    affected_area: a.affected_area || PLACE.areaAll,
    target_barangay_id: citywide ? null : barangaySlug(a.affected_area || ''),
    expires_at: a.expires_at || null,
    created_at: a.published_at || a.created_at,
  };
}

function toCenter(c: Row): EvacuationCenter {
  const located = hasCoords(c.lat, c.lng);
  return {
    id: c.id,
    barangay_id: barangaySlug(c.barangay || ''),
    barangay_name: c.barangay || '',
    name: c.name || '',
    address: c.address || '',
    capacity: c.capacity || 0,
    current_occupancy: c.occupancy || 0,
    status: (c.status || 'open') as EvacuationStatus,
    has_location: located,
    latitude: located ? c.lat : CENTER[0],
    longitude: located ? c.lng : CENTER[1],
    notes: c.note || '',
    facilities: Array.isArray(c.facilities)
      ? c.facilities
      : typeof c.facilities === 'string' && c.facilities.trim()
      ? c.facilities.split(',').map((f: string) => f.trim()).filter(Boolean)
      : [],
    contact_person: c.contact_person || '',
    contact_phone: c.contact_phone || '',
  };
}

const toHotline = (h: Row): EmergencyHotline => ({
  id: h.id,
  agency_name: h.agency_name || '',
  contact_number: h.contact_number || '',
  scope: h.scope || PLACE.areaAll,
  description: h.description || '',
  active: h.active !== false,
});

const toNotification = (n: Row): AppNotification => ({
  id: n.id,
  title: n.title || '',
  body: n.body || '',
  tone: n.tone || 'advisory',
  type: n.type || '',
  created_at: n.created_at,
  unread: !n.read_at,
  report_id: n.report_id,
  advisory_id: n.advisory_id,
  road_work_id: n.road_work_id,
  sos_id: n.sos_id,
  relief_id: n.relief_id,
});

const jsonList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = JSON.parse((v as string) || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const toRelief = (r: Row): ReliefDistribution => ({
  id: r.id,
  barangay: r.barangay || '',
  title: r.title || '',
  location_name: r.location_name || '',
  address: r.address || '',
  lat: num(r.lat),
  lng: num(r.lng),
  distribution_at: r.distribution_at || null,
  contact_person: r.contact_person || '',
  contact_phone: r.contact_phone || '',
  eligibility: jsonList(r.eligibility),
  required_docs: jsonList(r.required_docs),
  note: r.note || '',
  active: r.active !== false,
});

const toBeneficiary = (b: Row): Beneficiary => ({
  id: b.id,
  barangay: b.barangay || '',
  beneficiary_name: b.beneficiary_name || '',
  claimant_name: b.claimant_name || '',
  claimant_id: b.claimant_id || '',
  category: b.category || '',
  valid_until: b.valid_until || null,
  active: b.active !== false,
});

const PHASES: GuidePhase[] = ['before', 'during', 'after'];
const PHASE_COLUMN: Record<GuidePhase, string> = { before: 'body_before', during: 'body_during', after: 'body_after' };

// One database guide becomes one entry per phase that has text. A legacy
// single-phase row (phase before/during/after, text in body) stays one entry.
const toGuides = (g: Row): PreparednessGuide[] => {
  const base = {
    guide_id: g.id,
    hazard_type: g.hazard_type || '',
    title: g.title || '',
    summary: g.summary || '',
    sort_order: g.sort_order || 0,
    active: g.active !== false,
  };
  if (g.phase && g.phase !== 'all') {
    return [{ ...base, id: g.id, phase: g.phase as GuidePhase, body: g.body || '' }];
  }
  return PHASES.filter((ph) => (g[PHASE_COLUMN[ph]] || '').trim()).map((ph) => ({
    ...base,
    id: `${g.id}:${ph}`,
    phase: ph,
    body: g[PHASE_COLUMN[ph]],
  }));
};

const toFaq = (f: Row): Faq => ({
  id: f.id,
  category: f.category || 'General',
  question: f.question || '',
  answer: f.answer || '',
  sort_order: f.sort_order || 0,
  active: f.active !== false,
});

const toRoadWork = (r: Row): RoadWork => ({
  id: r.id,
  title: r.title || '',
  description: r.description || '',
  barangay: r.barangay || '',
  road_name: r.road_name || '',
  address: r.address || '',
  lat: num(r.lat),
  lng: num(r.lng),
  expected_start: r.expected_start || null,
  expected_end: r.expected_end || null,
  citywide: r.citywide === true,
  status: r.status || 'active',
  created_at: r.created_at,
});

const toRoadStatus = (r: Row): RoadStatus => ({
  id: r.id,
  road_name: r.road_name || '',
  barangay: r.barangay || '',
  // 'caution' was renamed 'one_lane' by the road status migration
  status: (r.status === 'caution' ? 'one_lane' : r.status || 'passable') as RoadCondition,
  note: r.note || '',
  lat: num(r.lat),
  lng: num(r.lng),
  updated_at: r.updated_at || null,
  segment_from: r.segment_from || '',
  segment_to: r.segment_to || '',
  cause: r.cause || '',
  severity: r.severity || '',
  started_at: r.started_at || null,
  estimated_reopen: r.estimated_reopen || null,
  updater_name: r.updater_name || '',
});

/* ------------------------------------------------------------- hydration */
type CachedData = Pick<RepoState, 'reports' | 'advisories' | 'centers' | 'hotlines' | 'notifications' | 'relief' | 'guides' | 'faqs' | 'roadWork' | 'roadStatus' | 'barangays'>;

async function hydrateFromCache(): Promise<boolean> {
  const snap = await offline.readSnapshot<CachedData>();
  if (!snap) return false;
  set({ ...snap.data, lastSync: snap.at });
  return true;
}

async function attachPhotoUrls(reports: IncidentReport[]): Promise<IncidentReport[]> {
  const paths = reports.filter((r) => r.photo_path).map((r) => r.photo_path as string);
  if (!paths.length || !supabase) return reports;
  const { data, error } = await supabase.storage.from('reports').createSignedUrls(paths, 60 * 60);
  if (error || !data) return reports;
  const byPath: Record<string, string> = {};
  data.forEach((d) => {
    if (d.path && d.signedUrl) byPath[d.path] = d.signedUrl;
  });
  return reports.map((r) => (r.photo_path && byPath[r.photo_path] ? { ...r, photo_url: byPath[r.photo_path] } : r));
}

// Keeps what an offline resident needs on this device: hotlines, shelters,
// advisories, guides and the most recent reports.
export function saveOffline(): Promise<void> {
  const s = state;
  return offline.storeSnapshot<CachedData>({
    reports: s.reports.slice(0, 40).map((r) => ({ ...r, photo_url: undefined })),
    advisories: s.advisories.slice(0, 20),
    centers: s.centers,
    hotlines: s.hotlines,
    notifications: s.notifications,
    relief: s.relief,
    guides: s.guides,
    faqs: s.faqs,
    roadWork: s.roadWork,
    roadStatus: s.roadStatus,
    barangays: s.barangays,
  });
}

let loadSeq = 0;
export async function loadAll(): Promise<void> {
  if (!supabase) {
    set({ source: 'unconfigured', loading: false });
    return;
  }
  const seq = ++loadSeq;
  set({ loading: true, error: null });
  const c = supabase;

  try {
    const [reports, advisories, centers, hotlines, notifications, subscriptions, assignments, relief, beneficiaries, guides, faqs, roadWork, roadStatus, barangays] =
      await Promise.all([
        c.from('reports_feed').select('*').order('created_at', { ascending: false }).limit(300),
        c.from('advisories').select('*').order('published_at', { ascending: false }).limit(100),
        c.from('evacuation_centers').select('*').order('name'),
        c.from('emergency_hotlines').select('*').order('agency_name'),
        c.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
        c.from('push_subscriptions').select('id', { count: 'exact', head: true }),
        c.from('report_assignments').select('report_id').is('released_at', null),
        c.from('relief_distributions').select('*').order('distribution_at', { ascending: false }).limit(100),
        c.from('authorized_beneficiaries').select('*').order('barangay, beneficiary_name').limit(800),
        c.from('preparedness_guides').select('*').order('hazard_type, phase, sort_order').limit(300),
        c.from('faqs').select('*').order('sort_order, created_at').limit(100),
        c.from('road_work_posts').select('*').order('created_at', { ascending: false }).limit(60),
        c.from('road_status').select('*').order('updated_at', { ascending: false }).limit(120),
        c.from('barangays').select('id,name,city').eq('active', true).order('name'),
      ]);

    if (reports.error) throw reports.error;
    if (seq !== loadSeq) return;

    const unitCount: Record<string, number> = {};
    if (!assignments.error) {
      (assignments.data || []).forEach((a: Row) => {
        unitCount[a.report_id] = (unitCount[a.report_id] || 0) + 1;
      });
    }

    const patch: Partial<RepoState> = {
      reports: await attachPhotoUrls((reports.data || []).map((r: Row) => toReport(r, unitCount[r.id] || 0))),
      subscribedDevices: subscriptions.error ? 0 : subscriptions.count || 0,
      source: 'supabase',
      loading: false,
      lastSync: new Date().toISOString(),
    };
    // Each remaining table is best-effort: a failed read keeps what the store already has.
    if (!advisories.error) patch.advisories = (advisories.data || []).map(toAdvisory);
    if (!centers.error) patch.centers = (centers.data || []).map(toCenter);
    if (!hotlines.error) patch.hotlines = (hotlines.data || []).map(toHotline);
    if (!notifications.error) patch.notifications = (notifications.data || []).map(toNotification);
    if (!relief.error) patch.relief = (relief.data || []).map(toRelief);
    if (!beneficiaries.error) patch.beneficiaries = (beneficiaries.data || []).map(toBeneficiary);
    if (!guides.error) patch.guides = (guides.data || []).flatMap(toGuides);
    if (!faqs.error) patch.faqs = (faqs.data || []).map(toFaq);
    if (!roadWork.error) patch.roadWork = (roadWork.data || []).map(toRoadWork);
    if (!roadStatus.error) patch.roadStatus = (roadStatus.data || []).map(toRoadStatus);
    if (!barangays.error && barangays.data && barangays.data.length) {
      patch.barangays = barangays.data.map((b: Row) => ({
        id: barangaySlug(b.name),
        uuid: b.id,
        name: b.name,
        city: b.city || PLACE.town,
      }));
    }
    if (seq !== loadSeq) return;
    set(patch);

    saveOffline();
    subscribeRealtime();
  } catch (e: any) {
    if (seq !== loadSeq) return;
    set({ source: 'offline', error: (e && e.message) || 'Could not reach the server', loading: false });
    await hydrateFromCache();
  }
}

// The barangay list is readable before sign in, so the sign up form can offer it.
export async function loadBarangays(): Promise<void> {
  if (!supabase) return;
  loadOrgProfile().catch(() => {});
  const { data, error } = await supabase.from('barangays').select('id,name,city').eq('active', true).order('name');
  if (error || !data || !data.length) return;
  set({
    barangays: data.map((b: Row) => ({ id: barangaySlug(b.name), uuid: b.id, name: b.name, city: b.city || PLACE.town })),
  });
}

/* ------------------------------------------------------------- realtime */
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
const REALTIME_TABLES = [
  'reports', 'advisories', 'notifications', 'evacuation_centers', 'emergency_hotlines', 'relief_distributions',
  'authorized_beneficiaries', 'preparedness_guides', 'faqs', 'road_work_posts', 'road_status', 'sos_log',
];

function subscribeRealtime() {
  if (!supabase || channel) return;
  try {
    let ch = supabase.channel('uniguard');
    REALTIME_TABLES.forEach((table) => {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        // a burst of row changes becomes a single reload
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          loadAll();
          if (table === 'sos_log' && state.user && state.user.role !== 'citizen') loadSos();
        }, 400);
      });
    });
    channel = ch.subscribe();
  } catch {
    // realtime is an enhancement, never a blocker
  }
}

function unsubscribeRealtime() {
  if (supabase && channel) {
    try {
      supabase.removeChannel(channel);
    } catch {}
  }
  channel = null;
}

/* ----------------------------------------------------------------- session */
export function setUser(user: User | null) {
  set({ user });
  // the waiting list shows only this account's saved reports and SOS
  refreshQueue();
  if (!user) {
    unsubscribeRealtime();
    // nothing the last account could read stays in memory or on the device
    offline.clearSnapshot();
    set({
      reports: [], notifications: [], beneficiaries: [], sosLog: [], othersReview: [], users: [], audit: [], responders: [],
      changeRequests: [], units: [], unitMembers: [], unitRequests: [], myUnit: null, dispatches: [], personnel: [],
      equipment: [], capacity: null, inventory: [], distributionLog: [], assessments: [], sitreps: [], overdue: [],
      shelterTrend: [],
    });
  }
}

/* --------------------------------------------------------------- reports */
export interface ReportInput {
  hazard_type: string; // canonical label
  hazard_other_text?: string;
  barangay: string; // barangay name
  description: string;
  severity: ReportSeverity;
  lat: number | null;
  lng: number | null;
  photo?: Blob | null;
}

async function uploadPhoto(blob: Blob, folder: string): Promise<string> {
  const c = client();
  const { data: userData } = await c.auth.getUser();
  const uid = userData && userData.user ? userData.user.id : 'anon';
  const path = `${uid}/${folder}/${Date.now()}.jpg`;
  const up = await c.storage.from('reports').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  return path;
}

async function insertReport(input: ReportInput, folder: string): Promise<Row> {
  const c = client();
  const photo_path = input.photo ? await uploadPhoto(input.photo, folder) : null;
  const { data, error } = await c
    .from('reports')
    .insert({
      // the key ('fire') is the stored form; the app shows the label
      hazard_type: classifyHazard(input.hazard_type).key,
      hazard_other_text: input.hazard_other_text || null,
      barangay: input.barangay,
      description: input.description,
      severity: input.severity,
      urgency: input.severity,
      lat: input.lat,
      lng: input.lng,
      photo_path,
    })
    .select('*')
    .single();
  if (error) fail(error);
  return data as Row;
}

// Online: inserts the report. Offline: keeps it in the queue, which uploads
// by itself when the connection returns (photos cannot be queued).
export async function createReport(input: ReportInput): Promise<{ queued: boolean; code: string | null }> {
  const queueIt = async () => {
    await offline.enqueue({
      user_id: state.user ? state.user.id : undefined,
      kind: 'report',
      hazard_type: input.hazard_type,
      hazard_other_text: input.hazard_other_text || '',
      barangay: input.barangay,
      description: input.description,
      severity: input.severity,
      lat: input.lat,
      lng: input.lng,
      photo: input.photo || null,
    });
    await refreshQueue();
    requestBackgroundSync();
    return { queued: true, code: null };
  };
  if (!isOnline()) return queueIt();
  let row: Row;
  try {
    row = await insertReport(input, 'draft');
  } catch (e) {
    // no signal although the phone says it is online: save it for later
    if (isNetworkError(e) || (e as { network?: boolean }).network) return queueIt();
    throw e;
  }
  await loadAll();
  return { queued: false, code: row.code || null };
}

export async function corroborate(reportId: string, note = ''): Promise<{ corroborations: number; verified: boolean }> {
  const { data, error } = await client().rpc('corroborate_report', { p_report_id: reportId, p_note: note });
  if (error) fail(error);
  await loadAll();
  return { corroborations: (data && data.corroborations) || 0, verified: !!(data && data.verified) };
}

export async function advanceStatus(reportId: string, next: IncidentStatus, note = ''): Promise<void> {
  const { error } = await client().rpc('advance_report_status', {
    p_report_id: reportId,
    p_next: next === 'unverified' ? 'reported' : next,
    p_note: note,
  });
  if (error) fail(error);
  await loadAll();
}

// LGU fallback verification for a report the barangay has not verified. Moves it
// to verified like the official path, but records the LGU as the verifier.
export async function lguVerify(reportId: string, note = ''): Promise<void> {
  const { error } = await client().rpc('lgu_verify_report', { p_report_id: reportId, p_note: note });
  if (error) fail(error);
  await loadAll();
}

export async function reportHistory(reportId: string): Promise<StatusHistoryEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('report_status_history').select('*').eq('report_id', reportId).order('created_at');
  if (error) return [];
  return (data || []).map((h: Row) => ({
    id: h.id,
    from_status: h.from_status,
    to_status: h.to_status,
    reason: h.reason || '',
    note: h.note || '',
    created_at: h.created_at,
  }));
}

export async function loadResponders(): Promise<Responder[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('responders').select('*').order('name');
  const responders = error ? [] : (data || []).map((r: Row) => ({ id: r.id, name: r.name, unit: r.unit || '', contact: r.contact || '' }));
  set({ responders });
  return responders;
}

export async function assignResponder(reportId: string, responderId: string): Promise<void> {
  const { error } = await client().rpc('assign_responder', { p_report_id: reportId, p_responder_id: responderId });
  if (error) fail(error);
  await loadAll();
}

/* -------------------------------------------------------------- advisories */
export interface AdvisoryInput {
  title: string;
  content: string;
  type: AdvisoryType;
  severity: AdvisorySeverity;
  target_barangay_id: string | null; // barangay slug, or null for municipality-wide
}

export async function createAdvisory(input: AdvisoryInput): Promise<void> {
  const c = client();
  const target = input.target_barangay_id ? state.barangays.find((b) => b.id === input.target_barangay_id) : null;
  const { data: userData } = await c.auth.getUser();
  const { data, error } = await c
    .from('advisories')
    .insert({
      author_id: userData && userData.user ? userData.user.id : null,
      title: input.title,
      body: input.content,
      severity: SEVERITY_TO_DB[input.severity],
      kind: input.type === 'preparedness' ? 'preparedness' : 'emergency',
      affected_area: target ? target.name : PLACE.areaAll,
      citywide: !target,
      published_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) fail(error);

  // a targeted advisory is fanned out to exactly the barangay it names
  if (target && target.uuid) {
    await c.from('advisory_targets').insert({ advisory_id: data.id, barangay_id: target.uuid });
  }
  await c.rpc('fanout_advisory', { p_advisory_id: data.id });
  await loadAll();
  // Web push to subscribed devices. LGU accounts may push municipality-wide; a
  // targeted advisory reaches only that barangay's devices, which is also the
  // only audience a barangay official may push to. The in-app notification
  // above has already been delivered either way.
  const role = state.user ? state.user.role : null;
  if (role === 'lgu_admin' || role === 'super_admin' || (role === 'barangay' && target && target.uuid)) {
    c.functions
      .invoke('push-dispatch', {
        body: {
          title: input.title,
          body: input.content,
          severity: SEVERITY_TO_DB[input.severity],
          advisoryId: data.id,
          area: target ? target.name : PLACE.areaAll,
          barangayId: target && target.uuid ? target.uuid : null,
        },
      })
      .then(() => {}, () => {});
  }
}

// Runs through the declare_emergency() server function: it is LGU only, writes
// an audit row, and returns the real subscribed device count.
export async function declareEmergency(title?: string, body?: string): Promise<{ devices: number }> {
  const c = client();
  const p_title = title || 'Emergency declaration: municipality-wide response activated';
  const { data, error } = await c.rpc('declare_emergency', { p_title, p_body: body || '', p_area: PLACE.areaAll });
  if (error) fail(error);
  await loadAll();
  if (data && data.advisory_id) {
    // best effort: hand the advisory to the push gateway
    try {
      await c.functions.invoke('push-dispatch', {
        body: { title: p_title, body: body || '', severity: 'emergency', advisoryId: data.advisory_id, area: PLACE.areaAll },
      });
    } catch {
      // push is an enhancement; the advisory is already published
    }
  }
  return { devices: (data && data.devices) != null ? data.devices : state.subscribedDevices };
}

// Logs that this resident saw an emergency alert (alert_acknowledgments).
export function acknowledgeAlert(advisoryId: string) {
  if (!supabase) return;
  supabase.from('alert_acknowledgments').insert({ advisory_id: advisoryId }).then(() => {}, () => {});
}

/* ----------------------------------------------------------------- centres */
export async function updateCenter(
  id: string,
  updates: Partial<Pick<EvacuationCenter, 'status' | 'current_occupancy' | 'capacity' | 'facilities' | 'contact_person' | 'contact_phone' | 'notes'>>
): Promise<void> {
  const patch: Row = {};
  if (updates.facilities !== undefined) patch.facilities = updates.facilities;
  if (updates.contact_person !== undefined) patch.contact_person = updates.contact_person;
  if (updates.contact_phone !== undefined) patch.contact_phone = updates.contact_phone;
  if (updates.notes !== undefined) patch.note = updates.notes;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.capacity !== undefined) patch.capacity = updates.capacity;
  if (updates.current_occupancy !== undefined) patch.occupancy = updates.current_occupancy;
  if (updates.status === 'closed' && updates.current_occupancy === undefined) patch.occupancy = 0;
  const { error } = await client().from('evacuation_centers').update(patch).eq('id', id);
  if (error) fail(error);
  await loadAll();
}

export interface CenterInput {
  name: string;
  barangay_id: string; // slug
  address?: string;
  capacity: number;
  lat: number | null;
  lng: number | null;
  notes?: string;
  facilities?: string[];
  contact_person?: string;
  contact_phone?: string;
}

export async function createCenter(input: CenterInput): Promise<void> {
  const brgy = state.barangays.find((b) => b.id === input.barangay_id);
  const { error } = await client().from('evacuation_centers').insert({
    name: input.name,
    barangay: brgy ? brgy.name : '',
    barangay_id: brgy ? brgy.uuid : null,
    address: input.address || '',
    capacity: input.capacity,
    occupancy: 0,
    status: 'open',
    note: input.notes || '',
    lat: input.lat,
    lng: input.lng,
    facilities: input.facilities || [],
    contact_person: input.contact_person || '',
    contact_phone: input.contact_phone || '',
  });
  if (error) fail(error);
  await loadAll();
}

/* ---------------------------------------------------------------- hotlines */
export type HotlineInput = Pick<EmergencyHotline, 'agency_name' | 'contact_number' | 'scope'>;

export async function createHotline(input: HotlineInput): Promise<void> {
  const { error } = await client().from('emergency_hotlines').insert({
    agency_name: input.agency_name,
    contact_number: input.contact_number,
    scope: input.scope || PLACE.areaAll,
  });
  if (error) fail(error);
  await loadAll();
}

export async function updateHotline(id: string, patch: Partial<HotlineInput> & { active?: boolean }): Promise<void> {
  const { error } = await client().from('emergency_hotlines').update(patch).eq('id', id);
  if (error) fail(error);
  await loadAll();
}

/* --------------------------------------------------------- change requests */
// Hotlines are official records: LGU staff and barangay officials propose a
// change, and it reaches the directory only when the Super Admin approves it.
const toChangeRequest = (c: Row): ChangeRequest => ({
  id: c.id,
  requester_name: c.requester_name || '',
  requester_role: c.requester_role || '',
  requester_barangay: c.requester_barangay || '',
  target_table: c.target_table || '',
  target_id: c.target_id || null,
  action: c.action,
  current_data: c.current_data || {},
  proposed_data: c.proposed_data || {},
  reason: c.reason || '',
  status: c.status || 'pending',
  decision_note: c.decision_note || '',
  decided_at: c.decided_at || null,
  created_at: c.created_at,
});

export async function loadChangeRequests(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from('change_requests').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) fail(error);
  set({ changeRequests: (data || []).map(toChangeRequest) });
}

export async function submitHotlineRequest(
  action: 'add' | 'edit' | 'delete',
  hotline: EmergencyHotline | null,
  proposed: Partial<HotlineInput> & { active?: boolean },
  reason = ''
): Promise<void> {
  const current = hotline
    ? { agency_name: hotline.agency_name, contact_number: hotline.contact_number, scope: hotline.scope, active: hotline.active }
    : {};
  const { error } = await client().rpc('submit_change_request', {
    p_target_table: 'emergency_hotlines',
    p_action: action,
    p_target_id: hotline ? hotline.id : null,
    p_current_data: current,
    p_proposed_data: proposed,
    p_reason: reason,
  });
  if (error) fail(error);
  await loadChangeRequests().catch(() => undefined);
}

export async function decideChangeRequest(id: string, approve: boolean, note = ''): Promise<void> {
  const { error } = await client().rpc(approve ? 'approve_change_request' : 'reject_change_request', {
    p_request_id: id,
    p_decision_note: note,
  });
  if (error) fail(error);
  await Promise.all([loadChangeRequests(), loadAll()]);
}

export async function deleteHotline(id: string): Promise<void> {
  const { error } = await client().from('emergency_hotlines').delete().eq('id', id);
  if (error) fail(error);
  await loadAll();
}

/* ---------------------------------------------------------- notifications */
export async function markRead(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    if (error) fail(error);
  }
  set({ notifications: state.notifications.map((n) => (n.id === id ? { ...n, unread: false } : n)) });
}

export async function markAllRead(): Promise<void> {
  if (supabase && state.user) {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', state.user.id)
      .is('read_at', null);
    if (error) fail(error);
  }
  set({ notifications: state.notifications.map((n) => ({ ...n, unread: false })) });
}

/* ------------------------------------------------- relief / beneficiaries */
export type ReliefInput = Partial<Omit<ReliefDistribution, 'id'>>;

function adaptRelief(input: ReliefInput): Row {
  const out: Row = {};
  (['title', 'barangay', 'location_name', 'address', 'lat', 'lng', 'distribution_at', 'contact_person', 'contact_phone', 'note', 'active'] as const).forEach((k) => {
    if (input[k] !== undefined) out[k] = input[k];
  });
  if (input.eligibility) out.eligibility = input.eligibility;
  if (input.required_docs) out.required_docs = input.required_docs;
  if (input.barangay !== undefined) {
    const brgy = state.barangays.find((b) => b.name === input.barangay);
    out.barangay_id = brgy ? brgy.uuid : null;
  }
  return out;
}

export async function createRelief(input: ReliefInput): Promise<void> {
  const { error } = await client().from('relief_distributions').insert(adaptRelief({ active: true, ...input }));
  if (error) fail(error);
  await loadAll();
}

export async function updateRelief(id: string, patch: ReliefInput): Promise<void> {
  const { error } = await client().from('relief_distributions').update(adaptRelief(patch)).eq('id', id);
  if (error) fail(error);
  await loadAll();
}

export type BeneficiaryInput = Pick<Beneficiary, 'barangay' | 'beneficiary_name' | 'claimant_name' | 'claimant_id' | 'category'>;

export async function createBeneficiary(input: BeneficiaryInput): Promise<void> {
  const brgy = state.barangays.find((b) => b.name === input.barangay);
  const { error } = await client().from('authorized_beneficiaries').insert({ ...input, barangay_id: brgy ? brgy.uuid : null });
  if (error) fail(error);
  await loadAll();
}

export async function deleteBeneficiary(id: string): Promise<void> {
  const { error } = await client().from('authorized_beneficiaries').delete().eq('id', id);
  if (error) fail(error);
  await loadAll();
}

/* ------------------------------------------------------------ guides / faqs */
export type GuideInput = Pick<PreparednessGuide, 'hazard_type' | 'phase' | 'title' | 'body'>;

// A new phase entry joins the guide with the same hazard and title, or starts
// a new guide, so each topic stays one row with three sections.
export async function createGuide(input: GuideInput): Promise<void> {
  const c = client();
  const { data: existing } = await c
    .from('preparedness_guides')
    .select('id')
    .eq('hazard_type', input.hazard_type)
    .eq('phase', 'all')
    .ilike('title', input.title.trim())
    .limit(1);
  const column = PHASE_COLUMN[input.phase];
  if (existing && existing.length) {
    const { error } = await c.from('preparedness_guides').update({ [column]: input.body }).eq('id', existing[0].id);
    if (error) fail(error);
  } else {
    const { data: userData } = await c.auth.getUser();
    const { error } = await c.from('preparedness_guides').insert({
      hazard_type: input.hazard_type,
      phase: 'all',
      title: input.title.trim(),
      body: input.body,
      summary: input.body.slice(0, 160),
      [column]: input.body,
      author_id: userData && userData.user ? userData.user.id : null,
    });
    if (error) fail(error);
  }
  await loadAll();
}

// id is a phase entry id ("<guide id>:<phase>"), or a legacy row id
export async function updateGuide(id: string, patch: Partial<GuideInput>): Promise<void> {
  const [guideId, phase] = id.split(':') as [string, GuidePhase | undefined];
  const row: Row = {};
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.hazard_type !== undefined) row.hazard_type = patch.hazard_type;
  if (phase && patch.phase && patch.phase !== phase && patch.body !== undefined) {
    // moved to another phase: clear the old section, write the new one
    row[PHASE_COLUMN[phase]] = '';
    row[PHASE_COLUMN[patch.phase]] = patch.body;
  } else if (patch.body !== undefined) {
    row[phase ? PHASE_COLUMN[phase] : 'body'] = patch.body;
    if (!phase && patch.phase) row.phase = patch.phase;
  }
  const { error } = await client().from('preparedness_guides').update(row).eq('id', guideId);
  if (error) fail(error);
  await loadAll();
}

export type FaqInput = Pick<Faq, 'question' | 'answer' | 'category'>;

export async function createFaq(input: FaqInput): Promise<void> {
  const { error } = await client().from('faqs').insert(input);
  if (error) fail(error);
  await loadAll();
}

export async function updateFaq(id: string, patch: Partial<FaqInput>): Promise<void> {
  const { error } = await client().from('faqs').update(patch).eq('id', id);
  if (error) fail(error);
  await loadAll();
}

export async function deleteFaq(id: string): Promise<void> {
  const { error } = await client().from('faqs').delete().eq('id', id);
  if (error) fail(error);
  await loadAll();
}

/* ------------------------------------------------- road work / road status */
export interface RoadWorkInput {
  title: string;
  description: string;
  barangay: string; // name, or '' with citywide
  road_name: string;
  address?: string;
  lat: number | null;
  lng: number | null;
  expected_start: string;
  expected_end: string;
  citywide: boolean;
}

export async function createRoadWork(input: RoadWorkInput): Promise<void> {
  const c = client();
  const { data: userData } = await c.auth.getUser();
  const { data, error } = await c
    .from('road_work_posts')
    .insert({ ...input, address: input.address || '', author_id: userData && userData.user ? userData.user.id : null })
    .select('*')
    .single();
  if (error) fail(error);
  // fan out a notification to residents of the affected barangay
  try {
    await c.rpc('fanout_road_work', { p_post_id: data.id });
  } catch {}
  await loadAll();
}

export type RoadStatusInput = Pick<RoadStatus, 'road_name' | 'barangay' | 'status' | 'note' | 'lat' | 'lng'> &
  Partial<Pick<RoadStatus, 'segment_from' | 'segment_to' | 'cause' | 'severity' | 'started_at' | 'estimated_reopen'>>;

export async function createRoadStatus(input: RoadStatusInput): Promise<void> {
  const c = client();
  const { data: userData } = await c.auth.getUser();
  const { error } = await c.from('road_status').insert({ ...input, updated_by: userData && userData.user ? userData.user.id : null });
  if (error) fail(error);
  await loadAll();
}

export async function updateRoadStatus(id: string, patch: Partial<RoadStatusInput>): Promise<void> {
  const { error } = await client().from('road_status').update(patch).eq('id', id);
  if (error) fail(error);
  await loadAll();
}

export async function deleteRoadStatus(id: string): Promise<void> {
  const { error } = await client().from('road_status').delete().eq('id', id);
  if (error) fail(error);
  await loadAll();
}

/* --------------------------------------------------------------------- SOS */
export interface SosResult {
  id: string | null;
  reach: number | null;
  queued: boolean;
}

// One tap sends GPS + the caller's profile snapshot to the LGU duty officers
// through the submit_sos RPC, which is rate limited to 5 calls per 10 minutes.
export async function submitSos(pos: { lat: number | null; lng: number | null; accuracy: number | null }, note = ''): Promise<SosResult> {
  const queue = async (): Promise<SosResult> => {
    await offline.upsertQueuedSos({ user_id: state.user ? state.user.id : undefined, kind: 'sos', lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, description: note });
    await refreshQueue();
    requestBackgroundSync();
    return { id: null, reach: null, queued: true };
  };
  if (!isOnline()) return queue();
  let res;
  try {
    res = await client().rpc('submit_sos', {
      p_lat: pos.lat,
      p_lng: pos.lng,
      p_accuracy: pos.accuracy,
      p_note: note,
    });
  } catch (e) {
    // the phone thinks it is online but the request never left: keep the SOS
    if (isNetworkError(e)) return queue();
    throw e;
  }
  const { data, error } = res;
  if (error && isNetworkError(error)) return queue();
  if (error) fail(error);
  return { id: (data && data.id) || null, reach: data && typeof data.reach === 'number' ? data.reach : null, queued: false };
}

export async function loadSos(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from('sos_log').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) return;
  set({
    sosLog: (data || []).map((s: Row) => ({
      id: s.id,
      profile_name: s.profile_name || '',
      profile_phone: s.profile_phone || '',
      barangay: s.barangay || '',
      lat: num(s.lat),
      lng: num(s.lng),
      accuracy: num(s.accuracy),
      note: s.note || '',
      status: s.status || 'sent',
      created_at: s.created_at,
    })),
  });
}

export async function loadOthersReview(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from('others_hazard_review').select('*');
  if (error) return;
  set({
    othersReview: (data || []).map((r: Row) => ({
      description: r.description || '',
      occurrences: Number(r.occurrences) || 0,
      latest_at: r.latest_at,
    })),
  });
}

/* -------------------------------------------------------------- admin ops */
export async function loadUsers(): Promise<void> {
  const { data, error } = await client().from('profiles').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) fail(error);
  set({ users: (data || []).map((p: Row) => toUser(p)) });
}

type AdminAction =
  | { action: 'create'; email: string; fullName: string; role: 'barangay_official' | 'lgu_ldrrmc'; barangayId?: string | null }
  | { action: 'set-role'; userId: string; role: string }
  | { action: 'set-barangay'; userId: string; barangayId: string | null }
  | { action: 'set-disabled'; userId: string; disabled: boolean };

// The admin-users Edge Function is the only way an account becomes anything
// other than a citizen. It re-checks that the caller is LGU and audits the change.
export async function adminUsers(payload: AdminAction): Promise<void> {
  const { error } = await client().functions.invoke('admin-users', { body: payload });
  if (error) {
    // an Edge Function returns its reason in the body; show that, not "non-2xx"
    let msg = error.message;
    try {
      const b = await (error as any).context.json();
      if (b && b.error) msg = b.error;
    } catch {}
    throw new Error(msg);
  }
  await loadUsers();
}

export async function loadAudit(limit = 200): Promise<void> {
  const c = client();
  // audit_log_with_actor (migration 145) carries the actor's role and barangay
  const viewed = await c.from('audit_log_with_actor').select('*').order('created_at', { ascending: false }).limit(limit);
  if (!viewed.error) {
    set({
      audit: (viewed.data || []).map((a: Row) => ({
        id: a.id,
        timestamp: a.created_at,
        event_type: a.action || '',
        entity: a.entity || '',
        target_id: a.entity_id || '',
        actor_id: a.actor_id || null,
        actor_name: a.actor_id ? a.actor_name || String(a.actor_id).slice(0, 8) : 'system',
        actor_role: a.actor_role || '',
        actor_barangay: a.actor_barangay || '',
        meta: a.meta || {},
        description: describeAudit(a),
      })),
    });
    return;
  }
  const { data, error } = await c.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) fail(error);
  const actorIds = Array.from(new Set((data || []).map((a: Row) => a.actor_id).filter(Boolean)));
  const names: Record<string, string> = {};
  if (actorIds.length) {
    const { data: actors } = await c.from('profiles').select('id, full_name, email').in('id', actorIds);
    (actors || []).forEach((p: Row) => {
      names[p.id] = p.full_name || p.email || '';
    });
  }
  set({
    audit: (data || []).map((a: Row) => ({
      id: a.id,
      timestamp: a.created_at,
      event_type: a.action || '',
      entity: a.entity || '',
      target_id: a.entity_id || '',
      actor_name: a.actor_id ? names[a.actor_id] || String(a.actor_id).slice(0, 8) : 'system',
      meta: a.meta || {},
      description: describeAudit(a),
    })),
  });
}

const AUDIT_RECORD: Record<string, string> = {
  evacuation_centers: 'Shelter',
  emergency_hotlines: 'Hotline',
  road_status: 'Road status',
  road_work_posts: 'Road work post',
  relief_distributions: 'Relief schedule',
  relief_inventory: 'Relief stock item',
  relief_distribution_log: 'Relief distribution',
  damage_assessments: 'Damage assessment',
  situation_reports: 'Situation report',
  advisories: 'Advisory',
  preparedness_guides: 'Guide',
  faqs: 'FAQ',
  dispatch_units: 'Dispatch unit',
  profiles: 'Account',
};

function describeAudit(a: Row): string {
  const meta: Row = a.meta && typeof a.meta === 'object' ? a.meta : {};
  switch (a.action) {
    case 'report.status_changed':
      return `Report status changed to ${meta.to || 'unknown'}${meta.note ? ` — ${meta.note}` : ''}`;
    case 'report.responder_assigned':
      return 'Responder unit assigned to report';
    case 'user.invited':
      return `Invited ${meta.email || 'an account'} as ${meta.role || 'official'}`;
    case 'user.role_changed':
      return `Role changed to ${meta.to || 'unknown'}`;
    case 'user.barangay_changed':
      return `Barangay assignment changed to ${meta.name || 'none'}`;
    case 'user.disabled':
      return 'Account disabled';
    case 'user.enabled':
      return 'Account enabled';
    case 'emergency.declared':
      return `Emergency declared${meta.title ? `: ${meta.title}` : ''}`;
    case 'sos.received':
      return `SOS received${meta.reach != null ? `, ${meta.reach} duty officers notified` : ''}`;
    default: {
      // rows written by the audit_row_change trigger: "<table>.<insert|update|delete>"
      const m = /^([a-z_]+)\.(insert|update|delete)$/.exec(a.action || '');
      if (m) {
        const what = AUDIT_RECORD[m[1]] || m[1].replace(/_/g, ' ');
        const did = m[2] === 'insert' ? 'added' : m[2] === 'update' ? 'updated' : 'removed';
        const name = meta.name || meta.title || meta.road_name || meta.agency_name || '';
        return `${what} ${did}${name ? `: ${name}` : ''}`;
      }
      const detail = Object.keys(meta)
        .map((k) => `${k}: ${typeof meta[k] === 'object' ? JSON.stringify(meta[k]) : meta[k]}`)
        .join(' · ');
      return [a.entity, detail].filter(Boolean).join(' — ');
    }
  }
}

/* ----------------------------------------------------------- offline queue */
// Queued rows belong to the account that saved them (older rows carry no
// owner and count as the current account's).
const mine = (r: QueuedReport) => !r.user_id || (!!state.user && r.user_id === state.user.id);

async function refreshQueue() {
  set({ queue: (await offline.listQueue()).filter(mine) });
}

// Called on reconnect and on a timer while the app is open.
let flushing = false;
export async function flushQueue(): Promise<number> {
  if (flushing || !isOnline() || !state.user) return 0;
  flushing = true;
  let sent = 0;
  try {
    // SOS first; rows the server already refused five times wait for the user
    const rows = (await offline.listQueue())
      .filter((r) => !r.failed && mine(r))
      .sort((a, b) => (a.kind === 'sos' ? 0 : 1) - (b.kind === 'sos' ? 0 : 1));
    for (const row of rows) {
      try {
        if (row.kind === 'sos') {
          const { error } = await client().rpc('submit_sos', {
            p_lat: row.lat, p_lng: row.lng, p_accuracy: row.accuracy ?? null, p_note: row.description || '',
          });
          if (error) throw error;
        } else {
          await insertReport(
            {
              hazard_type: row.hazard_type || '',
              hazard_other_text: row.hazard_other_text,
              barangay: row.barangay || '',
              description: row.description || '',
              severity: row.severity || 'advisory',
              lat: row.lat,
              lng: row.lng,
              photo: row.photo || null,
            },
            'offline'
          );
        }
        await offline.removeFromQueue(row.id);
        sent++;
      } catch (e) {
        // no signal: stop and try again later
        if (isNetworkError(e) || (e as { network?: boolean }).network) break;
        // the server refused this row: count it and carry on with the rest
        const attempts = (row.attempts || 0) + 1;
        await offline.updateQueueRow({ ...row, attempts, failed: attempts >= 5, last_error: friendlyError(e) });
      }
    }
  } finally {
    flushing = false;
  }
  await refreshQueue();
  if (sent) await loadAll();
  return sent;
}

// Asks the browser again, sends anything queued and reloads the data, then
// reports honestly what happened.
export async function retryNow(): Promise<{ online: boolean; uploaded: number; queued: number }> {
  set({ online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true });
  const uploaded = await flushQueue().catch(() => 0);
  if (isOnline() && state.user) await loadAll();
  return { online: state.online && state.source === 'supabase', uploaded, queued: state.queue.length };
}

// Escape hatch: drop the service worker and every cache, then reload. Useful
// when a device is somehow holding on to an older build.
export async function forceRefresh(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => null)));
    }
  } catch {
    // keep going
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // keep going
  }
  location.reload();
}

function requestBackgroundSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => (reg as any).sync && (reg as any).sync.register('uniguard-queue'))
    .catch(() => {});
}

/* --------------------------------------------------------------- web push */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const raw = atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const pushSupported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' &&
  'PushManager' in window && 'Notification' in window && !!CONFIG.VAPID_PUBLIC_KEY;

// Subscribes this device to emergency alerts and stores the subscription. Must
// be called from a user gesture; it is silent when push is unavailable, already
// set up, or the resident has declined.
let pushAttempted = false;
// `force` is a tap on "Turn on alerts": always try again instead of trusting
// the result of an earlier automatic attempt.
export async function enablePush(force = false): Promise<boolean> {
  if (!pushSupported() || !supabase || !state.user || Notification.permission === 'denied') return false;
  if (pushAttempted && !force) return Notification.permission === 'granted';
  pushAttempted = true;
  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      pushAttempted = false;
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY) as BufferSource,
      }));
    const json = sub.toJSON();
    await supabase.from('push_subscriptions').upsert(
      {
        endpoint: json.endpoint,
        p256dh: json.keys ? json.keys.p256dh : '',
        auth: json.keys ? json.keys.auth : '',
        user_agent: navigator.userAgent.slice(0, 200),
      },
      { onConflict: 'endpoint' }
    );
    return true;
  } catch {
    pushAttempted = false;
    return false;
  }
}

/* -------------------------------------------------------------------- wire */
let started = false;
export function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const sync = () => {
    set({ online: navigator.onLine !== false });
    if (state.online && state.user) flushQueue().then(() => {
      if (state.source !== 'supabase') loadAll();
    });
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  refreshQueue();
  loadBarangays();

  // the service worker wakes the page when the browser regains network
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'FLUSH_QUEUE') flushQueue();
    });
  }

  // Realtime is the primary sync between roles. Coming back to the tab, and a
  // slow timer, cover a dropped socket so no role is left looking at stale data.
  const refresh = () => {
    if (state.user && state.online && !state.loading && document.visibilityState === 'visible') loadAll();
  };
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 60000);
  setInterval(() => {
    if (state.online && state.queue.length) flushQueue();
  }, CONFIG.SYNC_RETRY_MS);
}


/* ---------------------------------------------------------- dispatch units */
// Every write goes through the security-definer RPCs from migrations 139/140,
// which re-check role, unit and barangay on the server.
const toUnit = (u: Row): DispatchUnit => ({
  id: u.id,
  name: u.name || '',
  unit_type: u.unit_type,
  contact_number: u.contact_number || '',
  address: u.address || '',
  status: u.status || 'available',
  active: u.active !== false,
  created_at: u.created_at,
});

const toDispatch = (d: Row): Dispatch => ({
  id: d.id,
  report_id: d.report_id,
  team: d.team || '',
  instructions: d.instructions || '',
  eta: d.eta || null,
  dispatched_by_name: d.dispatched_by_name || '',
  dispatched_at: d.dispatched_at,
  unit_id: d.unit_id || null,
  dispatch_status: d.dispatch_status || 'sent',
  ack_at: d.ack_at || null,
  en_route_at: d.en_route_at || null,
  on_scene_at: d.on_scene_at || null,
  done_at: d.done_at || null,
  after_action: d.after_action || '',
  report: d.report
    ? {
        code: d.report.code || '',
        hazard_type: hazardDisplayLabel(d.report.hazard_type, d.report.hazard_other_text),
        description: d.report.description || '',
        barangay: d.report.barangay || '',
        severity: d.report.severity || 'advisory',
        status: d.report.status === 'reported' ? 'unverified' : d.report.status || '',
        lat: num(d.report.lat),
        lng: num(d.report.lng),
        created_at: d.report.created_at,
      }
    : null,
});

const toRequest = (r: Row): UnitRequest => ({
  id: r.id,
  unit_id: r.unit_id,
  kind: r.kind || '',
  details: r.details || '',
  status: r.status || 'pending',
  created_at: r.created_at,
  decided_at: r.decided_at || null,
});

const rpcOrFail = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await client().rpc(name, args);
  if (error) fail(error);
  return data;
};

/** LGU / Super Admin: every unit, its members, and support requests. */
export async function loadDispatchUnits(): Promise<void> {
  if (!supabase) return;
  const c = supabase;
  const [units, requests] = await Promise.all([
    c.from('dispatch_units').select('*').order('unit_type').order('name'),
    c.from('unit_requests').select('*').order('created_at', { ascending: false }).limit(100),
  ]);
  if (units.error) fail(units.error);
  const patch: Partial<RepoState> = {
    units: (units.data || []).map(toUnit),
    unitRequests: requests.error ? [] : (requests.data || []).map(toRequest),
  };
  // members are profile rows; only the Super Admin can read other people's profiles
  const members = await c.from('profiles').select('*').eq('role', 'dispatch_team').order('full_name');
  patch.unitMembers = members.error ? [] : (members.data || []).map((p: Row) => toUser(p));
  set(patch);
}

export async function createDispatchUnit(input: { name: string; unit_type: UnitType; contact_number: string; address: string }): Promise<void> {
  await rpcOrFail('create_dispatch_unit', {
    p_name: input.name.trim(),
    p_unit_type: input.unit_type,
    p_contact_number: input.contact_number.trim(),
    p_address: input.address.trim(),
    p_lat: null,
    p_lng: null,
  });
  await loadDispatchUnits();
}

export async function updateDispatchUnit(id: string, patch: { name?: string; contact_number?: string; address?: string; active?: boolean }): Promise<void> {
  await rpcOrFail('update_dispatch_unit', {
    p_unit_id: id,
    p_name: patch.name ?? null,
    p_contact_number: patch.contact_number ?? null,
    p_address: patch.address ?? null,
    p_active: patch.active ?? null,
  });
  await loadDispatchUnits();
}

/** Super Admin invites a unit admin or member; a unit admin invites members of their own unit. */
export async function inviteUnitMember(unitId: string, email: string, unitRole: 'unit_admin' | 'member', asUnitAdmin = false): Promise<void> {
  const body = asUnitAdmin
    ? { action: 'unit-invite', email: email.trim(), unitId, redirectUrl: window.location.origin }
    : { action: 'create', email: email.trim(), role: 'dispatch_team', unitId, unitRole, redirectUrl: window.location.origin };
  const { error } = await client().functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try {
      const b = await (error as any).context.json();
      if (b && b.error) msg = b.error;
    } catch {}
    throw new Error(msg);
  }
  if (asUnitAdmin) await loadMyUnit();
  else await loadDispatchUnits();
}

export async function decideUnitRequest(id: string, decision: 'approved' | 'declined' | 'done', note = ''): Promise<void> {
  await rpcOrFail('decide_unit_request', { p_request_id: id, p_decision: decision, p_note: note });
  await loadDispatchUnits();
}

/** Officials and LGU send a team (and for BFP / PNP / Rescue, a unit) to a verified report. */
export async function dispatchReport(input: {
  reportId: string;
  team: string;
  instructions: string;
  eta: string;
  unitId: string | null;
  targetBarangayId: string | null;
}): Promise<void> {
  await rpcOrFail('dispatch_report_v2', {
    p_report_id: input.reportId,
    p_team: input.team,
    p_instructions: input.instructions,
    p_eta: input.eta,
    p_unit_id: input.unitId,
    p_target_barangay_id: input.targetBarangayId,
    p_equipment_ids: null,
  });
  await loadAll();
}

/** A dispatch account: its unit, the dispatches addressed to it, crew, equipment and hospital data. */
export async function loadMyUnit(): Promise<void> {
  if (!supabase || !state.user || !state.user.dispatch_unit_id) return;
  const c = supabase;
  const unitId = state.user.dispatch_unit_id;
  const [unit, dispatches, personnel, equipment, requests, capacity] = await Promise.all([
    c.from('dispatch_units').select('*').eq('id', unitId).maybeSingle(),
    c.from('report_dispatches').select('*, report:reports(*)').eq('unit_id', unitId).order('dispatched_at', { ascending: false }).limit(60),
    c.from('unit_personnel').select('*').eq('unit_id', unitId).order('name'),
    c.from('dispatch_equipment').select('*').eq('owner_unit_id', unitId).order('created_at', { ascending: false }),
    c.from('unit_requests').select('*').eq('unit_id', unitId).order('created_at', { ascending: false }),
    c.from('hospital_capacity').select('*').eq('unit_id', unitId).maybeSingle(),
  ]);
  if (unit.error) fail(unit.error);
  set({
    myUnit: unit.data ? toUnit(unit.data) : null,
    dispatches: dispatches.error ? [] : (dispatches.data || []).map(toDispatch),
    personnel: personnel.error
      ? []
      : (personnel.data || []).map((p: Row) => ({ id: p.id, unit_id: p.unit_id, name: p.name || '', role: p.role || '', phone: p.phone || '', on_duty: !!p.on_duty })),
    equipment: equipment.error
      ? []
      : (equipment.data || []).map((e: Row) => ({
          id: e.id,
          label: e.custom_label || 'Equipment',
          identifier: e.identifier || '',
          status: e.status || 'available',
          condition: e.condition || '',
          last_checked_at: e.last_checked_at || null,
          notes: e.notes || '',
        })),
    unitRequests: requests.error ? [] : (requests.data || []).map(toRequest),
    capacity: capacity.data
      ? {
          er_beds: capacity.data.er_beds || 0,
          icu_beds: capacity.data.icu_beds || 0,
          available: capacity.data.available || 0,
          accepting: capacity.data.accepting !== false,
          updated_at: capacity.data.updated_at || null,
        }
      : null,
  });
}

export async function respondToDispatch(dispatchId: string, action: 'acknowledged' | 'en_route' | 'on_scene' | 'done', note = ''): Promise<void> {
  await rpcOrFail('dispatch_respond', { p_dispatch_id: dispatchId, p_action: action, p_note: note });
  await loadMyUnit();
}

export async function submitAfterAction(dispatchId: string, text: string): Promise<void> {
  await rpcOrFail('submit_after_action', { p_dispatch_id: dispatchId, p_text: text, p_meta: {} });
  await loadMyUnit();
}

export async function setPersonnelDuty(personnelId: string, onDuty: boolean): Promise<void> {
  await rpcOrFail('set_personnel_duty', { p_personnel_id: personnelId, p_on_duty: onDuty });
  await loadMyUnit();
}

export async function addPersonnel(input: { name: string; role: string; phone: string }): Promise<void> {
  if (!state.user || !state.user.dispatch_unit_id) return;
  const { error } = await client()
    .from('unit_personnel')
    .insert({ unit_id: state.user.dispatch_unit_id, name: input.name.trim(), role: input.role.trim(), phone: input.phone.trim() });
  if (error) fail(error);
  await loadMyUnit();
}

export async function addEquipment(input: { label: string; identifier: string }): Promise<void> {
  if (!state.user || !state.user.dispatch_unit_id) return;
  const { error } = await client()
    .from('dispatch_equipment')
    .insert({ owner_unit_id: state.user.dispatch_unit_id, custom_label: input.label.trim(), identifier: input.identifier.trim() });
  if (error) fail(error);
  await loadMyUnit();
}

export async function setEquipmentStatus(equipmentId: string, status: UnitEquipment['status'], note = ''): Promise<void> {
  await rpcOrFail('set_equipment_status', { p_equipment_id: equipmentId, p_status: status, p_condition: null, p_notes: note });
  await loadMyUnit();
}

export async function recordEquipmentCheck(equipmentId: string, condition: string, notes = ''): Promise<void> {
  await rpcOrFail('record_equipment_check', { p_equipment_id: equipmentId, p_condition: condition, p_level: '', p_notes: notes });
  await loadMyUnit();
}

export async function createUnitRequest(kind: string, details: string): Promise<void> {
  if (!state.user || !state.user.dispatch_unit_id) return;
  await rpcOrFail('create_unit_request', { p_unit_id: state.user.dispatch_unit_id, p_kind: kind, p_details: details });
  await loadMyUnit();
}

export async function setHospitalCapacity(input: HospitalCapacity): Promise<void> {
  if (!state.user || !state.user.dispatch_unit_id) return;
  await rpcOrFail('set_hospital_capacity', {
    p_unit_id: state.user.dispatch_unit_id,
    p_er_beds: input.er_beds,
    p_icu_beds: input.icu_beds,
    p_available: input.available,
    p_accepting: input.accepting,
  });
  await loadMyUnit();
}

/* ============================================== Phase 3: operations data */
const int = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

/* ------------------------------------------- one-hour verification queue */
// Reports still awaiting barangay verification an hour after they were filed
// (lgu_escalation_queue, migrations 147 and 151).
export async function loadOverdue(): Promise<void> {
  const { data, error } = await client().from('lgu_escalation_queue').select('*').limit(200);
  if (error) fail(error);
  set({
    overdue: (data || []).map((r: Row) => ({
      id: r.id,
      code: r.code || '',
      hazard_type: r.hazard_type || '',
      barangay: r.barangay || '',
      severity: r.severity || '',
      description: r.description || '',
      created_at: r.created_at,
      minutes: Math.round(int(r.minutes_since_submission)),
    })),
  });
}

export async function verifyOverdue(reportId: string): Promise<void> {
  const { error } = await client().rpc('lgu_verify_overdue_report', { p_report_id: reportId });
  if (error) fail(error);
  await Promise.all([loadOverdue(), loadAll()]);
}

/* ------------------------------------------------------ relief inventory */
const toInventory = (r: Row): InventoryItem => ({
  id: r.id,
  name: r.name || '',
  category: r.category === 'Shelter' ? 'Shelter Supplies' : r.category || 'Food',
  unit: r.unit || 'units',
  stock: int(r.stock),
  reorder: int(r.reorder),
  location: r.location || '',
  supplier: r.supplier || '',
  updated_at: r.updated_at || null,
});

const toDistribution = (r: Row): DistributionLogEntry => ({
  id: r.id,
  item_id: r.item_id || null,
  item_name: r.item_name || '',
  qty: int(r.qty),
  barangay: r.barangay || '',
  family: r.family || '',
  distributed_by: r.distributed_by || '',
  distributed_at: r.distributed_at || r.created_at,
});

export async function loadInventory(): Promise<void> {
  const c = client();
  const [items, log] = await Promise.all([
    c.from('relief_inventory').select('*').order('category').order('name'),
    c.from('relief_distribution_log').select('*').order('distributed_at', { ascending: false }).limit(300),
  ]);
  if (items.error) fail(items.error);
  set({
    inventory: (items.data || []).map(toInventory),
    distributionLog: log.error ? [] : (log.data || []).map(toDistribution),
  });
}

export type InventoryInput = Omit<InventoryItem, 'id' | 'updated_at'>;

export async function saveInventoryItem(id: string | null, input: InventoryInput): Promise<void> {
  const c = client();
  const row = { ...input, stock: Math.max(0, Math.round(input.stock)), reorder: Math.max(0, Math.round(input.reorder)) };
  const { error } = id
    ? await c.from('relief_inventory').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
    : await c.from('relief_inventory').insert(row);
  if (error) fail(error);
  await loadInventory();
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await client().from('relief_inventory').delete().eq('id', id);
  if (error) fail(error);
  await loadInventory();
}

// Records goods handed out and lowers the stock in one server step (migration 151).
export async function logDistribution(input: { item_id: string; qty: number; barangay: string; family: string }): Promise<void> {
  const { error } = await client().rpc('log_relief_distribution', {
    p_item_id: input.item_id,
    p_qty: Math.round(input.qty),
    p_barangay: input.barangay,
    p_family: input.family,
  });
  if (error) fail(error);
  await loadInventory();
}

/* ------------------------------------- damage assessments and situation reports */
const toAssessment = (d: Row): DamageAssessment => ({
  id: d.id,
  barangay: d.barangay || '',
  barangay_uuid: d.barangay_id || null,
  report_id: d.report_id || null,
  report_code: d.report_code || '',
  event_name: d.event_name || '',
  hazard_type: d.hazard_type || '',
  assessed_on: d.assessed_on || '',
  affected_families: int(d.affected_families),
  affected_persons: int(d.affected_persons),
  displaced_families: int(d.displaced_families),
  displaced_persons: int(d.displaced_persons),
  dead: int(d.dead),
  injured: int(d.injured),
  missing: int(d.missing),
  houses_totally: int(d.houses_totally),
  houses_partially: int(d.houses_partially),
  infra_damage_php: int(d.infra_damage_php),
  agri_damage_php: int(d.agri_damage_php),
  infra_notes: d.infra_notes || '',
  agri_notes: d.agri_notes || '',
  power_status: d.power_status || 'Not assessed',
  water_status: d.water_status || 'Not assessed',
  comms_status: d.comms_status || 'Not assessed',
  needs: Array.isArray(d.needs) ? d.needs : [],
  needs_notes: d.needs_notes || '',
  remarks: d.remarks || '',
  status: d.status || 'draft',
  assessed_by_name: d.assessed_by_name || '',
  updated_at: d.updated_at || null,
});

const toSitrep = (r: Row): SituationReport => ({
  id: r.id,
  sitrep_no: int(r.sitrep_no),
  event_name: r.event_name || '',
  period_from: r.period_from || null,
  period_to: r.period_to || null,
  barangay: r.barangay || '',
  summary: r.summary && typeof r.summary === 'object' ? r.summary : {},
  remarks: r.remarks || '',
  prepared_by_name: r.prepared_by_name || '',
  created_at: r.created_at,
});

export async function loadDocumentation(): Promise<void> {
  const c = client();
  const [dna, sitreps] = await Promise.all([
    c.from('damage_assessments').select('*').order('assessed_on', { ascending: false }).limit(500),
    c.from('situation_reports').select('*').order('created_at', { ascending: false }).limit(100),
  ]);
  if (dna.error) fail(dna.error);
  set({
    assessments: (dna.data || []).map(toAssessment),
    sitreps: sitreps.error ? [] : (sitreps.data || []).map(toSitrep),
  });
}

export type AssessmentInput = Omit<DamageAssessment, 'id' | 'barangay_uuid' | 'updated_at'>;

export async function saveAssessment(id: string | null, input: AssessmentInput): Promise<void> {
  const brgy = state.barangays.find((b) => b.name === input.barangay);
  const row: Row = { ...input, barangay_id: brgy ? brgy.uuid : null, report_id: input.report_id || null };
  const c = client();
  const { error } = id ? await c.from('damage_assessments').update(row).eq('id', id) : await c.from('damage_assessments').insert(row);
  if (error) fail(error);
  await loadDocumentation();
}

export async function deleteAssessment(id: string): Promise<void> {
  const { error } = await client().from('damage_assessments').delete().eq('id', id);
  if (error) fail(error);
  await loadDocumentation();
}

export async function saveSitrep(input: Omit<SituationReport, 'id' | 'created_at'>): Promise<void> {
  const brgy = input.barangay ? state.barangays.find((b) => b.name === input.barangay) : null;
  const { error } = await client()
    .from('situation_reports')
    .insert({ ...input, barangay_id: brgy ? brgy.uuid : null });
  if (error) fail(error);
  await loadDocumentation();
}

/* -------------------------------------------------- shelter occupancy trend */
export async function loadShelterTrend(): Promise<void> {
  const { data, error } = await client().from('analytics_shelter_trend').select('*').order('day').limit(60);
  if (error) {
    set({ shelterTrend: [] });
    return;
  }
  set({
    shelterTrend: (data || []).map((d: Row) => ({ day: d.day, occupancy: int(d.occupancy), capacity: int(d.capacity) })),
  });
}

/* ------------------------------------------- dispatches for the documents */
export interface DispatchLogRow {
  report_id: string;
  report_code: string;
  barangay: string;
  team: string;
  status: string;
  dispatched_at: string;
  eta: string | null;
  instructions: string;
  after_action: string;
  report_created_at: string | null;
}

export async function dispatchLog(opts: { from?: string; to?: string; reportId?: string }): Promise<DispatchLogRow[]> {
  if (!supabase) return [];
  let q = supabase
    .from('report_dispatches')
    .select('report_id, team, dispatch_status, dispatched_at, eta, instructions, after_action, report:reports(code, barangay, created_at)')
    .order('dispatched_at', { ascending: false })
    .limit(500);
  if (opts.reportId) q = q.eq('report_id', opts.reportId);
  // the dates are local days; send the exact instants so the server (UTC) agrees
  if (opts.from) q = q.gte('dispatched_at', new Date(`${opts.from}T00:00:00`).toISOString());
  if (opts.to) q = q.lte('dispatched_at', new Date(`${opts.to}T23:59:59.999`).toISOString());
  const { data, error } = await q;
  if (error) return [];
  return (data || []).map((d: Row) => {
    const rep: Row = Array.isArray(d.report) ? d.report[0] || {} : d.report || {};
    return {
      report_id: d.report_id,
      report_code: rep.code || '',
      barangay: rep.barangay || '',
      team: d.team || '',
      status: d.dispatch_status || 'sent',
      dispatched_at: d.dispatched_at,
      eta: d.eta || null,
      instructions: d.instructions || '',
      after_action: d.after_action || '',
      report_created_at: rep.created_at || null,
    };
  });
}

// Lets the person retry or discard a row the server kept refusing.
export async function retryQueued(id: number): Promise<number> {
  const row = (await offline.listQueue()).find((r) => r.id === id);
  if (row) await offline.updateQueueRow({ ...row, failed: false, attempts: 0 });
  return flushQueue();
}

export async function discardQueued(id: number): Promise<void> {
  await offline.removeFromQueue(id);
  await refreshQueue();
}

/* ------------------------------------------------- organisation profile */
export async function loadOrgProfile(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.rpc('org_profile');
  if (error || !data) return;
  set({ org: { ...DEFAULT_ORG, ...(data as Partial<OrgProfile>) } });
}

/* ---------------------------------------------- alerts on this phone (push) */
export type PushStatus = 'on' | 'off' | 'blocked' | 'unsupported';
export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/* ------------------------------------------------------- message templates */
export interface MessageTemplate {
  id: string;
  category: 'evacuation_order' | 'weather_advisory' | 'road_closure' | 'general';
  label: string;
  title_en: string;
  body_en: string;
  title_fil: string;
  body_fil: string;
  placeholders: string[];
}

const toTemplate = (r: Row): MessageTemplate => ({
  id: r.id,
  category: r.category || 'general',
  label: r.label || '',
  title_en: r.title_en || '',
  body_en: r.body_en || '',
  title_fil: r.title_fil || '',
  body_fil: r.body_fil || '',
  placeholders: Array.isArray(r.placeholders) ? r.placeholders : [],
});

// {barangay}, {center} ... found in a template's text
export const templatePlaceholders = (...texts: string[]) =>
  Array.from(new Set(texts.join(' ').match(/\{\w+\}/g) || []));

export async function loadTemplates(): Promise<MessageTemplate[]> {
  const { data, error } = await client().from('message_templates').select('*').order('category').order('label');
  if (error) fail(error);
  return (data || []).map(toTemplate);
}

export async function saveTemplate(id: string | null, input: Omit<MessageTemplate, 'id' | 'placeholders'>): Promise<void> {
  const row = { ...input, placeholders: templatePlaceholders(input.title_en, input.body_en, input.title_fil, input.body_fil), updated_at: new Date().toISOString() };
  const c = client();
  const { error } = id ? await c.from('message_templates').update(row).eq('id', id) : await c.from('message_templates').insert(row);
  if (error) fail(error);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await client().from('message_templates').delete().eq('id', id);
  if (error) fail(error);
}

export const fillTemplate = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (m, k) => (values[k] ? values[k] : m));

/* --------------------------------------- organisation profile (Super Admin) */
export async function saveOrgProfile(org: OrgProfile): Promise<void> {
  const c = client();
  const { data, error } = await c.from('app_settings').select('value').eq('key', 'main').maybeSingle();
  if (error) fail(error);
  const value = { ...((data && data.value) || {}), org };
  const { error: e2 } = await c.from('app_settings').upsert({ key: 'main', value, updated_at: new Date().toISOString() });
  if (e2) fail(e2);
  await loadOrgProfile();
}
