/**
 * subscription.ts — Central auth + subscription gate.
 * ===================================================
 * Single source of truth for verifying the desktop session against the
 * Website backend (Node.js + MongoDB). Two public functions:
 *
 *   checkAuth()         — full session verification: hits GET /api/auth/me,
 *                         confirms the JWT is valid AND the user has an
 *                         active subscription. Used on every protected page
 *                         mount + on app startup.
 *
 *   verifySubscription() — lightweight subscription-only check, used by
 *                         the periodic background re-check.
 *
 *   logoutAndRedirect() — clears the local token and bounces to /login.
 *
 * The desktop app stores no user records or passwords; the JWT in
 * localStorage is the only piece of identity it holds.
 */
import { websiteAuthApi } from './websiteApi'
import { removeToken, isLoggedIn } from './auth'
import { getWebsiteApiUrl } from './runtime-config'
import { gotoLogin } from './app-nav'

export type AuthFailureReason =
  | 'no_token'
  | 'token_invalid'
  | 'subscription_inactive'
  | 'network_error'

export interface AuthUser {
  id?: string
  email?: string
  name?: string
  username?: string
}

export interface CheckAuthResult {
  ok: boolean
  reason?: AuthFailureReason
  user?: AuthUser
  subscription?: {
    active: boolean
    status?: string
    plan?: string
    expires_at?: string | null
  }
}

/**
 * Full session check used to gate protected routes.
 * Calls GET /api/auth/me on the website backend and validates BOTH:
 *   1. JWT is still accepted (else 401 → token_invalid)
 *   2. User has an active subscription (else subscription_inactive)
 *
 * Hard failures (token_invalid, subscription_inactive) should trigger
 * logoutAndRedirect() at the call site. Soft failures (network_error)
 * should not log the user out — let them keep working until the next
 * successful round-trip.
 */
export async function checkAuth(): Promise<CheckAuthResult> {
  if (!isLoggedIn()) return { ok: false, reason: 'no_token' }

  try {
    const r = await websiteAuthApi.me()
    const d = r.data ?? {}

    // Normalise the user payload — backend may return any of these shapes.
    const user: AuthUser = {
      id:       d.id        ?? d._id        ?? d.user?.id   ?? d.user?._id,
      email:    d.email     ?? d.user?.email,
      name:     d.name      ?? d.user?.name,
      username: d.username  ?? d.user?.username,
    }

    // Normalise the subscription payload.
    const sub  = d.subscription ?? d.user?.subscription ?? null
    const isActive =
         d.is_subscribed === true
      || sub?.active === true
      || sub?.is_active === true
      || sub?.status === 'active'

    if (!isActive) {
      return {
        ok: false,
        reason: 'subscription_inactive',
        user,
        subscription: sub
          ? { active: false, status: sub.status, plan: sub.plan, expires_at: sub.expires_at ?? null }
          : { active: false },
      }
    }

    return {
      ok: true,
      user,
      subscription: {
        active: true,
        status: sub?.status,
        plan:   sub?.plan,
        expires_at: sub?.expires_at ?? null,
      },
    }
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 401 || status === 403) return { ok: false, reason: 'token_invalid' }
    // 5xx / network — soft failure
    return { ok: false, reason: 'network_error' }
  }
}

export interface VerifyResult {
  ok: boolean
  reason?: AuthFailureReason
  status?: string
  expires_at?: string | null
}

/** Lightweight subscription-only check used by the background re-check loop. */
export async function verifySubscription(): Promise<VerifyResult> {
  if (!isLoggedIn()) return { ok: false, reason: 'no_token' }

  try {
    const s = await websiteAuthApi.subscriptionStatus()
    if (!s.active) {
      return { ok: false, reason: 'subscription_inactive', status: s.status, expires_at: s.expires_at }
    }
    return { ok: true, status: s.status, expires_at: s.expires_at }
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 401 || status === 403) return { ok: false, reason: 'token_invalid' }
    return { ok: false, reason: 'network_error' }
  }
}

/**
 * Manually log the user out — only called from the explicit Logout
 * button or sign-in flow. AuthGate / interceptors never call this
 * automatically; the session persists until the user clicks Logout.
 */
export function logoutAndRedirect(reason: AuthFailureReason | 'logged_out' = 'logged_out') {
  removeToken()
  if (typeof window === 'undefined') return
  // Use the file://-aware helper so this works in Electron AND web contexts.
  gotoLogin({ reason })
}

/**
 * Connectivity probe — designed to be PERMISSIVE, not pessimistic.
 *
 * Old version called `GET /api/auth/me` directly with axios. That triggered
 * CORS preflight, required the endpoint to exist, and reported "offline"
 * for any of: CORS misconfig, missing endpoint, slow TLS handshake, axios
 * timeout, or browser extension blocks. Almost every "fake offline" report
 * traced back to one of those non-network failures.
 *
 * New version asks the simpler question: "can the network round-trip
 * complete at all?" — using fetch in no-cors mode (CORS-bypassing) against
 * two independent targets, and only declares offline if BOTH fail AND the
 * browser also says we're offline. Default bias is "online".
 */
async function pingNoCors(url: string, timeoutMs: number): Promise<boolean> {
  // Hard outer race: even if fetch hangs (which it CAN under file:// origin
  // in Electron — the AbortController doesn't always honour the abort), we
  // resolve to false after timeoutMs. Without this, the splash hangs forever.
  return Promise.race<boolean>([
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs)),
    (async () => {
      try {
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), timeoutMs)
        await fetch(url, {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: ac.signal,
        })
        clearTimeout(t)
        return true
      } catch {
        return false
      }
    })(),
  ])
}

export async function probeBackend(timeoutMs = 4000): Promise<boolean> {
  // FAST PATH — trust the browser. navigator.onLine reflects the OS network
  // state and is instant. Under Electron in particular, this is far more
  // reliable than HTTP probes (which can hang under file:// origin). 99% of
  // launches resolve here without touching the network.
  if (typeof navigator !== 'undefined') {
    if (navigator.onLine === true)  return true
    if (navigator.onLine === false) return false
  }

  // Slow path — only runs if navigator.onLine is unavailable.
  const url = getWebsiteApiUrl()

  // Pass 1 — your own backend.
  if (await pingNoCors(url, timeoutMs)) return true

  // Pass 2 — independent public endpoint.
  if (await pingNoCors('https://www.google.com/generate_204', timeoutMs)) return true

  // Pass 3 — final fallback: trust the browser's own signal. If the browser
  // says we're online and both probes failed, it's almost certainly a
  // transient glitch (DNS hiccup, server cold start). Let the user in —
  // the actual auth flow will surface real errors with proper messaging.
  if (typeof navigator !== 'undefined' && navigator.onLine === true) return true

  // Truly offline: both pings failed AND the browser confirms offline.
  return false
}
