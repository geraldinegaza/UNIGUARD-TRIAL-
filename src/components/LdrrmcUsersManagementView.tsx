import React, { useState, useEffect } from 'react';
import { User, Barangay, UserRole } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import {
  Users,
  UserPlus,
  Download,
  ShieldCheck,
  Info,
  Search,
  CheckCircle2,
  Trash2,
  Lock,
  Mail,
  MapPin,
  X,
  Check,
  Inbox,
  ArrowUpRight,
  ShieldAlert
} from 'lucide-react';

export interface LdrrmcUsersManagementViewProps {
  currentUser: User;
  barangays: Barangay[];
}

export const LdrrmcUsersManagementView: React.FC<LdrrmcUsersManagementViewProps> = ({
  currentUser,
  barangays = [],
}) => {
  const isBarangay = currentUser?.role === 'barangay';

  // Accounts from public.profiles (LGU only, enforced by RLS)
  const usersList = useRepo().users;
  useEffect(() => {
    repo.loadUsers().catch((err: any) => flash(err.message || 'Could not load accounts'));
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = (message: string, ms = 4000) => {
    setNotice(message);
    setTimeout(() => setNotice(null), ms);
  };

  // Form state for "+ Create Official"
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    role: 'lgu_admin' as UserRole,
    barangay_id: barangays[0]?.id || '',
  });

  // Filtered users
  const filteredUsers = usersList.filter((u) => {
    if (selectedRoleFilter !== 'all' && u.role !== selectedRoleFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = u.full_name.toLowerCase().includes(q);
      const matchEmail = u.email.toLowerCase().includes(q);
      return matchName || matchEmail;
    }
    return true;
  });

  // Export CSV handler
  const handleExportCsv = () => {
    const headers = ['ID', 'Full Name', 'Email', 'Role', 'Barangay', 'Status', 'Created At'];
    const rows = filteredUsers.map((u) => [
      `"${u.id}"`,
      `"${u.full_name}"`,
      `"${u.email}"`,
      `"${u.role.toUpperCase()}"`,
      `"${u.barangay_name || ''}"`,
      `"${u.disabled ? 'disabled' : 'active'}"`,
      `"${u.created_at || ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `lingayen-user-management-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Create Official Handler. The admin-users server function invites the
  // account by email, re-checks that the caller is LGU and audits the change.
  const handleCreateOfficial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.full_name.trim() || !formData.email.trim()) return;

    const brgy = barangays.find((b) => b.id === formData.barangay_id);
    if (formData.role === 'barangay' && !(brgy && brgy.uuid)) {
      flash('Select the barangay this official will manage');
      return;
    }
    try {
      await repo.adminUsers({
        action: 'create',
        email: formData.email.trim(),
        fullName: formData.full_name.trim(),
        role: formData.role === 'lgu_admin' ? 'lgu_ldrrmc' : 'barangay_official',
        barangayId: formData.role === 'barangay' && brgy ? brgy.uuid : null,
      });
      setIsCreateModalOpen(false);
      flash(`Invitation sent to ${formData.email.trim()}`);
      setFormData({ full_name: '', email: '', role: 'lgu_admin', barangay_id: barangays[0]?.id || '' });
    } catch (err: any) {
      flash(err.message || 'Could not create the account.');
    }
  };

  // Promote / Demote Role
  const handleToggleOfficialRole = async (user: User) => {
    let nextRole: UserRole = 'citizen';
    if (user.role === 'citizen') nextRole = 'barangay';
    else if (user.role === 'barangay') nextRole = 'lgu_admin';
    else nextRole = 'citizen';

    try {
      await repo.adminUsers({ action: 'set-role', userId: user.id, role: repo.roleToDb(nextRole) });
      flash(`Updated ${user.full_name}'s role to ${nextRole.toUpperCase()}`, 3000);
    } catch (err: any) {
      flash(err.message || 'Could not update the role.');
    }
  };

  // Revoke / restore access. Accounts are disabled, never deleted.
  const handleRevokeUser = async (user: User) => {
    const disable = !user.disabled;
    const question = disable
      ? `Disable ${user.full_name}? The account can no longer sign in until it is enabled again.`
      : `Enable ${user.full_name}? The account can sign in again.`;
    if (!window.confirm(question)) return;
    try {
      await repo.adminUsers({ action: 'set-disabled', userId: user.id, disabled: disable });
      flash(disable ? `Access revoked for ${user.full_name}` : `Access restored for ${user.full_name}`, 3000);
    } catch (err: any) {
      flash(err.message || 'Could not update the account.');
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'lgu_admin':
        return (
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase shadow-2xs ${
            isBarangay ? 'bg-[#052659] text-white' : 'bg-[#18181b] text-white'
          }`}>
            MDRRMO / LGU Admin
          </span>
        );
      case 'barangay':
        return (
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase shadow-2xs ${
            isBarangay ? 'bg-[#031c42] text-white border border-[#7EA0C5]/40' : 'bg-neutral-800 text-white'
          }`}>
            BDRRMC Official
          </span>
        );
      default:
        return (
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase ${
            isBarangay
              ? 'bg-[#C2E8FF]/50 text-[#052659] border border-[#7EA0C5]/40'
              : 'bg-neutral-100 text-neutral-700 border border-neutral-200/80'
          }`}>
            Resident Citizen
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* 1. Header Section matching initial draft: Title + Subtitle + Action Buttons (Export CSV, Create Official) */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            User Management
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
            Officials and LGU staff are created and promoted here. Residents self-register.
          </p>
        </div>

        {/* Top Right Action Buttons matching draft: Export CSV + Create Official */}
        <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
          <button
            onClick={handleExportCsv}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-full shadow-2xs transition-colors cursor-pointer shrink-0 ${
              isBarangay
                ? 'bg-white hover:bg-[#C2E8FF]/20 text-[#052659] border border-[#7EA0C5]/40'
                : 'bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-200/80'
            }`}
          >
            <Download className={`w-4 h-4 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`} />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-full shadow-xs transition-colors cursor-pointer shrink-0 ${
              isBarangay ? 'bg-[#052659] hover:bg-[#031c42] text-white' : 'bg-[#18181b] hover:bg-neutral-800 text-white'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Create Official</span>
          </button>
        </div>
      </div>

      {/* Action Notification Flash */}
      {notice && (
        <div className={`p-3.5 rounded-[20px] text-xs font-medium flex items-center justify-between animate-in fade-in ${
          isBarangay
            ? 'bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#052659]'
            : 'bg-neutral-100/90 border border-neutral-200/80 text-neutral-800'
        }`}>
          <div className="flex items-center gap-2">
            <Check className={`w-4 h-4 shrink-0 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
            <span>{notice}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            className={`cursor-pointer p-1 rounded-full transition-colors ${
              isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search and Role Filter Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${
            isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'
          }`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email address..."
            className={`w-full pl-10 pr-4 py-2 rounded-full text-xs font-medium focus:outline-hidden shadow-2xs transition-all ${
              isBarangay
                ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] placeholder-[#7EA0C5] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
            }`}
          />
        </div>

        <div className={`flex items-center gap-1 p-1 rounded-full self-start overflow-x-auto shadow-2xs ${
          isBarangay ? 'bg-[#C2E8FF]/20 border border-[#7EA0C5]/30' : 'bg-neutral-100/90 border border-neutral-200/80'
        }`}>
          {[
            { id: 'all', label: `All (${usersList.length})` },
            { id: 'lgu_admin', label: 'LGU Admins' },
            { id: 'barangay', label: 'BDRRMC Officials' },
            { id: 'citizen', label: 'Residents' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedRoleFilter(tab.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                selectedRoleFilter === tab.id
                  ? isBarangay
                    ? 'bg-[#052659] text-white shadow-2xs'
                    : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay
                    ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Main Section Card: List of Accounts or Empty State (Matching Draft Screenshot) */}
      {filteredUsers.length === 0 ? (
        <div className={`rounded-[24px] p-16 text-center space-y-3 shadow-xs ${
          isBarangay ? 'bg-white border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'bg-white border border-neutral-200/70'
        }`}>
          <div className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center shadow-2xs ${
            isBarangay ? 'bg-[#C2E8FF]/30 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
          }`}>
            <Inbox className="w-6 h-6" />
          </div>
          <h3 className={`text-sm font-semibold tracking-tight ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            No accounts yet
          </h3>
          <p className={`text-xs max-w-sm mx-auto leading-relaxed ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
            Accounts appear here as residents register and officials are created.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((user) => {
            const brgy = barangays.find((b) => b.id === user.barangay_id);
            const isSelf = user.id === currentUser.id;

            return (
              <div
                key={user.id}
                className={`bg-white rounded-[20px] p-5 transition-all flex flex-col justify-between space-y-4 ${
                  isBarangay
                    ? 'border border-[#7EA0C5]/30 hover:border-[#7EA0C5]/60 hover:shadow-xs shadow-2xs'
                    : 'border border-neutral-200/70 hover:border-neutral-300 hover:shadow-xs shadow-2xs'
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className={`text-sm font-semibold tracking-tight flex items-center gap-1.5 ${
                        isBarangay ? 'text-[#011025]' : 'text-neutral-900'
                      }`}>
                        <span>{user.full_name}</span>
                        {isSelf && (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-2xs ${
                            isBarangay ? 'bg-[#052659] text-white' : 'bg-[#18181b] text-white'
                          }`}>
                            You
                          </span>
                        )}
                      </h4>
                      <p className={`text-xs font-mono flex items-center gap-1.5 mt-1 ${
                        isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                      }`}>
                        <Mail className={`w-3.5 h-3.5 shrink-0 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`} />
                        <span className="truncate">{user.email}</span>
                      </p>
                    </div>
                    {getRoleBadge(user.role)}
                  </div>

                  <div className={`pt-3 border-t space-y-1.5 text-xs ${
                    isBarangay ? 'border-[#7EA0C5]/20 text-[#5482B4]' : 'border-neutral-100 text-neutral-600'
                  }`}>
                    <div className={`flex items-center gap-1.5 font-medium ${
                      isBarangay ? 'text-[#011025]' : 'text-neutral-700'
                    }`}>
                      <MapPin className={`w-3.5 h-3.5 shrink-0 ${isBarangay ? 'text-[#052659]' : 'text-neutral-500'}`} />
                      <span>{brgy ? `Brgy. ${brgy.name}` : 'City-wide Command'}</span>
                    </div>
                    <div className={`text-[11px] font-mono ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                      Registered: {new Date(user.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      {user.disabled ? ' • Disabled' : ''}
                    </div>
                  </div>
                </div>

                <div className={`flex items-center justify-between pt-3 border-t text-xs ${
                  isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'
                }`}>
                  <button
                    onClick={() => handleToggleOfficialRole(user)}
                    className={`text-xs font-medium px-3 py-1 rounded-full transition-colors cursor-pointer shadow-2xs ${
                      isBarangay
                        ? 'text-[#052659] hover:bg-[#C2E8FF]/30 border border-[#7EA0C5]/40'
                        : 'text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100 border border-neutral-200/70'
                    }`}
                  >
                    Change Role
                  </button>

                  {!isSelf && (
                    <button
                      onClick={() => handleRevokeUser(user)}
                      className={`p-1.5 rounded-full shadow-2xs transition-colors cursor-pointer ${
                        isBarangay
                          ? 'text-[#7EA0C5] hover:text-[#052659] hover:bg-[#C2E8FF]/30 border border-[#7EA0C5]/40'
                          : 'text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 border border-neutral-200/70'
                      }`}
                      title={user.disabled ? 'Enable account' : 'Revoke account'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Bottom Information Banner Card matching exact text from screenshot */}
      <div className={`rounded-[24px] p-4 sm:p-5 shadow-xs flex items-start gap-3.5 ${
        isBarangay ? 'bg-white border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'bg-white border border-neutral-200/70'
      }`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isBarangay
            ? 'bg-[#C2E8FF]/40 text-[#052659] border border-[#7EA0C5]/40'
            : 'bg-neutral-100 text-neutral-700 border border-neutral-200/80'
        }`}>
          <Info className="w-4 h-4" />
        </div>
        <p className={`text-xs sm:text-sm leading-relaxed font-normal ${
          isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'
        }`}>
          Creating or promoting an official runs through a server function that checks the caller is LGU, writes an audit entry, and is the only way a role other than citizen can be assigned.
        </p>
      </div>

      {/* Modal: Create Official */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`bg-white rounded-[24px] max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200 ${
            isBarangay ? 'border border-[#7EA0C5]/40 shadow-[0_8px_30px_rgba(5,38,89,0.12)]' : 'border border-neutral-200/80'
          }`}>
            <div className={`flex items-center justify-between pb-3.5 ${isBarangay ? 'border-b border-[#7EA0C5]/20' : 'border-b border-neutral-100'}`}>
              <h3 className={`font-semibold text-base ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                Create Official Account
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className={`cursor-pointer p-1 rounded-full transition-colors ${
                  isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOfficial} className="space-y-4 pt-4">
              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                }`}>
                  Full Name & Title
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Officer Juan Dela Cruz"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className={`w-full text-xs font-medium p-2.5 rounded-xl focus:outline-hidden shadow-2xs transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] placeholder-[#7EA0C5] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                }`}>
                  Official Email Address
                </label>
                <input
                  required
                  type="email"
                  placeholder="e.g. jdelacruz@lingayen.gov.ph"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={`w-full text-xs font-mono font-medium p-2.5 rounded-xl focus:outline-hidden shadow-2xs transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] placeholder-[#7EA0C5] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                />
              </div>

              <div>
                <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                }`}>
                  Official Role
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                  className={`w-full text-xs font-medium p-2.5 rounded-xl appearance-none focus:outline-hidden shadow-2xs cursor-pointer transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                      : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                  }`}
                >
                  <option value="lgu_admin">MDRRMO / LGU Admin (Municipal Command)</option>
                  <option value="barangay">BDRRMC Official (Barangay Response)</option>
                </select>
              </div>

              {formData.role === 'barangay' && (
                <div>
                  <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${
                    isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                  }`}>
                    Jurisdiction / Assigned Barangay
                  </label>
                  <select
                    value={formData.barangay_id}
                    onChange={(e) => setFormData({ ...formData, barangay_id: e.target.value })}
                    className={`w-full text-xs font-medium p-2.5 rounded-xl appearance-none focus:outline-hidden shadow-2xs cursor-pointer transition-all ${
                      isBarangay
                        ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                        : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
                    }`}
                  >
                    {barangays.map((b) => (
                      <option key={b.id} value={b.id}>
                        Brgy. {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={`flex items-center justify-end gap-2 pt-3 ${isBarangay ? 'border-t border-[#7EA0C5]/20' : 'border-t border-neutral-100'}`}>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className={`px-4 py-2 text-xs font-medium rounded-full cursor-pointer transition-colors ${
                    isBarangay
                      ? 'text-[#5482B4] hover:bg-[#C2E8FF]/20'
                      : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-xs font-medium text-white rounded-full shadow-xs cursor-pointer transition-colors ${
                    isBarangay
                      ? 'bg-[#052659] hover:bg-[#031c42]'
                      : 'bg-[#18181b] hover:bg-neutral-800'
                  }`}
                >
                  Create & Authorize
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
