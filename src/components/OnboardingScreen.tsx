import React, { useState } from 'react';
import { Eye, EyeOff, LogOut } from 'lucide-react';
import { User } from '../types';
import * as auth from '../services/auth';
import { useRepo } from '../hooks/useRepo';
import { normalisePhone } from '../lib/util';
import { t } from '../lib/i18n';
import { UniGuardLogo } from './UniGuardLogo';

// Complete Your Account: the first screen an invited barangay official, LGU
// staff member or dispatch team member sees after accepting the invitation.
// They set a password (they have none yet) and their real name and phone.
// Role, barangay and unit were set by the Super Admin and are shown, not edited.

const ROLE_LABEL: Record<string, string> = {
  barangay: 'Barangay Official',
  lgu_admin: 'LGU / LDRRMO staff',
  dispatch: 'Dispatch Team member',
  super_admin: 'Super Admin',
};

const field = 'w-full py-2 bg-transparent border-b-2 border-slate-200 text-slate-800 text-sm focus:outline-none focus:border-[#D32F2F]';
const lab = 'block text-xs font-semibold text-slate-700 mb-1';

export const OnboardingScreen: React.FC<{
  user: User;
  /** arrived from the invitation link, so a password is required */
  passwordRequired: boolean;
  onDone: () => void;
  onSignOut: () => void;
}> = ({ user, passwordRequired, onDone, onSignOut }) => {
  const { myUnit } = useRepo();
  const prefix = (user.email || '').split('@')[0].toLowerCase();
  const [form, setForm] = useState({
    password: '',
    confirm: '',
    fullName: (user.full_name || '').trim().toLowerCase() === prefix ? '' : user.full_name || '',
    phone: user.phone || '',
  });
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unitName = myUnit?.name || '';
  const assignment =
    user.role === 'barangay'
      ? t('You manage reports from Barangay {name}.', { name: user.barangay_name || '—' })
      : user.role === 'dispatch'
      ? t('You are the {role} of {unit}.', {
          role: user.unit_role === 'unit_admin' ? t('Unit Administrator') : t('Unit Member'),
          unit: unitName || t('your dispatch unit'),
        })
      : t('You have citywide access to the command console.');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (passwordRequired || form.password || form.confirm) {
      if (form.password.length < 8) return setError(t('Use at least 8 characters for the password.'));
      if (form.password !== form.confirm) return setError(t('The two passwords do not match.'));
    }
    if (!form.fullName.trim()) return setError(t('Enter your full name.'));
    let phone = '';
    if (form.phone.trim()) {
      const p = normalisePhone(form.phone);
      if (!p) return setError(t('Use a Philippine mobile number, for example 0917 123 4567.'));
      phone = p;
    }
    setSaving(true);
    try {
      await auth.completeOnboarding({ password: form.password, fullName: form.fullName, phone });
      onDone();
    } catch (err: any) {
      setError(err?.message || t('Could not save your account. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-[#FDF6F7] px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-gradient-to-br from-[#FFF5F6] via-[#FCE8EB] to-[#F5D5DC] rounded-[28px] border border-rose-200/60 shadow-[0_24px_64px_rgba(136,19,55,0.12)] p-6 sm:p-8 space-y-5"
      >
        <div className="flex items-center gap-3">
          <UniGuardLogo size="md" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-700">{t('Invitation accepted')}</p>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">{t('Complete Your Account')}</h1>
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          {t("You're joining as a {role}. Fill in your details to finish setting up your account.", { role: t(ROLE_LABEL[user.role] || user.role) })}
        </p>
        <p className="text-[11px] text-slate-600 bg-white/70 border border-rose-200/60 rounded-2xl px-3.5 py-2.5 leading-relaxed">
          {assignment} {t('Your LGU administrator manages this assignment.')}
        </p>

        <div>
          <label className={lab} htmlFor="ob-email">{t('Email')}</label>
          <input id="ob-email" className={`${field} text-slate-500`} value={user.email} disabled />
        </div>
        <div>
          <label className={lab} htmlFor="ob-password">{t('Set Your Password')}</label>
          <div className="relative">
            <input
              id="ob-password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={passwordRequired ? t('At least 8 characters') : t('Leave blank to keep your current password')}
              className={`${field} pr-9`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? t('Hide password') : t('Show password')}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-500 cursor-pointer"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className={lab} htmlFor="ob-confirm">{t('Confirm Password')}</label>
          <input
            id="ob-confirm"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            placeholder={t('Repeat password')}
            className={field}
          />
        </div>
        <div>
          <label className={lab} htmlFor="ob-name">{t('Full Name')}</label>
          <input
            id="ob-name"
            autoComplete="name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            placeholder="Juan Dela Cruz"
            className={field}
          />
        </div>
        <div>
          <label className={lab} htmlFor="ob-phone">{t('Mobile Number')}</label>
          <input
            id="ob-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="0917 123 4567"
            className={field}
          />
        </div>

        {error && (
          <p role="alert" className="text-xs font-semibold text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button type="button" onClick={onSignOut} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
            <LogOut className="w-3.5 h-3.5" />
            {t('Sign Out')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-[#D32F2F] hover:bg-[#B71C1C] text-white font-semibold rounded-xl text-xs cursor-pointer disabled:opacity-60"
          >
            {saving ? t('Saving…') : t('Complete Setup & Sign In')}
          </button>
        </div>
      </form>
    </div>
  );
};
