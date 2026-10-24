import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileDown } from 'lucide-react';
import { Barangay, EvacuationCenter, IncidentReport, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { hazardDisplayLabel } from '../lib/hazards';
import { download, toCSV } from '../lib/util';
import { exportPdf, fileStamp } from '../lib/pdf';
import { isoDay, opsTone, OpsTone } from './opsTone';

// The nine analytics cards (A to I) from the reference build, on one date
// range and barangay filter, with the range compared against the period of
// the same length just before it. Exports as CSV or PDF.
const DAY = 86400000;
const fmtDur = (s: number | null) => (s == null ? '—' : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const STATUS_TEXT: Record<string, string> = {
  unverified: 'Awaiting verification',
  verified: 'Verified',
  dispatched: 'Dispatched',
  resolved: 'Resolved',
  rejected: 'Rejected',
};
const UNIT_BUCKETS: [string, RegExp][] = [
  ['BFP', /bfp|fire/i],
  ['PNP', /pnp|police/i],
  ['Rescue', /rescue|sar\b|sarl/i],
  ['Ambulance / Hospital', /hospital|medic|ambulance|ems/i],
  ['Barangay Response Team', /barangay|bpat|brt/i],
];

const Card: React.FC<{ t: OpsTone; title: string; tag?: string; children: React.ReactNode; className?: string }> = ({ t, title, tag, children, className = '' }) => (
  <div className={`${t.card} ${className}`}>
    <div className={`${t.head} flex flex-wrap items-center justify-between gap-2`}>
      <h2 className={t.h2}>{title}</h2>
      {tag && <span className={`text-[10px] font-mono uppercase tracking-wider ${t.muted}`}>{tag}</span>}
    </div>
    <div className="p-5 sm:p-6 space-y-3">{children}</div>
  </div>
);

const Bar: React.FC<{ t: OpsTone; label: string; value: number; max: number; right?: string }> = ({ t, label, value, max, right }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className={`font-medium min-w-0 truncate ${t.ink}`}>{label}</span>
      <span className={`font-mono shrink-0 ${t.muted}`}>{right ?? value}</span>
    </div>
    <div className={`w-full h-2 rounded-full overflow-hidden border ${t.track}`}>
      <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0}%` }} />
    </div>
  </div>
);

const Empty: React.FC<{ t: OpsTone; text: string }> = ({ t, text }) => <p className={`text-xs ${t.muted}`}>{text}</p>;

export const AnalyticsDetailCards: React.FC<{
  currentUser: User;
  barangays: Barangay[];
  reports: IncidentReport[];
  centers: EvacuationCenter[];
}> = ({ currentUser, barangays, reports, centers }) => {
  const isBarangay = currentUser.role === 'barangay';
  const isLgu = currentUser.role === 'lgu_admin';
  const t = opsTone(isBarangay);
  const { relief, distributionLog, unitRequests } = useRepo();

  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * DAY)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [brgy, setBrgy] = useState('All');
  const [dispatches, setDispatches] = useState<repo.DispatchLogRow[]>([]);
  const [prevDispatches, setPrevDispatches] = useState<repo.DispatchLogRow[]>([]);

  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T23:59:59`);
  const span = Math.max(DAY, end - start + 1);
  const prevFrom = isoDay(new Date(start - span));
  const prevTo = isoDay(new Date(start - DAY));

  useEffect(() => {
    repo.loadInventory().catch(() => {});
    if (isLgu) repo.loadDispatchUnits().catch(() => {});
  }, [isLgu]);
  useEffect(() => {
    repo.dispatchLog({ from, to }).then(setDispatches, () => setDispatches([]));
    repo.dispatchLog({ from: prevFrom, to: prevTo }).then(setPrevDispatches, () => setPrevDispatches([]));
  }, [from, to, prevFrom, prevTo]);

  const inBrgy = (name: string | null | undefined) => brgy === 'All' || name === brgy;
  const inPeriod = (ts: string, a: number, b: number) => {
    const x = Date.parse(ts);
    return !isNaN(x) && x >= a && x <= b;
  };

  const a = useMemo(() => {
    const inc = reports.filter((r) => inBrgy(r.barangay_name) && inPeriod(r.created_at, start, end));
    const prev = reports.filter((r) => inBrgy(r.barangay_name) && inPeriod(r.created_at, start - span, start - 1));
    const disp = dispatches.filter((d) => inBrgy(d.barangay));
    const prevDisp = prevDispatches.filter((d) => inBrgy(d.barangay));
    const count = <T,>(list: T[], key: (x: T) => string) => {
      const m: Record<string, number> = {};
      list.forEach((x) => (m[key(x)] = (m[key(x)] || 0) + 1));
      return Object.entries(m).sort((x, y) => y[1] - x[1]);
    };

    const stages: Record<string, number> = { unverified: 0, verified: 0, dispatched: 0, resolved: 0, rejected: 0 };
    inc.forEach((r) => (stages[r.status] = (stages[r.status] || 0) + 1));
    const open = inc.filter((r) => r.status !== 'resolved' && r.status !== 'rejected');
    const oldest = open.reduce<IncidentReport | null>((o, r) => (!o || Date.parse(r.created_at) < Date.parse(o.created_at) ? r : o), null);
    const overHour = open.filter((r) => r.status === 'unverified' && Date.now() - Date.parse(r.created_at) > 3600000).length;

    const unitStats = UNIT_BUCKETS.map(([name, re]) => {
      const secs = disp
        .filter((d) => re.test(d.team) && d.report_created_at)
        .map((d) => (Date.parse(d.dispatched_at) - Date.parse(d.report_created_at as string)) / 1000)
        .filter((s) => s >= 0);
      return {
        name,
        count: secs.length,
        avg: secs.length ? secs.reduce((x, y) => x + y, 0) / secs.length : null,
        slowest: secs.length ? Math.max(...secs) : null,
      };
    });

    const decided = unitRequests.filter((r) => r.decided_at && inPeriod(r.created_at, start, end));
    const acks = decided.map((r) => (Date.parse(r.decided_at as string) - Date.parse(r.created_at)) / 1000);

    const verified = stages.verified + stages.dispatched + stages.resolved;
    const lguVerified = inc.filter((r) => r.verified_by_role === 'lgu_ldrrmc').length;
    const autoVerified = inc.filter((r) => r.corroboration_count >= 3).length;

    const shelters = centers.filter((c) => inBrgy(c.barangay_name));
    const cap = shelters.reduce((n, c) => n + c.capacity, 0);
    const occ = shelters.reduce((n, c) => n + c.current_occupancy, 0);

    const reliefRows = relief.filter((r) => inBrgy(r.barangay));
    const log = distributionLog.filter((d) => inBrgy(d.barangay) && inPeriod(d.distributed_at, start, end));
    const givenByBrgy = count(log, (d) => d.barangay).map(([b]) => [b, log.filter((d) => d.barangay === b).reduce((n, d) => n + d.qty, 0)] as [string, number]);

    const delta = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : now ? 100 : 0);
    const resolvedNow = stages.resolved;
    const resolvedPrev = prev.filter((r) => r.status === 'resolved').length;
    const emergencyNow = inc.filter((r) => r.severity === 'emergency').length;
    const emergencyPrev = prev.filter((r) => r.severity === 'emergency').length;

    return {
      inc,
      byHazard: count(inc, (r) => hazardDisplayLabel(r.hazard_type, r.hazard_other_text)),
      byBarangay: count(inc, (r) => r.barangay_name || 'Unassigned'),
      stages,
      open: open.length,
      oldest,
      overHour,
      unitStats,
      perTeam: count(disp, (d) => d.team || 'Unspecified'),
      ackAvg: acks.length ? acks.reduce((x, y) => x + y, 0) / acks.length : null,
      ackSlowest: acks.length ? Math.max(...acks) : null,
      ackCounts: [decided.length, unitRequests.filter((r) => r.status === 'pending').length],
      verified,
      lguVerified,
      autoVerified,
      shelters,
      cap,
      occ,
      full: shelters.filter((c) => c.status === 'full' || (c.capacity > 0 && c.current_occupancy >= c.capacity)).length,
      openShelters: shelters.filter((c) => c.status === 'open').length,
      reliefScheduled: count(reliefRows, (r) => r.barangay || 'Municipality-wide'),
      givenByBrgy,
      unitsGiven: log.reduce((n, d) => n + d.qty, 0),
      comparison: [
        ['Reports filed', inc.length, prev.length, delta(inc.length, prev.length)],
        ['Emergency reports', emergencyNow, emergencyPrev, delta(emergencyNow, emergencyPrev)],
        ['Resolved', resolvedNow, resolvedPrev, delta(resolvedNow, resolvedPrev)],
        ['Dispatches', disp.length, prevDisp.length, delta(disp.length, prevDisp.length)],
      ] as [string, number, number, number][],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, centers, relief, distributionLog, unitRequests, dispatches, prevDispatches, start, end, span, brgy]);

  const scopeText = isBarangay ? `Barangay ${currentUser.barangay_name || ''}` : brgy === 'All' ? 'All barangays' : `Barangay ${brgy}`;
  const metricRows = (): (string | number)[][] => [
    ['Range', `${from} to ${to}`],
    ['Scope', scopeText],
    ['Reports in range', a.inc.length],
    ['Open', a.open],
    ...Object.entries(a.stages).map(([k, v]) => [STATUS_TEXT[k] || k, v] as (string | number)[]),
    ['Verified share %', a.inc.length ? Math.round((a.verified / a.inc.length) * 100) : 0],
    ['Verified by the LDRRMO', a.lguVerified],
    ['Three or more confirmations', a.autoVerified],
    ['Unverified over one hour', a.overHour],
    ['Shelter occupancy', `${a.occ} / ${a.cap}`],
    ['Relief units handed out', a.unitsGiven],
  ];

  const exportCsv = () => {
    const rows: Record<string, unknown>[] = [
      ...metricRows().map(([metric, value]) => ({ section: 'Summary', item: metric, value, previous_period: '' })),
      ...a.comparison.map(([label, now, before]) => ({ section: 'Period comparison', item: label, value: now, previous_period: before })),
      ...a.byHazard.map(([k, v]) => ({ section: 'By hazard', item: k, value: v, previous_period: '' })),
      ...a.byBarangay.map(([k, v]) => ({ section: 'By barangay', item: k, value: v, previous_period: '' })),
      ...a.unitStats.map((u) => ({ section: 'Response time by unit', item: u.name, value: `${u.count} dispatches, avg ${fmtDur(u.avg)}, slowest ${fmtDur(u.slowest)}`, previous_period: '' })),
      ...a.perTeam.map(([k, v]) => ({ section: 'Dispatch workload', item: k, value: v, previous_period: '' })),
      ...a.shelters.map((c) => ({ section: 'Shelters', item: c.name, value: `${c.current_occupancy}/${c.capacity}`, previous_period: '' })),
      ...a.givenByBrgy.map(([k, v]) => ({ section: 'Relief handed out', item: k, value: v, previous_period: '' })),
    ];
    download(`uniguard-analytics-${fileStamp()}.csv`, toCSV(rows, ['section', 'item', 'value', 'previous_period']));
  };

  const exportAnalyticsPdf = () =>
    exportPdf({
      title: 'Analytics and Reporting',
      subtitle: scopeText,
      meta: [`Range: ${from} to ${to} · compared with ${prevFrom} to ${prevTo}`],
      filename: `uniguard-analytics-${fileStamp()}.pdf`,
      signer: currentUser.full_name,
      sections: [
        { title: 'Summary', head: ['Metric', 'Value'], rows: metricRows() },
        { title: 'I · Period comparison', head: ['Measure', 'This range', 'Previous range', 'Change %'], rows: a.comparison.map(([l, n, p, d]) => [l, n, p, `${d >= 0 ? '+' : ''}${d}%`]) },
        { title: 'A · Reports by hazard type', head: ['Hazard', 'Reports'], rows: a.byHazard },
        { title: 'B · Reports by barangay', head: ['Barangay', 'Reports'], rows: a.byBarangay },
        { title: 'D · Response time by unit', head: ['Unit', 'Dispatches', 'Average', 'Slowest'], rows: a.unitStats.map((u) => [u.name, u.count, fmtDur(u.avg), fmtDur(u.slowest)]) },
        { title: 'E · Dispatch workload', head: ['Team', 'Dispatches'], rows: a.perTeam },
        { title: 'G · Shelter occupancy', head: ['Shelter', 'Status', 'Occupancy', 'Capacity'], rows: a.shelters.map((c) => [c.name, c.status, c.current_occupancy, c.capacity]) },
        { title: 'H · Relief handed out', head: ['Barangay', 'Units'], rows: a.givenByBrgy },
      ],
    });

  const maxHaz = a.byHazard[0]?.[1] || 0;
  const maxBrgy = a.byBarangay[0]?.[1] || 0;
  const maxTeam = a.perTeam[0]?.[1] || 0;
  const total = a.inc.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Shared filters for every card below */}
      <div className={t.card}>
        <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1">
            <div>
              <label className={t.label}>From</label>
              <input type="date" className={t.input} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </div>
            <div>
              <label className={t.label}>To</label>
              <input type="date" className={t.input} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </div>
            {!isBarangay && (
              <div className="col-span-2 sm:col-span-1">
                <label className={t.label}>Barangay</label>
                <select className={t.input} value={brgy} onChange={(e) => setBrgy(e.target.value)}>
                  <option value="All">All barangays</option>
                  {barangays.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportCsv} className={t.ghost}>
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button onClick={() => exportAnalyticsPdf()} className={t.primary}>
              <FileDown className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>
        <p className={`px-4 sm:px-5 pb-4 text-[11px] ${t.muted}`}>
          The range and barangay apply to every card below. Compared with {prevFrom} to {prevTo}.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <Card t={t} title="A · Reports by Hazard Type" tag={`${a.byHazard.length} types`}>
          {a.byHazard.length ? a.byHazard.map(([k, v]) => <Bar key={k} t={t} label={k} value={v} max={maxHaz} />) : <Empty t={t} text="No reports in this range." />}
        </Card>

        <Card t={t} title="B · Reports by Barangay" tag={`${a.byBarangay.length} barangays`}>
          {a.byBarangay.length ? (
            a.byBarangay.slice(0, 10).map(([k, v]) => <Bar key={k} t={t} label={k} value={v} max={maxBrgy} right={`${v} reports`} />)
          ) : (
            <Empty t={t} text="No reports in this range." />
          )}
        </Card>

        <Card t={t} title="C · Report Status Breakdown" tag={`${total} in range`} className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(a.stages).map(([k, v]) => (
              <div key={k} className={`${t.stat} text-white rounded-[18px] p-3.5 border`}>
                <p className={`text-[10px] font-medium uppercase ${t.statSub}`}>{STATUS_TEXT[k]}</p>
                <p className="text-xl font-bold mt-1 tabular-nums">{v}</p>
                <p className={`text-[10px] ${t.statSub}`}>{pct(v)}%</p>
              </div>
            ))}
          </div>
          <div className={`flex flex-wrap gap-x-5 gap-y-1 text-xs ${t.muted}`}>
            <span>
              Open: <b className={t.ink}>{a.open}</b>
            </span>
            <span>
              Oldest open:{' '}
              <b className={t.ink}>{a.oldest ? `${a.oldest.code}, ${Math.round((Date.now() - Date.parse(a.oldest.created_at)) / 60000)} min ago` : '—'}</b>
            </span>
            <span>
              Unverified over one hour: <b className={a.overHour ? 'text-amber-700' : t.ink}>{a.overHour}</b>
            </span>
          </div>
        </Card>

        <Card t={t} title="D · Response Time by Unit" tag="report to dispatch">
          {a.unitStats.map((u) => (
            <div key={u.name} className="flex items-center justify-between gap-3 text-xs">
              <span className={`font-medium ${t.ink}`}>{u.name}</span>
              <span className={`font-mono ${t.muted}`}>
                {u.count} · avg {fmtDur(u.avg)} · slowest {fmtDur(u.slowest)}
              </span>
            </div>
          ))}
          <p className={`text-[11px] ${t.muted}`}>Time from a report being filed to a team being dispatched, from the dispatch records.</p>
        </Card>

        <Card t={t} title="E · Dispatch Workload" tag={`${a.perTeam.length} teams`}>
          {a.perTeam.length ? a.perTeam.slice(0, 8).map(([k, v]) => <Bar key={k} t={t} label={k} value={v} max={maxTeam} right={`${v} dispatches`} />) : <Empty t={t} text="No dispatches in this range." />}
          {isLgu && (
            <div className={`pt-3 border-t ${t.border} text-xs space-y-1`}>
              <p className={`font-semibold ${t.ink}`}>Support request acknowledgement</p>
              <p className={t.muted}>
                average {fmtDur(a.ackAvg)} · slowest {fmtDur(a.ackSlowest)} · {a.ackCounts[0]} decided, {a.ackCounts[1]} pending
              </p>
            </div>
          )}
        </Card>

        <Card t={t} title="F · Verification Quality" tag="monitoring only">
          <Bar t={t} label="Verified or beyond" value={a.verified} max={total} right={`${a.verified} (${pct(a.verified)}%)`} />
          <Bar t={t} label="Awaiting verification" value={a.stages.unverified} max={total} right={`${a.stages.unverified} (${pct(a.stages.unverified)}%)`} />
          <Bar t={t} label="Rejected" value={a.stages.rejected} max={total} right={`${a.stages.rejected} (${pct(a.stages.rejected)}%)`} />
          <Bar t={t} label="Verified by the LDRRMO" value={a.lguVerified} max={total} />
          <Bar t={t} label="Three or more confirmations" value={a.autoVerified} max={total} />
        </Card>

        <Card t={t} title="G · Shelter Occupancy" tag={`${a.shelters.length} shelters`}>
          <Bar t={t} label="Evacuees against capacity" value={a.occ} max={a.cap} right={`${a.occ} / ${a.cap}`} />
          <div className={`flex flex-wrap gap-x-5 gap-y-1 text-xs ${t.muted}`}>
            <span>
              Open: <b className={t.ink}>{a.openShelters}</b>
            </span>
            <span>
              Full or at capacity: <b className={a.full ? 'text-amber-700' : t.ink}>{a.full}</b>
            </span>
          </div>
          {a.shelters
            .filter((c) => c.capacity > 0)
            .sort((x, y) => y.current_occupancy / y.capacity - x.current_occupancy / x.capacity)
            .slice(0, 5)
            .map((c) => (
              <Bar key={c.id} t={t} label={c.name} value={c.current_occupancy} max={c.capacity} right={`${Math.round((c.current_occupancy / c.capacity) * 100)}%`} />
            ))}
        </Card>

        <Card t={t} title="H · Relief Goods Distribution" tag={`${a.unitsGiven.toLocaleString()} units given`}>
          {a.givenByBrgy.length ? (
            a.givenByBrgy.slice(0, 8).map(([k, v]) => <Bar key={k} t={t} label={k} value={v} max={a.givenByBrgy[0][1]} right={`${v} units`} />)
          ) : (
            <Empty t={t} text="No goods recorded as handed out in this range." />
          )}
          <p className={`text-[11px] ${t.muted}`}>
            Scheduled distributions: {a.reliefScheduled.map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}
          </p>
        </Card>

        <Card t={t} title="I · Period Comparison" tag="this range vs the one before" className="lg:col-span-2">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {a.comparison.map(([label, now, before, d]) => (
              <div key={label} className={`rounded-[18px] border p-3.5 ${t.track}`}>
                <p className={`text-[10px] font-semibold uppercase ${t.muted}`}>{label}</p>
                <p className={`text-xl font-bold tabular-nums mt-1 ${t.ink}`}>{now}</p>
                <p className={`text-[11px] font-mono ${d > 0 ? 'text-amber-700' : d < 0 ? 'text-emerald-700' : t.muted}`}>
                  {d >= 0 ? '+' : ''}
                  {d}% vs {before}
                </p>
              </div>
            ))}
          </div>
          <p className={`text-[11px] ${t.muted}`}>Fewer reports than the previous range shows as a negative change.</p>
        </Card>
      </div>
    </div>
  );
};
