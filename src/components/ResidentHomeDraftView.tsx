import { t } from '../lib/i18n';
import React, { useState } from 'react';
import {
  AlertTriangle,
  MapPin,
  Clock,
  Phone,
  Building2,
  Users,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
  Bell,
  CheckCircle2,
  AlertCircle,
  Flame,
  Waves,
  Zap,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { IncidentReport, Barangay, EvacuationCenter, Advisory, AdvisorySeverity, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { relTime, syncLabel, telHref } from '../lib/util';
import { openable } from '../hooks/useFocusItem';
import { StatCard } from './StatCard';

export interface ResidentHomeDraftViewProps {
  currentUser: User;
  reports: IncidentReport[];
  barangays: Barangay[];
  evacuationCenters: EvacuationCenter[];
  advisories: Advisory[];
  selectedBarangay: string;
  onOpenReportModal: () => void;
  onSelectIncidentForMap: (rep: IncidentReport) => void;
  selectedIncidentForMap: IncidentReport | null;
  setActiveTab: (tab: string) => void;
  /** opens a page on one item: a report, an advisory, a shelter */
  onOpenItem: (tab: string, id?: string | null) => void;
  isOnline: boolean;
}

export const ResidentHomeDraftView: React.FC<ResidentHomeDraftViewProps> = ({
  currentUser,
  reports,
  barangays,
  evacuationCenters,
  advisories,
  selectedBarangay,
  onOpenReportModal,
  onSelectIncidentForMap,
  selectedIncidentForMap,
  setActiveTab,
  onOpenItem,
  isOnline,
}) => {
  const { hotlines, lastSync } = useRepo();

  // Determine user's active barangay location display
  const targetBarangayId = selectedBarangay !== 'all' ? selectedBarangay : currentUser.barangay_id;
  const userBarangayObj = barangays.find((b) => b.id === targetBarangayId);
  const locationLabel = userBarangayObj
    ? `Barangay ${userBarangayObj.name}, Lingayen, Pangasinan`
    : 'Lingayen, Pangasinan';

  // 1. In Your Barangay Active Hazards Count
  const inYourBarangayCount = reports.filter(
    (r) => r.barangay_id === targetBarangayId && r.status !== 'resolved' && r.status !== 'rejected'
  ).length;

  // 2. Shelters Open Count
  const openSheltersList = evacuationCenters.filter((s) => s.status === 'open');
  const openSheltersCount = openSheltersList.length;

  // 3. Active Advisories Count
  const liveAdvisories = advisories.filter((a) => a.severity !== 'low');
  const activeAdvisoriesCount = liveAdvisories.length;

  // Resident's own reports
  const userReports = reports.filter((r) => r.is_mine);

  // Reported near you: other residents' open reports in this barangay, to confirm
  const nearReports = reports
    .filter((r) => !r.is_mine && r.barangay_id === targetBarangayId && r.status !== 'resolved' && r.status !== 'rejected')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 3);
  const [confirmed, setConfirmed] = useState<Record<string, true>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [nearNotice, setNearNotice] = useState<string | null>(null);
  // where the resident is, when the device shares it, so the server can check the 500 m rule
  const position = () =>
    new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
      );
    });
  const confirmReport = async (rep: IncidentReport) => {
    if (confirmingId) return;
    setConfirmingId(rep.id);
    setNearNotice(null);
    try {
      const res = await repo.corroborate(rep.id, '', await position());
      setConfirmed((c) => ({ ...c, [rep.id]: true }));
      setNearNotice(res.verified ? t('Thank you. Enough neighbours confirmed it, so the report is now verified.') : t('Thank you for confirming this hazard.'));
    } catch (err: any) {
      const msg = String(err?.message || '');
      // the repo words a duplicate as "This record already exists." (in the chosen language)
      if (/report_corroborations_unique|duplicate/i.test(msg) || msg === t('This record already exists.')) {
        setConfirmed((c) => ({ ...c, [rep.id]: true }));
        setNearNotice(t('You already confirmed this report.'));
      } else {
        setNearNotice(msg || t('Could not confirm the report.'));
      }
    } finally {
      setConfirmingId(null);
      setTimeout(() => setNearNotice(null), 5000);
    }
  };

  const severityBadge: Record<AdvisorySeverity, { label: string; color: string }> = {
    critical: { label: 'CRITICAL', color: 'bg-red-900' },
    high: { label: 'HIGH', color: 'bg-red-800' },
    medium: { label: 'MODERATE', color: 'bg-red-950' },
    low: { label: 'PREPAREDNESS', color: 'bg-red-950' },
  };

  // The newest advisory leads the page
  const topAdvisory = advisories[0];

  // Latest advisories
  const draftAdvisories = advisories.slice(0, 3).map((adv) => ({
    id: adv.id,
    title: adv.title,
    location: adv.affected_area,
    category: adv.type === 'preparedness' ? 'Preparedness' : 'Emergency',
    timeAgo: relTime(adv.created_at),
    severity: severityBadge[adv.severity].label,
    color: severityBadge[adv.severity].color,
    dotColor: severityBadge[adv.severity].color,
  }));

  // Open shelters
  const draftShelters = openSheltersList.slice(0, 3).map((shelter) => ({
    id: shelter.id,
    name: shelter.name,
    barangay: shelter.barangay_name,
    currentOccupancy: shelter.current_occupancy,
    capacity: shelter.capacity,
    status: 'OPEN',
  }));

  // Emergency hotlines
  const draftHotlines = hotlines.slice(0, 4).map((hotline) => ({
    id: hotline.id,
    name: hotline.agency_name,
    number: hotline.contact_number,
  }));

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {/* 1. Header Section: Subtitle, and + Report a Hazard CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <p className="text-sm sm:text-base font-semibold text-neutral-800">
            {t("Live situation for")} <span className="font-extrabold text-red-900">{locationLabel}</span>.
          </p>
        </div>

        <button
          onClick={onOpenReportModal}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-red-900 hover:bg-red-800 text-white text-xs sm:text-sm font-bold transition-all shadow-lg hover:shadow-xl cursor-pointer active:scale-95 w-fit shrink-0"
        >
          <span className="text-base font-light leading-none">+</span>
          <span>{t("Report a Hazard")}</span>
        </button>
      </div>

      {/* 2. Three figures. Each card is white and turns the signature dark red
             while hovered or focused, and opens its page when tapped. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6 w-full">
        <StatCard
          className="col-span-2 lg:col-span-1"
          label={t("In Your Barangay")}
          value={inYourBarangayCount}
          note={t("Active ground hazard reports")}
          icon={AlertTriangle}
          onOpen={() => setActiveTab('hazard_map')}
        />
        <StatCard
          label={t("Shelters Open")}
          value={openSheltersCount}
          note={t("Available for intake")}
          icon={Building2}
          onOpen={() => setActiveTab('shelters')}
        />
        <StatCard
          label={t("Active Advisories")}
          value={activeAdvisoriesCount}
          note={t("Official bulletins")}
          icon={Bell}
          onOpen={() => setActiveTab('advisories')}
        />
      </div>

      {/* 3. Hero Critical Push Alert Card (Matching Screenshot 1) */}
      {topAdvisory && (
      <div
        {...openable(() => onOpenItem('advisories', topAdvisory.id))}
        className="rounded-3xl border border-red-950/40 bg-gradient-to-br from-red-800 via-red-900 to-red-950 p-6 sm:p-8 text-white shadow-2xl relative overflow-hidden cursor-pointer hover:shadow-red-900/30 transition-all group"
      >
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="px-3 py-1 rounded-xl bg-white text-red-900 text-xs font-black uppercase tracking-wider shadow-md">
              {t(severityBadge[topAdvisory.severity].label)}
            </span>
            <span className="px-3 py-1 rounded-xl bg-red-950/80 text-white text-xs font-bold uppercase tracking-wider border border-white/20">
              {t("PUSH ALERT")}
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight group-hover:text-red-100 transition-colors">
            {topAdvisory.title}
          </h2>

          <div className="flex items-center gap-2 text-xs sm:text-sm text-red-100/90 font-medium">
            <MapPin className="w-4 h-4 text-white shrink-0" />
            <span>{topAdvisory.affected_area} • {relTime(topAdvisory.created_at)}</span>
          </div>
        </div>

        {/* Botanical / alert background accent */}
        <div className="absolute right-2 -bottom-6 opacity-10 pointer-events-none">
          <ShieldAlert className="w-48 h-48 text-white" />
        </div>
      </div>
      )}

      {/* Section: Your Reports (Matching Initial Draft) */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex items-center justify-between bg-white">
          <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
            {t("Your Reports")}
          </h3>
          <div className="flex items-center gap-2">
            {userReports.length > 0 && (
              <button
                onClick={() => setActiveTab('my_reports')}
                className="px-4 py-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-red-50/60 text-neutral-800 text-xs font-bold transition-all cursor-pointer active:scale-95"
              >
                {t("View All")}
              </button>
            )}
            <button
              onClick={onOpenReportModal}
              className="px-5 py-2.5 rounded-xl bg-red-900 hover:bg-red-800 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
            >
              {t("+ New Report")}
            </button>
          </div>
        </div>

        <div className="p-6 sm:p-7">
          {userReports.length === 0 ? (
            <div className="text-center py-8 text-neutral-400">
              <p className="text-xs sm:text-sm font-medium">{t("You haven't submitted any incident reports yet.")}</p>
              <button
                onClick={onOpenReportModal}
                className="mt-3 text-xs sm:text-sm font-bold text-red-900 hover:underline cursor-pointer"
              >
                {t("+ Submit a ground hazard report")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {userReports.slice(0, 3).map((rep) => (
                <div
                  key={rep.id}
                  {...openable(() => onOpenItem('my_reports', rep.id))}
                  className="p-4 sm:p-5 rounded-2xl border border-neutral-100 bg-neutral-50/50 hover:bg-red-50/40 flex items-center justify-between gap-4 transition-all cursor-pointer"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-neutral-900 truncate">
                        {rep.hazard_type}
                      </span>
                      <span className="text-xs font-semibold text-neutral-400">
                        • Brgy. {rep.barangay_name}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600 truncate max-w-md">
                      {rep.description}
                    </p>
                  </div>

                  <span
                    className={`text-xs font-bold uppercase px-3.5 py-1.5 rounded-full shrink-0 shadow-xs ${
                      rep.status === 'verified'
                        ? 'bg-red-50 text-red-900 border border-red-900/30'
                        : rep.status === 'resolved'
                        ? 'bg-neutral-900 text-white border border-neutral-900'
                        : 'bg-red-900 text-white border border-red-900'
                    }`}
                  >
                    {rep.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section: Reported Near You (reference build): confirm a hazard you can see too */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-2 bg-white">
          <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
            {t("Reported Near You")}
          </h3>
          <span className="text-xs text-neutral-500">{t("Confirm a hazard if you can see it too")}</span>
        </div>
        {nearNotice && (
          <p className="mx-6 sm:mx-7 mt-5 text-xs font-semibold text-red-900 bg-red-50 border border-red-900/15 rounded-2xl px-4 py-2.5">{nearNotice}</p>
        )}
        <div className="divide-y divide-neutral-100">
          {nearReports.length === 0 ? (
            <p className="p-6 sm:p-7 text-center text-xs sm:text-sm text-neutral-400">{t("No other open reports in your barangay.")}</p>
          ) : (
            nearReports.map((rep) => {
              const done = !!confirmed[rep.id];
              return (
                <div
                  key={rep.id}
                  {...openable(() => onOpenItem('hazard_map', `report:${rep.id}`))}
                  className="p-5 sm:p-6 hover:bg-red-50/30 transition-colors flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-neutral-900 truncate">{rep.hazard_type}</span>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                        {rep.status === 'unverified' ? t('Reported') : rep.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-neutral-400" />
                        {relTime(rep.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-neutral-400" />
                        {rep.barangay_name}
                      </span>
                      <span className="inline-flex items-center gap-1" title={t("Confirmations needed to verify")}>
                        <ShieldAlert className="w-3.5 h-3.5 text-neutral-400" />
                        {Math.min(rep.corroboration_count, 3)}/3
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmReport(rep);
                    }}
                    disabled={done || confirmingId !== null}
                    className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:cursor-default ${
                      done ? 'bg-neutral-100 text-neutral-500' : 'bg-red-900 hover:bg-red-800 text-white shadow-md disabled:opacity-60'
                    }`}
                  >
                    {done ? <Check className="w-3.5 h-3.5" /> : null}
                    {done ? t("Confirmed") : confirmingId === rep.id ? t("Confirming…") : t("I see it too")}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 6. Section: Advisories and Alerts (Matching Initial Draft) */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex items-center justify-between bg-white">
          <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
            {t("Advisories and Alerts")}
          </h3>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs font-bold text-red-900 bg-red-50 border border-red-900/20 px-3.5 py-1 rounded-full">
              {activeAdvisoriesCount} live
            </span>
            <button
              onClick={() => setActiveTab('advisories')}
              className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
            >
              {t("View All")}
            </button>
          </div>
        </div>

        <div className="divide-y divide-neutral-100">
          {draftAdvisories.map((adv) => (
            <div
              key={adv.id}
              {...openable(() => onOpenItem('advisories', adv.id))}
              className="p-5 sm:p-6 hover:bg-red-50/30 transition-colors flex items-center justify-between gap-4 cursor-pointer"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${adv.dotColor} shrink-0`} />
                  <h4 className="text-sm font-bold text-neutral-900 truncate">
                    {adv.title}
                  </h4>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-500 pl-5">
                  <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="truncate">
                    {adv.location} {adv.category} • {adv.timeAgo}
                  </span>
                </div>
              </div>

              <span
                className={`text-xs font-bold uppercase px-3 py-1.5 rounded-xl text-white shrink-0 shadow-sm ${adv.color}`}
              >
                {adv.severity}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 7. Section: Nearest Open Shelters (Matching Initial Draft) */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex items-center justify-between bg-white">
          <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
            {t("Nearest Open Shelters")}
          </h3>
          <button
            onClick={() => setActiveTab('shelters')}
            className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
          >
            {t("All Shelters")}
          </button>
        </div>

        <div className="divide-y divide-neutral-100">
          {draftShelters.map((shelter) => (
            <div
              key={shelter.id}
              {...openable(() => onOpenItem('shelters', shelter.id))}
              className="p-5 sm:p-6 hover:bg-red-50/30 transition-colors flex items-center justify-between gap-4 cursor-pointer"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-900 shrink-0" />
                  <h4 className="text-sm font-bold text-neutral-900 truncate">
                    {shelter.name}
                  </h4>
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-500 pl-5 flex-wrap">
                  <span className="flex items-center gap-1.5 font-medium">
                    <MapPin className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Brgy. {shelter.barangay}</span>
                  </span>
                  <span className="flex items-center gap-1.5 font-mono tabular-nums text-neutral-700">
                    <Users className="w-3.5 h-3.5 text-neutral-400" />
                    <span>
                      {shelter.currentOccupancy} / {shelter.capacity} evacuees
                    </span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="text-xs font-bold uppercase px-3 py-1 rounded-full bg-red-50 text-red-900 border border-red-900/30 shadow-2xs">
                  {shelter.status}
                </span>
                <span className="text-xs font-mono font-bold text-neutral-500 tabular-nums">
                  {shelter.capacity ? Math.round((shelter.currentOccupancy / shelter.capacity) * 100) : 0}% occupied
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 8. Section: Emergency Hotlines (Matching Initial Draft) */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex items-center justify-between bg-white">
          <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
            {t("Emergency Hotlines")}
          </h3>
          <button
            onClick={() => setActiveTab('hotlines')}
            className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
          >
            {t("View All")}
          </button>
        </div>

        <div className="divide-y divide-neutral-100">
          {draftHotlines.map((hotline) => (
            <div
              key={hotline.id}
              {...openable(() => setActiveTab('hotlines'))}
              className="p-5 sm:p-6 hover:bg-red-50/30 transition-colors flex items-center justify-between gap-4 cursor-pointer"
            >
              <div className="space-y-1 min-w-0">
                <h4 className="text-sm font-bold text-neutral-900 truncate">
                  {hotline.name}
                </h4>
                <p className="text-xs font-semibold text-neutral-600 font-mono">
                  {hotline.number}
                </p>
              </div>

              <a
                href={telHref(hotline.number)}
                onClick={(e) => e.stopPropagation()}
                className="w-10 h-10 rounded-2xl bg-red-50 text-red-900 hover:bg-red-900 hover:text-white border border-red-900/20 flex items-center justify-center transition-all shadow-sm active:scale-95 shrink-0"
                title={`Call ${hotline.name}`}
              >
                <Phone className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* 9. Bottom Offline Status Footer Bar (Matching Initial Draft) */}
      <div
        {...openable(() => setActiveTab('offline_sync'))}
        className="rounded-3xl border border-neutral-100/80 bg-white hover:bg-neutral-50/80 p-6 sm:p-7 text-xs text-neutral-700 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer transition-colors"
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-500">{t("Offline copy:")}</span>
            <span className="font-bold text-red-900 bg-red-50 px-2.5 py-0.5 rounded-full border border-red-900/20">{lastSync ? 'Ready' : 'Not yet synced'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-500">{t("Last sync:")}</span>
            <span className="font-bold text-neutral-900">{syncLabel(lastSync)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:self-center">
          <span className="font-semibold text-neutral-500">{t("Hotlines cached:")}</span>
          <span className="font-bold text-white bg-neutral-900 px-3 py-1 rounded-xl shadow-xs">
            {hotlines.length}
          </span>
        </div>
      </div>
    </div>
  );
};
