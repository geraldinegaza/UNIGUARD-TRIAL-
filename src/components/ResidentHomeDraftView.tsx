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
import { relTime, syncLabel, telHref } from '../lib/util';

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
            Live situation for <span className="font-extrabold text-red-900">{locationLabel}</span>.
          </p>
        </div>

        <button
          onClick={onOpenReportModal}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-red-900 hover:bg-red-800 text-white text-xs sm:text-sm font-bold transition-all shadow-lg hover:shadow-xl cursor-pointer active:scale-95 w-fit shrink-0"
        >
          <span className="text-base font-light leading-none">+</span>
          <span>Report a Hazard</span>
        </button>
      </div>

      {/* 2. Three KPI Metric Cards with icons, bold labels, and tabular figures */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {/* Card 1: In Your Barangay (Signature Hero Dark Red Card) */}
        <div className="bg-gradient-to-br from-red-800 via-red-900 to-red-950 text-white rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-2xl border border-red-900/40 flex flex-col justify-between min-w-0 w-full relative overflow-hidden group transition-all duration-300">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-red-100/80">
                In Your Barangay
              </p>
              <p className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight font-mono tabular-nums mt-2">
                {inYourBarangayCount}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-white/15 text-white border border-white/20 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform shrink-0">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-white/15 flex items-center gap-2 text-xs text-red-100/90 font-medium">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>Active ground hazard reports</span>
          </div>
        </div>

        {/* Card 2: Shelters Open (Clean White Floating Card) */}
        <div
          onClick={() => setActiveTab('shelters')}
          className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-2xl border border-neutral-100/80 transition-all duration-300 flex flex-col justify-between cursor-pointer group min-w-0 w-full"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Shelters Open
              </p>
              <p className="text-4xl sm:text-5xl font-extrabold text-neutral-900 group-hover:text-red-900 transition-colors tracking-tight font-mono tabular-nums mt-2">
                {openSheltersCount}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500 font-medium">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-900" />
              <span>Available for intake</span>
            </span>
            <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:text-red-900 transition-transform group-hover:translate-x-1" />
          </div>
        </div>

        {/* Card 3: Active Advisories (Clean White Floating Card) */}
        <div
          onClick={() => setActiveTab('advisories')}
          className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-2xl border border-neutral-100/80 transition-all duration-300 flex flex-col justify-between cursor-pointer group min-w-0 w-full sm:col-span-2 lg:col-span-1"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Active Advisories
              </p>
              <p className="text-4xl sm:text-5xl font-extrabold text-red-900 group-hover:text-red-800 transition-colors tracking-tight font-mono tabular-nums mt-2">
                {activeAdvisoriesCount}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform shrink-0">
              <Bell className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500 font-medium">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-900" />
              <span>Official bulletins</span>
            </span>
            <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:text-red-900 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </div>

      {/* 3. Hero Critical Push Alert Card (Matching Screenshot 1) */}
      {topAdvisory && (
      <div
        onClick={() => setActiveTab('advisories')}
        className="rounded-3xl border border-red-950/40 bg-gradient-to-br from-red-800 via-red-900 to-red-950 p-6 sm:p-8 text-white shadow-2xl relative overflow-hidden cursor-pointer hover:shadow-red-900/30 transition-all group"
      >
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="px-3 py-1 rounded-xl bg-white text-red-900 text-xs font-black uppercase tracking-wider shadow-md">
              {severityBadge[topAdvisory.severity].label}
            </span>
            <span className="px-3 py-1 rounded-xl bg-red-950/80 text-white text-xs font-bold uppercase tracking-wider border border-white/20">
              PUSH ALERT
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
            Your Reports
          </h3>
          <button
            onClick={onOpenReportModal}
            className="px-5 py-2.5 rounded-xl bg-red-900 hover:bg-red-800 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
          >
            + New Report
          </button>
        </div>

        <div className="p-6 sm:p-7">
          {userReports.length === 0 ? (
            <div className="text-center py-8 text-neutral-400">
              <p className="text-xs sm:text-sm font-medium">You haven't submitted any incident reports yet.</p>
              <button
                onClick={onOpenReportModal}
                className="mt-3 text-xs sm:text-sm font-bold text-red-900 hover:underline cursor-pointer"
              >
                + Submit a ground hazard report
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {userReports.slice(0, 3).map((rep) => (
                <div
                  key={rep.id}
                  className="p-4 sm:p-5 rounded-2xl border border-neutral-100 bg-neutral-50/50 hover:bg-red-50/40 flex items-center justify-between gap-4 transition-all"
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

      {/* 6. Section: Advisories and Alerts (Matching Initial Draft) */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex items-center justify-between bg-white">
          <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
            Advisories and Alerts
          </h3>
          <span className="text-xs font-bold text-red-900 bg-red-50 border border-red-900/20 px-3.5 py-1 rounded-full">
            {activeAdvisoriesCount} live
          </span>
        </div>

        <div className="divide-y divide-neutral-100">
          {draftAdvisories.map((adv) => (
            <div
              key={adv.id}
              className="p-5 sm:p-6 hover:bg-red-50/30 transition-colors flex items-center justify-between gap-4"
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
            Nearest Open Shelters
          </h3>
          <button
            onClick={() => setActiveTab('shelters')}
            className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
          >
            All Shelters
          </button>
        </div>

        <div className="divide-y divide-neutral-100">
          {draftShelters.map((shelter) => (
            <div
              key={shelter.id}
              className="p-5 sm:p-6 hover:bg-red-50/30 transition-colors flex items-center justify-between gap-4"
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
            Emergency Hotlines
          </h3>
          <button
            onClick={() => setActiveTab('hotlines')}
            className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95"
          >
            View All
          </button>
        </div>

        <div className="divide-y divide-neutral-100">
          {draftHotlines.map((hotline) => (
            <div
              key={hotline.id}
              className="p-5 sm:p-6 hover:bg-red-50/30 transition-colors flex items-center justify-between gap-4"
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
      <div className="rounded-3xl border border-neutral-100/80 bg-white p-6 sm:p-7 text-xs text-neutral-700 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-500">Offline copy:</span>
            <span className="font-bold text-red-900 bg-red-50 px-2.5 py-0.5 rounded-full border border-red-900/20">{lastSync ? 'Ready' : 'Not yet synced'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-500">Last sync:</span>
            <span className="font-bold text-neutral-900">{syncLabel(lastSync)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:self-center">
          <span className="font-semibold text-neutral-500">Hotlines cached:</span>
          <span className="font-bold text-white bg-neutral-900 px-3 py-1 rounded-xl shadow-xs">
            {hotlines.length}
          </span>
        </div>
      </div>
    </div>
  );
};
