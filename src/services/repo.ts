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
}

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

function fail(error: { message?: string } | null): never {
  throw new Error((error && error.message) || 'Request failed');
}

/* ------------------------------------------------------- role adaptation */
const ROLE_FROM_DB: Record<string, UserRole> = {
  citizen: 'citizen',
  barangay_official: 'barangay',
  lgu_ldrrmc: 'lgu_admin',
};
const ROLE_TO_DB: Record<UserRole, string> = {
  citizen: 'citizen',
  barangay: 'barangay_official',
  lgu_admin: 'lgu_ldrrmc',
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
    role: ROLE_FROM_DB[p.role] || 'citizen',
    barangay_id: p.barangay ? barangaySlug(p.barangay) : undefined,
    barangay_name: p.barangay || '',
    barangay_uuid: p.barangay_id || null,
    disabled: !!p.disabled,
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
    is_mine: !!state.user && r.reporter_id === state.user.id,
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

const toGuide = (g: Row): PreparednessGuide => ({
  id: g.id,
  hazard_type: g.hazard_type || '',
  phase: (g.phase || 'before') as GuidePhase,
  title: g.title || '',
  body: g.body || '',
  sort_order: g.sort_order || 0,
  active: g.active !== false,
});

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
  status: (r.status || 'passable') as RoadCondition,
  note: r.note || '',
  lat: num(r.lat),
  lng: num(r.lng),
  updated_at: r.updated_at || null,
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
    if (!guides.error) patch.guides = (guides.data || []).map(toGuide);
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
  if (!user) {
    unsubscribeRealtime();
    set({
      reports: [], notifications: [], beneficiaries: [], sosLog: [], othersReview: [], users: [], audit: [], responders: [],
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
      hazard_type: input.hazard_type,
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
  if (!isOnline()) {
    await offline.enqueue({
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
  }
  const row = await insertReport(input, 'draft');
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
  // Web push to subscribed devices. The gateway only accepts LGU callers, and
  // the in-app notification above has already been delivered either way.
  if (state.user && state.user.role === 'lgu_admin') {
    c.functions
      .invoke('push-dispatch', {
        body: {
          title: input.title,
          body: input.content,
          severity: SEVERITY_TO_DB[input.severity],
          advisoryId: data.id,
          area: target ? target.name : PLACE.areaAll,
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
  updates: Partial<Pick<EvacuationCenter, 'status' | 'current_occupancy' | 'capacity'>>
): Promise<void> {
  const patch: Row = {};
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

export async function createGuide(input: GuideInput): Promise<void> {
  const { error } = await client().from('preparedness_guides').insert(input);
  if (error) fail(error);
  await loadAll();
}

export async function updateGuide(id: string, patch: Partial<GuideInput>): Promise<void> {
  const { error } = await client().from('preparedness_guides').update(patch).eq('id', id);
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

export type RoadStatusInput = Pick<RoadStatus, 'road_name' | 'barangay' | 'status' | 'note' | 'lat' | 'lng'>;

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
  if (!isOnline()) {
    await offline.enqueue({ kind: 'sos', lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, description: note });
    await refreshQueue();
    requestBackgroundSync();
    return { id: null, reach: null, queued: true };
  }
  const { data, error } = await client().rpc('submit_sos', {
    p_lat: pos.lat,
    p_lng: pos.lng,
    p_accuracy: pos.accuracy,
    p_note: note,
  });
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
      const detail = Object.keys(meta)
        .map((k) => `${k}: ${typeof meta[k] === 'object' ? JSON.stringify(meta[k]) : meta[k]}`)
        .join(' · ');
      return [a.entity, detail].filter(Boolean).join(' — ');
    }
  }
}

/* ----------------------------------------------------------- offline queue */
async function refreshQueue() {
  set({ queue: await offline.listQueue() });
}

// Called on reconnect and on a timer while the app is open.
let flushing = false;
export async function flushQueue(): Promise<number> {
  if (flushing || !isOnline() || !state.user) return 0;
  flushing = true;
  let sent = 0;
  try {
    const rows = await offline.listQueue();
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
      } catch {
        break;
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
export async function enablePush(): Promise<boolean> {
  if (!pushSupported() || !supabase || !state.user || Notification.permission === 'denied') return false;
  if (pushAttempted) return Notification.permission === 'granted';
  pushAttempted = true;
  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') return false;
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
