import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  Home,
  Building2,
  ShieldCheck,
  Truck,
  Crown,
  FileText,
  Siren,
  LogOut,
  Search,
  Download,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Activity,
  UserPlus,
  X,
} from 'lucide-react';
import { User, UserRole, ChangeRequest } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { relTime, download, toCSV } from '../lib/util';
import { exportPdf, fileStamp } from '../lib/pdf';
import { TriadEmblem } from '../brand';

// Super Admin console. Initial draft of the layout: a light sidebar with the
// account breakdown and recent activity, a warm yellow hero with the section
// links, two stat cards resting on the hero's floor, and a floating "system
// pulse" card on the right with a report chart and a calendar. On tablets and
// phones the columns stack.

type View = 'overview' | 'accounts' | 'activity' | 'requests';

const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'activity', label: 'Activity' },
  { id: 'requests', label: 'Requests' },
];

const ROLES: { role: UserRole; label: string; icon: typeof Users }[] = [
  { role: 'citizen', label: 'Residents', icon: Home },
  { role: 'barangay', label: 'Barangay officials', icon: Building2 },
  { role: 'lgu_admin', label: 'LDRRMO staff', icon: ShieldCheck },
  { role: 'dispatch', label: 'Dispatch team', icon: Truck },
  { role: 'super_admin', label: 'Super admins', icon: Crown },
];

