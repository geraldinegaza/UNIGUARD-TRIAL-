import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Edit3, FileDown, FileText, Plus, Save, Trash2, X } from 'lucide-react';
import { AssessmentStatus, Barangay, DamageAssessment, IncidentReport, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { HAZARDS, hazardDisplayLabel } from '../lib/hazards';
import { PLACE } from '../lib/geo';
import { DocSection, exportPdf, fileStamp } from '../lib/pdf';
import { isoDay, opsTone, OpsTone, phpText, shortWhen } from './opsTone';

// Reports & documentation (migration 144): the situation report, the damage
// and needs assessment, and a one-incident summary, each previewed on screen
// and exported as a PDF. A barangay official works inside their own barangay;
// the server enforces that as well.
const NEEDS = [
  'Food packs',
  'Drinking water',
  'Temporary shelter / tarpaulin',
  'Medicine / medical team',
  'Hygiene kits',
  'Clothing / blankets',
  'Search and rescue',
  'Clearing operations',
  'Psychosocial support',
];
const LIFELINE = ['Normal', 'Partially interrupted', 'Interrupted', 'Not assessed'];
const DNA_STATUS: Record<AssessmentStatus, string> = { draft: 'Draft', submitted: 'Submitted', validated: 'Validated' };
const STATUS_TEXT: Record<string, string> = {
  unverified: 'Awaiting verification',
  verified: 'Verified',
  dispatched: 'Response dispatched',
  resolved: 'Resolved',
  rejected: 'Rejected',
};
const SEVERITY_TEXT: Record<string, string> = { advisory: 'Advisory', warning: 'Warning', emergency: 'Emergency' };
const ROAD_TEXT: Record<string, string> = { blocked: 'Impassable', one_lane: 'One lane', under_repair: 'Under repair', passable: 'Passable' };

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const inRange = (ts: string | null | undefined, from: string, to: string) => {
  if (!ts) return true; // undated rows are never dropped silently
  const t = Date.parse(ts.length === 10 ? `${ts}T12:00:00` : ts);
  if (isNaN(t)) return true;
  return t >= Date.parse(`${from}T00:00:00`) && t <= Date.parse(`${to}T23:59:59`);
};

type DnaTotals = Pick<
  DamageAssessment,
  | 'affected_families'
  | 'affected_persons'
  | 'displaced_families'
  | 'displaced_persons'
  | 'dead'
  | 'injured'
  | 'missing'
  | 'houses_totally'
  | 'houses_partially'
  | 'infra_damage_php'
  | 'agri_damage_php'
>;
const TOTAL_KEYS: (keyof DnaTotals)[] = [
  'affected_families',
  'affected_persons',
  'displaced_families',
  'displaced_persons',
  'dead',
  'injured',
  'missing',
  'houses_totally',
  'houses_partially',
  'infra_damage_php',
  'agri_damage_php',
];
const dnaTotals = (rows: DamageAssessment[]) => {
  const t = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])) as DnaTotals;
  rows.forEach((d) => TOTAL_KEYS.forEach((k) => (t[k] += Number(d[k]) || 0)));
  return t;
};

function dnaSections(rows: DamageAssessment[]): DocSection[] {
  const dt = dnaTotals(rows);
  return [
    {
      title: 'Affected population and damage',
      head: ['Barangay', 'Date', 'Event', 'Families', 'Persons', 'Displ. fam.', 'Displ. pers.', 'Dead', 'Injured', 'Missing', 'Houses total', 'Houses partial', 'Infrastructure', 'Agriculture', 'Status'],
      rows: rows.map((d) => [
        d.barangay,
        d.assessed_on,
        d.event_name,
        d.affected_families,
        d.affected_persons,
        d.displaced_families,
        d.displaced_persons,
        d.dead,
        d.injured,
        d.missing,
        d.houses_totally,
        d.houses_partially,
        phpText(d.infra_damage_php),
        phpText(d.agri_damage_php),
        DNA_STATUS[d.status] || d.status,
      ]),
      total: rows.length
        ? ['TOTAL', '', '', dt.affected_families, dt.affected_persons, dt.displaced_families, dt.displaced_persons, dt.dead, dt.injured, dt.missing, dt.houses_totally, dt.houses_partially, phpText(dt.infra_damage_php), phpText(dt.agri_damage_php), '']
        : null,
    },
    {
      title: 'Lifelines and needs',
      head: ['Barangay', 'Power', 'Water', 'Communications', 'Needs', 'Priority needs and quantities'],
      rows: rows.map((d) => [d.barangay, d.power_status, d.water_status, d.comms_status, d.needs.join(', '), d.needs_notes]),
    },
    {
      title: 'Details and remarks',
      head: ['Barangay', 'Infrastructure', 'Agriculture', 'Remarks', 'Assessed by'],
      rows: rows.map((d) => [d.barangay, d.infra_notes, d.agri_notes, d.remarks, d.assessed_by_name]),
    },
  ];
}

interface Props {
  currentUser: User;
  barangays: Barangay[];
  reports: IncidentReport[];
}

