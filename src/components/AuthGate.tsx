'use client'
/**
 * AuthGate — connection + authentication gate for the entire app.
 *
 * On mount of any route (public OR protected) the gate runs a 3-stage flow:
 *
 *   Stage 1 — CONNECTING: probe the website backend with probeBackend().
 *     • Show "Connecting to server…" with an animated indicator.
 *     • If the probe fails (no internet, DNS failure, timeout, server down)
 *       → render the "No internet connection" screen with a Retry button.
 *     • If it succeeds → continue.
 *
 *   Stage 2 — AUTH GATE (only for protected routes):
 *     • If no token → redirect to /login (the connection check is preserved
 *       for the login page too, so the user is never dumped into a form
 *       that won't work).
 *     • If token → call checkAuth() (GET /api/auth/me + subscription check).
 *       Hard failures kick the user out; render content on success.
 *
 *   Stage 3 — STEADY STATE:
 *     • Background re-check every 5 minutes via verifySubscription().
 *     • Listens for window 'offline' / 'online' events; if the connection
 *       drops mid-session, the gate flips back to the offline screen.
 *
 * The Retry button just re-runs Stage 1.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { isLoggedIn } from '@/lib/auth'
import { checkAuth, probeBackend } from '@/lib/subscription'
import { gotoLogin } from '@/lib/app-nav'

const PUBLIC_PATHS = ['/login', '/signup']

type GateState =
  | 'connecting'   // probing backend
  | 'offline'      // probe failed → show retry
  | 'verifying'    // connected, checking auth
  | 'authorized'   // protected content can render
  | 'public'       // public route, content can render

/**
 * Normalise the pathname so `/login` checks work under all 3 origins:
 *   • http(s)://         pathname is already clean (e.g. /login)
 *   • app://             custom protocol — pathname is /login/index.html
 *                        or /login/, just strip trailing index.html / slash
 *   • file:// (legacy)   includes full disk path; extract after /out/
 */
function normalizePath(raw: string): string {
  // file:// path with /out/ segment
  const idx = raw.indexOf('/out/')
  if (idx >= 0) {
    const after = raw.slice(idx + 5)
    const cleaned = after.replace(/\/?(index\.html)?\/?$/, '')
    return cleaned ? `/${cleaned}` : '/'
  }
  // Strip trailing /index.html or trailing slash from any path
  const cleaned = raw.replace(/\/?(index\.html)?\/?$/, '')
  return cleaned || '/'
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const rawPath  = usePathname() ?? '/'
  const pathname = normalizePath(rawPath)
  const router   = useRouter()
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  const [state, setState] = useState<GateState>('connecting')
  const verifiedOnce = useRef(false)
  const connectedOnce = useRef(false)
  const [retryNonce, setRetryNonce] = useState(0)

  /**
   * Stage 1: connectivity probe + ONE-TIME auth check at mount.
   *
   * Once a user is signed in, AuthGate never logs them out — even if
   * checkAuth() comes back "subscription_inactive" or "token_invalid"
   * AFTER login. The session persists until the user clicks Logout.
   * Failed API calls surface their own UI errors; they don't kick the
   * gate into a logout.
   */
  const runConnectFlow = useCallback(async () => {
    setState('connecting')
    const ok = await probeBackend()
    if (!ok) { setState('offline'); return }
    connectedOnce.current = true

    // Public route? Show the page (login, signup) immediately.
    if (isPublic) { setState('public'); return }

    // No token at all → redirect to login. The user has to sign in
    // before reaching protected pages, but that's the only redirect
    // we ever do automatically.
    if (!isLoggedIn()) {
      gotoLogin({ from: pathname })
      return
    }

    // Token present — try to validate, but DO NOT logout on failure.
    // checkAuth() is best-effort: a failure means we couldn't verify
    // the subscription, not that the user has lost access.
    setState('verifying')
    try { await checkAuth() } catch { /* ignore — keep the user signed in */ }
    verifiedOnce.current = true
    setState('authorized')
  }, [isPublic, pathname, router])

  // Initial flow + re-trigger when path changes or user clicks Retry.
  useEffect(() => {
    let cancelled = false

    // Fast path: already connected + already verified this session — just route.
    if (connectedOnce.current && (isPublic || verifiedOnce.current)) {
      setState(isPublic ? 'public' : 'authorized')
      return
    }

    runConnectFlow()

    return () => { cancelled = true; void cancelled }
  }, [pathname, isPublic, retryNonce, runConnectFlow])

  // Background re-check loop has been removed by request.
  // Once authorised, the user stays signed in until they click Logout.
  // Subscription state is shown by individual UI banners as needed,
  // but it never automatically signs the user out.

  // React to OS-level connectivity changes mid-session.
  useEffect(() => {
    const onOffline = () => setState('offline')
    const onOnline  = () => { if (state === 'offline') setRetryNonce(n => n + 1) }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online',  onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online',  onOnline)
    }
  }, [state])

  if (state === 'public' || state === 'authorized') return <>{children}</>
  if (state === 'offline')    return <OfflineScreen onRetry={() => setRetryNonce(n => n + 1)} />
  if (state === 'verifying')  return <Splash title="Verifying session…" subtitle="Checking your subscription" />
  return                              <Splash title="Connecting to server…" subtitle="Please wait a moment" />
}

