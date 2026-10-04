import React, { useState, useMemo } from 'react';
import {
  X,
  MapPin,
  Camera,
  Check,
  WifiOff,
  Info,
  ChevronDown,
  AlertTriangle,
  Radio,
  ShieldCheck,
  Clock,
  Sparkles
} from 'lucide-react';
import { User, Barangay, HazardType, ReportSeverity } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { CONFIG } from '../lib/config';
import { locate } from '../lib/geo';
import { HAZARD_LABELS, classifyHazard, isOtherHazard } from '../lib/hazards';
import { compressImage } from '../lib/util';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  barangays: Barangay[];
  isOnline: boolean;
  onReportSubmitted: () => void;
}

export type UrgencyOption = 'minor' | 'worse' | 'risk';

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  barangays,
  isOnline,
  onReportSubmitted,
}) => {
  const [hazardType, setHazardType] = useState<HazardType>(HAZARD_LABELS[0]);
  const [hazardOther, setHazardOther] = useState('');
  const [barangayId, setBarangayId] = useState<string>(() => {
    return currentUser.barangay_id || (barangays.length > 0 ? barangays[0].id : '');
  });
  const [urgency, setUrgency] = useState<UrgencyOption>('risk');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [hasAcquiredLocation, setHasAcquiredLocation] = useState<boolean>(false);
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationSuccess, setLocationSuccess] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { reports } = useRepo();

  const handleBarangayChange = (bId: string) => {
    setBarangayId(bId);
  };

  // Matching open reports the server would count towards auto-verification:
  // same hazard, same barangay, inside the corroboration window
  const nearbyDuplicates = useMemo(() => {
    const cutoff = Date.now() - CONFIG.CORROBORATION_WINDOW_HOURS * 60 * 60 * 1000;
    const key = classifyHazard(hazardType).key;
    return reports.filter(
      (r) =>
        r.hazard_key === key &&
        r.barangay_id === barangayId &&
        r.status !== 'resolved' &&
        r.status !== 'rejected' &&
        new Date(r.created_at).getTime() >= cutoff
    );
  }, [reports, hazardType, barangayId]);

  // Request browser geolocation. Without a fix the report is sent with no coordinates.
  const handleGetLocation = async () => {
    setIsLocating(true);
    setLocationSuccess(false);
    setFormError(null);
    try {
      const pos = await locate();
      setLatitude(pos.lat);
      setLongitude(pos.lng);
      setLocationSuccess(true);
      setHasAcquiredLocation(true);
    } catch (err: any) {
      setLatitude(null);
      setLongitude(null);
      setHasAcquiredLocation(false);
      setFormError(err.message || 'Could not read your location.');
    } finally {
      setIsLocating(false);
    }
  };

  // Compress the photo before upload so it fits the storage bucket limit
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError(null);
    try {
      const blob = await compressImage(file);
      setPhotoBlob(blob);
      setPhotoUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      setFormError(err.message || 'Could not attach that photo.');
    }
  };

  const clearPhoto = () => {
    setPhotoUrl('');
    setPhotoBlob(null);
  };

  const severityFor = (option: UrgencyOption): ReportSeverity => {
    switch (option) {
      case 'minor':
        return 'advisory';
      case 'worse':
        return 'warning';
      case 'risk':
        return 'emergency';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || isSubmitting) return;
    if (isOtherHazard(hazardType) && !hazardOther.trim()) {
      setFormError('Tell us what the hazard is before submitting.');
      return;
    }

    const barangay = barangays.find((b) => b.id === barangayId);
    setIsSubmitting(true);
    setFormError(null);
    try {
      await repo.createReport({
        hazard_type: hazardType,
        hazard_other_text: isOtherHazard(hazardType) ? hazardOther.trim() : '',
        barangay: barangay ? barangay.name : '',
        description: description.trim(),
        severity: severityFor(urgency),
        lat: latitude,
        lng: longitude,
        photo: photoBlob,
      });

      onReportSubmitted();
      onClose();

      // Reset fields
      setDescription('');
      setHazardOther('');
      clearPhoto();
      setLatitude(null);
      setLongitude(null);
      setHasAcquiredLocation(false);
      setLocationSuccess(false);
    } catch (err: any) {
      setFormError(err.message || 'Could not submit the report.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const currentBarangayObj = barangays.find((b) => b.id === barangayId);
  const selectedBarangayName = currentBarangayObj ? currentBarangayObj.name : '';

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/50 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      {/* Background click overlay */}
      <div className="fixed inset-0 cursor-pointer" onClick={onClose} />

      {/* Compact, elegantly proportioned modal card matching Home styling */}
      <div className="relative bg-white rounded-3xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-neutral-100/90 z-10 animate-in zoom-in-95 duration-150 overflow-hidden my-auto">
        {/* Header - Matching Home Section Header */}
        <div className="px-5 sm:px-7 py-4 sm:py-5 border-b border-neutral-100 flex items-center justify-between gap-3 bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shadow-xs shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-900" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-neutral-900 tracking-tight leading-tight">
                Report a Hazard
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5 leading-snug truncate">
                Dispatched to <span className="font-extrabold text-red-900">Lingayen MDRRMO</span> &amp; Brgy. {selectedBarangayName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-2xl text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body Container */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 space-y-5 text-xs bg-neutral-50/30">
          {/* Offline Warning Banner if disconnected */}
          {!isOnline && (
            <div className="bg-red-50/80 border border-red-100 rounded-2xl p-4 flex items-start gap-3 text-xs text-red-950 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-white text-red-900 border border-red-100 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                <WifiOff className="w-4 h-4 text-red-900" />
              </div>
              <div className="space-y-0.5">
                <p className="font-bold text-xs text-red-950">Offline Resilience Active (PWA Caching)</p>
                <p className="text-red-900/90 text-xs leading-relaxed font-medium">
                  Your report will be stored securely in the device's local outbox and synced as soon as connectivity resumes.
                </p>
              </div>
            </div>
          )}

          {/* Proximity / Duplicate Warning Banner */}
          {nearbyDuplicates.length > 0 && (
            <div className="bg-red-50/60 border border-red-100 rounded-2xl p-4 flex items-start gap-3 text-xs text-neutral-900 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-white text-red-900 border border-red-100 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                <Info className="w-4 h-4 text-red-900" />
              </div>
              <div className="flex-1 space-y-0.5">
                <p className="font-bold text-xs text-neutral-900">
                  Existing {hazardType} Report Detected Nearby ({nearbyDuplicates.length} active)
                </p>
                <p className="text-neutral-600 text-xs leading-relaxed font-medium">
                  A matching hazard is already active in this sector. You may proceed with an independent ground report.
                </p>
              </div>
            </div>
          )}

          {/* Form */}
          <form id="report-hazard-form" onSubmit={handleSubmit} className="space-y-5">
            {/* Card 1: Hazard Details (Matching Home Card style) */}
            <div className="bg-white rounded-3xl border border-neutral-100/90 p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                  Hazard Details
                </h3>
                <span className="text-[10px] font-mono font-bold text-red-900 bg-red-50 border border-red-900/20 px-2.5 py-0.5 rounded-full">
                  Step 1 of 2
                </span>
              </div>

              {/* Hazard Type & Barangay Jurisdiction Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* HAZARD TYPE */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                    Hazard Type
                  </label>
                  <div className="relative">
                    <select
                      value={hazardType}
                      onChange={(e) => setHazardType(e.target.value as HazardType)}
                      className="w-full text-xs sm:text-sm font-bold bg-neutral-50/60 hover:bg-neutral-50 border border-neutral-200 text-neutral-900 rounded-2xl py-3 px-3.5 pr-9 shadow-xs focus:ring-2 focus:ring-red-900/20 focus:border-red-900 focus:bg-white focus:outline-none appearance-none cursor-pointer transition-all"
                    >
                      {HAZARD_LABELS.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                  {isOtherHazard(hazardType) && (
                    <input
                      type="text"
                      required
                      value={hazardOther}
                      onChange={(e) => setHazardOther(e.target.value)}
                      placeholder="What is the hazard?"
                      className="w-full text-xs sm:text-sm font-medium p-3.5 bg-neutral-50/60 border border-neutral-200 text-neutral-900 placeholder-neutral-400 focus:ring-2 focus:ring-red-900/20 focus:border-red-900 focus:bg-white focus:outline-none rounded-2xl shadow-xs leading-relaxed transition-all"
                    />
                  )}
                </div>

                {/* BARANGAY JURISDICTION */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                    Barangay Sector
                  </label>
                  <div className="relative">
                    <select
                      value={barangayId}
                      onChange={(e) => handleBarangayChange(e.target.value)}
                      className="w-full text-xs sm:text-sm font-bold bg-neutral-50/60 hover:bg-neutral-50 border border-neutral-200 text-neutral-900 rounded-2xl py-3 px-3.5 pr-9 shadow-xs focus:ring-2 focus:ring-red-900/20 focus:border-red-900 focus:bg-white focus:outline-none appearance-none cursor-pointer transition-all"
                    >
                      {barangays.map((b) => (
                        <option key={b.id} value={b.id}>
                          Brgy. {b.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* HOW URGENT DOES IT LOOK */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Urgency Level
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Option 1: Looks Minor */}
                  <button
                    type="button"
                    onClick={() => setUrgency('minor')}
                    className={`px-4 py-2 rounded-full border text-xs font-bold flex items-center gap-2 transition cursor-pointer active:scale-95 ${
                      urgency === 'minor'
                        ? 'bg-neutral-900 text-white border-neutral-900 shadow-md ring-2 ring-neutral-300'
                        : 'bg-white border-neutral-200 text-neutral-700 hover:border-red-900/40 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'minor' ? 'bg-white' : 'bg-neutral-400'}`} />
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'minor' ? 'bg-white/30' : 'bg-neutral-200'}`} />
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'minor' ? 'bg-white/30' : 'bg-neutral-200'}`} />
                    </div>
                    <span>Looks Minor</span>
                  </button>

                  {/* Option 2: Getting Worse */}
                  <button
                    type="button"
                    onClick={() => setUrgency('worse')}
                    className={`px-4 py-2 rounded-full border text-xs font-bold flex items-center gap-2 transition cursor-pointer active:scale-95 ${
                      urgency === 'worse'
                        ? 'bg-red-800 text-white border-red-800 shadow-md ring-2 ring-red-900/30'
                        : 'bg-white border-neutral-200 text-neutral-700 hover:border-red-900/40 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'worse' ? 'bg-white' : 'bg-red-800'}`} />
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'worse' ? 'bg-white' : 'bg-red-800'}`} />
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'worse' ? 'bg-white/30' : 'bg-neutral-200'}`} />
                    </div>
                    <span>Getting Worse</span>
                  </button>

                  {/* Option 3: People at Risk */}
                  <button
                    type="button"
                    onClick={() => setUrgency('risk')}
                    className={`px-4 py-2 rounded-full border text-xs font-bold flex items-center gap-2 transition cursor-pointer active:scale-95 ${
                      urgency === 'risk'
                        ? 'bg-red-900 text-white border-red-900 shadow-md ring-2 ring-red-950/40'
                        : 'bg-white border-neutral-200 text-neutral-700 hover:border-red-900/40 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'risk' ? 'bg-white' : 'bg-red-900'}`} />
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'risk' ? 'bg-white' : 'bg-red-900'}`} />
                      <span className={`w-1.5 h-3 rounded-full ${urgency === 'risk' ? 'bg-white' : 'bg-red-900'}`} />
                    </div>
                    <span>People at Risk</span>
                  </button>
                </div>
              </div>

              {/* DESCRIPTION AND HAZARD DETAILS */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Description &amp; Observations
                </label>
                <textarea
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what you are seeing: water depth (knee or waist high), affected roads, trapped families, or nearby landmarks."
                  rows={3}
                  className="w-full text-xs sm:text-sm font-medium p-3.5 bg-neutral-50/60 border border-neutral-200 text-neutral-900 placeholder-neutral-400 focus:ring-2 focus:ring-red-900/20 focus:border-red-900 focus:bg-white focus:outline-none rounded-2xl shadow-xs leading-relaxed transition-all"
                />
                <p className="text-[11px] text-neutral-400 leading-snug">
                  Landmark references help Lingayen rescue teams pinpoint the exact scene.
                </p>
              </div>
            </div>

            {/* Card 2 & 3: Photo Evidence & Incident Coordinates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Photo Evidence */}
              <div className="bg-white rounded-3xl border border-neutral-100/90 p-5 space-y-3 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                    Photo Evidence
                  </h3>
                  <span className="text-[10px] font-mono font-bold text-neutral-400">
                    Optional
                  </span>
                </div>

                {/* Upload Box with Dashed Border */}
                <label className="border-2 border-dashed border-neutral-200 hover:border-red-900/50 rounded-2xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition group bg-neutral-50/30 hover:bg-red-50/20 shadow-xs">
                  <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                    <Camera className="w-5 h-5 text-red-900" />
                  </div>
                  <span className="text-xs font-bold text-neutral-800 group-hover:text-red-900 transition-colors leading-tight">
                    Attach Hazard Photo
                  </span>
                  <span className="text-[10px] text-neutral-400 mt-0.5">
                    JPG or PNG up to 10 MB
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                {/* Photo Preview if uploaded */}
                {photoUrl && (
                  <div className="relative inline-block w-full">
                    <img
                      src={photoUrl}
                      alt="Hazard preview"
                      className="w-full h-20 object-cover rounded-xl border border-neutral-200 shadow-xs"
                    />
                    <button
                      type="button"
                      onClick={clearPhoto}
                      className="absolute top-1.5 right-1.5 bg-neutral-900/80 hover:bg-neutral-900 text-white rounded-full p-1 text-xs shadow-md cursor-pointer transition active:scale-90"
                      title="Remove photo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Incident Coordinates */}
              <div className="bg-white rounded-3xl border border-neutral-100/90 p-5 space-y-3 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                    Incident Coordinates
                  </h3>
                  <span className="text-[10px] font-mono font-bold text-red-900 bg-red-50 border border-red-900/20 px-2 py-0.5 rounded-full">
                    GPS Tag
                  </span>
                </div>

                {/* Coordinates Telemetry Box */}
                <div className="bg-neutral-50/70 rounded-2xl border border-neutral-200/80 p-3 flex items-center justify-between gap-2 shadow-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        hasAcquiredLocation || locationSuccess
                          ? 'bg-red-50 text-red-900 border-red-200'
                          : 'bg-white text-neutral-500 border-neutral-200'
                      }`}
                    >
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold font-mono text-neutral-900 truncate">
                        {latitude !== null && longitude !== null
                          ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
                          : 'Not acquired'}
                      </p>
                      <p className="text-[10px] text-neutral-400 truncate mt-0.5">
                        High-accuracy ground position
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGetLocation}
                    disabled={isLocating}
                    className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white active:scale-95 text-xs font-bold transition cursor-pointer shadow-xs shrink-0"
                  >
                    {isLocating ? 'Locating...' : 'Acquire'}
                  </button>
                </div>

                {/* Info Rows: Barangay queue & Verification */}
                <div className="space-y-1.5 pt-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-500 text-[11px]">Target Dispatch</span>
                    <span className="font-bold text-neutral-900 text-[11px]">
                      Brgy. {selectedBarangayName}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-500 text-[11px]">Crowd Verification</span>
                    <span className="font-bold font-mono text-red-900 text-[11px]">
                      {CONFIG.CORROBORATION_THRESHOLD} corroborations
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Footer Action - Signature Red Pill Button */}
        <div className="px-5 sm:px-7 py-4 border-t border-neutral-100 bg-white shrink-0 text-center space-y-2">
          <button
            type="submit"
            form="report-hazard-form"
            disabled={isSubmitting}
            className="w-full py-3.5 px-6 rounded-full bg-red-900 hover:bg-red-800 active:scale-98 text-white font-extrabold text-xs sm:text-sm shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Submit Ground Hazard Report</span>
          </button>

          <p className="text-[11px] text-neutral-400">
            {formError || 'Reports stay editable for 15 minutes after submission.'}
          </p>
        </div>
      </div>
    </div>
  );
};