export const LdrrmcReportsView: React.FC<Props> = ({ currentUser, barangays, reports }) => {
  const isBarangay = currentUser.role === 'barangay';
  const isLgu = currentUser.role === 'lgu_admin';
  const t = opsTone(isBarangay);
  const store = useRepo();
  const { assessments, sitreps, centers, advisories, roadStatus, relief, distributionLog, inventory } = store;

  const [tab, setTab] = useState<'sitrep' | 'dna' | 'incident'>('sitrep');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(null), 4500);
  };

  useEffect(() => {
    repo.loadDocumentation().then(
      () => setLoadError(null),
      (e) => setLoadError(e.message || 'Could not load the assessments')
    );
    repo.loadInventory().catch(() => {});
  }, []);

  const signer = currentUser.full_name || 'UniGuard';

  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in duration-300">
      <div className="px-1">
        <h1 className={t.h1}>{isBarangay ? 'Barangay Reports & Documentation' : 'Reports & Documentation'}</h1>
        <p className={`${t.sub} mt-0.5 max-w-2xl leading-relaxed`}>
          Situation reports, damage and needs assessments, and incident summaries, ready to print or send as PDF.
          {isBarangay ? ` Scope: Barangay ${currentUser.barangay_name || ''}.` : ''}
        </p>
      </div>

      <div className={`flex items-center gap-1.5 overflow-x-auto scrollbar-none p-1.5 rounded-full border w-fit max-w-full ${t.tabs}`} role="tablist">
        {(
          [
            ['sitrep', 'Situation Report'],
            ['dna', 'Damage & Needs'],
            ['incident', 'Incident Summary'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium shrink-0 cursor-pointer transition-all ${tab === key ? t.tabOn : t.tabOff}`}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && <div className={`p-3.5 rounded-2xl border text-xs font-medium ${isBarangay ? 'bg-[#C2E8FF]/30 border-[#7EA0C5]/40 text-[#011025]' : 'bg-neutral-100/90 border-neutral-200/80 text-neutral-800'}`}>{notice}</div>}
      {loadError && (
        <div className="p-3.5 rounded-2xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
          {loadError}. The documentation tables come with the upgrade (migration 144).
        </div>
      )}

      {tab === 'sitrep' && (
        <SitrepTab
          t={t}
          isBarangay={isBarangay}
          currentUser={currentUser}
          barangays={barangays}
          reports={reports}
          signer={signer}
          flash={flash}
          data={{ assessments, sitreps, centers, advisories, roadStatus, relief, distributionLog, inventory }}
        />
      )}
      {tab === 'dna' && (
        <DnaTab t={t} isBarangay={isBarangay} isLgu={isLgu} currentUser={currentUser} barangays={barangays} reports={reports} assessments={assessments} signer={signer} flash={flash} />
      )}
      {tab === 'incident' && <IncidentTab t={t} reports={reports} assessments={assessments} signer={signer} flash={flash} />}
    </div>
  );
};

/* ------------------------------------------------------------ preview table */
const Preview: React.FC<{ t: OpsTone; section: DocSection; cap?: number }> = ({ t, section, cap = 8 }) => (
  <div className={t.card}>
    <div className={`${t.head} !py-3`}>
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${t.ink}`}>{section.title}</h3>
      {section.note && <p className={`text-[11px] mt-0.5 ${t.muted}`}>{section.note}</p>}
    </div>
    {section.text !== undefined ? (
      <p className={`px-5 py-3 text-xs whitespace-pre-wrap ${t.ink}`}>{section.text || '—'}</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] min-w-max">
          {section.head && (
            <thead>
              <tr className={`text-left ${t.muted}`}>
                {section.head.map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className={`divide-y ${t.divide}`}>
            {section.rows.length === 0 ? (
              <tr>
                <td className={`px-3 py-3 ${t.faint}`} colSpan={section.head?.length || 1}>
                  Nothing recorded
                </td>
              </tr>
            ) : (
              section.rows.slice(0, cap).map((r, i) => (
                <tr key={i} className={t.ink}>
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2 align-top max-w-[280px] break-words">
                      {String(c ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
            {section.total && (
              <tr className={`font-semibold ${t.ink}`}>
                {section.total.map((c, j) => (
                  <td key={j} className="px-3 py-2">
                    {String(c ?? '')}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        {section.rows.length > cap && <p className={`px-3 pb-3 text-[11px] ${t.faint}`}>+{section.rows.length - cap} more rows in the PDF</p>}
      </div>
    )}
  </div>
);

/* ---------------------------------------------------------- situation report */
const SitrepTab: React.FC<{
  t: OpsTone;
  isBarangay: boolean;
  currentUser: User;
  barangays: Barangay[];
  reports: IncidentReport[];
  signer: string;
  flash: (m: string) => void;
  data: Pick<
    repo.RepoState,
    'assessments' | 'sitreps' | 'centers' | 'advisories' | 'roadStatus' | 'relief' | 'distributionLog' | 'inventory'
  >;
}> = ({ t, isBarangay, currentUser, barangays, reports, signer, flash, data }) => {
  const [from, setFrom] = useState(isoDay(daysAgo(7)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [brgy, setBrgy] = useState(isBarangay ? currentUser.barangay_name || '' : 'All');
  const [eventName, setEventName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [dispatches, setDispatches] = useState<repo.DispatchLogRow[]>([]);

  useEffect(() => {
    repo.dispatchLog({ from, to }).then(setDispatches, () => setDispatches([]));
  }, [from, to]);

  const scope = isBarangay ? currentUser.barangay_name || '' : brgy;
  const inScope = (name: string | null | undefined) => !scope || scope === 'All' || name === scope;
  const scopeLabel = !scope || scope === 'All' ? `Municipality of ${PLACE.town}` : `Barangay ${scope}`;

  const built = useMemo(() => {
    const incidents = reports.filter((r) => inScope(r.barangay_name) && inRange(r.created_at, from, to));
    const centers = data.centers.filter((c) => inScope(c.barangay_name));
    const advisories = data.advisories.filter(
      (a) => inRange(a.created_at, from, to) && (!scope || scope === 'All' || !a.target_barangay_id || a.affected_area.includes(scope))
    );
    const roads = data.roadStatus.filter((r) => inScope(r.barangay || '') && r.status !== 'passable');
    const dna = data.assessments.filter((d) => inScope(d.barangay) && inRange(d.assessed_on, from, to));
    const dt = dnaTotals(dna);
    const relief = data.relief.filter((r) => inScope(r.barangay) && inRange(r.distribution_at, from, to));
    const log = data.distributionLog.filter((r) => inScope(r.barangay) && inRange(r.distributed_at, from, to));
    const sent = dispatches.filter((d) => inScope(d.barangay));

    const by: Record<string, number> = {};
    incidents.forEach((i) => (by[i.status] = (by[i.status] || 0) + 1));
    const evacuees = centers.reduce((n, c) => n + c.current_occupancy, 0);
    const openCenters = centers.filter((c) => c.status === 'open' || c.status === 'full').length;

    const matrix: Record<string, Record<string, number>> = {};
    incidents.forEach((i) => {
      const b = i.barangay_name || 'Unassigned';
      matrix[b] = matrix[b] || { unverified: 0, verified: 0, dispatched: 0, resolved: 0, rejected: 0, total: 0 };
      matrix[b][i.status] = (matrix[b][i.status] || 0) + 1;
      matrix[b].total += 1;
    });
    const needs: Record<string, number> = {};
    dna.forEach((d) => d.needs.forEach((n) => (needs[n] = (needs[n] || 0) + 1)));

    const sections: DocSection[] = [
      {
        title: 'I. Situation overview',
        note: 'Headline figures for the reporting period and scope.',
        head: ['Indicator', 'Value'],
        rows: [
          ['Incidents reported', incidents.length],
          ['Awaiting verification', by.unverified || 0],
          ['Verified', by.verified || 0],
          ['Response dispatched', by.dispatched || 0],
          ['Resolved', by.resolved || 0],
          ['Rejected', by.rejected || 0],
          ['Evacuation centers open', openCenters],
          ['Persons inside evacuation centers', evacuees],
          ['Affected families (assessed)', dt.affected_families],
          ['Affected persons (assessed)', dt.affected_persons],
          ['Dead / Injured / Missing', `${dt.dead} / ${dt.injured} / ${dt.missing}`],
          ['Houses totally / partially damaged', `${dt.houses_totally} / ${dt.houses_partially}`],
          ['Estimated infrastructure damage', phpText(dt.infra_damage_php)],
          ['Estimated agriculture damage', phpText(dt.agri_damage_php)],
          ['Roads not passable', roads.length],
          ['Advisories issued', advisories.length],
        ],
      },
      {
        title: 'II. Incidents monitored',
        note: 'Every report filed in the period, newest first.',
        head: ['Code', 'Reported', 'Barangay', 'Hazard', 'Severity', 'Status', 'Details'],
        rows: incidents.map((i) => [
          i.code,
          shortWhen(i.created_at),
          i.barangay_name,
          hazardDisplayLabel(i.hazard_type, i.hazard_other_text),
          SEVERITY_TEXT[i.severity] || i.severity,
          STATUS_TEXT[i.status] || i.status,
          i.description,
        ]),
      },
      {
        title: 'III. Incidents by barangay',
        head: ['Barangay', 'Awaiting', 'Verified', 'Dispatched', 'Resolved', 'Rejected', 'Total'],
        rows: Object.keys(matrix)
          .sort()
          .map((b) => [b, matrix[b].unverified, matrix[b].verified, matrix[b].dispatched, matrix[b].resolved, matrix[b].rejected, matrix[b].total]),
      },
      { ...dnaSections(dna)[0], title: 'IV. Affected population and damage', note: 'From the damage and needs assessments dated within the period.' },
      {
        title: 'V. Evacuation centers',
        note: 'Status and occupancy when this report was generated.',
        head: ['Center', 'Barangay', 'Status', 'Occupancy', 'Capacity', 'Used %', 'Contact'],
        rows: centers.map((c) => [
          c.name,
          c.barangay_name,
          c.status,
          c.current_occupancy,
          c.capacity,
          c.capacity ? Math.round((c.current_occupancy / c.capacity) * 100) : 0,
          [c.contact_person, c.contact_phone].filter(Boolean).join(' · '),
        ]),
      },
      {
        title: 'VI. Response actions',
        note: 'Teams and units dispatched in the period.',
        head: ['Incident', 'Barangay', 'Team / unit', 'Stage', 'Dispatched', 'Instructions'],
        rows: sent.map((d) => [d.report_code, d.barangay, d.team, d.status, shortWhen(d.dispatched_at), d.instructions]),
      },
      {
        title: 'VII. Relief operations',
        note: 'Scheduled distributions in the period and goods handed out.',
        head: ['Type', 'Barangay', 'Item / activity', 'Quantity', 'When', 'Details'],
        rows: [
          ...relief.map((r) => ['Scheduled', r.barangay, r.title, '', shortWhen(r.distribution_at), r.location_name]),
          ...log.map((r) => ['Distributed', r.barangay, r.item_name, r.qty, shortWhen(r.distributed_at), r.family]),
        ],
      },
      {
        title: 'VIII. Relief stock on hand',
        note: 'Items at or below their reorder point are flagged.',
        head: ['Item', 'Category', 'Stock', 'Unit', 'Reorder at', 'Flag', 'Location'],
        rows: data.inventory.map((i) => [i.name, i.category, i.stock, i.unit, i.reorder, i.stock <= i.reorder ? 'LOW STOCK' : '', i.location]),
      },
      {
        title: 'IX. Roads not passable',
        head: ['Road', 'Barangay', 'Status', 'Cause', 'Expected reopening'],
        rows: roads.map((r) => [r.road_name, r.barangay, ROAD_TEXT[r.status] || r.status, r.cause || r.note, shortWhen(r.estimated_reopen)]),
      },
      {
        title: 'X. Advisories issued',
        head: ['Published', 'Severity', 'Type', 'Title', 'Area'],
        rows: advisories.map((a) => [shortWhen(a.created_at), a.severity, a.type, a.title, a.affected_area]),
      },
      {
        title: 'XI. Priority needs',
        note: 'Needs flagged in the damage assessments, by number of assessments requesting them.',
        head: ['Need', 'Assessments requesting'],
        rows: Object.keys(needs)
          .sort((a, b) => needs[b] - needs[a])
          .map((k) => [k, needs[k]]),
      },
    ];
    if (remarks.trim()) sections.push({ title: 'XII. Remarks', rows: [], text: remarks.trim() });
    return {
      sections,
      counts: { incidents: incidents.length, evacuees, openCenters, dna: dna.length, families: dt.affected_families, persons: dt.affected_persons },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, data, dispatches, from, to, scope, remarks]);

  const nextNo = useMemo(() => {
    const name = eventName.trim().toLowerCase();
    return data.sitreps.filter((r) => r.event_name.trim().toLowerCase() === name).reduce((m, r) => Math.max(m, r.sitrep_no), 0) + 1;
  }, [data.sitreps, eventName]);
  const title = `Situation Report No. ${nextNo}${eventName.trim() ? ` · ${eventName.trim()}` : ''}`;
  const period = `${from} to ${to}`;

  const pdf = async () => {
    setBusy(true);
    try {
      await exportPdf({
        title,
        subtitle: scopeLabel,
        meta: [`Reporting period: ${period}`],
        sections: built.sections,
        filename: `uniguard-sitrep-${fileStamp()}.pdf`,
        landscape: true,
        signer,
      });
      flash('Situation report exported as PDF');
    } catch (e: any) {
      flash(e.message || 'Could not build the PDF');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await repo.saveSitrep({
        sitrep_no: nextNo,
        event_name: eventName.trim(),
        period_from: from,
        period_to: to,
        barangay: !scope || scope === 'All' ? '' : scope,
        summary: built.counts,
        remarks: remarks.trim(),
        prepared_by_name: signer,
      });
      flash(`Situation Report No. ${nextNo} saved to the register`);
    } catch (e: any) {
      flash(e.message || 'Could not save the situation report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className={t.card}>
        <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div>
            <label className={t.label}>From</label>
            <input type="date" className={t.input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={t.label}>To</label>
            <input type="date" className={t.input} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className={t.label}>Scope</label>
            {isBarangay ? (
              <input className={t.input} value={`Barangay ${currentUser.barangay_name || ''}`} readOnly />
            ) : (
              <select className={t.input} value={brgy} onChange={(e) => setBrgy(e.target.value)}>
                <option value="All">Whole municipality</option>
                {barangays.map((b) => (
                  <option key={b.id} value={b.name}>
                    Brgy. {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className={t.label}>Event name</label>
            <input className={t.input} value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Typhoon Pepito" />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className={t.label}>Remarks (optional)</label>
            <textarea className={t.input} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Actions taken, coordination with agencies, outlook" />
          </div>
        </div>
        <div className={`px-4 sm:px-6 py-3.5 border-t ${t.border} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
          <span className={`text-[11px] ${t.muted}`}>
            This will be <b className={t.ink}>{title}</b> · {scopeLabel}. The number advances when you save it to the register.
          </span>
          <div className="flex flex-wrap gap-2">
            <button onClick={pdf} disabled={busy} className={t.ghost}>
              <FileDown className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
            <button onClick={save} disabled={busy} className={t.primary}>
              <Save className="w-3.5 h-3.5" />
              <span>Save to register</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {built.sections.map((s) => (
          <Preview key={s.title} t={t} section={s} cap={s.title.startsWith('I.') ? 16 : 6} />
        ))}
      </div>

      <div className={t.card}>
        <div className={`${t.head} flex items-center justify-between gap-2`}>
          <h2 className={t.h2}>Situation Report Register</h2>
          <span className={t.pill}>{data.sitreps.length} saved</span>
        </div>
        {data.sitreps.length === 0 ? (
          <p className={`px-5 sm:px-6 py-6 text-xs ${t.muted}`}>No situation reports saved yet.</p>
        ) : (
          <ul className={`divide-y ${t.divide}`}>
            {data.sitreps.slice(0, 20).map((r) => (
              <li key={r.id} className="px-5 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <span className={`text-xs font-semibold ${t.ink} shrink-0`}>No. {r.sitrep_no}</span>
                <span className={`text-xs ${t.ink} flex-1 min-w-0 truncate`}>{r.event_name || 'Unnamed event'}</span>
                <span className={`text-[11px] ${t.muted}`}>
                  {r.period_from} to {r.period_to} · {r.barangay ? `Brgy. ${r.barangay}` : 'Municipality'} · {r.summary.incidents ?? 0} incidents
                </span>
                <span className={`text-[11px] font-mono ${t.faint}`}>{r.prepared_by_name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------- damage and needs assessment */
type DnaForm = Omit<repo.AssessmentInput, never>;
const blankDna = (barangay: string, assessor: string): DnaForm => ({
  barangay,
  report_id: null,
  report_code: '',
  event_name: '',
  hazard_type: HAZARDS[0].key,
  assessed_on: isoDay(new Date()),
  affected_families: 0,
  affected_persons: 0,
  displaced_families: 0,
  displaced_persons: 0,
  dead: 0,
  injured: 0,
  missing: 0,
  houses_totally: 0,
  houses_partially: 0,
  infra_damage_php: 0,
  agri_damage_php: 0,
  infra_notes: '',
  agri_notes: '',
  power_status: 'Not assessed',
  water_status: 'Not assessed',
  comms_status: 'Not assessed',
  needs: [],
  needs_notes: '',
  remarks: '',
  status: 'draft',
  assessed_by_name: assessor,
});

const DnaTab: React.FC<{
  t: OpsTone;
  isBarangay: boolean;
  isLgu: boolean;
  currentUser: User;
  barangays: Barangay[];
  reports: IncidentReport[];
  assessments: DamageAssessment[];
  signer: string;
  flash: (m: string) => void;
}> = ({ t, isBarangay, isLgu, currentUser, barangays, reports, assessments, signer, flash }) => {
  const [filter, setFilter] = useState(isBarangay ? currentUser.barangay_name || '' : 'All');
  const [editing, setEditing] = useState<DamageAssessment | 'new' | null>(null);
  const [form, setForm] = useState<DnaForm>(blankDna(currentUser.barangay_name || '', signer));
  const [busy, setBusy] = useState(false);

  const rows = assessments.filter((d) => filter === 'All' || d.barangay === filter);

  const open = (d: DamageAssessment | 'new') => {
    setEditing(d);
    if (d === 'new') {
      setForm(blankDna(isBarangay ? currentUser.barangay_name || '' : filter !== 'All' ? filter : barangays[0]?.name || '', signer));
    } else {
      const { id, barangay_uuid, updated_at, ...rest } = d;
      setForm(rest);
    }
  };

  const num = (k: keyof DnaForm) => (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      className={t.input}
      value={String(form[k] ?? 0)}
      onChange={(e) => setForm({ ...form, [k]: Math.max(0, Number(e.target.value) || 0) })}
    />
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || busy) return;
    if (!form.barangay) return flash('Choose the barangay assessed');
    if (!form.assessed_on) return flash('Enter the date of the assessment');
    if (form.affected_persons && form.affected_families > form.affected_persons) return flash('Affected families cannot exceed affected persons');
    if (form.displaced_persons && form.displaced_families > form.displaced_persons) return flash('Displaced families cannot exceed displaced persons');
    const linked = form.report_id ? reports.find((r) => r.id === form.report_id) : null;
    setBusy(true);
    try {
      await repo.saveAssessment(editing === 'new' ? null : editing.id, {
        ...form,
        report_code: linked ? linked.code : '',
        event_name: form.event_name.trim(),
        assessed_by_name: form.assessed_by_name.trim(),
      });
      flash(editing === 'new' ? 'Assessment saved' : 'Assessment updated');
      setEditing(null);
    } catch (err: any) {
      flash(err.message || 'Could not save the assessment');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: DamageAssessment) => {
    if (!window.confirm(`Delete the ${d.barangay} assessment of ${d.assessed_on}?`)) return;
    try {
      await repo.deleteAssessment(d.id);
      flash('Assessment deleted');
    } catch (err: any) {
      flash(err.message || 'Could not delete the assessment');
    }
  };

  const pdf = async (list: DamageAssessment[], single?: DamageAssessment) => {
    try {
      await exportPdf({
        title: single ? `Damage and Needs Assessment · Brgy. ${single.barangay}` : 'Damage and Needs Assessments',
        subtitle: single ? `${single.event_name || 'Unnamed event'} · assessed ${single.assessed_on}` : filter === 'All' ? `Municipality of ${PLACE.town}` : `Barangay ${filter}`,
        meta: [`${list.length} assessment${list.length === 1 ? '' : 's'}`],
        sections: dnaSections(list),
        filename: `uniguard-dna-${fileStamp()}.pdf`,
        landscape: true,
        signer,
      });
    } catch (e: any) {
      flash(e.message || 'Could not build the PDF');
    }
  };

  const totals = dnaTotals(rows);
  const statusChoices: AssessmentStatus[] = isLgu ? ['draft', 'submitted', 'validated'] : ['draft', 'submitted'];
  const lockedValidated = !isLgu && editing !== 'new' && editing?.status === 'validated';

  return (
    <div className="space-y-5">
      <div className={`${t.card}`}>
        <div className={`${t.head} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
          <div className="flex items-center gap-2.5">
            <ClipboardCheck className={`w-4 h-4 ${t.ink}`} />
            <h2 className={t.h2}>Damage & Needs Assessments</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isBarangay && (
              <select className={`${t.input} !w-auto !py-2 !rounded-full`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Barangay">
                <option value="All">All barangays</option>
                {barangays.map((b) => (
                  <option key={b.id} value={b.name}>
                    Brgy. {b.name}
                  </option>
                ))}
              </select>
            )}
            <button onClick={() => pdf(rows)} disabled={!rows.length} className={t.ghost}>
              <FileDown className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
            <button onClick={() => open('new')} className={t.primary}>
              <Plus className="w-3.5 h-3.5" />
              <span>New assessment</span>
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Affected families', totals.affected_families.toLocaleString()],
            ['Displaced persons', totals.displaced_persons.toLocaleString()],
            ['Dead / injured / missing', `${totals.dead} / ${totals.injured} / ${totals.missing}`],
            ['Damage (infra + agri)', phpText(totals.infra_damage_php + totals.agri_damage_php)],
          ].map(([label, value]) => (
            <div key={label} className={`${t.stat} text-white rounded-[20px] p-4 border min-w-0`}>
              <p className={`text-[10px] font-medium uppercase ${t.statSub}`}>{label}</p>
              <p className="text-lg sm:text-xl font-bold mt-1 tabular-nums break-words">{value}</p>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className={`px-5 sm:px-6 pb-6 text-xs ${t.muted}`}>No assessments yet. Start one after a barangay has been assessed on the ground.</p>
        ) : (
          <ul className={`border-t ${t.border} divide-y ${t.divide}`}>
            {rows.map((d) => {
              const canDelete = isLgu || d.status === 'draft';
              const canEdit = isLgu || d.status !== 'validated';
              return (
                <li key={d.id} className="px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs font-semibold ${t.ink}`}>Brgy. {d.barangay}</span>
                      <span className={`text-[11px] ${t.muted}`}>{d.assessed_on}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          d.status === 'validated'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : d.status === 'submitted'
                            ? t.pill.replace('px-3 py-1', 'px-2 py-0.5')
                            : 'bg-white text-neutral-500 border-neutral-200'
                        }`}
                      >
                        {DNA_STATUS[d.status]}
                      </span>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${t.muted} break-words`}>
                      {[d.event_name, hazardDisplayLabel(d.hazard_type), `${d.affected_families} families affected`, d.report_code && `linked ${d.report_code}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => pdf([d], d)} className={`${t.ghost} !px-3 !py-1.5 !min-h-[32px]`}>
                      <FileText className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </button>
                    {canEdit && (
                      <button onClick={() => open(d)} className={`w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer ${t.muted} hover:bg-neutral-100`} aria-label="Edit assessment">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => remove(d)} className={`w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer ${t.muted} hover:bg-neutral-100`} aria-label="Delete assessment">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <div className={`fixed inset-0 z-50 ${t.modalBack} backdrop-blur-xs flex items-center justify-center p-3 sm:p-4`}>
          <form onSubmit={save} className={`bg-white rounded-[24px] max-w-2xl w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto shadow-2xl border ${t.modal}`}>
            <div className={`sticky top-0 z-10 bg-white px-5 sm:px-6 py-4 border-b ${t.border} flex items-center justify-between gap-3`}>
              <h3 className={`font-semibold text-base ${t.ink}`}>{editing === 'new' ? 'New Damage & Needs Assessment' : 'Edit Assessment'}</h3>
              <button type="button" onClick={() => setEditing(null)} className={`cursor-pointer ${t.muted}`} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 sm:px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={t.label}>Barangay</label>
                  {isBarangay ? (
                    <input className={t.input} value={form.barangay} readOnly />
                  ) : (
                    <select className={t.input} value={form.barangay} onChange={(e) => setForm({ ...form, barangay: e.target.value })}>
                      {barangays.map((b) => (
                        <option key={b.id}>{b.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className={t.label}>Date assessed</label>
                  <input type="date" className={t.input} value={form.assessed_on} onChange={(e) => setForm({ ...form, assessed_on: e.target.value })} />
                </div>
                <div>
                  <label className={t.label}>Event name</label>
                  <input className={t.input} value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} placeholder="e.g. Typhoon Pepito" />
                </div>
                <div>
                  <label className={t.label}>Hazard</label>
                  <select className={t.input} value={form.hazard_type} onChange={(e) => setForm({ ...form, hazard_type: e.target.value })}>
                    {HAZARDS.map((h) => (
                      <option key={h.key} value={h.key}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={t.label}>Linked incident (optional)</label>
                  <select className={t.input} value={form.report_id || ''} onChange={(e) => setForm({ ...form, report_id: e.target.value || null })}>
                    <option value="">None</option>
                    {reports
                      .filter((r) => !isBarangay || r.barangay_name === currentUser.barangay_name)
                      .slice(0, 150)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} · {hazardDisplayLabel(r.hazard_type, r.hazard_other_text)} · {r.barangay_name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className={`text-xs font-semibold ${t.ink}`}>Affected population</legend>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div><label className={t.label}>Affected families</label>{num('affected_families')}</div>
                  <div><label className={t.label}>Affected persons</label>{num('affected_persons')}</div>
                  <div><label className={t.label}>Displaced families</label>{num('displaced_families')}</div>
                  <div><label className={t.label}>Displaced persons</label>{num('displaced_persons')}</div>
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className={`text-xs font-semibold ${t.ink}`}>Casualties and houses</legend>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div><label className={t.label}>Dead</label>{num('dead')}</div>
                  <div><label className={t.label}>Injured</label>{num('injured')}</div>
                  <div><label className={t.label}>Missing</label>{num('missing')}</div>
                  <div><label className={t.label}>Houses totally</label>{num('houses_totally')}</div>
                  <div><label className={t.label}>Houses partially</label>{num('houses_partially')}</div>
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className={`text-xs font-semibold ${t.ink}`}>Damage cost</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={t.label}>Infrastructure (PHP)</label>{num('infra_damage_php')}</div>
                  <div><label className={t.label}>Agriculture (PHP)</label>{num('agri_damage_php')}</div>
                  <div>
                    <label className={t.label}>Infrastructure details</label>
                    <textarea rows={2} className={t.input} value={form.infra_notes} onChange={(e) => setForm({ ...form, infra_notes: e.target.value })} placeholder="Roads, bridges, schools, health stations" />
                  </div>
                  <div>
                    <label className={t.label}>Agriculture details</label>
                    <textarea rows={2} className={t.input} value={form.agri_notes} onChange={(e) => setForm({ ...form, agri_notes: e.target.value })} placeholder="Crops, livestock, fisheries" />
                  </div>
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className={`text-xs font-semibold ${t.ink}`}>Lifelines</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      ['power_status', 'Power'],
                      ['water_status', 'Water'],
                      ['comms_status', 'Communications'],
                    ] as const
                  ).map(([k, label]) => (
                    <div key={k}>
                      <label className={t.label}>{label}</label>
                      <select className={t.input} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                        {LIFELINE.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className={`text-xs font-semibold ${t.ink}`}>Needs</legend>
                <div className="flex flex-wrap gap-1.5">
                  {NEEDS.map((n) => {
                    const on = form.needs.includes(n);
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setForm({ ...form, needs: on ? form.needs.filter((x) => x !== n) : [...form.needs, n] })}
                        className={`px-3 py-1.5 min-h-[32px] rounded-full text-[11px] font-medium border cursor-pointer ${on ? t.tabOn + ' border-transparent' : 'bg-white border-neutral-200 ' + t.ink}`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
                <textarea rows={2} className={t.input} value={form.needs_notes} onChange={(e) => setForm({ ...form, needs_notes: e.target.value })} placeholder="Priority needs and quantities, e.g. 120 family food packs, 40 tarpaulins" />
              </fieldset>

              <div>
                <label className={t.label}>Remarks</label>
                <textarea rows={2} className={t.input} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={t.label}>Status</label>
                  <select className={t.input} value={form.status} disabled={lockedValidated} onChange={(e) => setForm({ ...form, status: e.target.value as AssessmentStatus })}>
                    {statusChoices.map((s) => (
                      <option key={s} value={s}>
                        {DNA_STATUS[s]}
                      </option>
                    ))}
                  </select>
                  {!isLgu && <p className={`text-[11px] mt-1 ${t.muted}`}>Only the LDRRMO validates an assessment.</p>}
                </div>
                <div>
                  <label className={t.label}>Assessed by</label>
                  <input className={t.input} value={form.assessed_by_name} onChange={(e) => setForm({ ...form, assessed_by_name: e.target.value })} />
                </div>
              </div>
            </div>
            <div className={`sticky bottom-0 bg-white px-5 sm:px-6 py-3.5 border-t ${t.border} flex justify-end gap-2`}>
              <button type="button" onClick={() => setEditing(null)} className={t.ghost}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={t.primary}>
                {busy ? 'Saving…' : editing === 'new' ? 'Save assessment' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ---------------------------------------------------------- incident summary */
const IncidentTab: React.FC<{
  t: OpsTone;
  reports: IncidentReport[];
  assessments: DamageAssessment[];
  signer: string;
  flash: (m: string) => void;
}> = ({ t, reports, assessments, signer, flash }) => {
  const [id, setId] = useState(reports[0]?.id || '');
  const [history, setHistory] = useState<Awaited<ReturnType<typeof repo.reportHistory>>>([]);
  const [sent, setSent] = useState<repo.DispatchLogRow[]>([]);
  const report = reports.find((r) => r.id === id) || null;

  useEffect(() => {
    if (!id) return;
    repo.reportHistory(id).then(setHistory, () => setHistory([]));
    repo.dispatchLog({ reportId: id }).then(setSent, () => setSent([]));
  }, [id]);

  const sections: DocSection[] = report
    ? [
        {
          title: 'Report',
          head: ['Field', 'Value'],
          rows: [
            ['Code', report.code],
            ['Filed', shortWhen(report.created_at)],
            ['Barangay', report.barangay_name],
            ['Hazard', hazardDisplayLabel(report.hazard_type, report.hazard_other_text)],
            ['Severity', SEVERITY_TEXT[report.severity] || report.severity],
            ['Status', STATUS_TEXT[report.status] || report.status],
            ['Verified by', [report.verified_by_name, report.verified_by_role === 'lgu_ldrrmc' ? '(LDRRMO)' : ''].filter(Boolean).join(' ') || '—'],
            ['Confirmations', report.corroboration_count],
            ['Location', report.has_location ? `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}` : 'Not recorded'],
          ],
        },
        { title: 'Description', rows: [], text: report.description },
        {
          title: 'Status timeline',
          head: ['When', 'From', 'To', 'Note'],
          rows: history.map((h) => [shortWhen(h.created_at), STATUS_TEXT[h.from_status || ''] || h.from_status || '—', STATUS_TEXT[h.to_status] || h.to_status, h.note || h.reason]),
        },
        {
          title: 'Teams dispatched',
          head: ['Team / unit', 'Stage', 'Dispatched', 'Instructions', 'After-action report'],
          rows: sent.map((d) => [d.team, d.status, shortWhen(d.dispatched_at), d.instructions, d.after_action]),
        },
        ...dnaSections(assessments.filter((a) => a.report_id === report.id)).slice(0, 1).map((s) => ({ ...s, title: 'Linked damage assessment' })),
      ]
    : [];

  const pdf = async () => {
    if (!report) return;
    try {
      await exportPdf({
        title: `Incident Summary · ${report.code}`,
        subtitle: `Brgy. ${report.barangay_name} · ${hazardDisplayLabel(report.hazard_type, report.hazard_other_text)}`,
        sections,
        filename: `uniguard-incident-${report.code || 'report'}-${fileStamp()}.pdf`,
        signer,
      });
    } catch (e: any) {
      flash(e.message || 'Could not build the PDF');
    }
  };

  return (
    <div className="space-y-5">
      <div className={t.card}>
        <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className={t.label}>Incident</label>
            <select className={t.input} value={id} onChange={(e) => setId(e.target.value)}>
              {reports.length === 0 && <option value="">No reports yet</option>}
              {reports.slice(0, 200).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {hazardDisplayLabel(r.hazard_type, r.hazard_other_text)} · {r.barangay_name} · {STATUS_TEXT[r.status]}
                </option>
              ))}
            </select>
          </div>
          <button onClick={pdf} disabled={!report} className={t.primary}>
            <FileDown className="w-3.5 h-3.5" />
            <span>Export PDF</span>
          </button>
        </div>
        <p className={`px-4 sm:px-6 pb-4 text-[11px] ${t.muted}`}>
          The summary pulls the report, its status timeline, the teams dispatched and any linked damage assessment into one document.
        </p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Preview key={s.title} t={t} section={s} cap={12} />
        ))}
      </div>
    </div>
  );
};
