import React, { useState } from 'react';
import { EmergencyHotline, User } from '../types';
import * as repo from '../services/repo';
import { download, toCSV } from '../lib/util';
import {
  Phone,
  PhoneCall,
  Download,
  Check,
  Edit2,
  CheckCircle,
  Plus,
  X,
  Trash2,
  FileSpreadsheet,
  AlertCircle
} from 'lucide-react';

interface LdrrmcHotlinesViewProps {
  hotlines: EmergencyHotline[];
  currentUser: User;
  onHotlinesUpdated?: () => void;
}

export const LdrrmcHotlinesView: React.FC<LdrrmcHotlinesViewProps> = ({
  hotlines,
  currentUser,
  onHotlinesUpdated,
}) => {

  // Add Form state matching bottom card from screenshot
  const [newAgency, setNewAgency] = useState('');
  const [newContactNumber, setNewContactNumber] = useState('');
  const [newScope, setNewScope] = useState('');

  // Edit Modal state
  const [editingHotline, setEditingHotline] = useState<EmergencyHotline | null>(null);
  const [editAgency, setEditAgency] = useState('');
  const [editNumber, setEditNumber] = useState('');
  const [editScope, setEditScope] = useState('');

  // A hotline is verified while it is marked active in the directory
  const verifiedIds: Record<string, boolean> = Object.fromEntries(hotlines.map((h) => [h.id, h.active]));

  const [flashNotice, setFlashNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setFlashNotice(msg);
    setTimeout(() => setFlashNotice(null), 3500);
  };

  // Add new hotline
  const handleAddHotline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgency.trim() || !newContactNumber.trim()) return;

    try {
      await repo.createHotline({
        agency_name: newAgency.trim(),
        contact_number: newContactNumber.trim(),
        scope: newScope.trim(),
      });
      showNotice(`Added ${newAgency.trim()} to municipal directory`);

      // Reset Form
      setNewAgency('');
      setNewContactNumber('');
      setNewScope('');
      if (onHotlinesUpdated) onHotlinesUpdated();
    } catch (err: any) {
      showNotice(err.message || 'Could not add the hotline.');
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (h: EmergencyHotline) => {
    setEditingHotline(h);
    setEditAgency(h.agency_name);
    setEditNumber(h.contact_number);
    setEditScope(h.scope);
  };

  // Save Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHotline) return;

    try {
      await repo.updateHotline(editingHotline.id, {
        agency_name: editAgency.trim(),
        contact_number: editNumber.trim(),
        scope: editScope.trim(),
      });
      setEditingHotline(null);
      showNotice(`Updated hotline information for ${editAgency.trim()}`);
      if (onHotlinesUpdated) onHotlinesUpdated();
    } catch (err: any) {
      showNotice(err.message || 'Could not update the hotline.');
    }
  };

  // Verify Hotline Action
  const handleVerify = async (id: string, name: string) => {
    try {
      await repo.updateHotline(id, { active: true });
      showNotice(`Verified line active: ${name}`);
    } catch (err: any) {
      showNotice(err.message || 'Could not verify the hotline.');
    }
  };

  // Export hotlines as CSV
  const handleExport = () => {
    if (!hotlines.length) {
      showNotice('Nothing to export');
      return;
    }
    const rows = hotlines.map((h) => ({ agency: h.agency_name, contact_number: h.contact_number, scope: h.scope }));
    download('uniguard-hotlines.csv', toCSV(rows, ['agency', 'contact_number', 'scope']));
    showNotice('Hotline directory exported');
  };

  const isBarangay = currentUser?.role === 'barangay';

  // Get tag label and badge color
  const getTagBadge = (h: EmergencyHotline) => {
    // classification is derived from the agency and scope, as in the hotline directory
    const text = `${h.scope} ${h.agency_name}`.toLowerCase();
    const tag = /police|pnp/.test(text) ? 'POLICE' : /medical|health|hospital|red cross/.test(text) ? 'MEDICAL' : 'EMERGENCY';
    if (tag.includes('POLICE')) {
      return (
        <span className={`text-[10px] font-medium tracking-wider uppercase px-2.5 py-0.5 rounded-full ${
          isBarangay ? 'bg-[#052659] text-white border border-[#011025]' : 'bg-[#18181b] text-white'
        }`}>
          POLICE
        </span>
      );
    }
    if (tag.includes('MEDICAL') || tag.includes('HEALTH') || tag.includes('HOSPITAL')) {
      return (
        <span className={`text-[10px] font-medium tracking-wider uppercase px-2.5 py-0.5 rounded-full ${
          isBarangay ? 'bg-[#5482B4] text-white' : 'bg-[#2A2A2A] text-white'
        }`}>
          MEDICAL
        </span>
      );
    }
    return (
      <span className={`text-[10px] font-medium tracking-wider uppercase px-2.5 py-0.5 rounded-full ${
        isBarangay
          ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
          : 'bg-neutral-100 text-neutral-800 border border-neutral-200'
      }`}>
        EMERGENCY
      </span>
    );
  };

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* Action Flash Notification */}
      {flashNotice && (
        <div className={`p-3.5 rounded-[20px] ${
          isBarangay
            ? 'bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#011025]'
            : 'bg-neutral-100/90 border border-neutral-200/80 text-neutral-800'
        } text-xs font-medium flex items-center justify-between animate-in fade-in`}>
          <div className="flex items-center gap-2">
            <Check className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'} shrink-0`} />
            <span>{flashNotice}</span>
          </div>
          <button onClick={() => setFlashNotice(null)} className={`cursor-pointer ${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hotlines Directory Table Card (Matching Reference Image List Styling) */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs overflow-hidden`}>
        {/* Card Header Bar */}
        <div className={`px-6 py-4.5 ${isBarangay ? 'bg-[#C2E8FF]/15 border-[#7EA0C5]/30' : 'bg-neutral-50/50 border-neutral-100'} border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            Emergency Hotlines Directory
          </h2>

          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <span className={`px-3 py-1 rounded-full text-xs font-mono font-medium ${
              isBarangay
                ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
                : 'bg-neutral-100 text-neutral-800 border border-neutral-200/80'
            } shadow-2xs`}>
              {hotlines.length} {hotlines.length === 1 ? 'contact' : 'contacts'}
            </span>

            <button
              onClick={handleExport}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 ${
                isBarangay
                  ? 'bg-white hover:bg-[#C2E8FF]/30 text-[#052659] border-[#7EA0C5]/40'
                  : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-200'
              } border text-xs font-medium rounded-full shadow-2xs transition-colors cursor-pointer shrink-0`}
            >
              <Download className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`} />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className={`${isBarangay ? 'bg-[#C2E8FF]/20 text-[#5482B4] border-[#7EA0C5]/30' : 'bg-neutral-50/50 text-neutral-400 border-neutral-100'} text-[10px] font-semibold uppercase tracking-wider border-b`}>
                <th className="px-6 py-3.5">Agency / Department</th>
                <th className="px-6 py-3.5">Contact Number</th>
                <th className="px-6 py-3.5">Scope / Coverage</th>
                <th className="px-6 py-3.5">Classification</th>
                <th className="px-6 py-3.5 text-center">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isBarangay ? 'divide-[#7EA0C5]/20' : 'divide-neutral-100'} text-xs`}>
              {hotlines.map((hotline) => {
                const isVerified = verifiedIds[hotline.id] ?? true;

                return (
                  <tr key={hotline.id} className={`${isBarangay ? 'hover:bg-[#C2E8FF]/20' : 'hover:bg-neutral-50/60'} transition-colors`}>
                    {/* Agency / Department */}
                    <td className={`px-6 py-4 font-semibold text-sm ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full ${
                          isBarangay
                            ? 'bg-[#C2E8FF]/50 border border-[#7EA0C5]/40 text-[#052659]'
                            : 'bg-neutral-100 border border-neutral-200 text-neutral-700'
                        } flex items-center justify-center shrink-0`}>
                          <Phone className="w-3.5 h-3.5" />
                        </div>
                        <span>{hotline.agency_name}</span>
                      </div>
                    </td>

                    {/* Contact Number */}
                    <td className={`px-6 py-4 font-mono font-semibold text-sm ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                      <a
                        href={`tel:${hotline.contact_number}`}
                        className={`inline-flex items-center gap-1.5 ${isBarangay ? 'hover:text-[#052659]' : 'hover:text-black'} transition-colors`}
                      >
                        <span>{hotline.contact_number}</span>
                      </a>
                    </td>

                    {/* Scope */}
                    <td className={`px-6 py-4 text-xs font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>
                      {hotline.scope}
                    </td>

                    {/* Tag Classification */}
                    <td className="px-6 py-4">
                      {getTagBadge(hotline)}
                    </td>

                    {/* Status Pill Badge */}
                    <td className="px-6 py-4 text-center">
                      <span
                        className={`inline-flex items-center justify-center w-24 h-7 rounded-full text-xs font-medium tracking-wide shadow-2xs text-center ${
                          isVerified
                            ? (isBarangay ? 'bg-[#052659] text-white' : 'bg-[#70757a] text-white')
                            : (isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-200 text-neutral-700')
                        }`}
                      >
                        {isVerified ? 'Verified' : 'Unverified'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 shrink-0">
                        {/* Direct Call Button */}
                        <a
                          href={`tel:${hotline.contact_number}`}
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            isBarangay
                              ? 'bg-[#C2E8FF]/40 hover:bg-[#C2E8FF]/80 text-[#052659] border border-[#7EA0C5]/40'
                              : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200/80'
                          } transition-colors cursor-pointer shadow-2xs shrink-0`}
                          title="Direct Call"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                        </a>

                        {/* Edit Button */}
                        <button
                          onClick={() => handleOpenEdit(hotline)}
                          className={`w-20 h-8 ${
                            isBarangay
                              ? 'bg-white hover:bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#052659]'
                              : 'bg-white hover:bg-neutral-100 border border-neutral-200/80 text-neutral-700'
                          } text-xs font-medium rounded-full inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs shrink-0 text-center`}
                        >
                          <Edit2 className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`} />
                          <span>Edit</span>
                        </button>

                        {/* Verify Button */}
                        <button
                          onClick={() => handleVerify(hotline.id, hotline.agency_name)}
                          className={`w-24 h-8 text-xs font-medium rounded-full inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs shrink-0 text-center ${
                            isVerified
                              ? (isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] text-white border border-[#011025]' : 'bg-[#18181b] hover:bg-neutral-800 text-white')
                              : (isBarangay ? 'bg-[#C2E8FF]/40 hover:bg-[#C2E8FF]/80 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200/80')
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{isVerified ? 'Verified' : 'Verify'}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Bottom Section Card: Add Hotline */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs overflow-hidden`}>
        {/* Card Header Bar */}
        <div className={`px-6 py-4.5 ${isBarangay ? 'bg-[#C2E8FF]/15 border-[#7EA0C5]/30' : 'bg-neutral-50/50 border-neutral-100'} border-b flex items-center justify-between`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            Add Hotline
          </h2>
          <span className={`text-[11px] font-medium ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
            Immediate Offline Cache Sync
          </span>
        </div>

        {/* Form Body: AGENCY | CONTACT NUMBER | SCOPE | + Add */}
        <form onSubmit={handleAddHotline} className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {/* AGENCY */}
            <div className="md:col-span-4">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                AGENCY
              </label>
              <input
                required
                type="text"
                value={newAgency}
                onChange={(e) => setNewAgency(e.target.value)}
                placeholder="e.g. Bureau of Fire Protection"
                className={`w-full text-xs font-medium p-3 border rounded-xl transition-all shadow-2xs ${
                  isBarangay
                    ? 'border-[#7EA0C5]/40 bg-white hover:bg-[#C2E8FF]/15 focus:bg-white text-[#011025] placeholder-[#7EA0C5] focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15'
                    : 'border-neutral-200 bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white text-neutral-800 placeholder-neutral-400 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                }`}
              />
            </div>

            {/* CONTACT NUMBER */}
            <div className="md:col-span-4">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                CONTACT NUMBER
              </label>
              <input
                required
                type="text"
                value={newContactNumber}
                onChange={(e) => setNewContactNumber(e.target.value)}
                placeholder="(075) 000-0000"
                className={`w-full text-xs font-mono font-medium p-3 border rounded-xl transition-all shadow-2xs ${
                  isBarangay
                    ? 'border-[#7EA0C5]/40 bg-white hover:bg-[#C2E8FF]/15 focus:bg-white text-[#011025] placeholder-[#7EA0C5] focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15'
                    : 'border-neutral-200 bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white text-neutral-800 placeholder-neutral-400 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                }`}
              />
            </div>

            {/* SCOPE */}
            <div className="md:col-span-3">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                SCOPE
              </label>
              <input
                type="text"
                value={newScope}
                onChange={(e) => setNewScope(e.target.value)}
                placeholder="Fire and rescue"
                className={`w-full text-xs font-medium p-3 border rounded-xl transition-all shadow-2xs ${
                  isBarangay
                    ? 'border-[#7EA0C5]/40 bg-white hover:bg-[#C2E8FF]/15 focus:bg-white text-[#011025] placeholder-[#7EA0C5] focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15'
                    : 'border-neutral-200 bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white text-neutral-800 placeholder-neutral-400 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                }`}
              />
            </div>

            {/* + Add Button */}
            <div className="md:col-span-1">
              <button
                type="submit"
                className={`w-full p-3 ${
                  isBarangay
                    ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]'
                    : 'bg-[#18181b] hover:bg-neutral-800'
                } text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95`}
              >
                <Plus className="w-4 h-4" />
                <span>Add</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Modal: Edit Hotline */}
      {editingHotline && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`bg-white rounded-[24px] max-w-md w-full p-6 shadow-2xl border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/80'} animate-in zoom-in-95 duration-200`}>
            <div className={`flex items-center justify-between pb-3.5 border-b ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-100'}`}>
              <h3 className={`font-semibold text-base ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                Edit Emergency Hotline
              </h3>
              <button
                onClick={() => setEditingHotline(null)}
                className={`cursor-pointer p-1 rounded-full transition-colors ${
                  isBarangay ? 'text-[#7EA0C5] hover:text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 pt-4">
              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                  Agency Name *
                </label>
                <input
                  required
                  type="text"
                  value={editAgency}
                  onChange={(e) => setEditAgency(e.target.value)}
                  className={`w-full text-xs font-medium p-2.5 rounded-xl shadow-2xs transition-all ${
                    isBarangay
                      ? 'border border-[#7EA0C5]/40 bg-white hover:bg-[#C2E8FF]/15 focus:bg-white text-[#011025] focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                  Contact Number *
                </label>
                <input
                  required
                  type="text"
                  value={editNumber}
                  onChange={(e) => setEditNumber(e.target.value)}
                  className={`w-full text-xs font-mono font-medium p-2.5 rounded-xl shadow-2xs transition-all ${
                    isBarangay
                      ? 'border border-[#7EA0C5]/40 bg-white hover:bg-[#C2E8FF]/15 focus:bg-white text-[#011025] focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                  Scope
                </label>
                <input
                  type="text"
                  value={editScope}
                  onChange={(e) => setEditScope(e.target.value)}
                  className={`w-full text-xs font-medium p-2.5 rounded-xl shadow-2xs transition-all ${
                    isBarangay
                      ? 'border border-[#7EA0C5]/40 bg-white hover:bg-[#C2E8FF]/15 focus:bg-white text-[#011025] focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                />
              </div>

              <div className={`flex items-center justify-between pt-3 border-t ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-100'}`}>
                <span />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingHotline(null)}
                    className={`px-4 py-2 text-xs font-medium rounded-full cursor-pointer transition-colors ${
                      isBarangay ? 'text-[#5482B4] hover:bg-[#C2E8FF]/30' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-5 py-2 text-xs font-medium text-white ${
                      isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]' : 'bg-[#18181b] hover:bg-neutral-800'
                    } rounded-full shadow-xs cursor-pointer transition-colors`}
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
