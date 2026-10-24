import React, { useEffect, useState } from 'react';
import { Bell, Building, Check, Download, Edit3, Globe, Megaphone, Plus, Trash2, X } from 'lucide-react';
import { User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { CONFIG } from '../lib/config';
import { t, useT, Lang } from '../lib/i18n';
import { opsTone } from './opsTone';

// Settings (Phase 4). Every role: alerts on this phone, language, offline.
// LDRRMO: message templates (barangay officials read them). Super Admin in
// Operations: the organisation profile residents see (MDRRMO name, hotline).
type Tab = 'alerts' | 'language' | 'offline' | 'templates' | 'general';

const CATEGORY_TEXT: Record<repo.MessageTemplate['category'], string> = {
  evacuation_order: 'Evacuation order',
  weather_advisory: 'Weather advisory',
  road_closure: 'Road closure',
  general: 'General notice',
};

interface Props {
  currentUser: User;
  isSuperAdmin?: boolean;
  onNavigateTab?: (tab: string) => void;
}

export const SettingsView: React.FC<Props> = ({ currentUser, isSuperAdmin = false, onNavigateTab }) => {
  const { lang, setLang } = useT();
  const { queue, lastSync, org } = useRepo();
  const role = currentUser.role;
  const isResident = role === 'citizen';
  const isBarangay = role === 'barangay';
  const isLgu = role === 'lgu_admin';
  const tone = opsTone(isBarangay);

  // residents get the crimson look of their app; staff the console tone
  const ui = isResident
    ? {
        ...tone,
        card: 'bg-white rounded-3xl border border-red-900/10 shadow-sm overflow-hidden',
        head: 'px-5 sm:px-6 py-4 bg-red-50/40 border-b border-red-900/10',
        h1: 'text-xl sm:text-2xl font-bold tracking-tight text-neutral-900',
        h2: 'text-sm font-bold uppercase tracking-wide text-neutral-900',
        primary:
          'inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[40px] text-xs font-bold rounded-full shadow-sm cursor-pointer bg-red-900 hover:bg-red-800 text-white disabled:opacity-60',
        ghost:
          'inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[40px] text-xs font-bold rounded-full cursor-pointer bg-white hover:bg-red-50 text-red-900 border border-red-900/20 disabled:opacity-60',
        tabOn: 'bg-red-900 text-white shadow-2xs',
        tabOff: 'text-neutral-600 hover:text-neutral-900 hover:bg-white/70',
        tabs: 'bg-red-50/60 border-red-900/10',
      }
    : tone;

  const tabs: [Tab, string, React.ElementType][] = [
    ['alerts', 'Alerts', Bell],
    ['language', 'Language', Globe],
    ['offline', 'Offline', Download],
    ...((isLgu || isBarangay ? [['templates', 'Message templates', Megaphone]] : []) as [Tab, string, React.ElementType][]),
    ...((isSuperAdmin ? [['general', 'Organisation', Building]] : []) as [Tab, string, React.ElementType][]),
  ];
  const [tab, setTab] = useState<Tab>(isSuperAdmin ? 'general' : isLgu ? 'templates' : 'alerts');

  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in duration-300 max-w-4xl">
      <div className="px-1">
        <h1 className={ui.h1}>{t('Settings')}</h1>
        <p className={`${ui.sub} mt-0.5`}>{t('Alerts, language and offline use on this device.')}</p>
      </div>

      <div className={`flex items-center gap-1.5 overflow-x-auto scrollbar-none p-1.5 rounded-full border w-fit max-w-full ${ui.tabs}`} role="tablist">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium shrink-0 cursor-pointer transition-all inline-flex items-center gap-1.5 ${tab === id ? ui.tabOn : ui.tabOff}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {t(label)}
          </button>
        ))}
      </div>

      {tab === 'alerts' && <AlertsTab ui={ui} isLgu={isLgu} />}

      {tab === 'language' && (
        <div className={ui.card}>
          <div className={ui.head}>
            <h2 className={ui.h2}>{t('Language')}</h2>
          </div>
          <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label={t('Language')}>
            {(
              [
                ['en', 'English', 'Use UniGuard in English'],
                ['fil', 'Filipino', 'Gamitin ang UniGuard sa Filipino'],
              ] as [Lang, string, string][]
            ).map(([code, name, note]) => (
              <button
                key={code}
                role="radio"
                aria-checked={lang === code}
                onClick={() => setLang(code)}
                className={`text-left p-4 rounded-2xl border-2 cursor-pointer transition-colors ${
                  lang === code ? (isResident ? 'border-red-900 bg-red-50/50' : isBarangay ? 'border-[#052659] bg-[#C2E8FF]/20' : 'border-neutral-900 bg-neutral-50') : 'border-neutral-200 bg-white'
                }`}
              >
                <span className={`flex items-center justify-between text-sm font-bold ${ui.ink}`}>
                  {name}
                  {lang === code && <Check className="w-4 h-4" />}
                </span>
                <span className={`block text-xs mt-1 ${ui.muted}`}>{note}</span>
              </button>
            ))}
            <p className={`sm:col-span-2 text-[11px] ${ui.muted}`}>
              {t('Saved on this device. Official advisories appear in the language the MDRRMO wrote them in.')}
            </p>
          </div>
        </div>
      )}

      {tab === 'offline' && (
        <div className={ui.card}>
          <div className={ui.head}>
            <h2 className={ui.h2}>{t('Offline')}</h2>
          </div>
          <div className="p-5 sm:p-6 space-y-3 text-xs">
            <p className={ui.muted}>{t('UniGuard keeps the essentials on your phone so they still open without a signal.')}</p>
            {(
              [
                ['Works without internet', typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? t('Yes') : t('No')],
                ['Last saved for offline use', lastSync ? new Date(lastSync).toLocaleString() : t('Not yet')],
                ['Reports waiting to send', String(queue.length)],
                ['App version', CONFIG.BUILD],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className={`flex items-center justify-between gap-3 py-2 border-b ${ui.border}`}>
                <span className={ui.muted}>{t(k)}</span>
                <span className={`font-mono font-semibold ${ui.ink}`}>{v}</span>
              </div>
            ))}
            {onNavigateTab && (
              <button onClick={() => onNavigateTab('offline_sync')} className={ui.ghost}>
                <Download className="w-3.5 h-3.5" />
                {t('Open the offline screen')}
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'templates' && <TemplatesTab ui={ui} canEdit={isLgu} />}

      {tab === 'general' && isSuperAdmin && <OrgTab ui={ui} org={org} />}
    </div>
  );
};

type UI = ReturnType<typeof opsTone>;

/* ----------------------------------------------------------------- alerts */
const AlertsTab: React.FC<{ ui: UI; isLgu: boolean }> = ({ ui, isLgu }) => {
  const [status, setStatus] = useState<repo.PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    repo.pushStatus().then(setStatus);
  }, []);

  const STATUS_TEXT: Record<repo.PushStatus, string> = {
    on: 'On',
    off: 'Off',
    blocked: 'Blocked in browser settings',
    unsupported: 'Not supported on this browser',
  };

  const turnOn = async () => {
    setBusy(true);
    const ok = await repo.enablePush();
    const next = await repo.pushStatus();
    setStatus(next);
    setNote(
      ok
        ? t('Alerts are on for this phone.')
        : next === 'blocked'
        ? t('Alerts are blocked. Allow notifications for this site in your browser settings, then try again.')
        : t('Alerts could not be turned on. Try again in a moment.')
    );
    setBusy(false);
  };

  return (
    <div className={ui.card}>
      <div className={ui.head}>
        <h2 className={ui.h2}>{t('Alerts on this phone')}</h2>
      </div>
      <div className="p-5 sm:p-6 space-y-3">
        <p className={`text-xs ${ui.muted}`}>{t('Get warnings and evacuation notices even when UniGuard is closed.')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-xs ${ui.muted}`}>{t('Status')}:</span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold border ${
              status === 'on' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-900 border-amber-200'
            }`}
          >
            {status ? t(STATUS_TEXT[status]) : '…'}
          </span>
          {status !== 'on' && status !== 'unsupported' && (
            <button onClick={turnOn} disabled={busy} className={ui.primary}>
              <Bell className="w-3.5 h-3.5" />
              {t('Turn on alerts')}
            </button>
          )}
        </div>
        {note && <p className={`text-xs font-medium ${ui.ink}`}>{note}</p>}
        <p className={`text-[11px] ${ui.muted}`}>{t('Emergency alerts may also be sent by text message to your registered mobile number.')}</p>
        {isLgu && (
          <p className={`text-[11px] ${ui.muted}`}>
            {t('Whether alerts reach phones also depends on the push notification key, which the system administrator sets.')}
          </p>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------- message templates */
const blank = { category: 'general' as repo.MessageTemplate['category'], label: '', title_en: '', body_en: '', title_fil: '', body_fil: '' };

const TemplatesTab: React.FC<{ ui: UI; canEdit: boolean }> = ({ ui, canEdit }) => {
  const [list, setList] = useState<repo.MessageTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<repo.MessageTemplate | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [showFil, setShowFil] = useState<Record<string, boolean>>({});

  const load = () =>
    repo.loadTemplates().then(
      (l) => {
        setList(l);
        setError(null);
      },
      (e) => setError(e.message)
    );
  useEffect(() => {
    load();
  }, []);

  const open = (tpl: repo.MessageTemplate | 'new') => {
    setEditing(tpl);
    setForm(tpl === 'new' ? blank : { category: tpl.category, label: tpl.label, title_en: tpl.title_en, body_en: tpl.body_en, title_fil: tpl.title_fil, body_fil: tpl.body_fil });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || busy) return;
    if (!form.label.trim() || !form.title_en.trim() || !form.body_en.trim()) {
      setError(t('Give the template a name, an English title and an English message.'));
      return;
    }
    setBusy(true);
    try {
      await repo.saveTemplate(editing === 'new' ? null : editing.id, form);
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tpl: repo.MessageTemplate) => {
    if (!window.confirm(t('Delete the template "{name}"?', { name: tpl.label }))) return;
    try {
      await repo.deleteTemplate(tpl.id);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className={ui.card}>
      <div className={`${ui.head} flex flex-wrap items-center justify-between gap-2`}>
        <div>
          <h2 className={ui.h2}>{t('Message templates')}</h2>
          <p className={`text-[11px] mt-0.5 ${ui.muted}`}>
            {canEdit
              ? t('Ready-made advisories in English and Filipino. Pick one when writing an advisory.')
              : t('Ready-made advisories from the LDRRMO. Pick one when writing an advisory.')}
          </p>
        </div>
        {canEdit && (
          <button onClick={() => open('new')} className={ui.primary}>
            <Plus className="w-3.5 h-3.5" />
            {t('New template')}
          </button>
        )}
      </div>
      {error && <div className="px-5 sm:px-6 py-2.5 text-xs text-amber-900 bg-amber-50 border-b border-amber-200">{error}</div>}
      <ul className={`divide-y ${ui.divide}`}>
        {list.map((tpl) => {
          const fil = !!showFil[tpl.id];
          return (
            <li key={tpl.id} className="px-5 sm:px-6 py-4 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-semibold ${ui.ink}`}>{tpl.label}</span>
                <span className={ui.pill.replace('px-3 py-1', 'px-2 py-0.5')}>{t(CATEGORY_TEXT[tpl.category] || tpl.category)}</span>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => setShowFil({ ...showFil, [tpl.id]: !fil })}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${ui.border} ${ui.ink}`}
                    aria-pressed={fil}
                  >
                    {fil ? 'EN' : 'FIL'}
                  </button>
                  {canEdit && (
                    <>
                      <button onClick={() => open(tpl)} className={`w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer ${ui.muted} hover:bg-neutral-100`} aria-label={t('Edit')}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(tpl)} className={`w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer ${ui.muted} hover:bg-neutral-100`} aria-label={t('Delete')}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </span>
              </div>
              <p className={`text-xs font-semibold ${ui.ink}`}>{fil ? tpl.title_fil || '—' : tpl.title_en}</p>
              <p className={`text-xs leading-relaxed ${ui.muted}`}>{fil ? tpl.body_fil || '—' : tpl.body_en}</p>
              {tpl.placeholders.length > 0 && (
                <p className={`text-[11px] font-mono ${ui.faint}`}>
                  {t('Fill in')}: {tpl.placeholders.join(' ')}
                </p>
              )}
            </li>
          );
        })}
        {!list.length && !error && <li className={`px-5 sm:px-6 py-8 text-xs text-center ${ui.muted}`}>{t('No templates yet.')}</li>}
      </ul>

      {editing && (
        <div className={`fixed inset-0 z-50 ${ui.modalBack} backdrop-blur-xs flex items-center justify-center p-3 sm:p-4`}>
          <form onSubmit={save} className={`bg-white rounded-[24px] max-w-2xl w-full max-h-[calc(100dvh-1.5rem)] overflow-y-auto shadow-2xl border ${ui.modal}`}>
            <div className={`sticky top-0 bg-white px-5 sm:px-6 py-4 border-b ${ui.border} flex items-center justify-between`}>
              <h3 className={`font-semibold text-base ${ui.ink}`}>{editing === 'new' ? t('New template') : t('Edit template')}</h3>
              <button type="button" onClick={() => setEditing(null)} className={`cursor-pointer ${ui.muted}`} aria-label={t('Close')}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 sm:px-6 py-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={ui.label}>{t('Template name')}</label>
                  <input className={ui.input} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Evacuation Order — Flood" />
                </div>
                <div>
                  <label className={ui.label}>{t('Category')}</label>
                  <select className={ui.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as repo.MessageTemplate['category'] })}>
                    {Object.entries(CATEGORY_TEXT).map(([k, v]) => (
                      <option key={k} value={k}>
                        {t(v)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={ui.label}>{t('Title (English)')}</label>
                <input className={ui.input} value={form.title_en} onChange={(e) => setForm({ ...form, title_en: e.target.value })} />
              </div>
              <div>
                <label className={ui.label}>{t('Message (English)')}</label>
                <textarea rows={4} className={ui.input} value={form.body_en} onChange={(e) => setForm({ ...form, body_en: e.target.value })} />
              </div>
              <div>
                <label className={ui.label}>{t('Title (Filipino)')}</label>
                <input className={ui.input} value={form.title_fil} onChange={(e) => setForm({ ...form, title_fil: e.target.value })} />
              </div>
              <div>
                <label className={ui.label}>{t('Message (Filipino)')}</label>
                <textarea rows={4} className={ui.input} value={form.body_fil} onChange={(e) => setForm({ ...form, body_fil: e.target.value })} />
              </div>
              <p className={`text-[11px] ${ui.muted}`}>
                {t('Write {barangay}, {center}, {road} or any other word in braces where the details change. They are filled in when the template is used.')}
              </p>
            </div>
            <div className={`sticky bottom-0 bg-white px-5 sm:px-6 py-3.5 border-t ${ui.border} flex justify-end gap-2`}>
              <button type="button" onClick={() => setEditing(null)} className={ui.ghost}>
                {t('Cancel')}
              </button>
              <button type="submit" disabled={busy} className={ui.primary}>
                {busy ? t('Saving…') : t('Save template')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------- organisation profile */
const OrgTab: React.FC<{ ui: UI; org: repo.OrgProfile }> = ({ ui, org }) => {
  const [form, setForm] = useState(org);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setForm(org), [org]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await repo.saveOrgProfile({ ...form, contact: form.contact.trim(), email: form.email.trim() });
      setNote(t('Saved. Residents see the new details the next time UniGuard opens.'));
    } catch (err: any) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof repo.OrgProfile, label: string, type = 'text') => (
    <div>
      <label className={ui.label}>{t(label)}</label>
      <input className={ui.input} type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );

  return (
    <form onSubmit={save} className={ui.card}>
      <div className={ui.head}>
        <h2 className={ui.h2}>{t('Organisation profile')}</h2>
        <p className={`text-[11px] mt-0.5 ${ui.muted}`}>{t('The office name and hotline residents see, including the call button on the SOS screen.')}</p>
      </div>
      <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('municipality', 'Municipality')}
        {field('province', 'Province')}
        <div className="sm:col-span-2">{field('office', 'Office name')}</div>
        {field('contact', 'Hotline', 'tel')}
        {field('email', 'Email', 'email')}
      </div>
      <div className={`px-5 sm:px-6 py-3.5 border-t ${ui.border} flex flex-wrap items-center justify-between gap-3`}>
        <span className={`text-xs ${ui.muted}`}>{note}</span>
        <button type="submit" disabled={busy} className={ui.primary}>
          <Check className="w-3.5 h-3.5" />
          {busy ? t('Saving…') : t('Save profile')}
        </button>
      </div>
    </form>
  );
};
