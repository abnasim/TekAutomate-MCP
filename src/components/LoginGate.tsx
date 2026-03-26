import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, Lock, Zap, AlertCircle, LogIn } from 'lucide-react';

// ─── Change this to whatever access code management distributes ───────────────
const ACCESS_CODE = 'TekPreview2025';
const STORAGE_KEY = 'tek_automator_auth';
// ─────────────────────────────────────────────────────────────────────────────

interface LoginFormValues {
  code: string;
}

function isAuthenticated(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'granted';
  } catch {
    return false;
  }
}

function setAuthenticated(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'granted');
  } catch {
    // localStorage unavailable – session-only auth is fine
  }
}

interface Props {
  children: React.ReactNode;
}

export function LoginGate({ children }: Props) {
  const [authed, setAuthed] = useState(isAuthenticated);
  const [showCode, setShowCode] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>();

  const onSubmit = useCallback(
    (values: LoginFormValues) => {
      if (values.code.trim() === ACCESS_CODE) {
        setAuthenticated();
        setAuthed(true);
      } else {
        setError('code', { message: 'Incorrect access code. Please try again.' });
      }
    },
    [setError],
  );

  if (authed) return <>{children}</>;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-gray-950 via-blue-950 to-gray-900 relative overflow-hidden">
      {/* Subtle grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg,#ffffff 0,#ffffff 1px,transparent 1px,transparent 40px),' +
            'repeating-linear-gradient(90deg,#ffffff 0,#ffffff 1px,transparent 1px,transparent 40px)',
        }}
      />

      {/* Glow accents */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-blue-400/8 blur-3xl pointer-events-none" />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          {/* Top accent bar */}
          <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600" />

          <div className="px-8 pt-8 pb-9">
            {/* Logo / brand */}
            <div className="flex flex-col items-center mb-8">
              <div className="w-14 h-14 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/10">
                <Zap className="w-7 h-7 text-blue-400" />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Tek Automator</h1>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide bg-amber-500/15 text-amber-300 border border-amber-400/20">
                  PRE-RELEASE
                </span>
              </div>
              <p className="mt-3 text-sm text-white/40 text-center leading-relaxed">
                This build is restricted to authorised testers.<br />
                Enter your access code to continue.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="mb-5">
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                  Access Code
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    type={showCode ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your access code"
                    className={[
                      'w-full bg-white/5 border rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder-white/20',
                      'focus:outline-none focus:ring-2 transition-all duration-150',
                      errors.code
                        ? 'border-red-400/60 focus:ring-red-400/30'
                        : 'border-white/10 focus:border-blue-400/60 focus:ring-blue-400/20',
                    ].join(' ')}
                    {...register('code', { required: 'Access code is required.' })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCode((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                    tabIndex={-1}
                    aria-label={showCode ? 'Hide code' : 'Show code'}
                  >
                    {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {errors.code && (
                  <div className="mt-2 flex items-center gap-1.5 text-red-400 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{errors.code.message}</span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-white font-semibold text-sm py-3 rounded-xl transition-all duration-150 shadow-lg shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-400/50"
              >
                <LogIn className="w-4 h-4" />
                Access Pre-Release
              </button>
            </form>

            {/* Footer note */}
            <p className="mt-6 text-center text-xs text-white/20 leading-relaxed">
              Don't have an access code?{' '}
              <span className="text-white/35">Contact your Tektronix team lead.</span>
            </p>
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-white/15">
          © {new Date().getFullYear()} Tektronix · Internal pre-release build
        </p>
      </div>
    </div>
  );
}
