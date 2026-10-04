import React, { useState, useMemo } from 'react';
import { Barangay, User as UserType } from '../types';
import {
  Package,
  Plus,
  Search,
  Filter,
  MapPin,
  Calendar,
  Clock,
  Users,
  CheckCircle2,
  AlertCircle,
  FileText,
  Building,
  Check,
  X,
  Trash2,
  ChevronDown,
  Tag,
  IdCard,
  QrCode,
  ShieldCheck,
  Sun
} from 'lucide-react';

import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';

export interface DistributionDrive {
  id: string;
  title: string;
  barangay: string;
  location: string;
  schedule: string;
  targetHouseholds?: number;
  eligibility?: string;
  requiredDocuments?: string;
  status?: 'In Progress' | 'Scheduled' | 'Completed';
  createdAt?: string;
  contactNumber?: string;
}

export interface BeneficiaryRecord {
  id: string;
  controlNo: string;
  name: string;
  barangay: string;
  claimantName: string;
  category: string;
}

const formatSchedule = (iso: string | null) => {
  if (!iso) return 'To be announced';
  const t = Date.parse(iso);
  if (isNaN(t)) return 'To be announced';
  return new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// <input type="datetime-local"> value for a stored timestamp
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const splitList = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

interface LdrrmcReliefViewProps {
  barangays: Barangay[];
  currentUser: UserType;
}

export const LdrrmcReliefView: React.FC<LdrrmcReliefViewProps> = ({
  barangays,
  currentUser,
}) => {
  const isBarangay = currentUser?.role === 'barangay';

  // Distributions and authorized beneficiaries from the database
  const store = useRepo();
  const LINGAYEN_BARANGAY_LIST = useMemo(() => ['All', ...barangays.map((b) => b.name)], [barangays]);
  const distributions: DistributionDrive[] = useMemo(
    () =>
      store.relief
        .filter((r) => r.active)
        .map((r) => ({
          id: r.id,
          title: r.title,
          barangay: r.barangay,
          location: r.location_name,
          schedule: formatSchedule(r.distribution_at),
          eligibility: r.eligibility.join(', '),
          requiredDocuments: r.required_docs.join(', '),
          contactNumber: r.contact_phone,
        })),
    [store.relief]
  );
  const beneficiaries: BeneficiaryRecord[] = useMemo(
    () =>
      store.beneficiaries.map((b) => ({
        id: b.id,
        controlNo: b.claimant_id,
        name: b.beneficiary_name,
        barangay: b.barangay,
        claimantName: b.claimant_name,
        category: b.category,
      })),
    [store.beneficiaries]
  );

  // Filter states matching screenshot
  const [filterBarangay, setFilterBarangay] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [isAddDistributionOpen, setIsAddDistributionOpen] = useState<boolean>(false);
  const [isAddBeneficiaryOpen, setIsAddBeneficiaryOpen] = useState<boolean>(false);
  const [editingDistId, setEditingDistId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // New Distribution form state
  const [newDistTitle, setNewDistTitle] = useState('');
  const [newDistBarangay, setNewDistBarangay] = useState(() => currentUser.barangay_name || (barangays[0] ? barangays[0].name : ''));
  const [newDistLocation, setNewDistLocation] = useState('');
  const [newDistSchedule, setNewDistSchedule] = useState('');
  const [newDistContact, setNewDistContact] = useState('');
  const [newDistEligibility, setNewDistEligibility] = useState('');
  const [newDistDocs, setNewDistDocs] = useState('');

  // New Beneficiary form state
  const [newBenName, setNewBenName] = useState('');
  const [newBenBarangay, setNewBenBarangay] = useState(() => currentUser.barangay_name || (barangays[0] ? barangays[0].name : ''));
  const [newBenClaimant, setNewBenClaimant] = useState('');
  const [newBenClaimantId, setNewBenClaimantId] = useState('');
  const [newBenCategory, setNewBenCategory] = useState<BeneficiaryRecord['category']>('4Ps / Indigent');

  const flash = (message: string) => {
    setActionNotice(message);
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Filtered beneficiaries based on Barangay dropdown and Search input
  const filteredBeneficiaries = useMemo(() => {
    return beneficiaries.filter((b) => {
      // Barangay filter
      if (filterBarangay !== 'All') {
        const matchesBarangay =
          b.barangay.toLowerCase() === filterBarangay.toLowerCase() ||
          b.barangay.toLowerCase().includes(filterBarangay.toLowerCase());
        if (!matchesBarangay) return false;
      }

      // Search filter (Name or ID)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = b.name.toLowerCase().includes(q);
        const matchesId = b.controlNo.toLowerCase().includes(q);
        const matchesContact = b.claimantName.toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesContact) return false;
      }

      return true;
    });
  }, [beneficiaries, filterBarangay, searchQuery]);

  const handleEditDistribution = (dist: DistributionDrive) => {
    const row = store.relief.find((r) => r.id === dist.id);
    setEditingDistId(dist.id);
    setNewDistTitle(dist.title);
    setNewDistBarangay(dist.barangay);
    setNewDistLocation(dist.location);
    setNewDistSchedule(toLocalInput(row ? row.distribution_at : null));
    setNewDistContact(dist.contactNumber || '');
    setNewDistEligibility((row ? row.eligibility : []).join(', '));
    setNewDistDocs((row ? row.required_docs : []).join(', '));
    setIsAddDistributionOpen(true);
  };

  // Form Submissions
  const handleAddDistributionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDistTitle.trim()) return;

    const input = {
      title: newDistTitle.trim(),
      barangay: newDistBarangay,
      location_name: newDistLocation.trim(),
      distribution_at: newDistSchedule ? new Date(newDistSchedule).toISOString() : null,
      contact_phone: newDistContact.trim(),
      eligibility: splitList(newDistEligibility),
      required_docs: splitList(newDistDocs),
    };
    try {
      if (editingDistId) {
        await repo.updateRelief(editingDistId, input);
        flash(`Updated distribution: "${input.title}"`);
      } else {
        await repo.createRelief(input);
        flash(`Added distribution schedule: "${input.title}"`);
      }
      setEditingDistId(null);
      setIsAddDistributionOpen(false);
      setNewDistTitle('');
      setNewDistLocation('');
      setNewDistSchedule('');
      setNewDistContact('');
    } catch (err: any) {
      flash(err.message || 'Could not save the distribution.');
    }
  };

  const handleAddBeneficiarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBenName.trim()) return;

    try {
      await repo.createBeneficiary({
        beneficiary_name: newBenName.trim(),
        claimant_name: newBenClaimant.trim() || newBenName.trim(),
        claimant_id: newBenClaimantId.trim(),
        barangay: newBenBarangay,
        category: newBenCategory,
      });
      flash(`Added authorized beneficiary: ${newBenName.trim()}`);
      setIsAddBeneficiaryOpen(false);
      setNewBenName('');
      setNewBenClaimant('');
      setNewBenClaimantId('');
    } catch (err: any) {
      flash(err.message || 'Could not add the beneficiary.');
    }
  };

  const handleDeleteBeneficiary = async (id: string) => {
    try {
      await repo.deleteBeneficiary(id);
      flash('Beneficiary removed');
    } catch (err: any) {
      flash(err.message || 'Could not remove the beneficiary.');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 1. Header Section */}
      <div className="px-1 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} tracking-tight`}>
            Relief Assistance
          </h1>
          <p className={`text-xs sm:text-sm ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} mt-0.5 max-w-2xl leading-relaxed`}>
            Manage per-barangay distribution schedules, eligibility, required documents and the authorized-beneficiary list.
          </p>
        </div>

        {/* Top Right Action Button: + Add Distribution */}
        <button
          onClick={() => setIsAddDistributionOpen(true)}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 ${
            isBarangay
              ? 'bg-[#052659] hover:bg-[#5482B4] text-white border border-[#011025]'
              : 'bg-[#18181b] hover:bg-neutral-800 text-white'
          } text-xs font-medium rounded-full shadow-xs transition-colors cursor-pointer shrink-0`}
        >
          <Plus className="w-4 h-4" />
          <span>Add Distribution</span>
        </button>
      </div>

      {/* Action Notice */}
      {actionNotice && (
        <div className={`p-3.5 rounded-2xl ${
          isBarangay ? 'bg-[#C2E8FF]/30 border-[#7EA0C5]/40 text-[#011025]' : 'bg-neutral-100/90 border-neutral-200/80 text-neutral-800'
        } border text-xs font-medium flex items-center justify-between animate-in fade-in`}>
          <div className="flex items-center gap-2">
            <Check className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'} shrink-0`} />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className={`cursor-pointer ${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Active Distributions Section Card */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs overflow-hidden`}>
        {/* Card Header Bar */}
        <div className={`px-6 py-4.5 ${isBarangay ? 'bg-[#C2E8FF]/10 border-[#7EA0C5]/20' : 'bg-neutral-50/50 border-neutral-100'} border-b flex items-center justify-between`}>
          <div className="flex items-center gap-2.5">
            <Package className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`} />
            <h2 className={`text-sm font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} uppercase tracking-wide`}>
              Active Distributions
            </h2>
          </div>

          {/* Right counter pill matching reference: "X records" */}
          <span className={`px-3 py-1 rounded-full text-xs font-mono font-medium ${
            isBarangay ? 'bg-[#C2E8FF] text-[#052659] border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border-neutral-200/80'
          } border shadow-2xs`}>
            {distributions.length} {distributions.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        {/* Card Body: Lists Active Distributions with contents ONLY from screenshot */}
        {distributions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className={`w-12 h-12 rounded-2xl ${isBarangay ? 'bg-[#C2E8FF]/40 text-[#052659] border-[#7EA0C5]/30' : 'bg-neutral-100 text-neutral-600 border-neutral-200'} mx-auto flex items-center justify-center border`}>
              <Package className="w-6 h-6" />
            </div>
            <h3 className={`text-sm font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>No Active Distributions</h3>
            <p className={`text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} max-w-sm mx-auto`}>
              There are currently no active distribution drives recorded. Click the button below to schedule relief operations.
            </p>
            <button
              onClick={() => {
                setEditingDistId(null);
                setIsAddDistributionOpen(true);
              }}
              className={`inline-flex items-center gap-1.5 px-4 py-2 ${
                isBarangay
                  ? 'bg-[#052659] hover:bg-[#5482B4] text-white border border-[#011025]'
                  : 'bg-[#18181b] hover:bg-neutral-800 text-white'
              } text-xs font-medium rounded-full cursor-pointer shadow-xs`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Schedule New Distribution</span>
            </button>
          </div>
        ) : (
          <div className={`divide-y ${isBarangay ? 'divide-[#7EA0C5]/15' : 'divide-neutral-100'}`}>
            {distributions.map((dist) => (
              <div
                key={dist.id}
                className={`px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 ${
                  isBarangay ? 'hover:bg-[#C2E8FF]/15' : 'hover:bg-neutral-50/60'
                } transition-colors`}
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div className="min-w-0 space-y-1">
                    <h3 className={`text-sm font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} tracking-tight`}>
                      {dist.title}
                    </h3>

                    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} font-normal`}>
                      <div className="flex items-center gap-1.5">
                        <MapPin className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'} shrink-0`} />
                        <span>{dist.location || dist.barangay}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Clock className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'} shrink-0`} />
                        <span>{dist.schedule}</span>
                      </div>

                      {dist.contactNumber && (
                        <span>{dist.contactNumber}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <button
                    onClick={() => handleEditDistribution(dist)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium border ${
                      isBarangay
                        ? 'border-[#7EA0C5]/40 bg-[#C2E8FF]/20 hover:bg-[#C2E8FF]/50 text-[#052659]'
                        : 'border-neutral-200/80 bg-white hover:bg-neutral-100 text-neutral-700 hover:text-neutral-900'
                    } shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5`}
                  >
                    <Sun className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#052659]' : 'text-neutral-400'}`} />
                    <span>Edit</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Authorized Beneficiaries Section Card */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs overflow-hidden space-y-4`}>
        {/* Card Header Bar with Title and + Add Button */}
        <div className={`px-6 py-4.5 ${isBarangay ? 'bg-[#C2E8FF]/10 border-[#7EA0C5]/20' : 'bg-neutral-50/50 border-neutral-100'} border-b flex items-center justify-between`}>
          <div className="flex items-center gap-2.5">
            <Users className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`} />
            <h2 className={`text-sm font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} uppercase tracking-wide`}>
              Authorized Beneficiaries
            </h2>
          </div>

          {/* Right Action Button: + Add */}
          <button
            onClick={() => setIsAddBeneficiaryOpen(true)}
            className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 ${
              isBarangay
                ? 'bg-[#052659] hover:bg-[#5482B4] text-white border border-[#011025]'
                : 'bg-[#18181b] hover:bg-neutral-800 text-white'
            } text-xs font-medium rounded-full shadow-2xs transition-colors cursor-pointer`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>

        {/* Filter Bar: FILTER BY BARANGAY & SEARCH */}
        <div className="px-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: FILTER BY BARANGAY */}
          <div>
            <label className={`block text-[10px] font-semibold ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} uppercase tracking-wider mb-1.5`}>
              FILTER BY BARANGAY
            </label>
            <div className="relative">
              <select
                value={filterBarangay}
                onChange={(e) => setFilterBarangay(e.target.value)}
                className={`w-full text-xs font-medium ${
                  isBarangay
                    ? 'text-[#011025] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                    : 'text-neutral-800 bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50'
                } border rounded-full px-4 py-2.5 appearance-none focus:outline-hidden focus:ring-2 cursor-pointer shadow-2xs`}
              >
                {LINGAYEN_BARANGAY_LIST.map((brgy) => (
                  <option key={brgy} value={brgy}>
                    {brgy === 'All' ? 'All (Municipality-wide)' : `Brgy. ${brgy}`}
                  </option>
                ))}
              </select>
              <ChevronDown className={`w-4 h-4 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'} absolute right-4 top-3 pointer-events-none`} />
            </div>
          </div>

          {/* Right: SEARCH */}
          <div>
            <label className={`block text-[10px] font-semibold ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} uppercase tracking-wider mb-1.5`}>
              SEARCH
            </label>
            <div className="relative flex items-center">
              <Search className={`w-4 h-4 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'} absolute left-3.5 pointer-events-none`} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name or ID"
                className={`w-full pl-10 pr-9 py-2.5 text-xs font-medium ${
                  isBarangay
                    ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                    : 'text-neutral-800 placeholder-neutral-400 bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50'
                } border rounded-full focus:outline-hidden focus:ring-2 shadow-2xs`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className={`absolute right-3.5 ${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'} cursor-pointer`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick Statistics Bar */}
        <div className={`px-6 flex items-center justify-between text-xs ${isBarangay ? 'text-[#5482B4] border-[#7EA0C5]/20' : 'text-neutral-500 border-neutral-100'} border-t pt-3 pb-1`}>
          <div className="flex items-center gap-3">
            <span>
              Showing <strong className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>{filteredBeneficiaries.length}</strong> records
            </span>
          </div>

          {filterBarangay !== 'All' && (
            <button
              onClick={() => setFilterBarangay('All')}
              className={`text-[11px] font-semibold ${isBarangay ? 'text-[#052659] hover:text-[#011025]' : 'text-neutral-900'} hover:underline cursor-pointer`}
            >
              Reset to All Barangays
            </button>
          )}
        </div>

        {/* Beneficiaries Table */}
        <div className={`border-t ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'} overflow-x-auto`}>
          {filteredBeneficiaries.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <div className={`w-10 h-10 rounded-full ${isBarangay ? 'bg-[#C2E8FF]/40 text-[#052659]' : 'bg-neutral-100 text-neutral-400'} mx-auto flex items-center justify-center`}>
                <Search className="w-5 h-5" />
              </div>
              <p className={`text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>No matching beneficiaries found</p>
              <p className={`text-[11px] ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                Try adjusting your search query or selecting a different barangay.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className={`${isBarangay ? 'bg-[#C2E8FF]/10 text-[#5482B4] border-[#7EA0C5]/20' : 'bg-neutral-50/50 text-neutral-400 border-neutral-100'} text-[10px] font-semibold uppercase tracking-wider border-b`}>
                  <th className="px-6 py-3.5">BENEFICIARY ID</th>
                  <th className="px-6 py-3.5">HEAD OF HOUSEHOLD</th>
                  <th className="px-6 py-3.5">BARANGAY / ADDRESS</th>
                  <th className="px-6 py-3.5 text-center">CATEGORY</th>
                  <th className="px-6 py-3.5 text-center">ACTION</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isBarangay ? 'divide-[#7EA0C5]/15' : 'divide-neutral-100'} text-xs`}>
                {filteredBeneficiaries.map((b) => (
                  <tr key={b.id} className={`${isBarangay ? 'hover:bg-[#C2E8FF]/15' : 'hover:bg-neutral-50/60'} transition-colors`}>
                    <td className={`px-6 py-4 font-mono font-medium align-middle ${isBarangay ? 'text-[#052659]' : 'text-neutral-600'}`}>
                      {b.controlNo}
                    </td>

                    <td className="px-6 py-4 align-middle">
                      <div className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>{b.name}</div>
                      <div className={`text-[10px] ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>Claimant: {b.claimantName}</div>
                    </td>

                    <td className="px-6 py-4 align-middle">
                      <div>
                        <div className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>Brgy. {b.barangay}</div>
                      </div>
                    </td>

                    {/* Category: Equal width & height, centralized text */}
                    <td className="px-6 py-4 text-center align-middle">
                      <span className={`inline-flex items-center justify-center w-32 h-7 px-2.5 rounded-full text-[10px] font-medium text-center ${
                        isBarangay ? 'bg-[#C2E8FF]/40 text-[#052659] border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border-neutral-200/80'
                      } border shadow-2xs`}>
                        {b.category}
                      </span>
                    </td>

                    {/* Action: Equal width & height, centralized text */}
                    <td className="px-6 py-4 text-center align-middle">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleDeleteBeneficiary(b.id)}
                          className={`w-8 h-8 rounded-full inline-flex items-center justify-center ${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025] hover:bg-[#C2E8FF]/20' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'} cursor-pointer transition-colors`}
                          title="Delete record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal 1: Add Distribution Schedule */}
      {isAddDistributionOpen && (
        <div className={`fixed inset-0 z-50 ${isBarangay ? 'bg-[#011025]/40' : 'bg-black/40'} backdrop-blur-xs flex items-center justify-center p-4`}>
          <div className={`bg-white rounded-[24px] max-w-lg w-full p-6 shadow-2xl border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/80'} animate-in zoom-in-95 duration-200`}>
            <div className={`flex items-center justify-between pb-3 border-b ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
              <h3 className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} text-base`}>
                {editingDistId ? 'Edit Relief Distribution Schedule' : 'Add Relief Distribution Schedule'}
              </h3>
              <button
                onClick={() => {
                  setIsAddDistributionOpen(false);
                  setEditingDistId(null);
                }}
                className={`${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'} cursor-pointer`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddDistributionSubmit} className="space-y-4 pt-4">
              <div>
                <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Distribution Title / Aid Package Name *
                </label>
                <input
                  required
                  type="text"
                  value={newDistTitle}
                  onChange={(e) => setNewDistTitle(e.target.value)}
                  placeholder="e.g. DSWD Family Food Packs (FFPs) — Batch 2"
                  className={`w-full text-xs p-2.5 border ${
                    isBarangay
                      ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                      : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                  } rounded-xl outline-hidden transition-all focus:ring-2`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                    Target Barangay *
                  </label>
                  <select
                    value={newDistBarangay}
                    onChange={(e) => setNewDistBarangay(e.target.value)}
                    className={`w-full text-xs p-2.5 border ${
                      isBarangay
                        ? 'text-[#011025] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                        : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                    } rounded-xl outline-hidden transition-all focus:ring-2 cursor-pointer`}
                  >
                    {LINGAYEN_BARANGAY_LIST.filter((b) => b !== 'All').map((brgy) => (
                      <option key={brgy} value={brgy}>
                        Brgy. {brgy}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                    Contact Number
                  </label>
                  <input
                    type="text"
                    value={newDistContact}
                    onChange={(e) => setNewDistContact(e.target.value)}
                    className={`w-full text-xs p-2.5 border ${
                      isBarangay
                        ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                        : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                    } rounded-xl outline-hidden transition-all focus:ring-2`}
                  />
                </div>
              </div>

              <div>
                <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Distribution Venue / Location *
                </label>
                <input
                  required
                  type="text"
                  value={newDistLocation}
                  onChange={(e) => setNewDistLocation(e.target.value)}
                  placeholder="e.g. Libsong East Elementary School Gymnasium"
                  className={`w-full text-xs p-2.5 border ${
                    isBarangay
                      ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                      : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                  } rounded-xl outline-hidden transition-all focus:ring-2`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Schedule Date & Time *
                </label>
                <input
                  required
                  type="datetime-local"
                  value={newDistSchedule}
                  onChange={(e) => setNewDistSchedule(e.target.value)}
                  className={`w-full text-xs p-2.5 border ${
                    isBarangay
                      ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                      : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                  } rounded-xl outline-hidden transition-all focus:ring-2`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Eligibility Criteria
                </label>
                <textarea
                  rows={2}
                  value={newDistEligibility}
                  onChange={(e) => setNewDistEligibility(e.target.value)}
                  className={`w-full text-xs p-2.5 border ${
                    isBarangay
                      ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                      : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                  } rounded-xl outline-hidden transition-all focus:ring-2`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Required Documents
                </label>
                <input
                  type="text"
                  value={newDistDocs}
                  onChange={(e) => setNewDistDocs(e.target.value)}
                  placeholder="e.g. Valid ID, Barangay Clearance, DAFAC Card"
                  className={`w-full text-xs p-2.5 border ${
                    isBarangay
                      ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                      : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                  } rounded-xl outline-hidden transition-all focus:ring-2`}
                />
              </div>

              <div className={`flex items-center justify-end gap-2.5 pt-2 border-t ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddDistributionOpen(false);
                    setEditingDistId(null);
                  }}
                  className={`px-4 py-2 text-xs font-medium ${isBarangay ? 'text-[#052659] hover:bg-[#C2E8FF]/30' : 'text-neutral-600 hover:bg-neutral-100'} rounded-full cursor-pointer transition-colors`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-xs font-medium text-white ${
                    isBarangay
                      ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]'
                      : 'bg-[#18181b] hover:bg-neutral-800'
                  } rounded-full shadow-xs cursor-pointer transition-colors`}
                >
                  {editingDistId ? 'Save Changes' : 'Publish Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Add Authorized Beneficiary */}
      {isAddBeneficiaryOpen && (
        <div className={`fixed inset-0 z-50 ${isBarangay ? 'bg-[#011025]/40' : 'bg-black/40'} backdrop-blur-xs flex items-center justify-center p-4`}>
          <div className={`bg-white rounded-[24px] max-w-md w-full p-6 shadow-2xl border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/80'} animate-in zoom-in-95 duration-200`}>
            <div className={`flex items-center justify-between pb-3 border-b ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
              <h3 className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} text-base`}>
                Add Authorized Beneficiary
              </h3>
              <button
                onClick={() => setIsAddBeneficiaryOpen(false)}
                className={`${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'} cursor-pointer`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddBeneficiarySubmit} className="space-y-4 pt-4">
              <div>
                <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Head of Household Full Name *
                </label>
                <input
                  required
                  type="text"
                  value={newBenName}
                  onChange={(e) => setNewBenName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  className={`w-full text-xs p-2.5 border ${
                    isBarangay
                      ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                      : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                  } rounded-xl outline-hidden transition-all focus:ring-2`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                    Barangay *
                  </label>
                  <select
                    value={newBenBarangay}
                    onChange={(e) => setNewBenBarangay(e.target.value)}
                    className={`w-full text-xs p-2.5 border ${
                      isBarangay
                        ? 'text-[#011025] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                        : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                    } rounded-xl outline-hidden transition-all focus:ring-2 cursor-pointer`}
                  >
                    {LINGAYEN_BARANGAY_LIST.filter((b) => b !== 'All').map((brgy) => (
                      <option key={brgy} value={brgy}>
                        Brgy. {brgy}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                    Claimant ID Number
                  </label>
                  <input
                    type="text"
                    value={newBenClaimantId}
                    onChange={(e) => setNewBenClaimantId(e.target.value)}
                    className={`w-full text-xs p-2.5 border ${
                      isBarangay
                        ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                        : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                    } rounded-xl outline-hidden transition-all focus:ring-2`}
                  />
                </div>
              </div>

              <div>
                <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Claimant Name (if claiming on behalf)
                </label>
                <input
                  type="text"
                  value={newBenClaimant}
                  onChange={(e) => setNewBenClaimant(e.target.value)}
                  placeholder="Same as beneficiary"
                  className={`w-full text-xs p-2.5 border ${
                    isBarangay
                      ? 'text-[#011025] placeholder-[#7EA0C5] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                      : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                  } rounded-xl outline-hidden transition-all focus:ring-2`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Eligibility Category
                </label>
                <select
                  value={newBenCategory}
                  onChange={(e) => setNewBenCategory(e.target.value as BeneficiaryRecord['category'])}
                  className={`w-full text-xs p-2.5 border ${
                    isBarangay
                      ? 'text-[#011025] bg-[#C2E8FF]/10 border-[#7EA0C5]/30 focus:border-[#5482B4] focus:ring-[#C2E8FF]/50'
                      : 'border-neutral-200 focus:border-neutral-400 focus:ring-neutral-200/50 bg-neutral-50/60 focus:bg-white'
                  } rounded-xl outline-hidden transition-all focus:ring-2 cursor-pointer`}
                >
                  <option value="4Ps / Indigent">4Ps / Indigent</option>
                  <option value="Coastal Evacuee">Coastal Evacuee</option>
                  <option value="Senior Citizen">Senior Citizen</option>
                  <option value="PWD">PWD</option>
                  <option value="Solo Parent">Solo Parent</option>
                </select>
              </div>

              <div className={`flex items-center justify-end gap-2.5 pt-2 border-t ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
                <button
                  type="button"
                  onClick={() => setIsAddBeneficiaryOpen(false)}
                  className={`px-4 py-2 text-xs font-medium ${isBarangay ? 'text-[#052659] hover:bg-[#C2E8FF]/30' : 'text-neutral-600 hover:bg-neutral-100'} rounded-full cursor-pointer transition-colors`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-xs font-medium text-white ${
                    isBarangay
                      ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]'
                      : 'bg-[#18181b] hover:bg-neutral-800'
                  } rounded-full shadow-xs cursor-pointer transition-colors`}
                >
                  Register Beneficiary
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
