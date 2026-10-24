import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import * as repo from '../services/repo';

// "Start from a template" for the advisory composer (Phase 4): pick one of the
// LDRRMO's message templates, choose English or Filipino, fill in the blanks
// ({barangay}, {center}...) and the title and message are written for you.
export const TemplatePicker: React.FC<{
  isBarangay: boolean;
  defaults: Record<string, string>;
  onApply: (title: string, body: string, category: repo.MessageTemplate['category']) => void;
}> = ({ isBarangay, defaults, onApply }) => {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<repo.MessageTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState('');
  const [lang, setLang] = useState<'en' | 'fil'>('en');
  const [values, setValues] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    if (!open || list) return;
    repo.loadTemplates().then(
      (l) => {
        setList(l);
        if (l[0]) setId(l[0].id);
      },
      (e) => setError(e.message)
    );
  }, [open, list]);

  const tpl = useMemo(() => (list || []).find((x) => x.id === id) || null, [list, id]);
  const keys = tpl ? repo.templatePlaceholders(tpl.title_en, tpl.body_en, tpl.title_fil, tpl.body_fil).map((p) => p.slice(1, -1)) : [];

  const cls = isBarangay
    ? {
        box: 'border-[#7EA0C5]/30 bg-[#C2E8FF]/10',
        text: 'text-[#011025]',
        muted: 'text-[#5482B4]',
        input: 'text-[#011025] bg-white border-[#7EA0C5]/30 focus:border-[#5482B4]',
        btn: 'bg-[#052659] hover:bg-[#031c42] text-white',
      }
    : {
        box: 'border-neutral-200 bg-neutral-50/60',
        text: 'text-neutral-900',
        muted: 'text-neutral-500',
        input: 'text-neutral-800 bg-white border-neutral-200 focus:border-neutral-400',
        btn: 'bg-[#18181b] hover:bg-neutral-800 text-white',
      };
  const inputCls = `w-full text-xs font-medium border rounded-xl p-2.5 outline-hidden ${cls.input}`;

  const apply = () => {
    if (!tpl) return;
    const v = { ...defaults, ...values };
    // never publish an advisory with a literal {placeholder} left in it
    const empty = keys.filter((k) => !(v[k] || '').trim());
    setMissing(empty);
    if (empty.length) return;
    const title = lang === 'fil' && tpl.title_fil ? tpl.title_fil : tpl.title_en;
    const body = lang === 'fil' && tpl.body_fil ? tpl.body_fil : tpl.body_en;
    onApply(repo.fillTemplate(title, v), repo.fillTemplate(body, v), tpl.category);
    setOpen(false);
  };

  return (
    <div className={`rounded-2xl border ${cls.box}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 cursor-pointer" aria-expanded={open}>
        <span className={`flex items-center gap-2 text-xs font-semibold ${cls.text}`}>
          <FileText className="w-3.5 h-3.5" />
          Start from a template
        </span>
        {open ? <ChevronUp className={`w-4 h-4 ${cls.muted}`} /> : <ChevronDown className={`w-4 h-4 ${cls.muted}`} />}
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-3">
          {error && <p className="text-xs text-amber-800">{error}</p>}
          {list && !list.length && <p className={`text-xs ${cls.muted}`}>No templates yet. The LDRRMO adds them in Settings.</p>}
          {list && list.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <select className={inputCls} value={id} onChange={(e) => setId(e.target.value)} aria-label="Template">
                  {list.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <div className="flex rounded-xl border overflow-hidden text-xs font-semibold" role="radiogroup" aria-label="Template language">
                  {(['en', 'fil'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={lang === l}
                      onClick={() => setLang(l)}
                      className={`px-3 py-2 cursor-pointer ${lang === l ? cls.btn : `bg-white ${cls.text}`}`}
                    >
                      {l === 'en' ? 'English' : 'Filipino'}
                    </button>
                  ))}
                </div>
              </div>
              {keys.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {keys.map((k) => (
                    <label key={k} className="block">
                      <span className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${cls.muted}`}>{k}</span>
                      <input
                        className={inputCls}
                        value={values[k] ?? defaults[k] ?? ''}
                        onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                        placeholder={`{${k}}`}
                      />
                    </label>
                  ))}
                </div>
              )}
              {tpl && (
                <p className={`text-[11px] leading-relaxed ${cls.muted}`}>
                  {repo.fillTemplate(lang === 'fil' && tpl.body_fil ? tpl.body_fil : tpl.body_en, { ...defaults, ...values })}
                </p>
              )}
              {missing.length > 0 && (
                <p className="text-xs font-medium text-amber-800" role="alert">
                  Fill in {missing.join(', ')} first.
                </p>
              )}
              <button type="button" onClick={apply} className={`px-4 py-2 rounded-full text-xs font-semibold cursor-pointer ${cls.btn}`}>
                Use this template
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
