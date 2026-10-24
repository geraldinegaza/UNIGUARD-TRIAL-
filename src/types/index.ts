export type UserRole = 'citizen' | 'barangay' | 'lgu_admin' | 'dispatch' | 'super_admin';

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  role: UserRole;
  barangay_id?: string; // barangay slug; undefined for LGU admin
  barangay_name?: string;
  barangay_uuid?: string | null;
  disabled?: boolean;
  /** dispatch_team accounts: the unit they belong to and their place in it */
  dispatch_unit_id?: string | null;
  unit_role?: '' | 'unit_admin' | 'member';
  created_at: string;
}

export interface Barangay {
  id: string; // slug of the name, used for filtering and display
  uuid: string | null; // public.barangays.id
  name: string;
  city: string;
}

// Canonical labels from src/lib/hazards.ts. "Others: <text>" is shown when a
// resident typed their own description.
export type HazardType = string;

export type IncidentStatus = 'unverified' | 'verified' | 'dispatched' | 'resolved' | 'rejected';

export type ReportSeverity = 'advisory' | 'warning' | 'emergency';

export interface IncidentReport {
  id: string; // public.reports.id
  code: string; // UG-YYYY-NNNN
  reporter_id: string | null;
  is_mine: boolean;
  barangay_id: string;
  barangay_name: string;
  hazard_type: HazardType;
  hazard_key: string;
  hazard_other_text: string;
  description: string;
  photo_path?: string | null;
  photo_url?: string;
  has_location: boolean;
  latitude: number;
  longitude: number;
  status: IncidentStatus;
  severity: ReportSeverity;
  urgency?: string;
  corroboration_count: number;
  assigned_units: number;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  is_offline_synced?: boolean;
  /** who verified it: a barangay official, or the LGU as the fallback */
  verified_by_role?: string | null;
  verified_by_name?: string | null;
  /** unverified for more than 30 minutes (escalation policy) */
  is_stale?: boolean;
  /** life-safety hazard shown to the LGU without waiting for the barangay */
  is_severity_bypass?: boolean;
  /** surfaced in the LGU verification queue */
  escalates_to_lgu?: boolean;
}

export interface StatusHistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  reason: string;
  note: string;
  created_at: string;
}

export interface Responder {
  id: string;
  name: string;
  unit: string;
  contact: string;
}

export type AdvisoryType = 'emergency_alert' | 'preparedness';
export type AdvisorySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Advisory {
  id: string;
  author_id: string | null;
  title: string;
  content: string;
  type: AdvisoryType;
  severity: AdvisorySeverity;
  affected_area: string;
  target_barangay_id?: string | null; // null represents municipality-wide
  expires_at?: string | null;
  created_at: string;
}

export type EvacuationStatus = 'open' | 'full' | 'closed';

export interface EvacuationCenter {
  id: string;
  barangay_id: string;
  barangay_name: string;
  name: string;
  address: string;
  capacity: number;
  current_occupancy: number;
  status: EvacuationStatus;
  has_location: boolean;
  latitude: number;
  longitude: number;
  notes?: string;
  facilities?: string[];
  contact_person?: string;
  contact_phone?: string;
}

export interface EmergencyHotline {
  id: string;
  agency_name: string;
  contact_number: string;
  scope: string;
  description: string;
  active: boolean;
  category?: string;
}

/** A proposed change to protected data (hotlines), applied only once the Super Admin approves it. */
export interface ChangeRequest {
  id: string;
  requester_name: string;
  requester_role: string;
  requester_barangay: string;
  target_table: string;
  target_id: string | null;
  action: 'add' | 'edit' | 'delete';
  current_data: Record<string, unknown>;
  proposed_data: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decision_note: string;
  decided_at: string | null;
  created_at: string;
}

export interface SystemAuditLog {
  id: string;
  timestamp: string;
  event_type: string; // audit_log.action, e.g. "report.status_changed"
  description: string;
  actor_name: string;
  target_id: string;
  entity: string;
  meta: Record<string, unknown>;
  actor_id?: string | null;
  actor_role?: string;
  actor_barangay?: string;
}

export type NotificationTone = 'emergency' | 'warning' | 'advisory' | 'prepared';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  tone: NotificationTone;
  type: string;
  created_at: string;
  unread: boolean;
  report_id?: string | null;
  advisory_id?: string | null;
  road_work_id?: string | null;
  sos_id?: string | null;
  relief_id?: string | null;
}

export interface ReliefDistribution {
  id: string;
  barangay: string;
  title: string;
  location_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  distribution_at: string | null;
  contact_person: string;
  contact_phone: string;
  eligibility: string[];
  required_docs: string[];
  note: string;
  active: boolean;
}

export interface Beneficiary {
  id: string;
  barangay: string;
  beneficiary_name: string;
  claimant_name: string;
  claimant_id: string;
  category: string;
  valid_until: string | null;
  active: boolean;
}

export type GuidePhase = 'before' | 'during' | 'after';


// The database keeps one guide per topic with Before / During / After
// sections; the screens list one entry per phase, so a guide is unpacked into
// up to three entries that share guide_id.
export interface PreparednessGuide {
  id: string;
  guide_id: string;
  summary?: string;
  hazard_type: string;
  phase: GuidePhase;
  title: string;
  body: string;
  sort_order: number;
  active: boolean;
}

