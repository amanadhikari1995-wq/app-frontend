/**
 * websiteApi.ts — External Website backend client (Node.js + MongoDB).
 * ====================================================================
 * Auth + subscription state lives ONLY on the website backend. The
 * desktop app stores no user records or passwords; it just holds the
 * JWT returned by /api/auth/login (or /api/auth/signup) in localStorage
 * and forwards it on every request.
 *
 * Every request automatically attaches `Authorization: Bearer <jwt>`.
 * A 401 response triggers an automatic logout + redirect to /login.
 */
import axios from 'axios'
import { getToken } from './auth'
import { getWebsiteApiUrl } from './runtime-config'

// baseURL is resolved per-request in the interceptor below so the value can
// come from window.__CONFIG__ (Electron preload reads runtime-config.json).
const websiteApi = axios.create({ timeout: 15000 })

websiteApi.interceptors.request.use((config) => {
  config.baseURL = getWebsiteApiUrl()
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Per user request, 401 responses do NOT auto-logout the user.
// Individual API calls may fail, but the session stays active until
// the user explicitly clicks Logout. No response interceptor needed.

export interface AuthResponse {
  /** Final JWT — present when login succeeds. */
  access_token?: string
  user?: { id?: string; email?: string; name?: string; username?: string }
  is_subscribed?: boolean
  subscription?: { active?: boolean; status?: string; expires_at?: string }
}

export interface SubscriptionStatus {
  active: boolean
  status?: string
  plan?: string
  expires_at?: string | null
  reason?: string
}

export const websiteAuthApi = {
  /** Sign in with email + password. Returns access_token + user info. */
  login: (email: string, password: string) =>
    websiteApi.post<AuthResponse>('/api/auth/login', { email, password }),

  /** Create a new account. Website backend may auto-issue a JWT on success. */
  signup: (payload: { email: string; password: string; name?: string }) =>
    websiteApi.post<AuthResponse>('/api/auth/signup', payload),

  /** Validate current JWT — returns the authenticated user. 401 if invalid. */
  me: () => websiteApi.get('/api/auth/me'),

  /**
   * Subscription state. Tries the dedicated endpoint first and falls back
   * to /api/auth/me which typically embeds an `is_subscribed` flag.
   */
  subscriptionStatus: async (): Promise<SubscriptionStatus> => {
    try {
      const r = await websiteApi.get('/api/subscription/status')
      const d = r.data ?? {}
      return {
        active: !!(d.active ?? d.is_active ?? d.is_subscribed),
        status: d.status,
        plan:   d.plan,
        expires_at: d.expires_at ?? d.expiresAt ?? null,
        reason: d.reason,
      }
    } catch (e: unknown) {
      // Fallback to /api/auth/me — many backends embed the flag there.
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status && status !== 404) throw e   // real failure (401, 500, network)
      const r = await websiteApi.get('/api/auth/me')
      const d = r.data ?? {}
      return {
        active: !!(d.is_subscribed ?? d.subscription?.active ?? d.subscription?.is_active),
        status: d.subscription?.status,
        plan:   d.subscription?.plan,
        expires_at: d.subscription?.expires_at ?? null,
      }
    }
  },
}


// ── Centralised "Fix with AI" ────────────────────────────────────────────────
// The Anthropic key lives on the website backend (Runway env var), so end
// users don't need their own Anthropic account. The website enforces the
// subscription gate + per-user daily limit; this client just sends the
// payload and reads the JSON response.

export interface AiFixResponse {
  explanation: string
  changes:     { description?: string; old_code?: string; new_code?: string }[]
  fixed_code:  string
  model?:      string
  usage?: {
    input_tokens:          number
    output_tokens:         number
    cache_read_tokens?:    number
    cache_creation_tokens?: number
  }
  rate_limit?: { used_today: number; daily_limit: number }
}

export const websiteAiApi = {
  /**
   * Send a bot's source + recent error logs to Claude (running in the
   * cloud), get back a structured fix. Returns the parsed JSON or throws
   * an Axios error whose response.data.error explains why (402 = no
   * subscription, 429 = daily quota, 503 = service down, 502 = AI returned
   * something we couldn't parse).
   */
  fix: (payload: { bot_code: string; error_logs: string[]; extra_context?: string }) =>
    websiteApi.post<AiFixResponse>('/api/ai/fix', payload),
}

export default websiteApi
