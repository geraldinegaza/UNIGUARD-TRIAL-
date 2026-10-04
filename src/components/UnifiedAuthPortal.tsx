import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { UniGuardLogo } from './UniGuardLogo';
import { User } from '../types';
import { useRepo } from '../hooks/useRepo';
import { normalisePhone } from '../lib/util';
import * as auth from '../services/auth';

interface UnifiedAuthPortalProps {
  onLoginSuccess: (user: User) => void;
  // true when the app was opened from a password recovery link
  recovery?: boolean;
  onRecoveryDone?: () => void;
}

export const UnifiedAuthPortal: React.FC<UnifiedAuthPortalProps> = ({ onLoginSuccess, recovery, onRecoveryDone }) => {
  const [viewMode, setViewMode] = useState<'login' | 'register' | 'forgot' | 'reset'>(recovery ? 'reset' : 'login');

  useEffect(() => {
    if (recovery) setViewMode('reset');
  }, [recovery]);
  
  // Login Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Register Form fields (Citizen)
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regBarangay, setRegBarangay] = useState('Poblacion');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regConsent, setRegConsent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Forgot / reset password fields
  const [forgotEmail, setForgotEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Lingayen barangays, from the database
  const lingayenBarangays = useRepo().barangays;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email || !password) {
      setErrorMessage('Please enter your email and password.');
      return;
    }

    setIsLoading(true);

    try {
      onLoginSuccess(await auth.signIn(email, password));
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setNotice(null);

    if (!regFullName.trim() || !regEmail.trim() || !regPassword) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }

    const phone = normalisePhone(regMobile);
    if (!phone) {
      setErrorMessage('Use a Philippine mobile number, for example 0917 123 4567.');
      return;
    }

    if (regPassword.length < 8) {
      setErrorMessage('Use at least 8 characters for the password.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (!regConsent) {
      setErrorMessage('You must consent to data processing for DRRM emergency coordination.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await auth.signUp({
        fullName: regFullName.trim(),
        email: regEmail.trim(),
        phone,
        barangay: regBarangay,
        password: regPassword,
      });
      if (res.user) {
        setNotice('Registration complete! Opening your resident portal...');
        onLoginSuccess(res.user);
      } else {
        setNotice(`Almost done. We sent a confirmation link to ${regEmail.trim()}. Open it, then sign in.`);
        setEmail(regEmail.trim());
        setViewMode('login');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not create the account. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgot = async () => {
    setErrorMessage(null);
    if (!forgotEmail.trim()) {
      setErrorMessage('Enter the email address on your account.');
      return;
    }
    setIsLoading(true);
    await auth.resetPassword(forgotEmail.trim());
    setIsLoading(false);
    // the same message either way, so we never reveal which emails exist
    setNotice('If an account exists for that email, password reset instructions are on the way.');
    setViewMode('login');
  };

  const handleSetPassword = async () => {
    setErrorMessage(null);
    if (newPassword.length < 8) {
      setErrorMessage('Use at least 8 characters for the new password.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    setIsLoading(true);
    try {
      await auth.updatePassword(newPassword);
      await auth.signOut();
      setNewPassword('');
      setConfirmNewPassword('');
      setNotice('Password updated. Sign in with your new password.');
      setViewMode('login');
      onRecoveryDone?.();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not update the password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen h-[100dvh] w-full bg-gradient-to-br from-[#FAF0F2] via-[#F5E6E9] to-[#EEDCE2] relative flex items-center justify-center p-4 sm:p-6 md:p-10 font-sans selection:bg-[#D32F2F] selection:text-white overflow-y-auto overflow-x-hidden">
      
      {/* Background Ambience: Soft aesthetic matching the Niagahoster reference backdrop */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
        {/* Soft pastel circular glows */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-gradient-to-br from-red-100/50 to-rose-200/30 blur-2xl" />
        <div className="absolute top-1/4 -right-40 w-[500px] h-[500px] rounded-full bg-gradient-to-bl from-rose-100/60 to-red-200/30 blur-3xl" />
        <div className="absolute -bottom-24 left-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-rose-200/40 via-red-50/30 to-transparent blur-3xl" />

        {/* Faint civic watermark text matching the background in reference image */}
        <div className="absolute top-12 left-12 text-7xl md:text-9xl font-black text-rose-300/20 tracking-widest uppercase">
          MDRRMO
        </div>
        <div className="absolute bottom-12 right-16 text-6xl md:text-8xl font-black text-rose-300/20 tracking-widest uppercase">
          LINGAYEN
        </div>

        {/* Light ambient rings */}
        <div className="absolute top-1/3 left-16 w-72 h-72 rounded-full border-8 border-white/50" />
        <div className="absolute bottom-16 right-1/3 w-80 h-80 rounded-full border-[12px] border-white/40" />
      </div>

      {/* Floating Card: Proportioned Desktop Design with Soft Red-to-Burgundy UX-friendly Gradient */}
      <div className="relative z-10 w-full max-w-4xl lg:max-w-[940px] bg-gradient-to-br from-[#FFF5F6] via-[#FCE8EB] to-[#F5D5DC] rounded-[32px] md:rounded-[36px] overflow-hidden shadow-[0_24px_64px_rgba(136,19,55,0.12),0_4px_24px_rgba(0,0,0,0.06)] border border-rose-200/60 flex flex-col md:flex-row transition-all duration-300 min-h-[560px]">
        
        {/* ============================================================== */}
        {/* LEFT HALF: Minimal Form, LDRRMO Brand & Informational Copy      */}
        {/* ============================================================== */}
        <div className="w-full md:w-[50%] lg:w-[48%] p-6 sm:p-7 md:p-8 lg:p-9 flex flex-col justify-between z-10 bg-transparent">
          
          <div>
            {/* Top Brand Header */}
            <div className="flex items-center gap-3.5 mb-4 md:mb-5">
              <UniGuardLogo size="md" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-2xl font-black tracking-tight text-slate-900">
                    Uni<span className="text-red-600">Guard</span>
                  </span>
                  <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                    Lingayen
                  </span>
                </div>
                <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  Unified DRRM System
                </p>
              </div>
            </div>

            {/* Informational Copy */}
            <div className="mb-4 md:mb-5">
              <h1 className="text-xl sm:text-2xl font-normal text-slate-800 tracking-tight leading-snug">
                {viewMode === 'register' ? 'Create Resident Account' : viewMode === 'reset' ? 'Set a new password' : 'One account for disaster reporting and response.'}
              </h1>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed font-normal">
                {viewMode === 'register' 
                  ? 'Resident accounts are created here. Official and LGU access is issued by your LGU administrator.'
                  : 'The system automatically routes you to the resident app or command console.'}
              </p>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="mb-4 p-2.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
                <AlertTriangle className="w-4 h-4 text-[#D32F2F] shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Success Message */}
            {notice && (
              <div className="mb-4 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2.5 text-xs text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            {/* ========================================= */}
            {/* VIEW 1: LOGIN (Niagahoster Minimal Style) */}
            {/* ========================================= */}
            {viewMode === 'login' && (
              <form onSubmit={handleSignIn} className="space-y-4 md:space-y-5">
                
                {/* E-mail Input (Minimal Clean Underline Style) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    E-mail:
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. name@example.ph"
                    required
                    className="w-full py-1.5 bg-transparent border-b-2 border-slate-200 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:border-[#D32F2F] transition-colors"
                  />
                </div>

                {/* Password Input (Minimal Clean Underline Style) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      Password:
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full py-1.5 pr-8 bg-transparent border-b-2 border-slate-200 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:border-[#D32F2F] transition-colors tracking-wider"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-0 top-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  
                  {/* Forgot Password Link right under password input */}
                  <div className="text-right mt-1.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('forgot')}
                      className="text-[11px] font-semibold text-[#D32F2F] hover:text-[#B71C1C] hover:underline cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                  </div>
                </div>

                {/* Login Button: Pill/Rounded Rectangle Gradient Button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="px-8 py-2.5 bg-gradient-to-r from-[#D32F2F] to-[#E53935] hover:from-[#B71C1C] hover:to-[#D32F2F] active:scale-[0.98] text-white font-semibold rounded-xl shadow-lg shadow-red-700/25 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-60 cursor-pointer"
                  >
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <span>Login</span>
                    )}
                  </button>
                </div>

                {/* Bottom Sign Up Link */}
                <div className="pt-2 text-xs text-slate-600">
                  <span>Don't have an Account? </span>
                  <button
                    type="button"
                    onClick={() => { setErrorMessage(null); setViewMode('register'); }}
                    className="font-bold text-[#D32F2F] hover:text-[#B71C1C] hover:underline cursor-pointer"
                  >
                    Sign Up
                  </button>
                </div>

              </form>
            )}

            {/* ========================================= */}
            {/* VIEW 2: REGISTER (Resident Sign Up)       */}
            {/* ========================================= */}
            {viewMode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-2.5 sm:space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-0.5">
                    Full Name:
                  </label>
                  <input
                    type="text"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    placeholder="e.g. Juan Dela Cruz"
                    required
                    className="w-full py-1 bg-transparent border-b-2 border-slate-200 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:border-[#D32F2F]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-0.5">
                      E-mail:
                    </label>
                    <input
                      type="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="name@example.ph"
                      required
                      className="w-full py-1 bg-transparent border-b-2 border-slate-200 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:border-[#D32F2F]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-0.5">
                      Mobile Number:
                    </label>
                    <input
                      type="tel"
                      value={regMobile}
                      onChange={(e) => setRegMobile(e.target.value)}
                      placeholder="0917 123 4567"
                      className="w-full py-1 bg-transparent border-b-2 border-slate-200 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:border-[#D32F2F]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-0.5">
                    Barangay (Lingayen):
                  </label>
                  <select
                    value={regBarangay}
                    onChange={(e) => setRegBarangay(e.target.value)}
                    className="w-full py-1 bg-transparent border-b-2 border-slate-200 text-slate-800 text-sm focus:outline-none focus:border-[#D32F2F]"
                  >
                    {lingayenBarangays.map((b) => (
                      <option key={b.id} value={b.name}>
                        Barangay {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-0.5">
                      Password:
                    </label>
                    <input
                      type="password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="At least 8 chars"
                      required
                      className="w-full py-1 bg-transparent border-b-2 border-slate-200 text-slate-800 text-sm focus:outline-none focus:border-[#D32F2F]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-0.5">
                      Confirm Password:
                    </label>
                    <input
                      type="password"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      required
                      className="w-full py-1 bg-transparent border-b-2 border-slate-200 text-slate-800 text-sm focus:outline-none focus:border-[#D32F2F]"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 pt-0.5 text-[11px] text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={regConsent}
                    onChange={(e) => setRegConsent(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-[#D32F2F] focus:ring-[#D32F2F]"
                  />
                  <span>
                    I consent to the processing of emergency data under the Data Privacy Act of 2012.
                  </span>
                </label>

                <div className="pt-1.5">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="px-8 py-2 bg-gradient-to-r from-[#D32F2F] to-[#E53935] hover:from-[#B71C1C] hover:to-[#D32F2F] text-white font-semibold rounded-xl shadow-lg shadow-red-700/25 transition-all text-sm cursor-pointer"
                  >
                    <span>Create Account</span>
                  </button>
                </div>

                <div className="pt-0.5 text-xs text-slate-600">
                  <span>Already have an account? </span>
                  <button
                    type="button"
                    onClick={() => { setErrorMessage(null); setViewMode('login'); }}
                    className="font-bold text-[#D32F2F] hover:text-[#B71C1C] hover:underline cursor-pointer"
                  >
                    Sign In
                  </button>
                </div>
              </form>
            )}

            {/* ========================================= */}
            {/* VIEW 3: FORGOT PASSWORD                   */}
            {/* ========================================= */}
            {viewMode === 'forgot' && (
              <div className="space-y-4 py-2">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Enter your registered email address and we'll dispatch password recovery instructions.
                </p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    E-mail:
                  </label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="e.g. name@example.ph"
                    className="w-full py-1.5 bg-transparent border-b-2 border-slate-200 text-slate-800 text-sm focus:outline-none focus:border-[#D32F2F]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleForgot}
                  disabled={isLoading}
                  className="px-6 py-2 bg-[#D32F2F] text-white font-semibold rounded-xl text-xs hover:bg-[#B71C1C]"
                >
                  Send Recovery Link
                </button>
                <div>
                  <button
                    type="button"
                    onClick={() => setViewMode('login')}
                    className="text-xs font-semibold text-slate-500 hover:text-[#D32F2F]"
                  >
                    ← Back to Login
                  </button>
                </div>
              </div>
            )}

            {/* ========================================= */}
            {/* VIEW 4: SET NEW PASSWORD (recovery link)  */}
            {/* ========================================= */}
            {viewMode === 'reset' && (
              <div className="space-y-4 py-2">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Choose a new password for your account.
                </p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    New Password:
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 chars"
                    className="w-full py-1.5 bg-transparent border-b-2 border-slate-200 text-slate-800 text-sm focus:outline-none focus:border-[#D32F2F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm Password:
                  </label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="w-full py-1.5 bg-transparent border-b-2 border-slate-200 text-slate-800 text-sm focus:outline-none focus:border-[#D32F2F]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSetPassword}
                  disabled={isLoading}
                  className="px-6 py-2 bg-[#D32F2F] text-white font-semibold rounded-xl text-xs hover:bg-[#B71C1C]"
                >
                  Update Password
                </button>
              </div>
            )}
          </div>

          {/* Subtext notice: LGU & Barangay access */}
          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
            <span className="font-semibold text-slate-600">Barangay officials and LGU staff:</span> Accounts are provisioned directly by the Lingayen MDRRMO administrator.
          </div>

        </div>

        {/* ============================================================== */}
        {/* RIGHT HALF: Visual Brand & PNA Article Flood Image             */}
        {/* Source: https://www.pna.gov.ph/articles/1236742               */}
        {/* Styled with organic wave ("alon") effect & drop shadow on white */}
        {/* ============================================================== */}
        <div className="hidden md:flex md:w-[50%] lg:w-[52%] self-stretch relative overflow-hidden bg-transparent items-center justify-center select-none">
          <svg
            viewBox="0 0 500 560"
            className="w-full h-full object-cover select-none overflow-visible"
            preserveAspectRatio="none"
          >
            <defs>
              {/* Soft, dimensional natural shadow effect on the wave image */}
              <filter id="waveImageShadow" x="-30%" y="-30%" width="170%" height="170%">
                <feDropShadow dx="-10" dy="12" stdDeviation="14" floodColor="#000000" floodOpacity="0.25" />
                <feDropShadow dx="-3" dy="4" stdDeviation="6" floodColor="#000000" floodOpacity="0.14" />
              </filter>

              {/* Primary Alon (Wave) Shape Clip Mask */}
              <clipPath id="alonWaveMask">
                <path d="M 500 0 L 290 0 C 235 24 185 54 180 120 C 174 190 220 225 198 290 C 172 360 108 380 108 440 C 108 502 165 542 235 555 C 290 565 385 560 500 560 Z" />
              </clipPath>

              {/* Dramatic Red & Black Ambient Gradients */}
              <linearGradient id="dramaticRedBlack" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7f1d1d" stopOpacity="0.45" />
                <stop offset="40%" stopColor="#991b1b" stopOpacity="0.25" />
                <stop offset="75%" stopColor="#18181b" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="dramaticBottomBlack" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="30%" stopColor="#000000" stopOpacity="0" />
                <stop offset="70%" stopColor="#000000" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#050505" stopOpacity="0.75" />
              </linearGradient>
            </defs>

            {/* Main Alon (Wave) Image with shadow effect and dramatic red/black gradient */}
            <g filter="url(#waveImageShadow)">
              <g clipPath="url(#alonWaveMask)">
                <image
                  href="/baha.jpg"
                  xlinkHref="/baha.jpg"
                  x="0"
                  y="0"
                  width="500"
                  height="560"
                  preserveAspectRatio="xMidYMid slice"
                  style={{ filter: 'contrast(1.12) brightness(1.02)' }}
                />
                {/* Dramatic Red & Black atmosphere gradient overlay */}
                <rect
                  x="0"
                  y="0"
                  width="500"
                  height="560"
                  fill="url(#dramaticRedBlack)"
                  style={{ mixBlendMode: 'multiply' }}
                />
                {/* Deep cinematic black bottom vignette */}
                <rect
                  x="0"
                  y="0"
                  width="500"
                  height="560"
                  fill="url(#dramaticBottomBlack)"
                />
              </g>
            </g>
          </svg>
        </div>

      </div>

    </div>
  );
};
