import { t } from '../lib/i18n';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  HeartHandshake,
  BookOpen,
  HelpCircle,
  Package,
  Clock,
  MapPin,
  Phone,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  FileText,
  Waves,
  Flame,
  Check,
  Search,
  Info,
  UserCheck,
  IdCard,
  Building,
  User,
  Maximize2,
  Minimize2,
  X,
  Filter,
  Download
} from 'lucide-react';
import { Barangay, User as UserType } from '../types';
import { exportGuidesPdf } from '../lib/pdf';
import { useRepo } from '../hooks/useRepo';
import { GUIDE_HAZARDS } from '../lib/hazards';
import { telHref } from '../lib/util';
import { hasCoords, wazeUrl } from '../lib/geo';
import { ItemFocus, useFocusItem } from '../hooks/useFocusItem';

interface ReliefDistributionHub {
  id: string;
  barangay: string;
  location: string;
  schedule: string;
  status: 'Distributing Now' | 'Scheduled' | 'Completed';
  contactPerson: string;
  contactPhone: string;
  address: string;
  lat: number | null;
  lng: number | null;
  eligibility: string[];
  requiredDocs: string[];
  note: string;
}

const formatSchedule = (iso: string | null) => {
  if (!iso) return 'To be announced';
  const t = Date.parse(iso);
  if (isNaN(t)) return 'To be announced';
  return new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// A distribution is "now" on its scheduled day, upcoming before it and completed after
const scheduleStatus = (iso: string | null): ReliefDistributionHub['status'] => {
  if (!iso) return 'Scheduled';
  const day = new Date(iso);
  const today = new Date();
  if (day.toDateString() === today.toDateString()) return 'Distributing Now';
  return day.getTime() > today.getTime() ? 'Scheduled' : 'Completed';
};

// One distribution: where and when, who qualifies, what to bring, and a way to
// get there or call the desk.
const ReliefHubCard: React.FC<{ hub: ReliefDistributionHub; id?: string }> = ({ hub, id }) => (
  <div id={id} className="bg-white rounded-3xl border border-neutral-100 p-6 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between space-y-4">
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-black uppercase text-red-900 tracking-wider">Brgy. {hub.barangay}</span>
          <h4 className="text-sm sm:text-base font-extrabold text-neutral-900 mt-1 break-words">{hub.location}</h4>
        </div>
        <span
          className={`text-[10px] font-black uppercase px-3 py-1 rounded-full shrink-0 shadow-xs ${
            hub.status === 'Distributing Now' ? 'bg-red-900 text-white' : 'bg-neutral-900 text-white'
          }`}
        >
          {hub.status}
        </span>
      </div>

      <div className="space-y-2 text-xs text-neutral-600">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-neutral-400 shrink-0" />
          <span>{hub.schedule}</span>
        </div>
        {hub.contactPerson && (
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-neutral-400 shrink-0" />
            <span className="font-semibold text-neutral-800">{hub.contactPerson}</span>
          </div>
        )}
      </div>

      {hub.eligibility.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">{t("Eligibility")}</p>
          <ul className="text-xs text-neutral-700 space-y-0.5">
            {hub.eligibility.map((e) => (
              <li key={e} className="flex items-start gap-1.5">
                <Check className="w-3.5 h-3.5 text-red-900 shrink-0 mt-px" />
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hub.requiredDocs.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">{t("Bring these documents")}</p>
          <ul className="text-xs text-neutral-700 space-y-0.5">
            {hub.requiredDocs.map((d) => (
              <li key={d} className="flex items-start gap-1.5">
                <FileText className="w-3.5 h-3.5 text-red-900 shrink-0 mt-px" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hub.note && <p className="text-xs text-neutral-600 leading-relaxed">{hub.note}</p>}
    </div>

    <div className="pt-3 border-t border-neutral-100 flex items-center gap-2 text-xs">
      {hasCoords(hub.lat, hub.lng) ? (
        <a
          href={wazeUrl(hub.lat as number, hub.lng as number)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-900 hover:bg-red-950 text-white font-bold transition-all active:scale-95"
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>{t("Navigate")}</span>
        </a>
      ) : (
        <span className="flex-1 text-neutral-400">{t("No coordinates on file for this distribution.")}</span>
      )}
      {hub.contactPhone && (
        <a
          href={telHref(hub.contactPhone)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-900 hover:bg-red-900 hover:text-white border border-red-900/20 font-bold transition-all active:scale-95 shrink-0"
        >
          <Phone className="w-3.5 h-3.5" />
          <span>{t("Call")}</span>
        </a>
      )}
    </div>
  </div>
);

export const ResidentReliefView: React.FC<{ barangays: Barangay[]; currentUser: UserType; focus?: ItemFocus }> = ({
  currentUser,
  focus,
}) => {
  const { relief } = useRepo();

  // A resident sees the relief for their own barangay and the municipality-wide
  // distributions, never another barangay's (the database applies the same rule)
  const userBarangayName = currentUser?.barangay_name || '';
  const [isScheduleMinimized, setIsScheduleMinimized] = useState<boolean>(false);
  const [isViewAllModalOpen, setIsViewAllModalOpen] = useState<boolean>(false);
  const [criteriaTab, setCriteriaTab] = useState<'all' | 'eligibility' | 'documents'>('all');


  // Active relief distributions published by the LGU
  const activeHubs: ReliefDistributionHub[] = useMemo(
    () =>
      relief
        .filter((r) => r.active)
        .map((r) => ({
          id: r.id,
          barangay: r.barangay,
          location: [r.title, r.location_name, r.address].filter(Boolean).join(' · '),
          schedule: formatSchedule(r.distribution_at),
          status: scheduleStatus(r.distribution_at),
          contactPerson: [r.contact_person, r.contact_phone].filter(Boolean).join(' - '),
          contactPhone: r.contact_phone,
          address: r.address,
          lat: r.lat,
          lng: r.lng,
          eligibility: r.eligibility,
          requiredDocs: r.required_docs,
          note: r.note,
        })),
    [relief]
  );

  // opened on one distribution (a map popup or a notification): show its
  // barangay, expand the schedules and bring the card into view
  useEffect(() => {
    if (!focus) return;
    if (!activeHubs.some((h) => h.id === focus.id)) return;
    setIsScheduleMinimized(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, activeHubs.length]);
  useFocusItem(focus ? `relief-${focus.id}` : null, `${focus?.key}-${activeHubs.length}`);

  // this barangay's distributions and the municipality-wide ones
  const filteredHubs = useMemo(() => {
    const mine = userBarangayName.toLowerCase();
    return activeHubs.filter((hub) => !hub.barangay || !mine || hub.barangay.toLowerCase() === mine);
  }, [userBarangayName, activeHubs]);

  // Eligibility and documents published for the distributions being shown
  const eligibilityList = useMemo(() => Array.from(new Set(filteredHubs.flatMap((h) => h.eligibility))), [filteredHubs]);
  const requiredDocsList = useMemo(() => Array.from(new Set(filteredHubs.flatMap((h) => h.requiredDocs))), [filteredHubs]);


  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {/* 1. Header Banner matching Dark Red Hero Palette */}
      <div className="rounded-3xl p-7 sm:p-8 text-white shadow-2xl relative overflow-hidden bg-gradient-to-br from-red-800 via-red-900 to-red-950 border border-red-950/40">
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 text-white text-xs font-bold tracking-wider uppercase border border-white/20 backdrop-blur-xs shadow-sm">
            <HeartHandshake className="w-4 h-4 text-white" />
            <span>{t("Relief Assistance Information")}</span>
          </div>

          <p className="text-white/90 text-xs sm:text-sm font-medium leading-relaxed">
            {t("Relief schedules for your barangay, who is eligible, and the documents to bring.")}
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-2 text-xs font-bold text-white">
            <span className="px-3 py-1.5 rounded-xl bg-black/30 border border-white/15 shadow-2xs">
              {t("🏛️ LGU Lingayen MSWDO")}
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-black/30 border border-white/15 shadow-2xs">
              {t("📦 DSWD Standard Family Food Packs")}
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-black/30 border border-white/15 shadow-2xs">
              📍 {userBarangayName ? `Brgy. ${userBarangayName}` : t('Lingayen')}
            </span>
          </div>
        </div>

        {/* Decorative Background Motif */}
        <div className="absolute -right-6 -bottom-8 opacity-10 pointer-events-none">
          <Package className="w-56 h-56 text-white" />
        </div>
      </div>

      {/* 2. Whose relief this is: the resident's own barangay, plus municipality-wide */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 p-5 sm:p-6 shadow-xl flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-red-50 text-red-900 border border-red-100 flex items-center justify-center shrink-0">
          <MapPin className="w-4 h-4" />
        </div>
        <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
          {userBarangayName
            ? t('Relief for Barangay {name} and municipality-wide distributions.', { name: userBarangayName })
            : t('Municipality-wide relief distributions.')}
        </p>
      </div>

      {/* 3. Relief Distribution Schedules (With Minimized Pane and View All Option) */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        {/* Header matching elevated style */}
        <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-4 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shrink-0 shadow-sm">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
                {t("Relief Distribution Schedules")}
              </h2>
              <p className="text-xs text-neutral-400 font-medium">
                {t('{n} active for your barangay', { n: filteredHubs.length })}
              </p>
            </div>
          </div>

          {/* Right Action Controls: Minimize / Expand toggle + Square Dark Red View All Button */}
          <div className="flex items-center gap-3">
            {/* Minimize / Expand Toggle Button */}
            <button
              onClick={() => setIsScheduleMinimized((prev) => !prev)}
              className="px-4 py-2 rounded-xl border border-neutral-200 hover:bg-neutral-100 text-neutral-700 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              {isScheduleMinimized ? (
                <>
                  <ChevronDown className="w-4 h-4" />
                  <span>{t("Expand List")}</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-4 h-4" />
                  <span>{t("Minimize")}</span>
                </>
              )}
            </button>

            {/* Dark Red Square Button with View All text below */}
            <div className="flex flex-col items-center shrink-0 ml-1">
              <button
                onClick={() => setIsViewAllModalOpen(true)}
                className="w-10 h-10 rounded-xl bg-red-900 hover:bg-red-800 text-white flex items-center justify-center transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
                title={t("View All Relief Schedules")}
                aria-label={t("View All Relief Schedules")}
              >
                <Maximize2 className="w-4 h-4 text-white" />
              </button>
              <span className="text-[10px] text-neutral-400 font-semibold tracking-tight leading-none mt-1 select-none">
                {t("View All")}
              </span>
            </div>
          </div>
        </div>

        {/* Schedule Body: Normal or Minimized Scroll Pane */}
        {!isScheduleMinimized && (
          <div className="p-6 sm:p-7 max-h-[500px] overflow-y-auto">
            {filteredHubs.length === 0 ? (
              /* Empty State */
              <div className="p-8 sm:p-12 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-900/20 text-red-900 mx-auto flex items-center justify-center shadow-sm">
                  <Info className="w-7 h-7" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-neutral-900">
                  {t('No relief distribution scheduled for your barangay yet')}
                </h3>
                <p className="text-xs sm:text-sm text-neutral-500 max-w-md mx-auto">
                  {t('New schedules appear here and in your notifications. Your barangay desk can tell you about pending distributions.')}
                </p>
              </div>
            ) : (
              /* Active Distribution Cards Grid */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {filteredHubs.map((hub) => <ReliefHubCard key={hub.id} id={`relief-${hub.id}`} hub={hub} />)}
              </div>
            )}
          </div>
        )}

        {/* When Minimized: Compact Banner with quick stats and expand button */}
        {isScheduleMinimized && (
          <div className="p-5 bg-neutral-50/80 flex items-center justify-between text-xs text-neutral-600">
            <span className="font-semibold">
              Relief schedules minimized ({filteredHubs.length} distribution {filteredHubs.length === 1 ? 'hub' : 'hubs'} active for your barangay)
            </span>
            <button
              onClick={() => setIsScheduleMinimized(false)}
              className="text-red-900 font-bold hover:underline cursor-pointer"
            >
              {t("Expand to View Cards")}
            </button>
          </div>
        )}
      </div>

      {/* View All Relief Schedules Modal */}
      {isViewAllModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl border border-neutral-100 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-neutral-100 flex items-center justify-between bg-neutral-900 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold tracking-tight text-white">
                    {t("All Municipal Relief Distribution Schedules")}
                  </h3>
                  <p className="text-xs text-white/80">
                    {t("Every schedule for your barangay and the municipality")}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsViewAllModalOpen(false)}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredHubs.map((hub) => <ReliefHubCard key={hub.id} hub={hub} />)}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-neutral-100 bg-neutral-50 flex items-center justify-between text-xs text-neutral-500">
              <span>Official Lingayen MSWDO & DSWD Relief Registry</span>
              <button
                onClick={() => setIsViewAllModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition-all cursor-pointer shadow-md"
              >
                {t("Close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Structured Cards: Eligibility Criteria & Required Documents with Segmented Controls */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-50 text-red-900 border border-red-100 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
            <h3 className="text-xs sm:text-sm font-extrabold text-neutral-900 uppercase tracking-wider">
              Claiming Rules & Guidelines
            </h3>
          </div>

          {/* Quick Segmented Filter */}
          <div className="flex items-center gap-1.5 p-1 bg-neutral-100 rounded-2xl self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setCriteriaTab('all')}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                criteriaTab === 'all'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t("All Requirements")}
            </button>
            <button
              type="button"
              onClick={() => setCriteriaTab('eligibility')}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                criteriaTab === 'eligibility'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t("Eligibility")}
            </button>
            <button
              type="button"
              onClick={() => setCriteriaTab('documents')}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                criteriaTab === 'documents'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t("Required IDs")}
            </button>
          </div>
        </div>

        <div className={`grid gap-6 ${criteriaTab === 'all' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
          {/* Card A: Eligibility Criteria */}
          {(criteriaTab === 'all' || criteriaTab === 'eligibility') && (
            <div className="bg-white rounded-3xl border border-neutral-100/80 p-6 sm:p-7 shadow-xl hover:shadow-2xl transition-shadow space-y-4">
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shrink-0 shadow-sm">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-extrabold text-neutral-900">
                    Eligibility & Allocation Criteria
                  </h4>
                  <p className="text-xs text-neutral-400">{t("Lingayen MSWDO Calamity Guidelines")}</p>
                </div>
              </div>

              <ul className="text-xs sm:text-sm text-neutral-600 space-y-3">
                {eligibilityList.length === 0 && (
                  <li className="text-neutral-400">{t("No eligibility criteria published for this barangay yet.")}</li>
                )}
                {eligibilityList.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-red-900 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Card B: Required Documents */}
          {(criteriaTab === 'all' || criteriaTab === 'documents') && (
            <div className="bg-white rounded-3xl border border-neutral-100/80 p-6 sm:p-7 shadow-xl hover:shadow-2xl transition-shadow space-y-4">
              <div className="flex items-center gap-3 border-b border-neutral-100 pb-3">
                <div className="w-10 h-10 rounded-2xl bg-neutral-100 text-neutral-900 flex items-center justify-center shrink-0 shadow-sm">
                  <IdCard className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-extrabold text-neutral-900">
                    {t("Required Documents for Claiming")}
                  </h4>
                  <p className="text-xs text-neutral-400">{t("Bring valid proof of residency")}</p>
                </div>
              </div>

              <ul className="text-xs sm:text-sm text-neutral-600 space-y-3">
                {requiredDocsList.length === 0 && (
                  <li className="text-neutral-400">{t("No required documents published for this barangay yet.")}</li>
                )}
                {requiredDocsList.map((item, idx) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-lg bg-neutral-100 text-neutral-900 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                      {idx + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* 6. Notice Banner: Claiming on Behalf of a Named Beneficiary */}
      <div className="rounded-3xl border border-red-950/40 bg-gradient-to-br from-red-800 via-red-900 to-red-950 p-6 sm:p-7 text-white shadow-xl flex items-start gap-4">
        <Info className="w-5 h-5 text-white shrink-0 mt-0.5" />
        <div className="text-xs sm:text-sm space-y-1.5">
          <p className="font-extrabold text-white">{t("Notice for Authorized Representatives:")}</p>
          <p className="text-red-100/90 leading-relaxed">
            {t("If you are claiming on behalf of a named beneficiary, the distribution desk will check you against the authorized-names list. Search it from the verification tool above and ensure you have a signed authorization letter and proof of identification ready.")}
          </p>
        </div>
      </div>
    </div>
  );
};

export const ResidentGuidesView: React.FC = () => {
  const [selectedHazard, setSelectedHazard] = useState<string>('Flood');
  const [selectedPhase, setSelectedPhase] = useState<'Before' | 'During' | 'After'>('Before');
  const [isHazardDropdownOpen, setIsHazardDropdownOpen] = useState<boolean>(false);
  const [hazardSearchFilter, setHazardSearchFilter] = useState<string>('');
  const hazardDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (hazardDropdownRef.current && !hazardDropdownRef.current.contains(event.target as Node)) {
        setIsHazardDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // The same canonical hazard list the report form uses, plus "General"
  const ALL_HAZARDS = GUIDE_HAZARDS;
  const { guides } = useRepo();

  const filteredHazards = useMemo(() => {
    if (!hazardSearchFilter.trim()) return ALL_HAZARDS;
    const q = hazardSearchFilter.toLowerCase().trim();
    return ALL_HAZARDS.filter((h) => h.toLowerCase().includes(q));
  }, [hazardSearchFilter]);

  // Guides published by the LGU for the selected hazard and phase
  const currentPhaseData = useMemo(() => {
    const phase = selectedPhase.toLowerCase();
    return {
      priorities: guides
        .filter((g) => g.active && g.hazard_type === selectedHazard && g.phase === phase)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => ({ id: g.id, title: g.title, body: g.body })),
    };
  }, [guides, selectedHazard, selectedPhase]);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {/* 1. Header Banner matching Red, Maroon, Black Palette */}
      <div className="rounded-2xl sm:rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden bg-gradient-to-br from-[#000000] via-[#4e0009] to-[#b60015] border border-[#4e0009]">
        <div className="relative z-10 max-w-3xl space-y-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 text-white text-[10px] font-black tracking-widest uppercase border border-white/20 backdrop-blur-xs">
            <BookOpen className="w-3.5 h-3.5 text-white" />
            <span>{t("Disaster Preparedness")}</span>
          </div>

          <p className="text-white/90 text-xs sm:text-sm font-medium leading-relaxed">
            {t("Step-by-step guidance for the hazards that affect Lingayen, Pangasinan. Pick a hazard, then read the Before / During / After tab.")}
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-2 text-[11px] font-bold text-white">
            <span className="px-2.5 py-1 rounded-lg bg-black/30 border border-white/10">
              {t("🛡️ 14 Hazard Types Covered")}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-black/30 border border-white/10">
              {t("⏱️ 3 Operational Lifecycle Phases")}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-black/30 border border-white/10">
              {t("📍 Lingayen Localized Protocols")}
            </span>
          </div>
        </div>

        {/* Decorative Background Motif */}
        <div className="absolute -right-6 -bottom-8 opacity-10 pointer-events-none">
          <ShieldCheck className="w-56 h-56 text-white" />
        </div>
      </div>

      {/* 2. Hazard Selector Category Pills (All 14 Hazards from Initial Draft) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h3 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span>{t("Preparedness Guides")}</span>
          </h3>
          <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
            <span>
              {t("Active Hazard:")} <strong className="text-[#d00018]">{selectedHazard}</strong>
            </span>
            <button
              type="button"
              onClick={() => exportGuidesPdf(guides, selectedHazard).catch(() => {})}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] rounded-full bg-white border border-red-900/20 text-red-900 hover:bg-red-50 font-bold cursor-pointer"
              title={t("Save this guide as a PDF to read offline")}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t("PDF")}</span>
            </button>
          </span>
        </div>

        <p className="text-xs text-slate-500">
          {t("Pick a hazard, then read the Before / During / After tab.")}
        </p>

        {/* Dropdown Selector Component for Picking a Hazard */}
        <div ref={hazardDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setIsHazardDropdownOpen((prev) => !prev)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/80 transition-colors text-xs font-bold text-slate-900 shadow-2xs cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-[#d00018]"
          >
            <div className="flex items-center gap-2.5 truncate">
              <span className="w-2 h-2 rounded-full bg-[#d00018] shrink-0" />
              <span className="truncate">{selectedHazard}</span>
              <span className="text-[10px] font-semibold text-slate-400">
                (Click to switch hazard)
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-500 transition-transform duration-200 shrink-0 ${
                isHazardDropdownOpen ? 'rotate-180 text-[#d00018]' : ''
              }`}
            />
          </button>

          {/* Dropdown Menu Popover */}
          {isHazardDropdownOpen && (
            <div className="absolute left-0 right-0 mt-2 bg-white rounded-2xl border border-slate-200 shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
              {/* Search Inside Dropdown */}
              <div className="px-3 pb-2 pt-1 border-b border-slate-100">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={hazardSearchFilter}
                    onChange={(e) => setHazardSearchFilter(e.target.value)}
                    placeholder={t("Search hazard type...")}
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-[#d00018]"
                    autoFocus
                  />
                </div>
              </div>

              {/* Hazards Options List */}
              <div className="max-h-60 overflow-y-auto py-1">
                {filteredHazards.map((hName) => {
                  const isCurrent = selectedHazard === hName;
                  return (
                    <button
                      key={hName}
                      type="button"
                      onClick={() => {
                        setSelectedHazard(hName);
                        setIsHazardDropdownOpen(false);
                        setHazardSearchFilter('');
                      }}
                      className={`w-full px-4 py-2 text-left text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-white border border-[#d00018]/30 text-[#d00018] font-bold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        <span>{hName}</span>
                      </span>
                      {isCurrent && <Check className="w-3.5 h-3.5 text-[#d00018]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Three Phase Selection Tabs (Before / During / After) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-xs">
        <div className="grid grid-cols-3 gap-2">
          {(['Before', 'During', 'After'] as const).map((phase) => {
            const isPhaseActive = selectedPhase === phase;
            return (
              <button
                key={phase}
                onClick={() => setSelectedPhase(phase)}
                className={`py-3 px-4 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center justify-center cursor-pointer active:scale-98 ${
                  isPhaseActive
                    ? 'bg-[#d00018] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span>{phase}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Actionable Guide Display Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-md bg-[#d00018] text-white">
                {selectedPhase} Action Protocol
              </span>
              <span className="text-xs font-bold text-slate-500">• {selectedHazard}</span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 mt-1">
              Standard {selectedPhase} Procedures: {selectedHazard}
            </h3>
          </div>
        </div>

        {/* Priority Steps */}
        <div className="space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#d00018]" />
            <span>Essential Action Checklist ({selectedPhase})</span>
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {currentPhaseData.priorities.length === 0 && (
              <p className="text-xs text-slate-500 leading-relaxed font-medium">
                No {selectedPhase} guide for {selectedHazard} yet.
              </p>
            )}
            {currentPhaseData.priorities.map((step, idx) => (
              <div
                key={step.id}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors flex items-start gap-2.5"
              >
                <span className="w-5 h-5 rounded-md bg-[#d00018] text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  <strong>{step.title}</strong>
                  {step.title && step.body ? ' — ' : ''}
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const ResidentFaqsView: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // FAQs published by the LGU
  const store = useRepo();
  const faqs = useMemo(() => store.faqs.filter((f) => f.active), [store.faqs]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(faqs.map((f) => f.category))).sort()], [faqs]);

  // The MDRRMO line from the hotline directory, for the support card
  const mdrrmoHotline = store.hotlines.find((h) => /mdrrmo|ldrrmo/i.test(h.agency_name));

  const filteredFaqs = useMemo(() => {
    return faqs.filter((faq) => {
      const matchesCategory = selectedCategory === 'All' || faq.category === selectedCategory;
      const matchesQuery =
        !searchQuery.trim() ||
        faq.question.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        faq.answer.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchesCategory && matchesQuery;
    });
  }, [faqs, selectedCategory, searchQuery]);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {/* 1. Header Banner matching Red, Maroon, Black Palette */}
      <div className="rounded-2xl sm:rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden bg-gradient-to-br from-[#000000] via-[#4e0009] to-[#b60015] border border-[#4e0009]">
        <div className="relative z-10 max-w-3xl space-y-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 text-white text-[10px] font-black tracking-widest uppercase border border-white/20 backdrop-blur-xs">
            <HelpCircle className="w-3.5 h-3.5 text-white" />
            <span>{t("Frequently Asked Questions")}</span>
          </div>

          <p className="text-white/90 text-xs sm:text-sm font-medium leading-relaxed">
            {t("Frequently asked questions answered by the LGU. Clear guidance on emergency alerts, relief distribution, and resident services in Lingayen, Pangasinan.")}
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-2 text-[11px] font-bold text-white">
            <span className="px-2.5 py-1 rounded-lg bg-black/30 border border-white/10">
              {t("🏛️ Official LGU Lingayen Help Desk")}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-black/30 border border-white/10">
              💡 {faqs.length} Verified Answers
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-black/30 border border-white/10">
              {t("📞 24/7 Operations Support")}
            </span>
          </div>
        </div>

        {/* Decorative Background Motif */}
        <div className="absolute -right-6 -bottom-8 opacity-10 pointer-events-none">
          <HelpCircle className="w-56 h-56 text-white" />
        </div>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h3 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span>{t("Help Center Search")}</span>
          </h3>
          <span className="text-[11px] font-semibold text-slate-500">
            {filteredFaqs.length} {filteredFaqs.length === 1 ? 'article available' : 'articles available'}
          </span>
        </div>

        {/* Search Input Box (Matching Initial Draft "Search FAQs...") */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("Search FAQs...")}
            className="w-full pl-10 pr-10 py-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#d00018] focus:border-transparent bg-slate-50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick Category Filter Pills */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
                  isSelected
                    ? 'bg-[#d00018] hover:bg-[#b60015] text-white shadow-xs border border-transparent'
                    : 'bg-slate-50 hover:bg-white border border-[#d00018]/30 text-slate-700 border border-slate-200 hover:border-[#d00018]/30'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. FAQ Accordion List or Clean Empty State (Matching Screenshot) */}
      <div className="space-y-3">
        {filteredFaqs.length === 0 ? (
          /* Empty State matching initial draft: "No FAQs yet / The LGU has not published any FAQs." */
          <div className="bg-white rounded-2xl border border-slate-200 p-10 sm:p-14 text-center shadow-xs space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-white border border-[#d00018]/30 border border-[#d00018]/20 text-[#d00018] mx-auto flex items-center justify-center">
              <HelpCircle className="w-7 h-7" />
            </div>

            <h3 className="text-base sm:text-lg font-black text-slate-900">
              {t("No FAQs yet")}
            </h3>

            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
              {searchQuery
                ? `No FAQs found matching "${searchQuery}". Try a different keyword or contact the LGU desk.`
                : 'The LGU has not published any FAQs in this category.'}
            </p>

            {(searchQuery || selectedCategory !== 'All') && (
              <div className="pt-2">
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('All');
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all cursor-pointer"
                >
                  {t("Clear Search Filter")}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Accordion Articles */
          filteredFaqs.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={faq.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs transition-all hover:border-slate-300"
              >
                <button
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="w-full p-4 sm:p-5 text-left flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-white border border-[#d00018]/30 text-[#d00018] border border-[#d00018]/20 flex items-center justify-center shrink-0 font-black text-xs">
                      Q{idx + 1}
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#d00018] block">
                        {faq.category}
                      </span>
                      <span className="font-extrabold text-slate-900 text-xs sm:text-sm">
                        {faq.question}
                      </span>
                    </div>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-[#d00018] shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 pt-2 text-xs text-slate-600 leading-relaxed border-t border-slate-100 bg-slate-50/40">
                    <p className="pl-10 text-slate-700 font-medium leading-relaxed">
                      {faq.answer}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 4. Bottom Support Contact Card */}
      {mdrrmoHotline && (
      <div className="rounded-2xl border border-[#4e0009] bg-gradient-to-r from-[#000000] via-[#330006] to-[#68000c] p-4 sm:p-5 text-white shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="font-black text-white text-xs sm:text-sm">
            {t("Still have questions or need immediate assistance?")}
          </p>
          <p className="text-slate-300 text-xs">
            {t("The Lingayen MDRRMO emergency hotline desk is open 24/7 for resident inquiries.")}
          </p>
        </div>

        <a
          href={telHref(mdrrmoHotline.contact_number)}
          className="px-4 py-2.5 rounded-xl bg-[#d00018] hover:bg-[#b60015] text-white text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95 shrink-0 text-center"
        >
          Call MDRRMO {mdrrmoHotline.contact_number}
        </a>
      </div>
      )}
    </div>
  );
};
