/**
 * auth.ts  —  Token management for WatchDog Bot
 * ===============================================
 * Stores the JWT in both:
 *   • localStorage  — for client-side API calls (Authorization header)
 *   • Cookie        — so Next.js middleware can protect server-side routes
 *
 * The cookie is NOT httpOnly so JS can write it.  Security model: local
 * desktop app where both client and server run on localhost.
 *
 * Once the user logs in, the app does NOT log them out automatically.
 * Tokens are kept indefinitely; only an explicit click on the Logout
 * button (which calls removeToken()) ends the session.
 */

const TOKEN_KEY      = 'watchdog-token'
const COOKIE_NAME    = 'watchdog-token'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365  // 1 year — effectively permanent

// ── Cookie helpers ────────────────────────────────────────────────────────────

function setCookie(name: string, value: string, maxAge: number) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`
}

function deleteCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=; path=/; max-age=0`
}

// ── JWT payload decoder (no signature verification — just reads exp) ──────────

export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload
  } catch {
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const getToken = (): string | null => {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export const setToken = (token: string) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(TOKEN_KEY, token)
  setCookie(COOKIE_NAME, token, COOKIE_MAX_AGE)
}

export const removeToken = () => {
  if (typeof window === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
  deleteCookie(COOKIE_NAME)
}

/**
 * "Logged in" means simply: a token is present.
 *
 * Intentionally does NOT auto-clear an expired token. The session stays
 * active until the user manually logs out (which removeToken() does).
 * If the token is actually rejected by the server, individual API calls
 * will get 401 errors but the user stays on the page — they can refresh
 * or log out themselves.
 */
export const isLoggedIn = (): boolean => {
  return !!getToken()
}

// ── Full session storage ──────────────────────────────────────────────────────
// Stores the complete Supabase session (access_token + refresh_token +
// metadata) so that on subsequent Electron launches — where the user is
// already "logged in" via the cached access_token and skips the login page —
// AuthGate can still sync the full session to session.json for wd_cloud.py.
//
// Without this, session.json is only created the very first time the user
// manually signs in; if they reinstall the app, clear LOCALAPPDATA, or the
// file is deleted for any reason, the cloud connector can't authenticate.

const FULL_SESSION_KEY = 'watchdog-session-full'

export interface FullSession {
  access_token:  string
  refresh_token: string | null
  expires_at:    number
  user_id:       string | null
  email:         string | null
}

/** Persist the full Supabase session to localStorage. */
export const setFullSession = (session: FullSession): void => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FULL_SESSION_KEY, JSON.stringify(session))
  } catch { /* quota exceeded or private-browsing */ }
}

/** Read back the full session. Returns null if absent or malformed. */
export const getFullSession = (): FullSession | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(FULL_SESSION_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object' || !obj.access_token) return null
    return obj as FullSession
  } catch {
    return null
  }
}

/** Clear both the access-token shortcut and the full session on logout. */
export const removeFullSession = (): void => {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(FULL_SESSION_KEY) } catch { /* ignore */ }
}

/**
 * Returns the username / display name from the stored token,
 * or null if no token exists or the payload can't be decoded.
 */
export const getTokenUser = (): { username?: string; userId?: number } | null => {
  const token = getToken()
  if (!token) return null
  const payload = decodeTokenPayload(token)
  if (!payload) return null
  return {
    username: payload.sub as string | undefined,
    userId:   payload.user_id as number | undefined,
  }
}
