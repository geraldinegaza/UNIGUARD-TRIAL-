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
  RefreshCw,
  LayoutGrid,
  Bell,
  BarChart3,
  Settings as SettingsIcon,
} from 'lucide-react';
import { User, UserRole, ChangeRequest } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { relTime, download, toCSV } from '../lib/util';
import { exportPdf, fileStamp } from '../lib/pdf';
import { openable } from '../hooks/useFocusItem';
import { DetailModal, DetailRow } from './DetailModal';
import { TriadEmblem, THEMES, type Portal } from '../brand';

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

// Triad Shield geometry (64 unit grid), as in brand/TriadEmblem
const SHIELD_LEFT = 'M30.4 5.3C24 8.2 17.5 9.9 9.5 11.2V30C9.5 32.3 9.7 34.4 10.1 36.4H30.4Z';
const SHIELD_RIGHT = 'M33.6 5.3C40 8.2 46.5 9.9 54.5 11.2V30C54.5 32.3 54.3 34.4 53.9 36.4H33.6Z';
const SHIELD_KEEL = 'M10.9 40.2C16.8 37.6 22.6 42.8 32 40.2C41.4 37.6 47.2 42.8 53.1 40.2C49.6 48.8 42.2 55.6 32 60.5C21.8 55.6 14.4 48.8 10.9 40.2Z';

