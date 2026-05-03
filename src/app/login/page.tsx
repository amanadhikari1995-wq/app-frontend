'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setToken, isLoggedIn, setFullSession } from '@/lib/auth'
import { websiteAuthApi } from '@/lib/websiteApi'
import WatchdogLogo from '@/components/WatchdogLogo'
import { gotoDashboard } from '@/lib/app-nav'

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, type, onDismiss }: { message: string; type: 'error' | 'success'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className={`
      fixed top-6 left-1/2 -translate-x-1/2 z-[999]
      flex items-center gap-3 px-6 py-4 rounded-2xl
      border shadow-2xl backdrop-blur-sm max-w-[90vw] sm:max-w-lg
      animate-[slideDown_0.35s_ease_forwards]
      ${type === 'error'
        ? 'bg-red-950/90 border-red-500/40 text-red-200'
        : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'}
    `}>
      {type === 'error' ? (
        <svg className="shrink-0 w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
      ) : (
        <svg className="shrink-0 w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/>
        </svg>
      )}
      <p className="text-sm font-medium leading-snug">{message}</p>
      <button onClick={onDismiss} className="ml-auto shrink-0 opacity-60 hover:opacity-100 transition-opacity" aria-label="Dismiss">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  )
}

// ── Input field ───────────────────────────────────────────────────────────────
function Field({
  label, type, value, onChange, error, autoComplete, disabled, inputRef,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  error?: string
  autoComplete?: string
  disabled?: boolean
  inputRef?: React.RefObject<HTMLInputElement>
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        className="font-semibold"
        style={{
          fontSize: 12,
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </label>
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        className="w-full outline-none transition-all duration-200 disabled:opacity-50"
        style={{
          padding: '14px 18px',
          borderRadius: 14,
          fontSize: 16,
          background: 'rgba(255,255,255,0.03)',
          color: 'white',
          border: error ? '1px solid rgba(239,68,68,0.55)' : '1px solid rgba(255,255,255,0.08)',
          boxShadow: error ? '0 0 0 3px rgba(239,68,68,0.10)' : 'none',
        }}
        onFocus={e => {
          if (!error) {
            e.currentTarget.style.border = '1px solid var(--accent)'
            e.currentTarget.style.boxShadow = '0 0 0 4px var(--accent-dim)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
          }
        }}
        onBlur={e => {
          if (!error) {
            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)'
            e.currentTarget.style.boxShadow = 'none'
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
          }
        }}
      />
      {error && (
        <p className="text-[13px] text-red-400 flex items-center gap-1.5 mt-0.5">
          <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  )
}

// ── Main login page ───────────────────────────────────────────────────────────
export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const emailRef     = useRef<HTMLInputElement>(null)

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [rememberMe,   setRememberMe]   = useState(false)
  const [errors,       setErrors]       = useState<{ email?: string; password?: string; form?: string }>({})
  const [loading,      setLoading]      = useState(false)
  const [toast,        setToast]        = useState<{ message: string; type: 'error' | 'success' } | null>(null)

  useEffect(() => {
    if (isLoggedIn()) {
      // file://-aware hard navigation; works in Electron AND web contexts
      gotoDashboard()
      return
    }
    emailRef.current?.focus()
  }, [router, searchParams])

  // Surface "session expired" or "subscription_inactive" reason from URL
  useEffect(() => {
    const reason = searchParams.get('reason')
    if (!reason) return
    const map: Record<string, string> = {
      session_expired:        'Your session expired. Please log in again.',
      token_invalid:          'Your session is no longer valid. Please log in again.',
      subscription_inactive:  'Your subscription is inactive. Please renew on watchdogbot.cloud.',
      logged_out:             'You have been logged out.',
    }
    if (map[reason]) setErrors({ form: map[reason] })
  }, [searchParams])

  const handleSignUpClick = () => {
    // Sign-up lives on the website. Open it in the user's default browser.
    window.open('https://watchdogbot.cloud', '_blank', 'noopener,noreferrer')
  }

  const redirectAfterLogin = (token: string, username?: string) => {
    setToken(token)
    const displayName = username ? `Welcome back, ${username}!` : 'Login successful!'
    setToast({ message: `✓ ${displayName} Redirecting…`, type: 'success' })
    setTimeout(() => {
      // file://-aware navigation. The `from` query param is intentionally
      // ignored under file:// — we always go to dashboard. (Round-tripping
      // an arbitrary file path through the URL bar is fragile under file://.)
      gotoDashboard()
    }, 1000)
  }

  const validate = () => {
    const errs: typeof errors = {}
    if (!email.trim()) errs.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = 'Enter a valid email address.'
    if (!password) errs.password = 'Password is required.'
    return errs
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setErrors({})
    setLoading(true)
    try {
      // Auth lives on the Website backend (Node.js + MongoDB). The desktop
      // app never stores passwords — it only holds the JWT this returns.
      const res = await websiteAuthApi.login(email.trim(), password)
      const { access_token, refresh_token, expires_in, user, is_subscribed, subscription } = res.data as {
        access_token?:  string
        refresh_token?: string
        expires_in?:    number
        user?: { id?: string; email?: string; name?: string; username?: string }
        is_subscribed?: boolean
        subscription?: { active?: boolean }
      }

      // Persist the full Supabase session to localStorage AND to Electron's
      // main process (session.json). Having it in localStorage is the safety
      // net — on subsequent launches where the login page is skipped,
      // AuthGate reads it back and re-creates session.json if it's missing.
      if (access_token) {
        const sessionPayload = {
          access_token,                             // type-narrowed to string
          refresh_token: refresh_token || null,
          expires_at:    expires_in
                           ? Math.floor(Date.now() / 1000) + expires_in
                           : Math.floor(Date.now() / 1000) + 3600,
          user_id:       user?.id || null,
          email:         user?.email || email.trim(),
        }

        // Always write to localStorage (works in both Electron and web).
        setFullSession(sessionPayload)

        // Pipe to Electron main process so wd_cloud.py gets session.json
        // immediately. We retry up to 3 times because the first IPC call
        // right after renderer mount can race with main.js handler reg.
        try {
          const electronAPI = (window as unknown as {
            electronAPI?: { setSession?: (s: unknown) => Promise<{ ok?: boolean; error?: string } | unknown> }
          }).electronAPI
          if (electronAPI?.setSession) {
            let lastErr: unknown = null
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                const res = await electronAPI.setSession(sessionPayload) as { ok?: boolean; error?: string }
                if (res && res.ok) { lastErr = null; break }
                lastErr = res?.error || 'unknown'
                console.warn(`[login] setSession attempt ${attempt} returned not-ok:`, lastErr)
              } catch (e) {
                lastErr = e
                console.warn(`[login] setSession attempt ${attempt} threw:`, e)
              }
              await new Promise(r => setTimeout(r, 400 * attempt))
            }
            if (lastErr) {
              // Non-fatal — AuthGate startup sync is the safety net.
              console.error('[login] session.json not persisted via IPC after 3 attempts:', lastErr)
            }
          }
        } catch (e) {
          console.warn('[login] could not persist session to Electron main:', e)
        }
      }

      if (!access_token) {
        setErrors({ form: 'Login failed — no token returned by the server.' })
        return
      }

      const subActive = is_subscribed ?? subscription?.active
      if (subActive === false) {
        setErrors({ form: 'Your account does not have an active subscription. Please subscribe at watchdogbot.cloud.' })
        return
      }

      redirectAfterLogin(access_token, user?.name || user?.username || user?.email)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string; message?: string; error?: string } } }
      const detail   = axiosErr?.response?.data?.detail
                    ?? axiosErr?.response?.data?.message
                    ?? axiosErr?.response?.data?.error
      setErrors({ form: detail || 'Login failed. Check your email and password.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <main
        className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
        style={{ background: 'var(--bg)', padding: '48px 24px' }}
      >
        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0" style={{
          background: 'radial-gradient(ellipse 70% 55% at 50% 45%, var(--accent-dim) 0%, transparent 68%)',
        }} />

        {/* Open layout — no card, no border, no shadow */}
        <div
          className="relative z-10 w-full"
          style={{ maxWidth: 460 }}
        >
          {/* ── Brand mark — animated, centered, premium ── */}
          <div className="flex flex-col items-center mb-12">
            <WatchdogLogo size={64} animated />
            <span
              className="mt-4 font-bold uppercase"
              style={{
                fontSize: 11,
                letterSpacing: '0.32em',
                color: 'var(--accent)',
                opacity: 0.9,
              }}
            >
              WatchDog &nbsp;·&nbsp; Universal Bot
            </span>
          </div>

          {/* Heading */}
          <div className="text-center mb-10">
            <h1
              className="text-white"
              style={{
                fontFamily: 'Poppins, Inter, system-ui, sans-serif',
                fontSize: 38,
                fontWeight: 900,
                letterSpacing: '-0.025em',
                lineHeight: 1.1,
                marginBottom: 10,
              }}
            >
              Welcome back
            </h1>
            <p style={{ fontSize: 15, color: 'var(--text-muted)', letterSpacing: '-0.005em' }}>
              Sign in to continue to your workspace
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} noValidate className="flex flex-col gap-6">
            <Field
              label="Email Address"
              type="email"
              value={email}
              onChange={v => { setEmail(v); setErrors(p => ({ ...p, email: undefined, form: undefined })) }}
              autoComplete="email"
              error={errors.email}
              disabled={loading}
              inputRef={emailRef}
            />

            {/* Password with forgot link */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label
                  className="font-semibold"
                  style={{ fontSize: 12, letterSpacing: '0.04em', color: 'var(--text-muted)' }}
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => window.open('https://watchdogbot.cloud', '_blank', 'noopener,noreferrer')}
                  className="font-semibold transition-opacity hover:opacity-100"
                  style={{ fontSize: 12, color: 'var(--accent)', opacity: 0.8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setErrors(p => ({ ...p, password: undefined, form: undefined })) }}
                autoComplete="current-password"
                disabled={loading}
                className="w-full outline-none transition-all duration-200 disabled:opacity-50"
                style={{
                  padding: '14px 18px',
                  borderRadius: 14,
                  fontSize: 16,
                  background: 'rgba(255,255,255,0.03)',
                  color: 'white',
                  border: errors.password ? '1px solid rgba(239,68,68,0.55)' : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: errors.password ? '0 0 0 3px rgba(239,68,68,0.10)' : 'none',
                }}
                onFocus={e => {
                  if (!errors.password) {
                    e.currentTarget.style.border = '1px solid var(--accent)'
                    e.currentTarget.style.boxShadow = '0 0 0 4px var(--accent-dim)'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                  }
                }}
                onBlur={e => {
                  if (!errors.password) {
                    e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)'
                    e.currentTarget.style.boxShadow = 'none'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                  }
                }}
              />
              {errors.password && (
                <p className="text-[13px] text-red-400 flex items-center gap-1.5 mt-0.5">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {errors.password}
                </p>
              )}
            </div>

            {/* Remember me */}
            <label className="flex items-center gap-3 cursor-pointer select-none" style={{ marginTop: '-6px' }}>
              <div
                className="relative flex items-center justify-center transition-all duration-150 shrink-0"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: rememberMe ? '2px solid var(--accent)' : '2px solid rgba(255,255,255,0.2)',
                  background: rememberMe ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                  boxShadow: rememberMe ? '0 0 12px var(--accent-dim)' : 'none',
                }}
                onClick={() => setRememberMe(p => !p)}
              >
                {rememberMe && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="var(--bg)" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </div>
              <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Remember me</span>
            </label>

            {/* Form-level error */}
            {errors.form && (
              <div className="flex items-start gap-3 rounded-2xl text-sm text-red-300"
                style={{ padding: '14px 18px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                <svg className="w-5 h-5 mt-0.5 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                </svg>
                <span className="leading-relaxed">{errors.form}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full font-bold flex items-center justify-center gap-2.5 transition-all duration-200 active:scale-[0.98] hover:scale-[1.01]"
              style={{
                marginTop: 4,
                padding: '15px 24px',
                borderRadius: 14,
                fontSize: 15.5,
                letterSpacing: '-0.005em',
                background: loading ? 'var(--accent)' : 'linear-gradient(135deg, var(--accent) 0%, #0099bb 100%)',
                color: 'var(--bg)',
                boxShadow: loading ? 'none' : '0 8px 28px var(--accent-dim), 0 0 0 1px rgba(255,255,255,0.12) inset',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => {
                if (!loading) (e.currentTarget as HTMLElement).style.boxShadow = '0 12px 40px var(--accent-dim), 0 0 0 1px rgba(255,255,255,0.18) inset'
              }}
              onMouseLeave={e => {
                if (!loading) (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 28px var(--accent-dim), 0 0 0 1px rgba(255,255,255,0.12) inset'
              }}
            >
              {loading ? (
                <><Spinner size={18} /> Signing in…</>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/>
                  </svg>
                  Sign In
                </>
              )}
            </button>
          </form>

          {/* Footer — open, no divider */}
          <div className="mt-10 flex items-center justify-center gap-2">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Don&apos;t have an account?
            </span>
            <button
              type="button"
              onClick={handleSignUpClick}
              className="flex items-center gap-1.5 text-sm font-bold transition-all hover:gap-2"
              style={{ color: 'var(--accent)' }}
            >
              Sign Up
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Version badge */}
        <p className="mt-8 text-xs tracking-[0.22em] uppercase" style={{ color: 'rgba(255,255,255,0.1)' }}>
          WATCH-DOG &nbsp;·&nbsp; v3.5.0
        </p>
      </main>

      <style jsx global>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -12px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </>
  )
}