/* ─────────────────────────────────────────────────────────────────────────── */

function Splash({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg, #05070f)',
        gap: 22,
      }}
    >
      {/* Animated three-dot wave */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: 11, height: 11, borderRadius: '50%',
              background: '#00f5ff',
              boxShadow: '0 0 12px rgba(0,245,255,0.6)',
              animation: `wd-bounce 1.1s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 16, fontWeight: 800,
            color: 'rgba(255,255,255,0.92)',
            letterSpacing: '-0.005em',
            fontFamily: 'Poppins, Inter, system-ui, sans-serif',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 8, fontSize: 12, fontWeight: 600,
              color: 'rgba(255,255,255,0.45)',
              letterSpacing: '0.04em',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <style>{`
        @keyframes wd-bounce {
          0%, 80%, 100% { transform: translateY(0) scale(0.85); opacity: 0.45 }
          40%           { transform: translateY(-10px) scale(1);  opacity: 1 }
        }
      `}</style>
    </div>
  )
}

function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const [retrying, setRetrying] = useState(false)
  const handleRetry = async () => {
    if (retrying) return
    setRetrying(true)
    // Brief delay so the user sees the retry actually fire
    await new Promise(r => setTimeout(r, 350))
    onRetry()
  }
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg, #05070f)',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        {/* Icon */}
        <div
          style={{
            width: 76, height: 76, margin: '0 auto 24px',
            borderRadius: 22,
            background: 'linear-gradient(135deg, rgba(239,68,68,0.18), rgba(239,68,68,0.06))',
            border: '1px solid rgba(239,68,68,0.32)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 12px 40px rgba(239,68,68,0.18), 0 0 0 1px rgba(255,255,255,0.04) inset',
          }}
        >
          <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1l22 22"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
        </div>
        <h1
          style={{
            fontSize: 24, fontWeight: 900,
            color: '#fff', letterSpacing: '-0.02em',
            margin: 0, marginBottom: 10,
            fontFamily: 'Poppins, Inter, system-ui, sans-serif',
          }}
        >
          No internet connection
        </h1>
        <p
          style={{
            fontSize: 14, lineHeight: 1.55,
            color: 'rgba(255,255,255,0.55)',
            margin: 0, marginBottom: 28,
          }}
        >
          Please check your connection and try again.
        </p>
        <button
          onClick={handleRetry}
          disabled={retrying}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '13px 32px',
            borderRadius: 14,
            fontSize: 14, fontWeight: 800, letterSpacing: '-0.005em',
            color: 'var(--bg, #05070f)',
            background: retrying
              ? 'rgba(0,245,255,0.55)'
              : 'linear-gradient(135deg, #00f5ff 0%, #0099bb 100%)',
            border: 'none',
            cursor: retrying ? 'wait' : 'pointer',
            boxShadow: retrying
              ? 'none'
              : '0 8px 28px rgba(0,245,255,0.35), 0 0 0 1px rgba(255,255,255,0.14) inset',
            transition: 'transform 150ms ease, box-shadow 200ms ease',
          }}
          onMouseEnter={e => { if (!retrying) (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
        >
          {retrying ? (
            <>
              <span
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: '2px solid rgba(5,7,15,0.35)',
                  borderTopColor: 'var(--bg, #05070f)',
                  animation: 'wd-spin-r 0.8s linear infinite',
                }}
              />
              Retrying…
            </>
          ) : (
            <>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Retry
            </>
          )}
        </button>
      </div>
      <style>{`
        @keyframes wd-spin-r { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
