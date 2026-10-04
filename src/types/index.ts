export type UserRole = 'citizen' | 'barangay' | 'lgu_admin';

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
}

export interface EmergencyHotline {
  id: string;
  agency_name: string;
  contact_number: string;
  scope: string;
  description: string;
  active: boolean;
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

export interface PreparednessGuide {
  id: string;
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

export type RoadCondition = 'passable' | 'caution' | 'blocked';

export interface RoadStatus {
  id: string;
  road_name: string;
  barangay: string;
  status: RoadCondition;
  note: string;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
}

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
}
