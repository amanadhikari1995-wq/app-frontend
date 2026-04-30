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