// one portal's shield in its own colours, centred on (x, y)
const HeroShield: React.FC<{ portal: Portal; x: number; y: number; size: number; filter?: string }> = ({ portal, x, y, size, filter }) => {
  const c = THEMES[portal].emblem.light;
  const k = size / 64;
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${k})`} filter={filter}>
      <path d={SHIELD_LEFT} fill={c.left} />
      <path d={SHIELD_RIGHT} fill={c.right} />
      <path d={SHIELD_KEEL} fill={c.keel} />
      <circle cx="32" cy="21.5" r="5.6" fill={c.hub} />
      <circle cx="32" cy="21.5" r="2.4" fill={c.dot} />
    </g>
  );
};

// the four portals ride a tilted orbit around the Super Admin's shield
const HUB = { x: 180, y: 76 };
const ORBIT = { rx: 128, ry: 50 };
const onOrbit = (deg: number) => ({
  x: Math.round(HUB.x + ORBIT.rx * Math.cos((deg * Math.PI) / 180)),
  y: Math.round(HUB.y + ORBIT.ry * Math.sin((deg * Math.PI) / 180)),
});
const HERO_NODES = (
  [
    { portal: 'resident', label: 'Residents', deg: 208, labelAbove: true },
    { portal: 'barangay', label: 'Barangay', deg: 332, labelAbove: true },
    { portal: 'command', label: 'LDRRMO', deg: 152, labelAbove: false },
    { portal: 'dispatch', label: 'Dispatch', deg: 28, labelAbove: false },
  ] as { portal: Portal; label: string; deg: number; labelAbove: boolean }[]
).map((n) => ({ ...n, ...onOrbit(n.deg) }));
// sparkles scattered over the scene: x, y, size, delay (s)
const SPARKLES: [number, number, number, number][] = [
  [118, 18, 5, 0],
  [250, 14, 4, 1.1],
  [28, 104, 4, 0.6],
  [336, 120, 5, 1.7],
  [214, 136, 3.5, 2.3],
];
// eight rays, after the sun on the Philippine flag
const RAYS = Array.from({ length: 8 }, (_, i) => i * 45);

// "Every portal, one view": the Super Admin's gold shield on a sun burst, the
// four portals' shields riding an orbit around it, and curved links that carry
// data in. No containers: everything stands on the gold hero. It all sits in
// the top 145 units, because the stat cards overlap the bottom of the art.
// Motion stops for people who ask for reduced motion.
// each portal shield opens the accounts of that portal's role
const PORTAL_ROLE: Partial<Record<Portal, UserRole>> = { resident: 'citizen', barangay: 'barangay', command: 'lgu_admin', dispatch: 'dispatch' };

const HeroArt: React.FC<{ onPickRole?: (role: UserRole) => void }> = ({ onPickRole }) => (
  <svg viewBox="0 0 360 230" className="w-full h-full ug-hero-art" role="group" aria-label="The four portals">
    <defs>
      <radialGradient id="ugHeroGlow">
        <stop offset="0%" stopColor="#FFF6DA" stopOpacity="0.95" />
        <stop offset="45%" stopColor="#FFE7A3" stopOpacity="0.45" />
        <stop offset="100%" stopColor="#FFE7A3" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="ugHeroHalo">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="ugHeroRay" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor="#FFF6DA" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#FFF6DA" stopOpacity="0" />
      </linearGradient>
      <filter id="ugHeroLift" x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#5C3A0A" floodOpacity="0.28" />
      </filter>
    </defs>
    <style>{`
      .ug-hero-art .rays { transform-origin: ${HUB.x}px ${HUB.y}px; animation: ug-hero-spin 40s linear infinite; }
      .ug-hero-art .flow { animation: ug-hero-flow 2.4s linear infinite; }
      .ug-hero-art .beacon { transform-origin: 0 0; animation: ug-hero-spin 10s linear infinite; }
      .ug-hero-art .float { animation: ug-hero-float 5s ease-in-out infinite; }
      .ug-hero-art .node { cursor: pointer; outline: none; }
      .ug-hero-art .node .ring { opacity: 0; transition: opacity .2s; }
      .ug-hero-art .node:hover .ring, .ug-hero-art .node:focus-visible .ring { opacity: 1; }
      .ug-hero-art .node:hover .halo { transform: scale(1.25); }
      .ug-hero-art .node .halo { transform-box: fill-box; transform-origin: center; transition: transform .2s; }
      .ug-hero-art .twinkle { transform-box: fill-box; transform-origin: center; animation: ug-hero-twinkle 3s ease-in-out infinite; }
      @keyframes ug-hero-spin { to { transform: rotate(360deg); } }
      @keyframes ug-hero-flow { from { stroke-dashoffset: 26; } to { stroke-dashoffset: 0; } }
      @keyframes ug-hero-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      @keyframes ug-hero-twinkle { 0%, 100% { opacity: .25; transform: scale(.6); } 50% { opacity: 1; transform: scale(1); } }
      @media (prefers-reduced-motion: reduce) { .ug-hero-art * { animation: none !important; } }
    `}</style>

    {/* sparkles */}
    {SPARKLES.map(([x, y, r, delay]) => (
      <path
        key={`${x}-${y}`}
        className="twinkle"
        style={{ animationDelay: `${delay}s` }}
        d={`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`}
        fill="#FFF6DA"
      />
    ))}

    {/* back half of the orbit, behind the sun */}
    <path
      d={`M${HUB.x - ORBIT.rx} ${HUB.y}A${ORBIT.rx} ${ORBIT.ry} 0 0 1 ${HUB.x + ORBIT.rx} ${HUB.y}`}
      fill="none"
      stroke="#FFF6DA"
      strokeWidth="1.6"
      strokeDasharray="1 7"
      strokeLinecap="round"
      opacity="0.8"
    />

    {/* sun burst and glow behind the Super Admin's shield */}
    <circle cx={HUB.x} cy={HUB.y} r="64" fill="url(#ugHeroGlow)" />
    <g className="rays">
      {RAYS.map((deg) => (
        <path
          key={deg}
          transform={`rotate(${deg} ${HUB.x} ${HUB.y})`}
          d={`M${HUB.x - 7} ${HUB.y - 30}L${HUB.x} ${HUB.y - 62}L${HUB.x + 7} ${HUB.y - 30}Z`}
          fill="url(#ugHeroRay)"
        />
      ))}
    </g>

    {/* curved links from each portal into the centre, with data flowing in */}
    {HERO_NODES.map((n) => {
      const d = `M${n.x} ${n.y}Q${(n.x + HUB.x) / 2} ${n.labelAbove ? HUB.y - 34 : HUB.y + 34} ${HUB.x} ${HUB.y}`;
      return (
        <g key={`${n.portal}-link`}>
          <path d={d} fill="none" stroke="#FFF6DA" strokeWidth="1.6" opacity="0.5" />
          <path className="flow" d={d} fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="2 24" />
        </g>
      );
    })}

    {/* the Super Admin's shield */}
    <g className="float">
      <HeroShield portal="admin" x={HUB.x} y={HUB.y + 2} size={62} filter="url(#ugHeroLift)" />
    </g>

    {/* front half of the orbit, in front of the sun, with its travelling beacon */}
    <path
      d={`M${HUB.x - ORBIT.rx} ${HUB.y}A${ORBIT.rx} ${ORBIT.ry} 0 0 0 ${HUB.x + ORBIT.rx} ${HUB.y}`}
      fill="none"
      stroke="#FFF6DA"
      strokeWidth="1.8"
      strokeLinecap="round"
      opacity="0.85"
    />
    <g transform={`translate(${HUB.x} ${HUB.y}) scale(1 ${ORBIT.ry / ORBIT.rx})`}>
      <g className="beacon">
        <circle cx={ORBIT.rx} cy="0" r="9" fill="url(#ugHeroHalo)" />
        <circle cx={ORBIT.rx} cy="0" r="3.4" fill="#FFFFFF" />
      </g>
    </g>

    {/* the four portals, standing on the gold with a soft halo, no tile */}
    {HERO_NODES.map((n, i) => {
      const role = PORTAL_ROLE[n.portal];
      const pick = onPickRole && role ? () => onPickRole(role) : undefined;
      return (
      <g
        key={n.portal}
        className={`float${pick ? ' node' : ''}`}
        style={{ animationDelay: `${i * 0.6}s` }}
        role={pick ? 'button' : undefined}
        tabIndex={pick ? 0 : undefined}
        aria-label={pick ? `${n.label} accounts` : undefined}
        onClick={pick}
        onKeyDown={
          pick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pick();
                }
              }
            : undefined
        }
      >
        {pick && <circle className="ring" cx={n.x} cy={n.y + 1} r="19" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeDasharray="3 3" />}
        <circle className="halo" cx={n.x} cy={n.y} r="20" fill="url(#ugHeroHalo)" />
        <HeroShield portal={n.portal} x={n.x} y={n.y + 1} size={30} filter="url(#ugHeroLift)" />
        <text
          x={n.x}
          y={n.labelAbove ? n.y - 21 : n.y + 28}
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="800"
          letterSpacing="1.2"
          fill="#5C3A0A"
          fontFamily="inherit"
        >
          {n.label.toUpperCase()}
        </text>
      </g>
      );
    })}
  </svg>
);

interface SuperAdminPortalProps {
  currentUser: User;
  onSignOut: () => void;
  /** opens the operations console (incidents, map, shelters, road work, hotlines, analytics) */
  onOpenOperations?: (tab?: string) => void;
}

// Sidebar menu: LDRRMO screens the Super Admin opens in Operations
const SIDE_MENU: { tab: string; label: string; icon: typeof Users }[] = [
  { tab: 'overview', label: 'Operations', icon: LayoutGrid },
  { tab: 'settings', label: 'Settings', icon: SettingsIcon },
  { tab: 'notifications', label: 'Notifications', icon: Bell },
  { tab: 'reports', label: 'Reports & Documents', icon: FileText },
  { tab: 'analytics', label: 'Analytics', icon: BarChart3 },
];
// screens this menu already links to; the Operations navigation leaves them out
export const SIDEBAR_OPS_TABS = SIDE_MENU.map((m) => m.tab).filter((tab) => tab !== 'overview');

// activity log labels and where each kind of record can be opened
// reference build: actions grouped into kinds for the activity filter
const ACTION_BUCKET_TEXT: Record<string, string> = {
  create: 'Create',
  edit: 'Edit / update',
  delete: 'Delete',
  verify: 'Verify',
  status: 'Status / dispatch',
  other: 'Other',
};
const actionBucket = (action: string) => {
  const a = (action || '').toLowerCase();
  if (/\.create|\.insert|invited|received|published|fanned_out|member_invited/.test(a)) return 'create';
  if (/\.update|\.edit|role_changed|barangay_changed|status_changed/.test(a)) return 'edit';
  if (/\.delete|\.deleted/.test(a)) return 'delete';
  if (/verif/.test(a)) return 'verify';
  if (/dispatch|advance|resolved|rejected|disabled|enabled|deactivated/.test(a)) return 'status';
  return 'other';
};

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
  // the day picked on the calendar or the pulse chart (today to start)
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  // accounts list: one role, or every role
  const [accountRole, setAccountRole] = useState<UserRole | 'all'>('all');
  const showRole = (role: UserRole | 'all') => {
    setAccountRole(role);
    setQuery('');
    setView('accounts');
  };
  // activity log filters
  const [actQuery, setActQuery] = useState('');
  const [actRole, setActRole] = useState('all');
  const [actEntity, setActEntity] = useState('all');
  const [actFrom, setActFrom] = useState('');
  const [actTo, setActTo] = useState('');
  const [actAction, setActAction] = useState('all');
  const [actActor, setActActor] = useState('all');
  const [actBarangay, setActBarangay] = useState('all');
  const [actPage, setActPage] = useState(1);
  const [refreshingAudit, setRefreshingAudit] = useState(false);
  // any filter change starts the activity log again at page 1
  useEffect(() => setActPage(1), [actQuery, actRole, actEntity, actAction, actActor, actBarangay, actFrom, actTo]);

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
    Promise.all([repo.loadUsers(), repo.loadAudit(500), repo.loadSos(), repo.loadChangeRequests(), repo.loadDispatchUnits(), repo.loadResponders()]).catch((e: any) =>
      setLoadError(e?.message || 'Some sections could not be loaded.')
    );
  }, []);

  const unreadNotes = data.notifications.filter((n) => n.unread).length;
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
    (u) =>
      (accountRole === 'all' || u.role === accountRole) &&
      (!q || [u.full_name, u.email, u.barangay_name].some((f) => (f || '').toLowerCase().includes(q)))
  );

  const initial = (currentUser.full_name || 'S').trim().charAt(0).toUpperCase();

  // change requests: hotline edits proposed by LGU staff and barangay officials
  const pending = data.changeRequests.filter((c) => c.status === 'pending');
  const [openRequest, setOpenRequest] = useState<ChangeRequest | null>(null);
  // Activity Log: the entry whose details are open
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  // account administration (Super Admin only, enforced by the admin-users function)
  const [editing, setEditing] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('citizen');
  const [editBarangay, setEditBarangay] = useState<string>('');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  // a dispatch account belongs to one unit, as its admin or a member
  const [editUnit, setEditUnit] = useState<string>('');
  const [editUnitRole, setEditUnitRole] = useState<'unit_admin' | 'member'>('member');
  const activeUnits = data.units.filter((u) => u.active);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  // New staff account: the admin-users function emails an invitation
  const [newAcct, setNewAcct] = useState<{
    fullName: string;
    email: string;
    role: 'barangay_official' | 'lgu_ldrrmc' | 'dispatch_team';
    barangayId: string;
    unitId: string;
    unitRole: 'unit_admin' | 'member';
  } | null>(null);
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
    if (newAcct.role === 'dispatch_team' && !newAcct.unitId) {
      setNewAcctNote(activeUnits.length ? 'Choose the unit this person belongs to.' : 'Create a dispatch unit first, in Dispatch units.');
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
        unitId: newAcct.role === 'dispatch_team' ? newAcct.unitId : null,
        unitRole: newAcct.role === 'dispatch_team' ? newAcct.unitRole : undefined,
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


  const openAccount = (u: User) => {
    setEditing(u);
    setEditRole(u.role);
    setEditBarangay(u.barangay_uuid || '');
    setEditName(u.full_name || '');
    setEditPhone(u.phone || '');
    setEditUnit(u.dispatch_unit_id || '');
    setEditUnitRole(u.unit_role === 'unit_admin' ? 'unit_admin' : 'member');
    setAccountNotice(null);
  };
  const saveAccount = async () => {
    if (!editing || savingAccount) return;
    if (editRole === 'barangay' && !editBarangay) {
      setAccountNotice('Choose the barangay this official serves.');
      return;
    }
    if (editRole === 'dispatch' && !editUnit) {
      setAccountNotice(activeUnits.length ? 'Choose the unit this person belongs to.' : 'Create a dispatch unit first, in Dispatch units.');
      return;
    }
    if (!editName.trim()) {
      setAccountNotice('The name cannot be empty.');
      return;
    }
    setSavingAccount(true);
    setAccountNotice(null);
    try {
      if (editName.trim() !== (editing.full_name || '') || editPhone.trim() !== (editing.phone || '')) {
        await repo.editAccountDetails(editing.id, editName, editPhone);
      }
      const unitChanged =
        editRole === 'dispatch' &&
        (editUnit !== (editing.dispatch_unit_id || '') || editUnitRole !== (editing.unit_role === 'unit_admin' ? 'unit_admin' : 'member'));
      if (editRole !== editing.role || unitChanged) {
        await repo.adminUsers(
          editRole === 'dispatch'
            ? { action: 'set-role', userId: editing.id, role: 'dispatch_team', unitId: editUnit, unitRole: editUnitRole }
            : { action: 'set-role', userId: editing.id, role: repo.roleToDb(editRole) }
        );
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
  // a picked day: what happened on it, from the reports, SOS calls and activity log
  const pickDay = (d: Date) => {
    setSelectedDay(d);
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };
  const sosByDay = useMemo(() => {
    const byDay: Record<string, number> = {};
    data.sosLog.forEach((x) => {
      const k = dayKey(new Date(x.created_at));
      byDay[k] = (byDay[k] || 0) + 1;
    });
    return byDay;
  }, [data.sosLog]);
  const selKey = dayKey(selectedDay);
  const dayReports = data.reports.filter((r) => dayKey(new Date(r.created_at)) === selKey);
  const daySos = data.sosLog.filter((x) => dayKey(new Date(x.created_at)) === selKey);
  const dayActivity = data.audit.filter((a) => dayKey(new Date(a.timestamp)) === selKey);
  // the activity log filter takes a local calendar date (YYYY-MM-DD)
  const openDayActivity = () => {
    const d = selectedDay;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    clearActivity();
    setActFrom(k);
    setActTo(k);
    setView('activity');
  };

  const calendar = (() => {
    const first = month.getDay();
    const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (number | null)[] = Array.from({ length: first }, (): number | null => null).concat(
      Array.from({ length: daysIn }, (_, i) => i + 1)
    );
    const today = new Date();
    const onThisMonth = month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
    return (
      <div className="rounded-2xl border border-neutral-100 p-3">
        <div className="flex items-center justify-between gap-1 mb-2">
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
          <span className="flex items-center gap-0.5">
            {!onThisMonth && (
              <button
                type="button"
                onClick={() => pickDay(new Date())}
                className="h-7 px-2 rounded-full text-[10px] font-bold text-[#8A5A00] hover:bg-[#FFF3C9] cursor-pointer"
              >
                Today
              </button>
            )}
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              aria-label="Next month"
              className="w-7 h-7 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </span>
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
            const k = dayKey(d);
            const count = series.byDay[k] || 0;
            const sos = sosByDay[k] || 0;
            const isToday = k === dayKey(today);
            const isPicked = k === selKey;
            return (
              <button
                type="button"
                key={i}
                onClick={() => pickDay(d)}
                aria-pressed={isPicked}
                aria-label={`${d.toLocaleDateString([], { month: 'long', day: 'numeric' })}: ${count} report${count === 1 ? '' : 's'}${sos ? `, ${sos} SOS` : ''}`}
                className={`relative h-6 rounded-md text-[10px] leading-6 tabular-nums cursor-pointer hover:ring-1 hover:ring-[#F2B21B] ${
                  isToday
                    ? 'bg-[#F2B21B] text-white font-bold'
                    : count
                    ? 'bg-[#FFF1C2] text-[#8A5A00] font-semibold'
                    : 'text-neutral-500'
                } ${isPicked ? 'ring-2 ring-[#C98A0B] ring-offset-1' : ''}`}
              >
                {n}
                {sos > 0 && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#E5484D]" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {/* the picked day */}
        <div className="mt-3 pt-3 border-t border-neutral-100">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] font-bold text-neutral-800">
              {selectedDay.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            <p className="text-[11px] text-neutral-400 tabular-nums">
              {dayReports.length} report{dayReports.length === 1 ? '' : 's'} · {daySos.length} SOS · {dayActivity.length} activit{dayActivity.length === 1 ? 'y' : 'ies'}
            </p>
          </div>
          {dayReports.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {dayReports.slice(0, 3).map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono font-semibold text-[#8A5A00] shrink-0">{r.code}</span>
                  <span className="truncate text-neutral-600">
                    {r.hazard_type} · {r.barangay_name || '—'}
                  </span>
                </li>
              ))}
              {dayReports.length > 3 && <li className="text-[11px] text-neutral-400">and {dayReports.length - 3} more</li>}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-neutral-400">No reports filed this day.</p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {onOpenOperations && dayReports.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenOperations('incidents')}
                className="h-7 px-3 rounded-full bg-[#FFF3C9] text-[#8A5A00] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer hover:bg-[#FFE9A3]"
              >
                Incidents <ArrowUpRight className="w-3 h-3" />
              </button>
            )}
            {onOpenOperations && daySos.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenOperations('sos_log')}
                className="h-7 px-3 rounded-full bg-[#FDE4E4] text-[#A12C2C] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer hover:bg-[#FBD3D3]"
              >
                SOS Log <ArrowUpRight className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={openDayActivity}
              className="h-7 px-3 rounded-full bg-neutral-100 text-neutral-600 text-[11px] font-bold cursor-pointer hover:bg-neutral-200"
            >
              Day’s activity
            </button>
          </div>
        </div>
      </div>
    );
  })();

  /* ---------------------------------------------------------- pieces */

  const isLive = data.source === 'supabase' && data.online;
  const pulseCard = (
    <section className="bg-white rounded-[22px] p-5 shadow-[0_24px_50px_-24px_rgba(58,42,8,0.35)] flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[18px] font-bold text-neutral-800 leading-tight">System pulse</h3>
          <p className="text-[12px] text-neutral-400 mt-0.5">Reports filed per day</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1 ${
            isLive ? 'text-[#8A5A00] bg-[#FFF3C9]' : 'text-neutral-500 bg-neutral-100'
          }`}
          title={isLive ? 'Updates arrive as they happen' : 'Showing the last data this device saved'}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-[#E9A825] animate-pulse' : 'bg-neutral-400'}`} aria-hidden="true" />
          {isLive ? 'Live' : 'Offline'}
        </span>
      </div>
      <div className="flex gap-2">
        {([7, 14] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRange(n)}
            aria-pressed={range === n}
            className={`h-8 px-3.5 rounded-full text-[12px] font-semibold cursor-pointer ${
              range === n ? 'bg-[#F2B21B] text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
            }`}
          >
            {n} days
          </button>
        ))}
      </div>
      {/* skyline-style bars: tap one to pick that day */}
      <div className="h-32 rounded-2xl bg-gradient-to-b from-[#F4F2FB] to-white px-3 pt-3 flex items-end gap-1" aria-label={`Reports per day over the last ${range} days`}>
        {series.days.map(({ d, n }, i) => {
          const picked = dayKey(d) === selKey;
          return (
            <button
              type="button"
              key={i}
              onClick={() => pickDay(d)}
              aria-pressed={picked}
              aria-label={`${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}: ${n} report${n === 1 ? '' : 's'}`}
              title={`${d.toLocaleDateString()}: ${n}`}
              className="group flex-1 min-w-0 flex flex-col items-center justify-end h-full cursor-pointer"
            >
              <span
                className={`block w-full rounded-t-md transition-colors ${
                  picked ? 'bg-[#C98A0B]' : i === series.days.length - 1 ? 'bg-[#F2B21B]' : 'bg-[#B9B3E6] group-hover:bg-[#9E96DB]'
                }`}
                style={{ height: `${Math.max(6, (n / series.max) * 100)}%` }}
              />
            </button>
          );
        })}
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

  // a stat card opens the Operations screen it summarises
  const statCard = (
    title: string,
    Icon: typeof Users,
    tint: string,
    a: { label: string; value: number },
    b: { label: string; value: number },
    tab: string
  ) => {
    const body = (
      <>
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-semibold text-neutral-700">{title}</h4>
          <span className="w-6 h-6 rounded-full bg-[#FFF3C9] text-[#C98A0B] flex items-center justify-center transition-colors group-hover:bg-[#F2B21B] group-hover:text-white">
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
      </>
    );
    const cls = 'bg-white rounded-[22px] p-5 shadow-[0_20px_40px_-24px_rgba(58,42,8,0.4)]';
    return onOpenOperations ? (
      <button type="button" onClick={() => onOpenOperations(tab)} className={`${cls} group text-left cursor-pointer transition-shadow hover:shadow-[0_24px_44px_-22px_rgba(58,42,8,0.5)]`}>
        {body}
      </button>
    ) : (
      <div className={cls}>{body}</div>
    );
  };

  const overview = (
    <>
      {/* stat cards resting on the hero floor */}
      <div className="relative z-10 -mt-14 sm:-mt-16 px-4 sm:px-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {statCard('Reports this week', FileText, 'bg-gradient-to-br from-[#F6A33A] to-[#E9781C]', { label: 'Filed', value: reportsWeek.length }, { label: 'Still open', value: openReports }, 'incidents')}
        {statCard('SOS calls this week', Siren, 'bg-gradient-to-br from-[#F6C445] to-[#E9A825]', { label: 'Received', value: sosWeek.length }, { label: 'Unhandled', value: sosOpen }, 'sos_log')}
      </div>
      <div className="px-4 sm:px-8 mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Resolved this week', value: resolvedWeek, tab: 'incidents' },
          { label: 'Responder units', value: data.responders.length, tab: 'incidents' },
          { label: 'Open shelters', value: data.centers.filter((c) => c.status === 'open').length, tab: 'shelters' },
        ].map((s) =>
          onOpenOperations ? (
            <button
              type="button"
              key={s.label}
              onClick={() => onOpenOperations(s.tab)}
              className="group bg-white/70 hover:bg-white rounded-2xl px-5 py-4 flex items-center justify-between gap-3 text-left cursor-pointer transition-colors"
            >
              <span className="text-[12px] text-neutral-500">{s.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-[18px] font-bold text-neutral-800 tabular-nums">{s.value}</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-[#C98A0B]" />
              </span>
            </button>
          ) : (
            <div key={s.label} className="bg-white/70 rounded-2xl px-5 py-4 flex items-center justify-between">
              <span className="text-[12px] text-neutral-500">{s.label}</span>
              <span className="text-[18px] font-bold text-neutral-800 tabular-nums">{s.value}</span>
            </div>
          )
        )}
      </div>
    </>
  );

  const accountsView = (
    <div className="px-4 sm:px-8 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-[20px] font-bold text-neutral-800">
          {accountRole === 'all' ? 'All accounts' : ROLES.find((r) => r.role === accountRole)?.label || 'Accounts'}
        </h2>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
        <button
          type="button"
          onClick={() => {
            setNewAcct({ fullName: '', email: '', role: 'barangay_official', barangayId: '', unitId: '', unitRole: 'member' });
            setNewAcctNote(null);
          }}
          className="h-10 px-4 rounded-full bg-[#F28C0F] text-white text-[12px] font-bold inline-flex items-center gap-2 shadow-md cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          New account
        </button>
        <button
          type="button"
          onClick={exportUsersPdf}
          className="h-10 px-4 rounded-full bg-white text-[#8A5A00] text-[12px] font-bold inline-flex items-center gap-2 shadow-sm cursor-pointer"
        >
          <Download className="w-4 h-4" />
          Export PDF
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
      {/* one role, or every role (the sidebar's role rows and the hero's portals set it too) */}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show accounts by role">
        {[{ role: 'all' as const, label: 'All' }, ...ROLES].map(({ role, label }) => (
          <button
            key={role}
            type="button"
            onClick={() => setAccountRole(role)}
            aria-pressed={accountRole === role}
            className={`h-8 px-3.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors ${
              accountRole === role ? 'bg-[#F2B21B] text-white shadow-sm' : 'bg-white text-neutral-600 hover:bg-[#FFF3C9] hover:text-[#8A5A00]'
            }`}
          >
            {label}
            <span className={`ml-1.5 tabular-nums ${accountRole === role ? 'text-white/80' : 'text-neutral-400'}`}>
              {role === 'all' ? totalAccounts : roleCounts[role] || 0}
            </span>
          </button>
        ))}
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
            The person gets an email to set their password. Residents sign up by themselves.
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
              <select className="w-full h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] outline-none focus:border-[#C98A0B]" value={newAcct.role} onChange={(e) => setNewAcct({ ...newAcct, role: e.target.value as 'barangay_official' | 'lgu_ldrrmc' | 'dispatch_team' })}>
                <option value="barangay_official">Barangay official</option>
                <option value="lgu_ldrrmc">LDRRMO staff</option>
                <option value="dispatch_team">Dispatch team</option>
              </select>
            </label>
            {newAcct.role === 'dispatch_team' && (
              <>
                <label className="block">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">Dispatch unit</span>
                  <select className="w-full h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] outline-none focus:border-[#C98A0B]" value={newAcct.unitId} onChange={(e) => setNewAcct({ ...newAcct, unitId: e.target.value })}>
                    <option value="">{activeUnits.length ? 'Choose a unit' : 'No active units yet'}</option>
                    {activeUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.unit_type})
                      </option>
                    ))}
                  </select>
                </label>
                {!activeUnits.length && onOpenOperations && (
                  <button type="button" onClick={() => onOpenOperations('dispatch_units')} className="sm:col-span-2 text-left text-[12px] font-bold text-[#8A5A00] underline cursor-pointer">
                    No dispatch units yet. Create one in Dispatch units
                  </button>
                )}
                <label className="block">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">In the unit</span>
                  <select className="w-full h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] outline-none focus:border-[#C98A0B]" value={newAcct.unitRole} onChange={(e) => setNewAcct({ ...newAcct, unitRole: e.target.value as 'unit_admin' | 'member' })}>
                    <option value="member">Member</option>
                    <option value="unit_admin">Unit admin</option>
                  </select>
                </label>
              </>
            )}
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

            {(
              <>
                <label className="block mt-5 text-[11px] font-semibold text-neutral-500">Full name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1.5 w-full h-11 rounded-xl border border-neutral-200 px-3 text-[13px] bg-white focus:outline-none focus:border-[#F2B21B]"
                />
                <label className="block mt-4 text-[11px] font-semibold text-neutral-500">Phone</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  inputMode="tel"
                  className="mt-1.5 w-full h-11 rounded-xl border border-neutral-200 px-3 text-[13px] bg-white focus:outline-none focus:border-[#F2B21B]"
                />
                <p className="mt-3 text-[11px] text-neutral-400">
                  {editing.disabled ? 'Disabled' : 'Active'} · joined {new Date(editing.created_at).toLocaleDateString()}
                </p>
                <label className="block mt-4 text-[11px] font-semibold text-neutral-500">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="mt-1.5 w-full h-11 rounded-xl border border-neutral-200 px-3 text-[13px] bg-white focus:outline-none focus:border-[#F2B21B]"
                >
                  <option value="citizen">Resident</option>
                  <option value="barangay">Barangay official</option>
                  <option value="lgu_admin">LDRRMO staff</option>
                  <option value="dispatch">Dispatch team</option>
                  <option value="super_admin">Super Admin</option>
                </select>
                {editRole === 'dispatch' && (
                  <>
                    <label className="block mt-4 text-[11px] font-semibold text-neutral-500">Dispatch unit</label>
                    {activeUnits.length ? (
                      <select
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value)}
                        className="mt-1.5 w-full h-11 rounded-xl border border-neutral-200 px-3 text-[13px] bg-white focus:outline-none focus:border-[#F2B21B]"
                      >
                        <option value="">Choose a unit</option>
                        {activeUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.unit_type})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="mt-1.5 text-[12px] text-amber-800">
                        No active dispatch units yet.{' '}
                        {onOpenOperations ? (
                          <button type="button" onClick={() => onOpenOperations('dispatch_units')} className="font-bold underline cursor-pointer">
                            Create one in Dispatch units
                          </button>
                        ) : (
                          <b>Create one in Dispatch units first.</b>
                        )}
                      </p>
                    )}
                    <label className="block mt-4 text-[11px] font-semibold text-neutral-500">In the unit</label>
                    <select
                      value={editUnitRole}
                      onChange={(e) => setEditUnitRole(e.target.value as 'unit_admin' | 'member')}
                      className="mt-1.5 w-full h-11 rounded-xl border border-neutral-200 px-3 text-[13px] bg-white focus:outline-none focus:border-[#F2B21B]"
                    >
                      <option value="member">Member</option>
                      <option value="unit_admin">Unit admin (manages the unit's crew and equipment)</option>
                    </select>
                  </>
                )}
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
              <button
                type="button"
                onClick={saveAccount}
                disabled={savingAccount}
                className="flex-1 h-11 rounded-full bg-gradient-to-r from-[#F6C445] to-[#F2A50F] text-white text-[13px] font-bold shadow-[0_10px_20px_-10px_rgba(242,165,15,0.9)] cursor-pointer disabled:opacity-50"
              >
                {savingAccount ? 'Saving…' : 'Save'}
              </button>
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
  const actors = Array.from(new Set(data.audit.map((a) => a.actor_name).filter(Boolean))).sort();
  const auditBarangays = Array.from(new Set(data.audit.map((a) => a.actor_barangay || '').filter(Boolean))).sort();
  const filteredAudit = data.audit.filter((a) => {
    if (actRole !== 'all' && (actRole === 'system' ? a.actor_id || a.actor_name !== 'system' : a.actor_role !== actRole)) return false;
    if (actEntity !== 'all' && a.entity !== actEntity) return false;
    if (actAction !== 'all' && actionBucket(a.event_type) !== actAction) return false;
    if (actActor !== 'all' && a.actor_name !== actActor) return false;
    if (actBarangay !== 'all' && (a.actor_barangay || '') !== actBarangay) return false;
    // compare by the local calendar day (timestamps are stored in UTC)
    const t = new Date(a.timestamp);
    const day = isNaN(t.getTime()) ? '' : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (actFrom && day < actFrom) return false;
    if (actTo && day > actTo) return false;
    const q = actQuery.trim().toLowerCase();
    if (q && ![a.description, a.event_type, a.actor_name, a.entity, a.actor_barangay].some((x) => (x || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const PAGE = 25;
  const pages = Math.max(1, Math.ceil(filteredAudit.length / PAGE));
  const page = Math.min(actPage, pages);
  const pageRows = filteredAudit.slice((page - 1) * PAGE, page * PAGE);
  const openEntry = openEntryId ? data.audit.find((a) => a.id === openEntryId) || null : null;
  const clearActivity = () => {
    setActQuery('');
    setActRole('all');
    setActEntity('all');
    setActAction('all');
    setActActor('all');
    setActBarangay('all');
    setActFrom('');
    setActTo('');
    setActPage(1);
  };
  // reference build: Export PDF of the filtered activity log and of the accounts
  function exportAuditPdf() {
    return exportPdf({
      title: 'Activity Log',
      subtitle: data.org.office,
      meta: [`${filteredAudit.length} of ${data.audit.length} entries`],
      filename: `uniguard-activity-${fileStamp()}.pdf`,
      landscape: true,
      signer: currentUser.full_name,
      sections: [
        {
          title: 'Entries',
          head: ['When', 'Who', 'Role', 'Barangay', 'Record', 'Action', 'What changed'],
          rows: filteredAudit.map((a) => [
            new Date(a.timestamp).toLocaleString(),
            a.actor_name,
            ROLE_TEXT[a.actor_role || ''] || a.actor_role || 'System',
            a.actor_barangay || '',
            ENTITY_TEXT[a.entity] || a.entity,
            a.event_type,
            a.description,
          ]),
        },
      ],
    }).catch(() => {});
  }
  function exportUsersPdf() {
    return exportPdf({
      title: 'User Management',
      subtitle: data.org.office,
      meta: [`${accounts.length} accounts`],
      filename: `uniguard-accounts-${fileStamp()}.pdf`,
      landscape: true,
      signer: currentUser.full_name,
      sections: [
        {
          title: 'Accounts',
          head: ['Name', 'Email', 'Role', 'Barangay', 'Status', 'Created'],
          rows: accounts.map((u) => [
            u.full_name || '(no name)',
            u.email,
            (ROLES.find((r) => r.role === u.role)?.label || u.role) + (u.unit_role ? ` (${u.unit_role.replace('_', ' ')})` : ''),
            u.barangay_name || '',
            u.disabled ? 'Disabled' : 'Active',
            new Date(u.created_at).toLocaleDateString(),
          ]),
        },
      ],
    }).catch(() => {});
  }
  const fieldCls = 'h-10 px-3 rounded-xl bg-[#FFFBF0] border border-[#F3D98A] text-[13px] text-neutral-800 outline-none focus:border-[#C98A0B] min-w-0';

  const activityView = (
    <div className="px-4 sm:px-8 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-[20px] font-bold text-neutral-800">Activity log</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-9 px-3 rounded-full bg-white/70 text-[#8A5A00] text-[12px] font-bold inline-flex items-center">
            {filteredAudit.length} / {data.audit.length}
          </span>
          <button
            type="button"
            disabled={refreshingAudit}
            onClick={async () => {
              setRefreshingAudit(true);
              await repo.loadAudit(500).catch(() => {});
              setRefreshingAudit(false);
            }}
            className="h-9 px-4 rounded-full bg-white text-[#8A5A00] text-[12px] font-bold inline-flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingAudit ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={exportAuditPdf}
            disabled={!filteredAudit.length}
            className="h-9 px-4 rounded-full bg-white text-[#8A5A00] text-[12px] font-bold inline-flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>
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
        <select className={fieldCls} value={actAction} onChange={(e) => setActAction(e.target.value)} aria-label="Action type">
          <option value="all">Every action</option>
          {Object.entries(ACTION_BUCKET_TEXT).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className={fieldCls} value={actActor} onChange={(e) => setActActor(e.target.value)} aria-label="Changed by">
          <option value="all">Everyone</option>
          {actors.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select className={fieldCls} value={actBarangay} onChange={(e) => setActBarangay(e.target.value)} aria-label="Barangay">
          <option value="all">Every barangay</option>
          {auditBarangays.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <input type="date" className={fieldCls} value={actFrom} onChange={(e) => setActFrom(e.target.value)} aria-label="From date" />
        <input type="date" className={fieldCls} value={actTo} onChange={(e) => setActTo(e.target.value)} aria-label="To date" />
        <button type="button" onClick={clearActivity} className="h-10 px-4 rounded-xl bg-white border border-[#F3D98A] text-[12px] font-bold text-[#8A5A00] cursor-pointer">
          Clear
        </button>
      </div>
      <p className="text-[11px] text-[#5C3A0A]/70 mb-2 px-1">
        Every change made by an account, newest first. Tap Open to go to the record.
      </p>
      <div className="bg-white rounded-[22px] p-2 shadow-[0_20px_40px_-28px_rgba(58,42,8,0.4)]">
        {pageRows.map((a) => {
          const target = a.entity ? ENTITY_TAB[a.entity] : undefined;
          return (
            <div
              key={a.id}
              {...openable(() => setOpenEntryId(a.id))}
              aria-label="Activity entry: details"
              className="flex items-start gap-3 px-3 sm:px-4 py-3 rounded-2xl hover:bg-[#FFFBF0] cursor-pointer"
            >
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
                  onClick={(e) => {
                    e.stopPropagation();
                    if (target === 'accounts') setView('accounts');
                    else if (onOpenOperations) onOpenOperations(target);
                  }}
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
      {openEntry && (() => {
        const a = openEntry;
        const target = a.entity ? ENTITY_TAB[a.entity] : undefined;
        const changed = (a.meta && typeof a.meta === 'object' && (a.meta as any).changed) as Record<string, { from: unknown; to: unknown }> | undefined;
        const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
        const otherMeta = a.meta && Object.keys(a.meta).filter((k) => k !== 'changed').length ? a.meta : null;
        return (
          <DetailModal
            title="Activity entry"
            subtitle={a.description || a.event_type}
            onClose={() => setOpenEntryId(null)}
            actions={
              target && (target === 'accounts' || onOpenOperations) ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpenEntryId(null);
                    if (target === 'accounts') setView('accounts');
                    else if (onOpenOperations) onOpenOperations(target);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold bg-[#FFF3C9] text-[#8A5A00] hover:bg-[#FFE89A] cursor-pointer"
                >
                  Open this record
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              ) : null
            }
          >
            <div>
              <DetailRow label="When" value={new Date(a.timestamp).toLocaleString()} />
              <DetailRow label="Actor" value={a.actor_name || 'System'} />
              <DetailRow label="Role" value={a.actor_role ? ROLE_TEXT[a.actor_role] || a.actor_role : 'System'} />
              <DetailRow label="Barangay" value={a.actor_barangay} />
              <DetailRow label="Module" value={ENTITY_TEXT[a.entity] || a.entity} />
              <DetailRow label="Action" value={a.event_type} />
              <DetailRow label="Record id" value={<span className="font-mono text-[11px]">{a.target_id}</span>} />
            </div>
            {changed && Object.keys(changed).length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Changed fields (before → after)</p>
                <ul className="divide-y divide-neutral-100 text-xs">
                  {Object.entries(changed).map(([field, v]) => (
                    <li key={field} className="py-1.5 break-words">
                      <span className="font-semibold text-neutral-900">{field}</span>: <span className="text-neutral-500">{show(v?.from)}</span> → <span className="text-neutral-900">{show(v?.to)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {otherMeta && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Detail</p>
                <pre className="text-[11px] bg-neutral-50 border border-neutral-100 rounded-xl p-3 whitespace-pre-wrap break-words max-h-48 overflow-auto">
                  {JSON.stringify(Object.fromEntries(Object.entries(otherMeta).filter(([k]) => k !== 'changed')), null, 2)}
                </pre>
              </div>
            )}
          </DetailModal>
        );
      })()}
      {filteredAudit.length > PAGE && (
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3 px-1">
          <span className="text-[12px] text-[#5C3A0A]/70">
            Page {page} of {pages} · {filteredAudit.length} entries match
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setActPage(page - 1)}
              className="h-9 px-4 rounded-full bg-white text-[#8A5A00] text-[12px] font-bold shadow-sm cursor-pointer disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setActPage(page + 1)}
              className="h-9 px-4 rounded-full bg-white text-[#8A5A00] text-[12px] font-bold shadow-sm cursor-pointer disabled:opacity-40"
            >
              Next
            </button>
          </span>
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
            {/* the application name leads; the console's name sits under it */}
            <div className="flex items-center gap-2">
              <TriadEmblem portal="admin" size={30} />
              <span className="text-[22px] font-extrabold tracking-tight text-neutral-900 leading-none">UniGuard</span>
            </div>

            <h1 className="mt-6 text-[14px] font-bold text-neutral-800 leading-tight">System Admin</h1>
            {/* the LDRRMO screens the Super Admin opens in the gold Operations view */}
            {onOpenOperations && (
              <>
                <nav aria-label="Operations menu" className="mt-4 -mx-3 space-y-0.5">
                  {SIDE_MENU.map(({ tab, label, icon: Icon }) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => onOpenOperations(tab)}
                      className="w-full h-10 px-3 rounded-xl flex items-center gap-3 text-left text-[13px] font-semibold text-neutral-700 hover:bg-[#FFF6DB] hover:text-[#8A5A00] cursor-pointer group"
                    >
                      <Icon className="w-4 h-4 text-neutral-400 group-hover:text-[#C98A0B]" />
                      <span className="flex-1">{label}</span>
                      {tab === 'notifications' && unreadNotes > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#F28C0F] text-white text-[10px] font-bold flex items-center justify-center">
                          {unreadNotes}
                        </span>
                      )}
                      <ArrowUpRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-[#C98A0B]" />
                    </button>
                  ))}
                </nav>
              </>
            )}

            {/* a section label under the menu, set apart by a hairline */}
            <div
              className={`${onOpenOperations ? 'mt-7 pt-6 border-t border-neutral-100' : 'mt-6'} flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.12em] text-neutral-400`}
            >
              <span>Accounts by role</span>
              <span className="text-[12px] tracking-normal text-neutral-500 tabular-nums">{totalAccounts}</span>
            </div>

            <ul className="mt-4 space-y-4">
              {ROLES.map(({ role, label, icon: Icon }) => {
                const n = roleCounts[role] || 0;
                const pct = totalAccounts ? (n / totalAccounts) * 100 : 0;
                return (
                  <li key={role}>
                    <button type="button" onClick={() => showRole(role)} aria-label={`${label}: ${n} account${n === 1 ? '' : 's'}`} className="w-full text-left cursor-pointer group">
                      <span className="flex items-center gap-3">
                        <Icon className="w-4 h-4 text-neutral-400 group-hover:text-[#C98A0B]" />
                        <span className="flex-1 text-[13px] text-neutral-600">{label}</span>
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

            {/* pinned to the bottom, with room above it even when the sidebar is full */}
            <div className="mt-auto pt-8 shrink-0">
              <button
                type="button"
                onClick={onSignOut}
                className="group w-full h-10 pl-4 pr-1.5 rounded-full bg-gradient-to-r from-[#F6C445] to-[#F2A50F] text-white text-[12.5px] font-bold flex items-center justify-between shadow-[0_8px_16px_-10px_rgba(242,165,15,0.9)] cursor-pointer transition-all duration-200 hover:from-[#F2B93A] hover:to-[#E9950A] hover:shadow-[0_10px_20px_-10px_rgba(233,149,10,0.95)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2A50F] focus-visible:ring-offset-2"
              >
                <span>Sign out</span>
                <span className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center transition-colors group-hover:bg-white/35">
                  <LogOut className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </button>
            </div>
          </aside>

          {/* ---------------- main column */}
          <main className="flex-1 min-w-0 overflow-y-auto">
            {/* warm hero with the section links */}
            <section ref={heroRef} className="relative bg-gradient-to-br from-[#F7CE6A] via-[#F2B744] to-[#E9A12A] pt-[env(safe-area-inset-top)]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-8 pt-4 sm:pt-6">
                <span className="lg:hidden w-8 h-8 rounded-lg bg-white/30 flex items-center justify-center shrink-0">
                  <TriadEmblem portal="admin" variant="reverse" size={20} />
                </span>
                {/* wraps onto a second line rather than hiding links off the edge */}
                <nav aria-label="Admin sections" className="flex flex-wrap items-center gap-1 sm:gap-2 min-w-0 flex-1">
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
                  {/* phones and tablets have no sidebar: its menu shows here instead */}
                  {onOpenOperations &&
                    SIDE_MENU.map(({ tab, label }) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => onOpenOperations(tab)}
                        className="lg:hidden shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold cursor-pointer text-[#5C3A0A]/75 hover:text-[#3A2A08] inline-flex items-center gap-1"
                      >
                        {label}
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    ))}
                </nav>
                <span className="ml-auto hidden sm:flex w-9 h-9 rounded-full bg-white/35 text-[#3A2A08] font-bold items-center justify-center shrink-0">
                  {initial}
                </span>
                <button
                  type="button"
                  onClick={() => (view === 'activity' ? exportAuditPdf() : exportUsersPdf())}
                  className="hidden sm:flex h-9 px-4 rounded-full bg-[#F28C0F] text-white text-[12px] font-bold items-center gap-2 shadow-md cursor-pointer shrink-0"
                >
                  <Download className="w-3.5 h-3.5" /> Export PDF
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
                        onClick={() => showRole('all')}
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
                    <HeroArt onPickRole={showRole} />
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
