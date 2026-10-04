import React, { useState, useMemo } from 'react';
import { IncidentReport, Barangay, EvacuationCenter, Advisory, User } from '../types';
import {
  FileText,
  Download,
  Inbox,
  ShieldCheck,
  Clock,
  Home,
  SlidersHorizontal,
  ChevronDown,
  TrendingUp,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Flame,
  ArrowUpRight,
  Layers,
  Sparkles
} from 'lucide-react';

import { HAZARD_LABELS, classifyHazard } from '../lib/hazards';
import { download, toCSV } from '../lib/util';

export interface LdrrmcAnalyticsViewProps {
  reports: IncidentReport[];
  barangays: Barangay[];
  evacuationCenters: EvacuationCenter[];
  advisories: Advisory[];
  currentUser?: User;
  onOpenDrillDown?: (type: string, val: string) => void;
}

export const LdrrmcAnalyticsView: React.FC<LdrrmcAnalyticsViewProps> = ({
  reports = [],
  barangays = [],
  evacuationCenters = [],
  advisories = [],
  currentUser,
  onOpenDrillDown,
}) => {
  const [selectedHazard, setSelectedHazard] = useState<string>('All hazards');
  const [hoveredDay, setHoveredDay] = useState<{ dayLabel: string; count: number } | null>(null);
  const isBarangay = currentUser?.role === 'barangay';

  // 1. KPI Calculations matching draft
  // Reports this week (last 7 days vs previous 7 days)
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * oneDayMs;
  const fourteenDaysAgo = now - 14 * oneDayMs;

  const filteredReports = useMemo(() => {
    if (selectedHazard === 'All hazards') return reports;
    const key = classifyHazard(selectedHazard).key;
    return reports.filter((r) => r.hazard_key === key);
  }, [reports, selectedHazard]);

  const reportsThisWeek = useMemo(() => {
    return filteredReports.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= sevenDaysAgo;
    }).length;
  }, [filteredReports, sevenDaysAgo]);

  const reportsPrevWeek = useMemo(() => {
    return filteredReports.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= fourteenDaysAgo && t < sevenDaysAgo;
    }).length;
  }, [filteredReports, fourteenDaysAgo, sevenDaysAgo]);

  const weekGrowthPct = useMemo(() => {
    if (reportsPrevWeek === 0) {
      return reportsThisWeek > 0 ? '+100%' : '+0%';
    }
    const diff = ((reportsThisWeek - reportsPrevWeek) / reportsPrevWeek) * 100;
    return `${diff >= 0 ? '+' : ''}${Math.round(diff)}%`;
  }, [reportsThisWeek, reportsPrevWeek]);

  // Verified Share
  const totalOnRecord = filteredReports.length;
  const verifiedCount = filteredReports.filter((r) => r.status === 'verified' || r.status === 'dispatched' || r.status === 'resolved').length;
  const verifiedSharePct = totalOnRecord > 0 ? Math.round((verifiedCount / totalOnRecord) * 100) : 0;

  // Corroboration Rate (% reaching 3 or more confirmations)
  const corroboratedCount = filteredReports.filter((r) => (r.corroboration_count || 0) >= 3).length;
  const corroborationRatePct = totalOnRecord > 0 ? Math.round((corroboratedCount / totalOnRecord) * 100) : 0;

  // Shelters at Capacity
  const openShelters = evacuationCenters.filter((ec) => ec.status === 'open');
  const totalSheltersCount = evacuationCenters.length;
  const openSheltersCount = openShelters.length;
  const sheltersAtCapacity = evacuationCenters.filter((ec) => ec.status === 'full').length;

  // 2. Incident Trend - 14 Days Timeline
  const trendDays = useMemo(() => {
    const days: { index: number; label: string; dateStr: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const dayDate = new Date(now - i * oneDayMs);
      const startOfDay = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate()).getTime();
      const endOfDay = startOfDay + oneDayMs;

      const count = filteredReports.filter((r) => {
        const t = new Date(r.created_at).getTime();
        return t >= startOfDay && t < endOfDay;
      }).length;

      let label = `${i} days ago`;
      if (i === 0) label = 'Today';
      else if (i === 1) label = '1 day ago';

      days.push({
        index: 13 - i,
        label,
        dateStr: dayDate.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        count,
      });
    }
    return days;
  }, [filteredReports, now, oneDayMs]);

  const maxTrendCount = useMemo(() => {
    const max = Math.max(...trendDays.map((d) => d.count), 1);
    return max;
  }, [trendDays]);

  // 3. Pipeline Load Breakdown
  const pipeline = useMemo(() => {
    const pending = filteredReports.filter((r) => r.status === 'unverified').length;
    const verified = filteredReports.filter((r) => r.status === 'verified').length;
    const dispatched = filteredReports.filter((r) => r.status === 'dispatched').length;
    const resolved = filteredReports.filter((r) => r.status === 'resolved').length;
    const total = totalOnRecord || 1;

    return [
      {
        stage: 'Pending',
        count: pending,
        pct: Math.round((pending / total) * 100),
        barColor: isBarangay ? 'bg-[#7EA0C5]' : 'bg-neutral-300',
        textColor: isBarangay ? 'text-[#5482B4]' : 'text-neutral-600',
      },
      {
        stage: 'Verified',
        count: verified,
        pct: Math.round((verified / total) * 100),
        barColor: isBarangay ? 'bg-[#5482B4]' : 'bg-[#70757a]',
        textColor: isBarangay ? 'text-[#011025]' : 'text-neutral-800',
      },
      {
        stage: 'Dispatched / In Response',
        count: dispatched,
        pct: Math.round((dispatched / total) * 100),
        barColor: isBarangay ? 'bg-[#052659]' : 'bg-[#2A2A2A]',
        textColor: isBarangay ? 'text-[#011025]' : 'text-neutral-900',
      },
      {
        stage: 'Resolved / Cleared',
        count: resolved,
        pct: Math.round((resolved / total) * 100),
        barColor: isBarangay ? 'bg-[#031c42]' : 'bg-[#18181b]',
        textColor: isBarangay ? 'text-[#011025]' : 'text-neutral-900',
      },
    ];
  }, [filteredReports, totalOnRecord, isBarangay]);

  // Export handler: totals by hazard type and by pipeline stage, as CSV
  const handleExport = () => {
    const byHazard: Record<string, number> = {};
    filteredReports.forEach((r) => {
      const label = classifyHazard(r.hazard_key).label;
      byHazard[label] = (byHazard[label] || 0) + 1;
    });
    const rows = Object.keys(byHazard).map((k) => ({ hazard_type: k, total: byHazard[k] }));
    pipeline.forEach((p) => rows.push({ hazard_type: `STATUS: ${p.stage}`, total: p.count }));
    download(`uniguard-analytics-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows, ['hazard_type', 'total']));
  };

  const hazardOptions = ['All hazards', ...HAZARD_LABELS];

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* 1. Header Section matching reference: Title + Subtitle + Export Report Button */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${
            isBarangay ? 'text-[#011025]' : 'text-neutral-900'
          }`}>
            {isBarangay ? 'Barangay Analytics and Reporting' : 'Analytics and Reporting'}
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed ${
            isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
          }`}>
            {isBarangay
              ? `Barangay ${currentUser?.barangay_name || ''} telemetry across local hazards, response times and verification quality.`
              : 'City-wide telemetry across hazards, response times and verification quality.'}
          </p>
        </div>

        {/* Top Right Action Button: Export Report */}
        <button
          onClick={handleExport}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-full shadow-2xs transition-colors cursor-pointer shrink-0 self-start sm:self-auto ${
            isBarangay
              ? 'bg-[#052659] hover:bg-[#031c42] text-white border border-[#011025]/20'
              : 'bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-200'
          }`}
        >
          <Download className={`w-3.5 h-3.5 ${isBarangay ? 'text-white' : 'text-neutral-600'}`} />
          <span>Export Report</span>
        </button>
      </div>

      {/* 2. Top 4 Stat Cards in 2x2 Grid (Matching home dashboard design, structure, and number positioning) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 w-full">
        {/* Card 1: REPORTS THIS WEEK */}
        <div
          onClick={() => onOpenDrillDown && onOpenDrillDown('active_incidents', 'all')}
          className={`${
            isBarangay ? 'bg-[#052659] border-[#011025]/30' : 'bg-[#18181b] border-neutral-800'
          } text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border cursor-pointer hover:border-white/20 transition-all`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`text-[11px] font-medium tracking-normal ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-400'} uppercase`}>
                REPORTS THIS WEEK
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight font-sans tabular-nums">
                {reportsThisWeek}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <Inbox className="w-4 h-4 text-white" />
              </div>
              <span className={`w-6 h-6 rounded-full border border-white/20 ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-400'} flex items-center justify-center text-[11px]`}>
                ↗
              </span>
            </div>
          </div>
          <div className={`mt-4 pt-3 border-t ${isBarangay ? 'border-white/15 text-[#C2E8FF]' : 'border-white/10 text-neutral-400'} flex items-center gap-2 text-xs font-normal`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isBarangay ? 'bg-[#7EA0C5]' : 'bg-neutral-300'}`} />
            <span>▲ {weekGrowthPct} vs previous week</span>
          </div>
        </div>

        {/* Card 2: VERIFIED SHARE */}
        <div
          onClick={() => onOpenDrillDown && onOpenDrillDown('verified_share', 'all')}
          className={`${
            isBarangay ? 'bg-[#052659] border-[#011025]/30' : 'bg-[#18181b] border-neutral-800'
          } text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border cursor-pointer hover:border-white/20 transition-all`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`text-[11px] font-medium tracking-normal ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-400'} uppercase`}>
                VERIFIED SHARE
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight font-sans tabular-nums">
                {verifiedSharePct}%
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <span className={`w-6 h-6 rounded-full border border-white/20 ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-400'} flex items-center justify-center text-[11px]`}>
                ↗
              </span>
            </div>
          </div>
          <div className={`mt-4 pt-3 border-t ${isBarangay ? 'border-white/15 text-[#C2E8FF]' : 'border-white/10 text-neutral-400'} flex items-center gap-2 text-xs font-normal`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isBarangay ? 'bg-[#7EA0C5]' : 'bg-neutral-300'}`} />
            <span>{totalOnRecord} {totalOnRecord === 1 ? 'report' : 'reports'} on record</span>
          </div>
        </div>

        {/* Card 3: CORROBORATION RATE */}
        <div
          onClick={() => onOpenDrillDown && onOpenDrillDown('corroboration_rate', 'all')}
          className={`${
            isBarangay ? 'bg-[#052659] border-[#011025]/30' : 'bg-[#18181b] border-neutral-800'
          } text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border cursor-pointer hover:border-white/20 transition-all`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`text-[11px] font-medium tracking-normal ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-400'} uppercase`}>
                CORROBORATION RATE
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight font-sans tabular-nums">
                {corroborationRatePct}%
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <Clock className="w-4 h-4 text-white" />
              </div>
              <span className={`w-6 h-6 rounded-full border border-white/20 ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-400'} flex items-center justify-center text-[11px]`}>
                ↗
              </span>
            </div>
          </div>
          <div className={`mt-4 pt-3 border-t ${isBarangay ? 'border-white/15 text-[#C2E8FF]' : 'border-white/10 text-neutral-400'} flex items-center gap-2 text-xs font-normal`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isBarangay ? 'bg-[#7EA0C5]' : 'bg-neutral-300'}`} />
            <span>Reports reaching three confirmations</span>
          </div>
        </div>

        {/* Card 4: SHELTERS AT CAPACITY */}
        <div
          onClick={() => onOpenDrillDown && onOpenDrillDown('shelters_capacity', 'all')}
          className={`${
            isBarangay ? 'bg-[#052659] border-[#011025]/30' : 'bg-[#18181b] border-neutral-800'
          } text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border cursor-pointer hover:border-white/20 transition-all`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`text-[11px] font-medium tracking-normal ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-400'} uppercase`}>
                SHELTERS AT CAPACITY
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight font-sans tabular-nums">
                {sheltersAtCapacity}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <Home className="w-4 h-4 text-white" />
              </div>
              <span className={`w-6 h-6 rounded-full border border-white/20 ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-400'} flex items-center justify-center text-[11px]`}>
                ↗
              </span>
            </div>
          </div>
          <div className={`mt-4 pt-3 border-t ${isBarangay ? 'border-white/15 text-[#C2E8FF]' : 'border-white/10 text-neutral-400'} flex items-center gap-2 text-xs font-normal`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isBarangay ? 'bg-[#7EA0C5]' : 'bg-neutral-300'}`} />
            <span>{openSheltersCount} open of {totalSheltersCount}</span>
          </div>
        </div>
      </div>

      {/* 3. Middle Section Card: Incident Trend, Last 14 Days (Matching Reference Card Header & Layout) */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'border-neutral-200/70'} shadow-xs overflow-hidden`}>
        {/* Card Header Bar */}
        <div className={`px-6 py-4.5 ${isBarangay ? 'bg-[#C2E8FF]/10 border-b border-[#7EA0C5]/20' : 'bg-neutral-50/50 border-b border-neutral-100'} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            Incident Trend, Last 14 Days
          </h2>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <span className={`text-[10px] font-mono font-medium uppercase tracking-wider ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`}>
              REPORTS PER DAY
            </span>

            {/* All hazards filter pill matching reference styling */}
            <div className="relative">
              <select
                value={selectedHazard}
                onChange={(e) => setSelectedHazard(e.target.value)}
                className={`text-xs font-medium ${
                  isBarangay
                    ? 'bg-white border border-[#7EA0C5]/40 text-[#011025] hover:bg-[#C2E8FF]/20 focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]'
                    : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 focus:border-neutral-400'
                } rounded-full px-3.5 py-1.5 pr-8 appearance-none focus:outline-hidden shadow-2xs cursor-pointer transition-all`}
              >
                {hazardOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} absolute right-3 top-2.5 pointer-events-none`} />
            </div>
          </div>
        </div>

        {/* Trend Chart Body */}
        <div className="p-6">
          {hoveredDay && (
            <div className={`mb-2 text-xs font-mono font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'} flex items-center gap-2`}>
              <span className={`w-2 h-2 rounded-full ${isBarangay ? 'bg-[#052659]' : 'bg-[#18181b]'}`} />
              <span>{hoveredDay.dayLabel}: {hoveredDay.count} {hoveredDay.count === 1 ? 'report' : 'reports'}</span>
            </div>
          )}

          {/* SVG & Bars Chart */}
          <div className={`relative h-44 w-full flex items-end justify-between pt-6 pb-6 border-b ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
            {/* Horizontal Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
              <div className={`border-b ${isBarangay ? 'border-[#7EA0C5]' : 'border-neutral-300'} w-full`} />
              <div className={`border-b ${isBarangay ? 'border-[#7EA0C5]' : 'border-neutral-300'} w-full`} />
              <div className={`border-b ${isBarangay ? 'border-[#7EA0C5]' : 'border-neutral-300'} w-full`} />
            </div>

            {/* Y-axis labels matching reference styling */}
            <div className={`absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[10px] font-mono ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'} pointer-events-none pl-1`}>
              <span>{maxTrendCount}</span>
              <span>{Math.round(maxTrendCount / 2)}</span>
              <span>0</span>
            </div>

            {/* Day columns */}
            <div className="w-full flex items-end justify-between pl-8 pr-2 h-full z-10">
              {trendDays.map((day) => {
                const heightPct = maxTrendCount > 0 ? (day.count / maxTrendCount) * 80 : 0;

                return (
                  <div
                    key={day.index}
                    className="flex-1 flex flex-col items-center justify-end h-full group cursor-pointer relative px-1"
                    onMouseEnter={() => setHoveredDay({ dayLabel: `${day.label} (${day.dateStr})`, count: day.count })}
                    onMouseLeave={() => setHoveredDay(null)}
                  >
                    {/* Tooltip on hover */}
                    <div className={`opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 px-2.5 py-0.5 rounded-full ${isBarangay ? 'bg-[#052659]' : 'bg-[#18181b]'} text-white text-[10px] font-mono whitespace-nowrap pointer-events-none z-20 shadow-xs`}>
                      {day.count} reports
                    </div>

                    {/* Bar / Node */}
                    <div
                      style={{ height: `${Math.max(heightPct, 6)}%` }}
                      className={`w-2.5 sm:w-3 rounded-t-md transition-all ${
                        day.count > 0
                          ? isBarangay ? 'bg-[#052659] group-hover:bg-[#031c42]' : 'bg-[#18181b] group-hover:bg-[#2A2A2A]'
                          : isBarangay ? 'bg-[#C2E8FF]/40 group-hover:bg-[#C2E8FF]/70' : 'bg-neutral-100 group-hover:bg-neutral-200'
                      }`}
                    />

                    {/* Point indicator on top */}
                    <span
                      className={`w-2 h-2 rounded-full -mt-1 transition-transform group-hover:scale-125 ${
                        day.count > 0 ? (isBarangay ? 'bg-[#052659]' : 'bg-[#18181b]') : (isBarangay ? 'bg-[#7EA0C5]' : 'bg-neutral-300')
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* X-axis Timeline markers */}
          <div className={`flex items-center justify-between text-[11px] font-mono ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'} pt-3 pl-8 pr-2`}>
            <span>13 days ago</span>
            <span className="hidden sm:inline">10 days ago</span>
            <span>7 days ago</span>
            <span className="hidden sm:inline">4 days ago</span>
            <span className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>Today</span>
          </div>
        </div>
      </div>

      {/* 4. Lower Section Card: Pipeline Load */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'border-neutral-200/70'} shadow-xs overflow-hidden`}>
        {/* Card Header Bar */}
        <div className={`px-6 py-4.5 ${isBarangay ? 'bg-[#C2E8FF]/10 border-b border-[#7EA0C5]/20' : 'bg-neutral-50/50 border-b border-neutral-100'} flex items-center justify-between`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            Pipeline Load
          </h2>

          <span className={`px-3 py-1 rounded-full text-xs font-mono font-medium ${isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-800 border border-neutral-200/80'} shadow-2xs`}>
            {totalOnRecord} total incidents
          </span>
        </div>

        {/* Pipeline Stages Breakdown matching list style from reference image */}
        <div className="p-6 space-y-5">
          {pipeline.map((item) => (
            <div key={item.stage} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className={`font-semibold ${item.textColor}`}>{item.stage}</span>
                <span className={`font-mono font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                  {item.count} {item.count === 1 ? 'report' : 'reports'} ({item.pct}%)
                </span>
              </div>

              {/* Progress bar track */}
              <div className={`w-full h-2.5 rounded-full overflow-hidden border ${
                isBarangay ? 'bg-[#C2E8FF]/20 border-[#7EA0C5]/30' : 'bg-neutral-100 border-neutral-200/60'
              }`}>
                <div
                  style={{ width: `${Math.max(item.pct, item.count > 0 ? 5 : 0)}%` }}
                  className={`h-full ${item.barColor} rounded-full transition-all duration-500`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
