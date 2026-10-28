import React, { useEffect, useState } from 'react';
import { EmergencyHotline, User } from '../types';
import * as repo from '../services/repo';
import { useRepo } from '../hooks/useRepo';
import { relTime, telHref } from '../lib/util';
import { openable } from '../hooks/useFocusItem';
import { DetailModal, DetailRow } from './DetailModal';
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
  /** the Super Admin manages the directory directly; everyone else sends requests */
  directEdit?: boolean;
}

export const LdrrmcHotlinesView: React.FC<LdrrmcHotlinesViewProps> = ({
  hotlines,
  currentUser,
  onHotlinesUpdated,
  directEdit = false,
}) => {

  // Add Form state matching bottom card from screenshot
  const [newAgency, setNewAgency] = useState('');
  const [newContactNumber, setNewContactNumber] = useState('');
  const [newScope, setNewScope] = useState('');

  // Details pop-up (reference build: tap a hotline row)
  const [detailHotline, setDetailHotline] = useState<EmergencyHotline | null>(null);
  const { barangays } = useRepo();

  // Edit Modal state
  const [editingHotline, setEditingHotline] = useState<EmergencyHotline | null>(null);
  const [editAgency, setEditAgency] = useState('');
  const [editNumber, setEditNumber] = useState('');
  const [editScope, setEditScope] = useState('');
  const [editReason, setEditReason] = useState('');

  // The directory is an official record: changes from LGU staff and barangay
  // officials go to the Super Admin as requests and apply once approved.
  const { changeRequests } = useRepo();
  const myRequests = changeRequests.filter((c) => c.target_table === 'emergency_hotlines').slice(0, 6);
  useEffect(() => {
    repo.loadChangeRequests().catch(() => undefined);
  }, []);

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
      const proposed = {
        agency_name: newAgency.trim(),
        contact_number: newContactNumber.trim(),
        scope: newScope.trim() || 'Municipality-wide',
      };
      if (directEdit) {
        await repo.createHotline(proposed);
        showNotice(`Added ${proposed.agency_name} to the directory`);
      } else {
        await repo.submitHotlineRequest('add', null, proposed);
        showNotice(`Request sent: ${proposed.agency_name} will be added once the Super Admin approves it`);
      }

      // Reset Form
      setNewAgency('');
      setNewContactNumber('');
      setNewScope('');
      if (onHotlinesUpdated) onHotlinesUpdated();
    } catch (err: any) {
      showNotice(err.message || 'Could not send the request.');
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (h: EmergencyHotline) => {
    setEditingHotline(h);
    setEditAgency(h.agency_name);
    setEditNumber(h.contact_number);
    setEditScope(h.scope);
    setEditReason('');
  };

  // Save Edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHotline) return;

    try {
      const proposed = { agency_name: editAgency.trim(), contact_number: editNumber.trim(), scope: editScope.trim() };
      if (directEdit) {
        await repo.updateHotline(editingHotline.id, proposed);
        setEditingHotline(null);
        showNotice(`Updated ${proposed.agency_name}`);
      } else {
        await repo.submitHotlineRequest('edit', editingHotline, proposed, editReason.trim());
        setEditingHotline(null);
        showNotice(`Change request sent for ${proposed.agency_name}. It applies once the Super Admin approves it.`);
      }
      if (onHotlinesUpdated) onHotlinesUpdated();
    } catch (err: any) {
      showNotice(err.message || 'Could not send the request.');
    }
  };

  // Verify Hotline Action
  const handleVerify = async (id: string, name: string) => {
    const hotline = hotlines.find((h) => h.id === id) || null;
    try {
      if (directEdit) {
        await repo.updateHotline(id, { active: true });
        showNotice(`Verified line active: ${name}`);
      } else {
        await repo.submitHotlineRequest('edit', hotline, { active: true }, 'Line confirmed working');
        showNotice(`Request sent to mark ${name} as verified`);
      }
    } catch (err: any) {
      showNotice(err.message || 'Could not send the request.');
    }
  };

  // Ask the Super Admin to remove a line from the directory
  const handleRequestRemoval = async () => {
    if (!editingHotline) return;
    const question = directEdit
      ? `Remove ${editingHotline.agency_name} from the directory? Residents will no longer see it.`
      : `Ask the Super Admin to remove ${editingHotline.agency_name} from the directory?`;
    if (!window.confirm(question)) return;
    try {
      if (directEdit) {
        await repo.deleteHotline(editingHotline.id);
        showNotice(`Removed ${editingHotline.agency_name}`);
      } else {
        await repo.submitHotlineRequest('delete', editingHotline, {}, editReason.trim());
        showNotice(`Removal request sent for ${editingHotline.agency_name}`);
      }
      setEditingHotline(null);
    } catch (err: any) {
      showNotice(err.message || 'Could not send the request.');
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
                  <tr
                    key={hotline.id}
                    {...openable(() => setDetailHotline(hotline))}
                    aria-label={`${hotline.agency_name}: details`}
                    className={`${isBarangay ? 'hover:bg-[#C2E8FF]/20' : 'hover:bg-neutral-50/60'} transition-colors cursor-pointer`}
                  >
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
                        onClick={(e) => e.stopPropagation()}
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
                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
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
                          className={`h-8 px-3 whitespace-nowrap ${
                            isBarangay
                              ? 'bg-white hover:bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#052659]'
                              : 'bg-white hover:bg-neutral-100 border border-neutral-200/80 text-neutral-700'
                          } text-xs font-medium rounded-full inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs shrink-0 text-center`}
                        >
                          <Edit2 className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`} />
                          <span>{directEdit ? 'Edit' : 'Request edit'}</span>
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
            {directEdit ? 'Add Hotline' : 'Request a New Hotline'}
          </h2>
          <span className={`text-[11px] font-medium ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
            {directEdit ? 'Added to the directory immediately' : 'Added once the Super Admin approves it'}
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
                <span>{directEdit ? 'Add' : 'Request'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Requests this account has sent, with their outcome */}
      {!directEdit && myRequests.length > 0 && (
        <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs overflow-hidden`}>
          <div className={`px-6 py-4 ${isBarangay ? 'bg-[#C2E8FF]/15 border-[#7EA0C5]/30' : 'bg-neutral-50/50 border-neutral-100'} border-b`}>
            <h2 className={`text-sm font-semibold uppercase tracking-wide ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
              Your Change Requests
            </h2>
          </div>
          <ul className={`divide-y ${isBarangay ? 'divide-[#7EA0C5]/20' : 'divide-neutral-100'}`}>
            {myRequests.map((c) => (
              <li key={c.id} className="px-6 py-3 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className={`block text-xs font-semibold truncate ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                    {c.action === 'add' ? 'Add' : c.action === 'edit' ? 'Edit' : 'Remove'}{' '}
                    {String(c.proposed_data.agency_name || c.current_data.agency_name || 'hotline')}
                  </span>
                  <span className={`block text-[11px] truncate ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                    {relTime(c.created_at)}
                    {c.decision_note ? ` · ${c.decision_note}` : ''}
                  </span>
                </span>
                <span
                  className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    c.status === 'approved'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : c.status === 'rejected'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : isBarangay
                      ? 'bg-[#C2E8FF]/50 text-[#052659] border border-[#7EA0C5]/40'
                      : 'bg-neutral-100 text-neutral-700 border border-neutral-200'
                  }`}
                >
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modal: Edit Hotline */}
      {detailHotline && (() => {
        const h = hotlines.find((x) => x.id === detailHotline.id) || detailHotline;
        const tone = isBarangay ? 'barangay' : 'staff';
        const brgy = h.barangay_uuid ? barangays.find((b) => b.uuid === h.barangay_uuid)?.name : '';
        const btn = 'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold cursor-pointer transition-colors';
        return (
          <DetailModal
            title={h.agency_name}
            tone={tone}
            onClose={() => setDetailHotline(null)}
            actions={
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDetailHotline(null);
                    handleOpenEdit(h);
                  }}
                  className={`${btn} bg-white border border-neutral-200 text-neutral-800 hover:bg-neutral-100`}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {directEdit ? 'Edit' : 'Request change'}
                </button>
                <a href={telHref(h.contact_number)} className={`${btn} text-white ${isBarangay ? 'bg-[#052659] hover:bg-[#011025]' : 'bg-[#18181b] hover:bg-neutral-800'}`}>
                  <PhoneCall className="w-3.5 h-3.5" />
                  Call
                </a>
              </>
            }
          >
            <a href={telHref(h.contact_number)} className={`block text-xl font-mono font-semibold ${isBarangay ? 'text-[#052659]' : 'text-neutral-900'}`}>
              {h.contact_number}
            </a>
            <div>
              <DetailRow tone={tone} label="Agency" value={h.agency_name} />
              <DetailRow tone={tone} label="Category" value={h.category} />
              <DetailRow tone={tone} label="Contact number" value={h.contact_number} />
              <DetailRow tone={tone} label="Scope" value={h.scope} />
              {brgy && <DetailRow tone={tone} label="Barangay" value={brgy} />}
              <DetailRow tone={tone} label="Description" value={h.description} />
              <DetailRow tone={tone} label="Active" value={h.active ? 'Yes' : 'No'} />
            </div>
            {!directEdit && (
              <p className={`text-[11px] ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                Changes to the directory go to the Super Admin for review before residents see them.
              </p>
            )}
          </DetailModal>
        );
      })()}

      {editingHotline && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className={`bg-white rounded-[24px] max-w-md w-full p-6 shadow-2xl border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/80'} animate-in zoom-in-95 duration-200`}>
            <div className={`flex items-center justify-between pb-3.5 border-b ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-100'}`}>
              <h3 className={`font-semibold text-base ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                {directEdit ? 'Edit Emergency Hotline' : 'Request a Hotline Change'}
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

              {!directEdit && (
              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                  Reason (shown to the Super Admin)
                </label>
                <textarea
                  rows={2}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="e.g. The agency changed its trunk line"
                  className={`w-full text-xs font-medium p-2.5 rounded-xl shadow-2xs transition-all resize-none ${
                    isBarangay
                      ? 'border border-[#7EA0C5]/40 bg-white hover:bg-[#C2E8FF]/15 focus:bg-white text-[#011025] focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                />
              </div>
              )}

              <div className={`flex items-center justify-between pt-3 border-t ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-100'}`}>
                <button
                  type="button"
                  onClick={handleRequestRemoval}
                  className="px-3 py-2 text-xs font-medium rounded-full cursor-pointer text-red-700 hover:bg-red-50 transition-colors"
                >
                  {directEdit ? 'Remove line' : 'Request removal'}
                </button>

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
                    {directEdit ? 'Save Changes' : 'Send Request'}
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