const ROLE_PILL: Record<UserRole, string> = {
  citizen: 'bg-[#FDECEC] text-[#991B1B]',
  barangay: 'bg-[#E3EEFA] text-[#052659]',
  lgu_admin: 'bg-[#EDEDF0] text-[#27272A]',
  dispatch: 'bg-[#FFEDE3] text-[#C2410C]',
  super_admin: 'bg-[#FFF3C9] text-[#8A5A00]',
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Flat illustration for the hero: the Triad Shield on a plinth, flanked by the portals it joins. */
const HeroArt: React.FC = () => (
  <svg viewBox="0 0 360 230" className="w-full h-full" aria-hidden="true">
    {/* arched doorway behind the shield */}
    <path d="M150 210V92a50 50 0 0 1 100 0v118" fill="#FFF6DA" stroke="#E9A825" strokeWidth="6" />
    <path d="M168 210V98a32 32 0 0 1 64 0v112" fill="#3A2A08" opacity="0.9" />
    <path d="M200 66v144M168 120h64M168 160h64" stroke="#F6C445" strokeWidth="2" opacity="0.6" />
    {/* plinth and shield */}
    <rect x="176" y="186" width="48" height="24" rx="4" fill="#E9A825" />
    <g transform="translate(170 118) scale(0.94)">
      <path d="M30.4 5.3C24 8.2 17.5 9.9 9.5 11.2V30C9.5 32.3 9.7 34.4 10.1 36.4H30.4Z" fill="#FFFFFF" />
      <path d="M33.6 5.3C40 8.2 46.5 9.9 54.5 11.2V30C54.5 32.3 54.3 34.4 53.9 36.4H33.6Z" fill="#FDE68A" />
      <path d="M10.9 40.2C16.8 37.6 22.6 42.8 32 40.2C41.4 37.6 47.2 42.8 53.1 40.2C49.6 48.8 42.2 55.6 32 60.5C21.8 55.6 14.4 48.8 10.9 40.2Z" fill="#FBBF24" />
      <circle cx="32" cy="21.5" r="5.6" fill="#B7791F" />
      <circle cx="32" cy="21.5" r="2.4" fill="#FFFFFF" />
    </g>
    {/* lantern */}
    <path d="M110 40v18" stroke="#3A2A08" strokeWidth="2" />
    <path d="M100 58h20l-3 26h-14z" fill="#3A2A08" />
    <rect x="104" y="64" width="12" height="14" rx="2" fill="#FFD66B" />
    {/* potted plants */}
    <g>
      <path d="M58 182h34l-4 28H62z" fill="#F08A24" />
      <path d="M75 182c-6-18-22-20-26-30 12 2 20 8 26 18 4-14 14-22 28-24-6 10-16 20-28 36z" fill="#4C7A5A" />
    </g>
    <g>
      <path d="M282 186h30l-4 24h-22z" fill="#F08A24" />
      <path d="M297 186c-4-14-18-18-22-26 10 2 18 8 22 16 4-12 12-18 24-20-6 8-14 18-24 30z" fill="#4C7A5A" />
    </g>
    {/* floor line */}
    <path d="M20 210h320" stroke="#E9A825" strokeWidth="2" opacity="0.5" />
  </svg>
);

interface SuperAdminPortalProps {
  currentUser: User;
  onSignOut: () => void;
  /** opens the operations console (incidents, map, shelters, road work, hotlines, analytics) */
  onOpenOperations?: (tab?: string) => void;
}

// activity log labels and where each kind of record can be opened
const ROLE_TEXT: Record<string, string> = {
  super_admin: 'Super Admin',
  lgu_ldrrmc: 'LDRRMO',
  barangay_official: 'Barangay official',
  dispatch_team: 'Dispatch',
  citizen: 'Resident',
};
const ENTITY_TEXT: Record<string, string> = {
  reports: 'Incident report',
  report_dispatches: 'Dispatch',
  profiles: 'Account',
  advisories: 'Advisory',
  evacuation_centers: 'Shelter',
  emergency_hotlines: 'Hotline',
  change_requests: 'Change request',
  road_status: 'Road status',
  road_work_posts: 'Road work',
  relief_distributions: 'Relief schedule',
  relief_inventory: 'Relief stock',
  relief_distribution_log: 'Relief handed out',
  damage_assessments: 'Damage assessment',
  situation_reports: 'Situation report',
  dispatch_units: 'Dispatch unit',
  unit_requests: 'Unit request',
  dispatch_equipment: 'Unit equipment',
  hospital_capacity: 'Hospital capacity',
  sos_log: 'SOS',
  sos_alerts: 'SOS',
  preparedness_guides: 'Guide',
  faqs: 'FAQ',
};
const ENTITY_TAB: Record<string, string> = {
  reports: 'incidents',
  report_dispatches: 'incidents',
  profiles: 'accounts',
  advisories: 'advisories',
  evacuation_centers: 'shelters',
  emergency_hotlines: 'hotlines',
  change_requests: 'hotlines',
  road_status: 'road_work',
  road_work_posts: 'road_work',
  relief_distributions: 'relief',
  relief_inventory: 'relief',
  relief_distribution_log: 'relief',
  damage_assessments: 'reports',
  situation_reports: 'reports',
  dispatch_units: 'dispatch_units',
  unit_requests: 'dispatch_units',
  sos_log: 'sos_log',
  sos_alerts: 'sos_log',
  preparedness_guides: 'guides',
  faqs: 'faqs',
};

export const SuperAdminPortal: React.FC<SuperAdminPortalProps> = ({ currentUser, onSignOut, onOpenOperations }) => {
  const data = useRepo();
  const [view, setView] = useState<View>('overview');
  const [range, setRange] = useState<7 | 14>(14);
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  // activity log filters
  const [actQuery, setActQuery] = useState('');
  const [actRole, setActRole] = useState('all');
  const [actEntity, setActEntity] = useState('all');
  const [actFrom, setActFrom] = useState('');
  const [actTo, setActTo] = useState('');
  const [actLimit, setActLimit] = useState(100);

  // the yellow band behind the pulse card ends where the hero ends
  const heroRef = useRef<HTMLElement>(null);
  const [heroHeight, setHeroHeight] = useState(280);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeroHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    Promise.all([repo.loadUsers(), repo.loadAudit(100), repo.loadSos(), repo.loadChangeRequests()]).catch((e: any) =>
      setLoadError(e?.message || 'Some sections could not be loaded.')
    );
  }, []);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    data.users.forEach((u) => (counts[u.role] = (counts[u.role] || 0) + 1));
    return counts;
  }, [data.users]);
  const totalAccounts = data.users.length;
  const disabled = data.users.filter((u) => u.disabled).length;

  // reports per day for the pulse chart
  const series = useMemo(() => {
    const byDay: Record<string, number> = {};
    data.reports.forEach((r) => {
      const k = dayKey(new Date(r.created_at));
      byDay[k] = (byDay[k] || 0) + 1;
    });
    const days = Array.from({ length: range }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (range - 1 - i));
      return { d, n: byDay[dayKey(d)] || 0 };
    });
    return { days, byDay, max: Math.max(1, ...days.map((x) => x.n)) };
  }, [data.reports, range]);

  const weekAgo = Date.now() - 7 * 86400000;
  const reportsWeek = data.reports.filter((r) => new Date(r.created_at).getTime() >= weekAgo);
  const openReports = data.reports.filter((r) => r.status !== 'resolved' && r.status !== 'rejected').length;
  const resolvedWeek = reportsWeek.filter((r) => r.status === 'resolved').length;
  const sosWeek = data.sosLog.filter((s) => new Date(s.created_at).getTime() >= weekAgo);
  const sosOpen = data.sosLog.filter((s) => s.status !== 'resolved').length;

  const q = query.trim().toLowerCase();
  const accounts = data.users.filter(
    (u) => !q || [u.full_name, u.email, u.barangay_name].some((f) => (f || '').toLowerCase().includes(q))
  );

  const initial = (currentUser.full_name || 'S').trim().charAt(0).toUpperCase();

  // change requests: hotline edits proposed by LGU staff and barangay officials
  const pending = data.changeRequests.filter((c) => c.status === 'pending');
  const [openRequest, setOpenRequest] = useState<ChangeRequest | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  // account administration (Super Admin only, enforced by the admin-users function)
  const [editing, setEditing] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('citizen');
  const [editBarangay, setEditBarangay] = useState<string>('');
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  // New staff account: the admin-users function emails an invitation
  const [newAcct, setNewAcct] = useState<{ fullName: string; email: string; role: 'barangay_official' | 'lgu_ldrrmc'; barangayId: string } | null>(null);
  const [newAcctBusy, setNewAcctBusy] = useState(false);
  const [newAcctNote, setNewAcctNote] = useState<string | null>(null);
  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAcct || newAcctBusy) return;
    if (!newAcct.fullName.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newAcct.email.trim())) {
      setNewAcctNote("Enter the person's name and a valid email address.");
      return;
    }
    if (newAcct.role === 'barangay_official' && !newAcct.barangayId) {
      setNewAcctNote('Choose the barangay this official will manage.');
      return;
    }
    setNewAcctBusy(true);
    try {
      await repo.adminUsers({
        action: 'create',
        email: newAcct.email.trim(),
        fullName: newAcct.fullName.trim(),
        role: newAcct.role,
        barangayId: newAcct.role === 'barangay_official' ? newAcct.barangayId : null,
        redirectUrl: window.location.origin,
      });
      setNewAcctNote(`Invitation sent to ${newAcct.email.trim()}. They set a password from the email.`);
      setNewAcct(null);
      repo.loadUsers().catch(() => {});
    } catch (err: any) {
      setNewAcctNote(err.message || 'Could not create the account.');
    } finally {
      setNewAcctBusy(false);
    }
  };

  // System report: a PDF of accounts, incident load, pending requests and recent activity
  const systemReport = () =>
    exportPdf({
      title: 'UniGuard System Report',
      subtitle: data.org.office,
      filename: `uniguard-system-report-${fileStamp()}.pdf`,
      signer: currentUser.full_name,
      sections: [
        {
          title: 'Accounts by role',
          head: ['Role', 'Accounts'],
          rows: [
            ...ROLES.map((r) => [r.label, roleCounts[r.role] || 0] as (string | number)[]),
            ['Disabled accounts', disabled],
            ['Total', totalAccounts],
          ],
        },
        {
          title: 'Incident reports',
          head: ['Status', 'Reports'],
          rows: (['unverified', 'verified', 'dispatched', 'resolved', 'rejected'] as const).map((st) => [st, data.reports.filter((r) => r.status === st).length]),
        },
        {
          title: 'Pending hotline change requests',
          head: ['Requested', 'Action', 'Reason'],
          rows: pending.map((c) => [new Date(c.created_at).toLocaleString(), c.action, c.reason || '']),
        },
        {
          title: 'Recent activity',
          head: ['When', 'Who', 'What'],
          rows: data.audit.slice(0, 60).map((a) => [new Date(a.timestamp).toLocaleString(), a.actor_name, a.description || a.event_type]),
        },
      ],
    }).catch(() => {});

  const openAccount = (u: User) => {
    setEditing(u);
    setEditRole(u.role);
    setEditBarangay(u.barangay_uuid || '');
    setAccountNotice(null);
  };
  const saveAccount = async () => {
    if (!editing || savingAccount) return;
    if (editRole === 'barangay' && !editBarangay) {
      setAccountNotice('Choose the barangay this official serves.');
      return;
    }
    setSavingAccount(true);
    setAccountNotice(null);
    try {
      if (editRole !== editing.role) {
        await repo.adminUsers({ action: 'set-role', userId: editing.id, role: repo.roleToDb(editRole) });
      }
      if (editRole === 'barangay' || editRole === 'citizen') {
        const target = editBarangay || null;
        if (target !== (editing.barangay_uuid || null)) {
          await repo.adminUsers({ action: 'set-barangay', userId: editing.id, barangayId: target });
        }
      }
      setEditing(null);
    } catch (e: any) {
      setAccountNotice(e?.message || 'Could not save the account.');
    } finally {
      setSavingAccount(false);
    }
  };
  const toggleDisabled = async () => {
    if (!editing || savingAccount) return;
    const disable = !editing.disabled;
    if (disable && !window.confirm(`Disable ${editing.full_name || editing.email}? They are signed out and cannot sign in until enabled again.`)) return;
    setSavingAccount(true);
    setAccountNotice(null);
    try {
      await repo.adminUsers({ action: 'set-disabled', userId: editing.id, disabled: disable });
      setEditing(null);
    } catch (e: any) {
      setAccountNotice(e?.message || 'Could not change the account status.');
    } finally {
      setSavingAccount(false);
    }
  };

  const decide = async (approve: boolean) => {
    if (!openRequest || deciding) return;
    if (!approve && !decisionNote.trim()) {
      setRequestNotice('Give a reason when rejecting, so the requester knows why.');
      return;
    }
    setDeciding(true);
    setRequestNotice(null);
    try {
      await repo.decideChangeRequest(openRequest.id, approve, decisionNote.trim());
      setRequestNotice(approve ? 'Approved. The directory is updated and the requester is notified.' : 'Rejected. The requester is notified.');
      setOpenRequest(null);
      setDecisionNote('');
    } catch (e: any) {
      setRequestNotice(e?.message || 'Could not record the decision.');
    } finally {
      setDeciding(false);
    }
  };

  /* ---------------------------------------------------------- calendar */
  const calendar = (() => {
    const first = month.getDay();
    const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (number | null)[] = Array.from({ length: first }, (): number | null => null).concat(
      Array.from({ length: daysIn }, (_, i) => i + 1)
    );
    const today = new Date();
    return (
      <div className="rounded-2xl border border-neutral-100 p-3">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="w-7 h-7 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[12px] font-semibold text-neutral-700">
            {month.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
            className="w-7 h-7 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-400 mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {cells.map((n, i) => {
            if (!n) return <span key={i} />;
            const d = new Date(month.getFullYear(), month.getMonth(), n);
            const count = series.byDay[dayKey(d)] || 0;
            const isToday = dayKey(d) === dayKey(today);
            return (
              <span
                key={i}
                title={count ? `${count} report${count === 1 ? '' : 's'}` : undefined}
                className={`h-6 rounded-md text-[10px] leading-6 tabular-nums ${
                  isToday
                    ? 'bg-[#F2B21B] text-white font-bold'
                    : count
                    ? 'bg-[#FFF1C2] text-[#8A5A00] font-semibold'
                    : 'text-neutral-500'
                }`}
              >
                {n}
              </span>
            );
          })}
        </div>
      </div>
    );
  })();

  /* ---------------------------------------------------------- pieces */

  const pulseCard = (
    <section className="bg-white rounded-[22px] p-5 shadow-[0_24px_50px_-24px_rgba(58,42,8,0.35)] flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[18px] font-bold text-neutral-800 leading-tight">System pulse</h3>
          <p className="text-[12px] text-neutral-400 mt-0.5">Reports filed per day</p>
        </div>
        <span className="text-[11px] font-semibold text-[#8A5A00] bg-[#FFF3C9] rounded-full px-2.5 py-1">Live</span>
      </div>
      <div className="flex gap-2">
        {([7, 14] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRange(n)}
            className={`h-8 px-3.5 rounded-full text-[12px] font-semibold cursor-pointer ${
              range === n ? 'bg-[#F2B21B] text-white' : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            {n} days
          </button>
        ))}
      </div>
      {/* skyline-style bars */}
      <div className="h-32 rounded-2xl bg-gradient-to-b from-[#F4F2FB] to-white px-3 pt-3 flex items-end gap-1" role="img" aria-label={`Reports per day over the last ${range} days`}>
        {series.days.map(({ d, n }, i) => (
          <div key={i} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${d.toLocaleDateString()}: ${n}`}>
            <div
              className={`w-full rounded-t-md ${i === series.days.length - 1 ? 'bg-[#F2B21B]' : 'bg-[#B9B3E6]'}`}
              style={{ height: `${Math.max(6, (n / series.max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      {calendar}
      <button
        type="button"
        onClick={() => setView('activity')}
        className="h-12 rounded-full bg-gradient-to-r from-[#F6C445] to-[#F2A50F] text-white text-[14px] font-bold flex items-center justify-between px-5 shadow-[0_12px_24px_-12px_rgba(242,165,15,0.9)] cursor-pointer"
      >
        <span>Open activity log</span>
        <ArrowUpRight className="w-4 h-4" />
      </button>
    </section>
  );

  const statCard = (title: string, Icon: typeof Users, tint: string, a: { label: string; value: number }, b: { label: string; value: number }) => (
    <div className="bg-white rounded-[22px] p-5 shadow-[0_20px_40px_-24px_rgba(58,42,8,0.4)]">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-semibold text-neutral-700">{title}</h4>
        <span className="w-6 h-6 rounded-full bg-[#FFF3C9] text-[#C98A0B] flex items-center justify-center">
          <ArrowUpRight className="w-3.5 h-3.5" />
        </span>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <span className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-md shrink-0 ${tint}`}>
          <Icon className="w-6 h-6" />
        </span>
        <div className="flex-1 grid grid-cols-2 gap-3">
          {[a, b].map((x) => (
            <div key={x.label} className="min-w-0">
              <p className="text-[11px] text-neutral-400 truncate">{x.label}</p>
              <p className="text-[24px] font-bold text-neutral-800 tabular-nums leading-tight">{x.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const overview = (
    <>
      {/* stat cards resting on the hero floor */}
      <div className="relative z-10 -mt-14 sm:-mt-16 px-4 sm:px-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {statCard('Reports this week', FileText, 'bg-gradient-to-br from-[#F6A33A] to-[#E9781C]', { label: 'Filed', value: reportsWeek.length }, { label: 'Still open', value: openReports })}
        {statCard('SOS calls this week', Siren, 'bg-gradient-to-br from-[#F6C445] to-[#E9A825]', { label: 'Received', value: sosWeek.length }, { label: 'Unhandled', value: sosOpen })}
      </div>
      <div className="px-4 sm:px-8 mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Resolved this week', value: resolvedWeek },
          { label: 'Responder units', value: data.responders.length },
          { label: 'Open shelters', value: data.centers.filter((c) => c.status === 'open').length },
        ].map((s) => (
          <div key={s.label} className="bg-white/70 rounded-2xl px-5 py-4 flex items-center justify-between">
            <span className="text-[12px] text-neutral-500">{s.label}</span>
            <span className="text-[18px] font-bold text-neutral-800 tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
    </>
  );

  const accountsView = (
    <div className="px-4 sm:px-8 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-[20px] font-bold text-neutral-800">All accounts</h2>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
        <button
          type="button"
          onClick={() => {
            setNewAcct({ fullName: '', email: '', role: 'barangay_official', barangayId: '' });
            setNewAcctNote(null);
          }}
          className="h-10 px-4 rounded-full bg-[#F28C0F] text-white text-[12px] font-bold inline-flex items-center gap-2 shadow-md cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          New account
        </button>
        <label className="h-10 flex-1 sm:flex-none w-full sm:w-72 flex items-center gap-2 px-4 rounded-full bg-white shadow-sm">
          <Search className="w-4 h-4 text-neutral-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or barangay"
            className="flex-1 min-w-0 bg-transparent text-[13px] focus:outline-none"
          />
        </label>
        </div>
      </div>
      {newAcctNote && !newAcct && <p className="mb-3 px-1 text-[12px] font-semibold text-[#8A5A00]">{newAcctNote}</p>}
      {newAcct && (
        <form onSubmit={createAccount} className="mb-4 bg-white rounded-[22px] p-4 sm:p-5 shadow-[0_20px_40px_-28px_rgba(58,42,8,0.4)] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-bold text-neutral-800">New staff account</h3>
            <button type="button" onClick={() => setNewAcct(null)} className="text-neutral-400 cursor-pointer" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[12px] text-neutral-500">
            The person gets an email to set their password. Residents sign up by themselves; dispatch accounts are created from Dispatch units.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Full name</span>
              <input className="w-full h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] outline-none focus:border-[#C98A0B]" value={newAcct.fullName} onChange={(e) => setNewAcct({ ...newAcct, fullName: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Email</span>
              <input type="email" className="w-full h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] outline-none focus:border-[#C98A0B]" value={newAcct.email} onChange={(e) => setNewAcct({ ...newAcct, email: e.target.value })} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Role</span>
              <select className="w-full h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] outline-none focus:border-[#C98A0B]" value={newAcct.role} onChange={(e) => setNewAcct({ ...newAcct, role: e.target.value as 'barangay_official' | 'lgu_ldrrmc' })}>
                <option value="barangay_official">Barangay official</option>
                <option value="lgu_ldrrmc">LDRRMO staff</option>
              </select>
            </label>
            {newAcct.role === 'barangay_official' && (
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Barangay</span>
                <select className="w-full h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] outline-none focus:border-[#C98A0B]" value={newAcct.barangayId} onChange={(e) => setNewAcct({ ...newAcct, barangayId: e.target.value })}>
                  <option value="">Choose a barangay</option>
                  {data.barangays.filter((b) => b.uuid).map((b) => (
                    <option key={b.id} value={b.uuid as string}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {newAcctNote && <p className="text-[12px] font-semibold text-red-700">{newAcctNote}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNewAcct(null)} className="h-10 px-4 rounded-full bg-white border border-neutral-200 text-[12px] font-bold cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={newAcctBusy} className="h-10 px-5 rounded-full bg-[#F28C0F] text-white text-[12px] font-bold cursor-pointer disabled:opacity-60">
              {newAcctBusy ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>
      )}
      <div className="bg-white rounded-[22px] overflow-hidden shadow-[0_20px_40px_-28px_rgba(58,42,8,0.4)]">
        <div className="hidden md:grid grid-cols-[1.6fr_1fr_1.1fr_0.7fr] gap-4 px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 border-b border-neutral-100">
          <span>Account</span>
          <span>Role</span>
          <span>Barangay</span>
          <span>Joined</span>
        </div>
        {accounts.map((u) => {
          const role = ROLES.find((r) => r.role === u.role);
          return (
            <button
              type="button"
              key={u.id}
              onClick={() => openAccount(u)}
              className="w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[1.6fr_1fr_1.1fr_0.7fr] gap-x-4 gap-y-1 items-center px-5 md:px-6 py-3.5 border-b border-neutral-50 last:border-0 hover:bg-[#FFFBF0] cursor-pointer"
            >
              <span className="min-w-0 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-[#FFF3C9] text-[#8A5A00] font-bold flex items-center justify-center shrink-0">
                  {(u.full_name || u.email || '?').trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-neutral-800 truncate">
                    {u.full_name || 'Unnamed'}
                    {u.disabled && <span className="ml-2 text-[10px] font-bold text-red-600">DISABLED</span>}
                  </span>
                  <span className="block text-[11px] text-neutral-400 truncate">{u.email}</span>
                </span>
              </span>
              <span>
                <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${ROLE_PILL[u.role]}`}>{role?.label || u.role}</span>
              </span>
              <span className="hidden md:block text-[13px] text-neutral-600 truncate">{u.barangay_name || '—'}</span>
              <span className="hidden md:block text-[12px] text-neutral-400">{relTime(u.created_at)}</span>
            </button>
          );
        })}
        {!accounts.length && <p className="px-6 py-10 text-center text-[13px] text-neutral-400">No accounts match.</p>}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#3A2A08]/40 p-0 sm:p-6" onClick={() => setEditing(null)}>
          <div
            role="dialog"
            aria-label="Manage account"
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-t-[26px] sm:rounded-[26px] p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-full bg-[#FFF3C9] text-[#8A5A00] font-bold flex items-center justify-center shrink-0">
                {(editing.full_name || editing.email || '?').trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold text-neutral-800 truncate">{editing.full_name || 'Unnamed'}</span>
                <span className="block text-[12px] text-neutral-400 truncate">{editing.email}</span>
              </span>
            </div>

            {editing.role === 'dispatch' ? (
              <p className="mt-5 text-[13px] text-neutral-600 bg-[#FFFBF0] rounded-xl px-4 py-3">
                Dispatch team accounts belong to a dispatch unit and are managed from the unit, which comes in the next phase.
              </p>
            ) : (
              <>
                <label className="block mt-5 text-[11px] font-semibold text-neutral-500">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="mt-1.5 w-full h-11 rounded-xl border border-neutral-200 px-3 text-[13px] bg-white focus:outline-none focus:border-[#F2B21B]"
                >
                  <option value="citizen">Resident</option>
                  <option value="barangay">Barangay official</option>
                  <option value="lgu_admin">LDRRMO staff</option>
                  <option value="super_admin">Super Admin</option>
                </select>
                {(editRole === 'barangay' || editRole === 'citizen') && (
                  <>
                    <label className="block mt-4 text-[11px] font-semibold text-neutral-500">Barangay</label>
                    <select
                      value={editBarangay}
                      onChange={(e) => setEditBarangay(e.target.value)}
                      className="mt-1.5 w-full h-11 rounded-xl border border-neutral-200 px-3 text-[13px] bg-white focus:outline-none focus:border-[#F2B21B]"
                    >
                      <option value="">{editRole === 'citizen' ? 'Not set' : 'Choose a barangay'}</option>
                      {data.barangays
                        .filter((b) => b.uuid)
                        .map((b) => (
                          <option key={b.uuid as string} value={b.uuid as string}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  </>
                )}
              </>
            )}

            {accountNotice && <p className="mt-3 text-[12px] text-red-700">{accountNotice}</p>}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={toggleDisabled}
                disabled={savingAccount || editing.id === currentUser.id}
                title={editing.id === currentUser.id ? 'You cannot disable your own account' : undefined}
                className={`flex-1 h-11 rounded-full border text-[13px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  editing.disabled ? 'border-emerald-200 text-emerald-700' : 'border-red-200 text-red-700'
                }`}
              >
                {editing.disabled ? 'Enable account' : 'Disable account'}
              </button>
              {editing.role !== 'dispatch' && (
                <button
                  type="button"
                  onClick={saveAccount}
                  disabled={savingAccount}
                  className="flex-1 h-11 rounded-full bg-gradient-to-r from-[#F6C445] to-[#F2A50F] text-white text-[13px] font-bold shadow-[0_10px_20px_-10px_rgba(242,165,15,0.9)] cursor-pointer disabled:opacity-50"
                >
                  {savingAccount ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
            <button type="button" onClick={() => setEditing(null)} className="mt-3 w-full h-10 text-[13px] text-neutral-500 cursor-pointer">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const entities = Array.from(new Set(data.audit.map((a) => a.entity).filter(Boolean))).sort();
  const filteredAudit = data.audit.filter((a) => {
    if (actRole !== 'all' && (actRole === 'system' ? a.actor_id || a.actor_name !== 'system' : a.actor_role !== actRole)) return false;
    if (actEntity !== 'all' && a.entity !== actEntity) return false;
    const day = (a.timestamp || '').slice(0, 10);
    if (actFrom && day < actFrom) return false;
    if (actTo && day > actTo) return false;
    const q = actQuery.trim().toLowerCase();
    if (q && ![a.description, a.event_type, a.actor_name, a.entity, a.actor_barangay].some((x) => (x || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const exportAudit = () =>
    download(
      `uniguard-activity-${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(
        filteredAudit.map((a) => ({
          when: a.timestamp,
          actor: a.actor_name,
          role: ROLE_TEXT[a.actor_role || ''] || a.actor_role || '',
          barangay: a.actor_barangay || '',
          action: a.event_type,
          record: a.entity,
          record_id: a.target_id,
          details: a.description,
        }))
      )
    );
  const fieldCls = 'h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] text-neutral-800 outline-none focus:border-[#C98A0B] min-w-0';

  const activityView = (
    <div className="px-4 sm:px-8 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-[20px] font-bold text-neutral-800">Activity log</h2>
        <button
          type="button"
          onClick={exportAudit}
          disabled={!filteredAudit.length}
          className="h-9 px-4 rounded-full bg-white text-[#8A5A00] text-[12px] font-bold inline-flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>
      <div className="bg-white rounded-[22px] p-3 sm:p-4 mb-3 shadow-[0_20px_40px_-28px_rgba(58,42,8,0.4)] grid grid-cols-2 xl:grid-cols-4 gap-2.5">
        <input
          className={`${fieldCls} col-span-2 xl:col-span-4`}
          placeholder="Search actor, action, record"
          value={actQuery}
          onChange={(e) => setActQuery(e.target.value)}
          aria-label="Search the activity log"
        />
        <select className={fieldCls} value={actRole} onChange={(e) => setActRole(e.target.value)} aria-label="Actor role">
          <option value="all">Every role</option>
          {Object.entries(ROLE_TEXT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
          <option value="system">System</option>
        </select>
        <select className={fieldCls} value={actEntity} onChange={(e) => setActEntity(e.target.value)} aria-label="Record type">
          <option value="all">Every record</option>
          {entities.map((e) => (
            <option key={e} value={e}>
              {ENTITY_TEXT[e] || e}
            </option>
          ))}
        </select>
        <input type="date" className={fieldCls} value={actFrom} onChange={(e) => setActFrom(e.target.value)} aria-label="From date" />
        <input type="date" className={fieldCls} value={actTo} onChange={(e) => setActTo(e.target.value)} aria-label="To date" />
      </div>
      <p className="text-[11px] text-[#5C3A0A]/70 mb-2 px-1">
        Showing {filteredAudit.length} of the latest {data.audit.length} entries.
      </p>
      <div className="bg-white rounded-[22px] p-2 shadow-[0_20px_40px_-28px_rgba(58,42,8,0.4)]">
        {filteredAudit.map((a) => {
          const target = a.entity ? ENTITY_TAB[a.entity] : undefined;
          return (
            <div key={a.id} className="flex items-start gap-3 px-3 sm:px-4 py-3 rounded-2xl hover:bg-[#FFFBF0]">
              <span className="w-8 h-8 rounded-xl bg-[#FFF3C9] text-[#C98A0B] flex items-center justify-center shrink-0 mt-0.5">
                <Activity className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-neutral-800 break-words">{a.description || a.event_type}</span>
                <span className="block text-[11px] text-neutral-400 mt-0.5">
                  {a.actor_name}
                  {a.actor_role ? ` (${ROLE_TEXT[a.actor_role] || a.actor_role}${a.actor_barangay ? `, ${a.actor_barangay}` : ''})` : ''} · {ENTITY_TEXT[a.entity] || a.entity} ·{' '}
                  {new Date(a.timestamp).toLocaleString()}
                </span>
              </span>
              {target && (target === 'accounts' || onOpenOperations) && (
                <button
                  type="button"
                  onClick={() => (target === 'accounts' ? setView('accounts') : onOpenOperations && onOpenOperations(target))}
                  className="shrink-0 h-8 px-3 rounded-full bg-[#FFF3C9] text-[#8A5A00] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer hover:bg-[#FFE89A]"
                  title="Open the screen that holds this record"
                >
                  Open
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        {!filteredAudit.length && (
          <p className="px-4 py-10 text-center text-[13px] text-neutral-400">{data.audit.length ? 'Nothing matches these filters.' : 'No activity recorded yet.'}</p>
        )}
      </div>
      {data.audit.length >= actLimit && (
        <div className="flex justify-center mt-3">
          <button
            type="button"
            onClick={() => {
              const next = actLimit + 400;
              setActLimit(next);
              repo.loadAudit(next).catch(() => {});
            }}
            className="h-9 px-5 rounded-full bg-white text-[#8A5A00] text-[12px] font-bold shadow-sm cursor-pointer"
          >
            Load older activity
          </button>
        </div>
      )}
    </div>
  );

  const FIELD_LABEL: Record<string, string> = { agency_name: 'Agency', contact_number: 'Contact number', scope: 'Scope', description: 'Description', active: 'Verified' };
  const fieldText = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

  const requestsView = (
    <div className="px-4 sm:px-8 pt-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[20px] font-bold text-neutral-800">Change requests</h2>
        <span className="text-[12px] font-semibold text-[#8A5A00] bg-[#FFF3C9] rounded-full px-3 py-1">{pending.length} pending</span>
      </div>
      {requestNotice && <p className="mb-3 text-[12px] text-[#5C3A0A] bg-[#FFF3C9] rounded-xl px-4 py-2">{requestNotice}</p>}
      <div className="bg-white rounded-[22px] p-2 shadow-[0_20px_40px_-28px_rgba(58,42,8,0.4)]">
        {data.changeRequests.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setOpenRequest(c);
              setDecisionNote('');
              setRequestNotice(null);
            }}
            className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-2xl hover:bg-[#FFFBF0] cursor-pointer"
          >
            <span className="w-8 h-8 rounded-xl bg-[#FFF3C9] text-[#C98A0B] flex items-center justify-center shrink-0 mt-0.5">
              <FileText className="w-4 h-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-neutral-800 truncate">
                {c.action === 'add' ? 'Add' : c.action === 'edit' ? 'Edit' : 'Remove'} hotline:{' '}
                {String(c.proposed_data.agency_name || c.current_data.agency_name || '')}
              </span>
              <span className="block text-[11px] text-neutral-400 mt-0.5 truncate">
                {c.requester_name || 'Unknown'} · {c.requester_role === 'barangay_official' ? `Brgy. ${c.requester_barangay}` : 'LDRRMO'} · {relTime(c.created_at)}
              </span>
            </span>
            <span
              className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                c.status === 'pending' ? 'bg-[#FFF3C9] text-[#8A5A00]' : c.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {c.status}
            </span>
          </button>
        ))}
        {!data.changeRequests.length && <p className="px-4 py-10 text-center text-[13px] text-neutral-400">No change requests yet.</p>}
      </div>

      {openRequest && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#3A2A08]/40 p-0 sm:p-6" onClick={() => setOpenRequest(null)}>
          <div
            role="dialog"
            aria-label="Review change request"
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-[26px] sm:rounded-[26px] p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          >
            <h3 className="text-[17px] font-bold text-neutral-800">
              {openRequest.action === 'add' ? 'Add a hotline' : openRequest.action === 'edit' ? 'Change a hotline' : 'Remove a hotline'}
            </h3>
            <p className="text-[12px] text-neutral-400 mt-1">
              From {openRequest.requester_name || 'Unknown'}
              {openRequest.requester_role === 'barangay_official' ? ` (Brgy. ${openRequest.requester_barangay})` : ' (LDRRMO)'} · {relTime(openRequest.created_at)}
            </p>
            {openRequest.reason && <p className="mt-3 text-[13px] text-neutral-700 bg-[#FFFBF0] rounded-xl px-4 py-3">“{openRequest.reason}”</p>}

            <div className="mt-4 rounded-2xl border border-neutral-100 overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400 bg-neutral-50">
                <span>Field</span>
                <span>Current</span>
                <span>Proposed</span>
              </div>
              {Object.keys(FIELD_LABEL)
                .filter((k) => k in openRequest.current_data || k in openRequest.proposed_data)
                .map((k) => {
                  const before = openRequest.current_data[k];
                  const after = openRequest.action === 'delete' ? undefined : k in openRequest.proposed_data ? openRequest.proposed_data[k] : before;
                  const changed = fieldText(before) !== fieldText(after);
                  return (
                    <div key={k} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-4 py-2 text-[12px] border-t border-neutral-100">
                      <span className="text-neutral-500">{FIELD_LABEL[k]}</span>
                      <span className="text-neutral-700 break-words">{fieldText(before)}</span>
                      <span className={`break-words ${changed ? 'font-semibold text-[#8A5A00]' : 'text-neutral-700'}`}>{fieldText(after)}</span>
                    </div>
                  );
                })}
            </div>

            {openRequest.status === 'pending' ? (
              <>
                <label className="block mt-4 text-[11px] font-semibold text-neutral-500">Note to the requester (required to reject)</label>
                <textarea
                  rows={2}
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2 text-[13px] focus:outline-none focus:border-[#F2B21B] resize-none"
                />
                {requestNotice && <p className="mt-2 text-[12px] text-red-700">{requestNotice}</p>}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide(false)}
                    disabled={deciding}
                    className="flex-1 h-11 rounded-full border border-neutral-200 text-[13px] font-bold text-neutral-700 cursor-pointer disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(true)}
                    disabled={deciding}
                    className="flex-1 h-11 rounded-full bg-gradient-to-r from-[#F6C445] to-[#F2A50F] text-white text-[13px] font-bold shadow-[0_10px_20px_-10px_rgba(242,165,15,0.9)] cursor-pointer disabled:opacity-50"
                  >
                    {deciding ? 'Saving…' : 'Approve'}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-4 text-[12px] text-neutral-500">
                {openRequest.status === 'approved' ? 'Approved' : 'Rejected'} {openRequest.decided_at ? relTime(openRequest.decided_at) : ''}
                {openRequest.decision_note ? ` · ${openRequest.decision_note}` : ''}
              </p>
            )}
            <button type="button" onClick={() => setOpenRequest(null)} className="mt-3 w-full h-10 text-[13px] text-neutral-500 cursor-pointer">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );

  /* ---------------------------------------------------------- layout */

  return (
    <div className="h-full w-full overflow-hidden bg-[#E4E6EE] font-sans antialiased text-neutral-800">
      <div className="h-full w-full p-0 sm:p-3 lg:p-6 flex items-center justify-center">
        <div className="h-full w-full max-w-[1500px] flex overflow-hidden sm:rounded-[26px] bg-[#F4F2EE] shadow-[0_40px_80px_-40px_rgba(40,40,70,0.45)]">
          {/* ---------------- left sidebar (desktop) */}
          <aside className="hidden lg:flex w-[270px] shrink-0 flex-col bg-white px-6 py-7 overflow-y-auto">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-[#F2B21B] flex items-center justify-center">
                <TriadEmblem portal="admin" variant="reverse" size={20} />
              </span>
              <span className="text-[15px] font-extrabold text-neutral-800">UniGuard</span>
            </div>

            <h1 className="mt-9 text-[24px] font-extrabold text-neutral-900 leading-tight">System Admin</h1>
            <div className="mt-4 flex items-center justify-between text-[12px] text-neutral-400">
              <span>Accounts by role</span>
              <span className="font-semibold text-neutral-600">{totalAccounts}</span>
            </div>

            <ul className="mt-4 space-y-4">
              {ROLES.map(({ role, label, icon: Icon }) => {
                const n = roleCounts[role] || 0;
                const pct = totalAccounts ? (n / totalAccounts) * 100 : 0;
                return (
                  <li key={role}>
                    <button type="button" onClick={() => { setView('accounts'); setQuery(''); }} className="w-full text-left cursor-pointer group">
                      <span className="flex items-center gap-3">
                        <Icon className="w-4 h-4 text-neutral-400 group-hover:text-[#C98A0B]" />
                        <span className="flex-1 text-[13px] text-neutral-700">{label}</span>
                        <span className="text-[12px] font-semibold text-neutral-500 tabular-nums">{n}</span>
                      </span>
                      <span className="mt-2 ml-7 block h-1 rounded-full bg-neutral-100 overflow-hidden">
                        <span className="block h-full rounded-full bg-gradient-to-r from-[#F6C445] to-[#F2A50F]" style={{ width: `${pct}%` }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-9 flex items-center justify-between">
              <h2 className="text-[13px] font-bold text-neutral-800">Recent activity</h2>
              <span className="w-2 h-2 rounded-full bg-[#F2B21B]" />
            </div>
            <ul className="mt-3 space-y-2.5">
              {data.audit.slice(0, 4).map((a) => (
                <li key={a.id} className="text-[11px] text-neutral-500 leading-snug">
                  <span className="line-clamp-2">{a.description || a.event_type}</span>
                  <span className="text-neutral-300">{relTime(a.timestamp)}</span>
                </li>
              ))}
              {!data.audit.length && <li className="text-[11px] text-neutral-400">No activity yet.</li>}
            </ul>

            <button
              type="button"
              onClick={onSignOut}
              className="mt-auto pt-0 h-11 rounded-full bg-gradient-to-r from-[#F6C445] to-[#F2A50F] text-white text-[13px] font-bold flex items-center justify-between px-5 shadow-[0_10px_20px_-10px_rgba(242,165,15,0.9)] cursor-pointer"
            >
              <span>Sign out</span>
              <LogOut className="w-4 h-4" />
            </button>
          </aside>

          {/* ---------------- main column */}
          <main className="flex-1 min-w-0 overflow-y-auto">
            {/* warm hero with the section links */}
            <section ref={heroRef} className="relative bg-gradient-to-br from-[#F7CE6A] via-[#F2B744] to-[#E9A12A] pt-[env(safe-area-inset-top)]">
              <div className="flex items-center gap-3 px-4 sm:px-8 pt-4 sm:pt-6">
                <span className="lg:hidden w-8 h-8 rounded-lg bg-white/30 flex items-center justify-center shrink-0">
                  <TriadEmblem portal="admin" variant="reverse" size={20} />
                </span>
                <nav aria-label="Admin sections" className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar min-w-0">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setView(v.id)}
                      aria-current={view === v.id ? 'page' : undefined}
                      className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold cursor-pointer transition-colors ${
                        view === v.id ? 'bg-white text-[#8A5A00] shadow-sm' : 'text-[#5C3A0A]/75 hover:text-[#3A2A08]'
                      }`}
                    >
                      {v.label}
                      {v.id === 'requests' && pending.length > 0 && (
                        <span className="ml-1.5 inline-flex min-w-[18px] h-[18px] px-1 items-center justify-center rounded-full bg-[#F28C0F] text-white text-[10px] font-bold">
                          {pending.length}
                        </span>
                      )}
                    </button>
                  ))}
                  {onOpenOperations && (
                    <button
                      type="button"
                      onClick={() => onOpenOperations()}
                      className="shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold cursor-pointer text-[#5C3A0A]/75 hover:text-[#3A2A08] inline-flex items-center gap-1"
                    >
                      Operations
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onOpenOperations && (
                    <button
                      type="button"
                      onClick={() => onOpenOperations('settings')}
                      className="shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold cursor-pointer text-[#5C3A0A]/75 hover:text-[#3A2A08] inline-flex items-center gap-1"
                    >
                      Settings
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onOpenOperations && (
                    <button
                      type="button"
                      onClick={() => onOpenOperations('hotlines')}
                      className="shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold cursor-pointer text-[#5C3A0A]/75 hover:text-[#3A2A08] inline-flex items-center gap-1"
                    >
                      Hotlines
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onOpenOperations && (
                    <button
                      type="button"
                      onClick={() => onOpenOperations('dispatch_units')}
                      className="shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold cursor-pointer text-[#5C3A0A]/75 hover:text-[#3A2A08] inline-flex items-center gap-1"
                    >
                      Dispatch units
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </nav>
                <span className="ml-auto hidden sm:flex w-9 h-9 rounded-full bg-white/35 text-[#3A2A08] font-bold items-center justify-center shrink-0">
                  {initial}
                </span>
                <button
                  type="button"
                  onClick={() => systemReport()}
                  className="hidden sm:flex h-9 px-4 rounded-full bg-[#F28C0F] text-white text-[12px] font-bold items-center gap-2 shadow-md cursor-pointer shrink-0"
                >
                  <Download className="w-3.5 h-3.5" /> System report
                </button>
                <button
                  type="button"
                  onClick={onSignOut}
                  aria-label="Sign out"
                  className="lg:hidden ml-auto sm:ml-0 w-9 h-9 rounded-full bg-white/35 text-[#3A2A08] flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>

              {view === 'overview' ? (
                <div className="grid grid-cols-1 md:grid-cols-[1fr_0.9fr] items-end gap-2 px-4 sm:px-8 pt-6 sm:pt-8">
                  <div className="pb-24 sm:pb-28 md:pb-32">
                    <h2 className="text-[26px] sm:text-[34px] font-extrabold leading-[1.1] text-[#3A2A08]">
                      Every portal,
                      <br />
                      one view.
                    </h2>
                    <p className="mt-3 text-[13px] sm:text-[14px] text-[#5C3A0A]/80 max-w-sm">
                      {totalAccounts} accounts across residents, barangays, LDRRMO and dispatch.
                      {disabled ? ` ${disabled} disabled.` : ''}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setView('accounts')}
                        className="h-10 px-5 rounded-full bg-[#F28C0F] text-white text-[13px] font-bold shadow-md cursor-pointer"
                      >
                        Manage accounts
                      </button>
                      {onOpenOperations && (
                        <button
                          type="button"
                          onClick={() => onOpenOperations()}
                          className="h-10 px-5 rounded-full bg-white/80 text-[#5C3A0A] text-[13px] font-bold shadow-sm cursor-pointer inline-flex items-center gap-1.5"
                        >
                          Open operations
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="hidden md:block h-[230px] self-end">
                    <HeroArt />
                  </div>
                </div>
              ) : (
                <div className="px-4 sm:px-8 pt-6 pb-8">
                  <h2 className="text-[26px] font-extrabold text-[#3A2A08]">
                    {view === 'accounts' ? 'Accounts' : view === 'requests' ? 'Requests' : 'Activity'}
                  </h2>
                  <p className="text-[13px] text-[#5C3A0A]/80 mt-1">
                    {view === 'accounts'
                      ? `${totalAccounts} accounts in UniGuard`
                      : view === 'requests'
                      ? 'Changes to official records wait here for your approval'
                      : 'Every privileged action, newest first'}
                  </p>
                </div>
              )}
            </section>

            {loadError && <p className="mx-4 sm:mx-8 mt-4 text-[12px] text-red-700 bg-red-50 rounded-xl px-4 py-2">{loadError}</p>}

            {view === 'overview' ? overview : view === 'accounts' ? accountsView : view === 'requests' ? requestsView : activityView}

            {/* on narrower screens the pulse card follows the content */}
            <div className="xl:hidden px-4 sm:px-8 py-6">{pulseCard}</div>
            <div className="hidden xl:block h-8" />
          </main>

          {/* ---------------- floating pulse card (wide screens) */}
          <aside className="hidden xl:block w-[330px] shrink-0 relative">
            <div className="absolute inset-x-0 top-0 bg-gradient-to-br from-[#F2B744] to-[#E9A12A]" style={{ height: heroHeight }} aria-hidden="true" />
            <div className="relative h-full overflow-y-auto pt-16 pb-6 pr-6">{pulseCard}</div>
          </aside>
        </div>
      </div>
    </div>
  );
};
