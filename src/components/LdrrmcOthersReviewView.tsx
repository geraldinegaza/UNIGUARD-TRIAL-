import React, { useState, useEffect } from 'react';
import { IncidentReport, Barangay, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import {
  HelpCircle,
  Tag,
  CheckCircle2,
  Trash2,
  ArrowRight,
  MapPin,
  Clock,
  Sparkles,
  Plus,
  X,
  Check,
  Navigation,
  FileQuestion,
  Filter
} from 'lucide-react';

export interface LdrrmcOthersReviewViewProps {
  reports: IncidentReport[];
  barangays: Barangay[];
  currentUser: User;
  onUpdateReportStatus?: (reportId: string, status: any) => void;
  onSelectOnMap?: (coords: { latitude: number; longitude: number; label: string }) => void;
  onNavigateTab?: (tab: string) => void;
}

export const LdrrmcOthersReviewView: React.FC<LdrrmcOthersReviewViewProps> = ({
  reports = [],
  barangays = [],
  currentUser,
  onUpdateReportStatus,
  onSelectOnMap,
  onNavigateTab,
}) => {
  const isBarangay = currentUser?.role === 'barangay';

  // The others_hazard_review view: the free text residents typed when they
  // picked "Others", grouped, with how often and how recently each was reported
  const { othersReview } = useRepo();
  useEffect(() => {
    repo.loadOthersReview();
  }, []);
  const allOthersReports = othersReview.map((row) => ({
    id: row.description.toLowerCase(),
    description: row.description,
    occurrences: row.occurrences,
    latest_at: row.latest_at,
  }));

  const [actionNotice, setActionNotice] = useState<string | null>(null);

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* 1. Header Section from Initial Draft: Title + Subtitle + Entries Counter */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            &ldquo;Others&rdquo; Hazard Review
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
            Aggregated free-text from reports filed as &ldquo;Others&rdquo;. Use it to spot new hazard categories worth promoting into the canonical list.
          </p>
        </div>

        {/* Top Right Counter Pill matching draft: "0 entries" / "X entries" */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-medium shadow-2xs ${
            isBarangay
              ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
              : 'bg-neutral-100 text-neutral-800 border border-neutral-200/80'
          }`}>
            {allOthersReports.length} {allOthersReports.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </div>

      {/* Action Flash Notification */}
      {actionNotice && (
        <div className={`p-3.5 rounded-[20px] text-xs font-medium flex items-center justify-between animate-in fade-in ${
          isBarangay
            ? 'bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#052659]'
            : 'bg-neutral-100/90 border border-neutral-200/80 text-neutral-800'
        }`}>
          <div className="flex items-center gap-2">
            <Check className={`w-4 h-4 shrink-0 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
            <span>{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className={`cursor-pointer p-1 rounded-full transition-colors ${
              isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Main Card Section matching Initial Draft */}
      <div className={`bg-white rounded-[24px] shadow-xs overflow-hidden ${
        isBarangay ? 'border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'border border-neutral-200/70'
      }`}>
        {allOthersReports.length === 0 ? (
          /* Empty State matching initial draft screenshot */
          <div className="p-16 text-center space-y-3">
            <div className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center shadow-2xs ${
              isBarangay ? 'bg-[#C2E8FF]/30 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
            }`}>
              <HelpCircle className="w-6 h-6" />
            </div>
            <h3 className={`text-sm font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
              No &ldquo;Others&rdquo; reports yet
            </h3>
            <p className={`text-xs max-w-md mx-auto leading-relaxed ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
              When residents file a report with the &ldquo;Others&rdquo; hazard type and a free-text description, those entries aggregate here.
            </p>
          </div>
        ) : (
          /* Aggregated Free-Text Entries List */
          <div className={`divide-y ${isBarangay ? 'divide-[#7EA0C5]/15' : 'divide-neutral-100'}`}>
            {allOthersReports.map((report) => (
              <div
                key={report.id}
                className={`p-5 sm:p-6 transition-colors space-y-3 ${
                  isBarangay ? 'hover:bg-[#C2E8FF]/10' : 'hover:bg-neutral-50/50'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                        isBarangay ? 'bg-[#052659] text-white' : 'bg-[#18181b] text-white'
                      }`}>
                        Free-Text Report
                      </span>
                      <span className={`text-[10px] font-mono tracking-wider ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                        {report.occurrences} {report.occurrences === 1 ? 'report' : 'reports'}
                      </span>
                    </div>

                    <p className={`text-sm sm:text-base font-semibold pt-1 leading-relaxed ${
                      isBarangay ? 'text-[#011025]' : 'text-neutral-900'
                    }`}>
                      &ldquo;{report.description}&rdquo;
                    </p>

                    <div className={`flex flex-wrap items-center gap-3 text-xs pt-1 ${
                      isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                    }`}>
                      <span className="flex items-center gap-1">
                        <Clock className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`} />
                        <span>Latest: {new Date(report.latest_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