export interface Faq {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  active: boolean;
}

export interface RoadWork {
  id: string;
  title: string;
  description: string;
  barangay: string;
  road_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  expected_start: string | null;
  expected_end: string | null;
  citywide: boolean;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
}

export type RoadCondition = 'passable' | 'one_lane' | 'blocked' | 'under_repair';

export interface RoadStatus {
  id: string;
  road_name: string;
  barangay: string;
  status: RoadCondition;
  note: string;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
  segment_from?: string;
  segment_to?: string;
  cause?: RoadCause;
  severity?: string;
  started_at?: string | null;
  estimated_reopen?: string | null;
  updater_name?: string;
}

export type RoadCause = '' | 'flood' | 'landslide' | 'repair' | 'accident' | 'other';

export interface SosEntry {
  id: string;
  profile_name: string;
  profile_phone: string;
  barangay: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  note: string;
  status: 'sent' | 'acknowledged' | 'resolved';
  created_at: string;
}

export interface OthersReviewRow {
  description: string;
  occurrences: number;
  latest_at: string;
}

export interface QueuedReport {
  id: number;
  queued_at: string;
  kind: 'report' | 'sos';
  hazard_type?: string;
  hazard_other_text?: string;
  barangay?: string;
  description?: string;
  severity?: ReportSeverity;
  lat: number | null;
  lng: number | null;
  accuracy?: number | null;
  photo?: Blob | null; // compressed photo, uploaded when the queue flushes
  /** times the server refused this row; after 5 it is marked failed */
  attempts?: number;
  failed?: boolean;
  last_error?: string;
}

/* ------------------------------------------------------------- dispatch units */
export type UnitType = 'BFP' | 'PNP' | 'Rescue' | 'Hospital';
export type DispatchStage = 'sent' | 'acknowledged' | 'en_route' | 'on_scene' | 'done';

export interface DispatchUnit {
  id: string;
  name: string;
  unit_type: UnitType;
  contact_number: string;
  address: string;
  status: 'available' | 'on_duty' | 'off_duty';
  active: boolean;
  created_at: string;
}

/** A dispatch: a team (and for BFP / PNP / Rescue, a unit) sent to a verified report */
export interface Dispatch {
  id: string;
  report_id: string;
  team: string;
  instructions: string;
  eta: string | null;
  dispatched_by_name: string;
  dispatched_at: string;
  unit_id: string | null;
  dispatch_status: DispatchStage;
  ack_at: string | null;
  en_route_at: string | null;
  on_scene_at: string | null;
  done_at: string | null;
  after_action: string;
  report: {
    code: string;
    hazard_type: string;
    description: string;
    barangay: string;
    severity: string;
    status: string;
    lat: number | null;
    lng: number | null;
    created_at: string;
  } | null;
}

export interface UnitPersonnel {
  id: string;
  unit_id: string;
  name: string;
  role: string;
  phone: string;
  on_duty: boolean;
}

export interface UnitEquipment {
  id: string;
  label: string;
  identifier: string;
  status: 'available' | 'deployed' | 'maintenance' | 'unavailable';
  condition: string;
  last_checked_at: string | null;
  notes: string;
}

export interface UnitRequest {
  id: string;
  unit_id: string;
  kind: string;
  details: string;
  status: 'pending' | 'approved' | 'declined' | 'done';
  created_at: string;
  decided_at: string | null;
}

export interface HospitalCapacity {
  er_beds: number;
  icu_beds: number;
  available: number;
  accepting: boolean;
  updated_at: string | null;
}

/* ------------------------------------------------ Phase 3: operations data */
export type InventoryCategory = 'Food' | 'Water' | 'Medical' | 'Equipment' | 'Shelter Supplies' | 'Hygiene';

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  unit: string;
  stock: number;
  reorder: number;
  location: string;
  supplier: string;
  updated_at: string | null;
}

export interface DistributionLogEntry {
  id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  barangay: string;
  family: string;
  distributed_by: string;
  distributed_at: string;
}

export type AssessmentStatus = 'draft' | 'submitted' | 'validated';

export interface DamageAssessment {
  id: string;
  barangay: string;
  barangay_uuid: string | null;
  report_id: string | null;
  report_code: string;
  event_name: string;
  hazard_type: string;
  assessed_on: string;
  affected_families: number;
  affected_persons: number;
  displaced_families: number;
  displaced_persons: number;
  dead: number;
  injured: number;
  missing: number;
  houses_totally: number;
  houses_partially: number;
  infra_damage_php: number;
  agri_damage_php: number;
  infra_notes: string;
  agri_notes: string;
  power_status: string;
  water_status: string;
  comms_status: string;
  needs: string[];
  needs_notes: string;
  remarks: string;
  status: AssessmentStatus;
  assessed_by_name: string;
  updated_at: string | null;
}

export interface SituationReport {
  id: string;
  sitrep_no: number;
  event_name: string;
  period_from: string | null;
  period_to: string | null;
  barangay: string;
  summary: Record<string, number>;
  remarks: string;
  prepared_by_name: string;
  created_at: string;
}

export interface OverdueReport {
  id: string;
  code: string;
  hazard_type: string;
  barangay: string;
  severity: string;
  description: string;
  created_at: string;
  minutes: number;
}

export interface ShelterTrendPoint {
  day: string;
  occupancy: number;
  capacity: number;
}
