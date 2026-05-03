/**
 * supabase.ts — single shared Supabase client.
 *
 * Two design points:
 *
 *   1. Lazy init — the URL + anon key live on the website backend at
 *      /api/config, not in env vars. We fetch them once and cache the
 *      created client. Components await getSupabase() instead of
 *      importing a top-level singleton (which would force a fixed
 *      build-time URL).
 *
 *   2. Re-uses the JWT we already store as `watchdog-token` after the
 *      user signs in via auth.html. Setting it on both the global
 *      headers AND realtime.setAuth means PostgREST queries AND
 *      Realtime channels authenticate as the user — required for our
 *      RLS policies (`auth.uid() = user_id`).
 *
 * Same code runs in Electron (token comes from local login) and in the
 * web dashboard at /app/ (token comes from /api/auth/login). No
 * platform-specific branches.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getWebsiteApiUrl } from './runtime-config'

const TOKEN_KEY = 'watchdog-token'
const REFRESH_INTERVAL_MS = 30_000   // 30s — short enough to recover quickly

// Local view of the electronAPI shape we use here. We don't `declare global`
// it because BackendCrashOverlay.tsx already does that with a different
// subset of fields, and TypeScript rejects duplicate interface declarations
// where the same property has different types. A narrow cast at the call
// site is enough — runtime check still gates the call.
interface ElectronTokenAPI {
  getCurrentToken?: () => Promise<string | null>
}
function getElectronAPI(): ElectronTokenAPI | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electronAPI?: ElectronTokenAPI }).electronAPI
}

let _client:        SupabaseClient | null = null
let _initOnce:      Promise<SupabaseClient> | null = null
let _currentToken:  string | null          = null   // last token we applied to _client
let _refreshTimer:  ReturnType<typeof setInterval> | null = null


/** Synchronous fallback — what we had before. Used in web mode and as a
 *  last resort if the IPC channel isn't available yet. */
function readTokenSync(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

/**
 * Returns the freshest available access_token.
 *
 * Preference order:
 *   1. Electron IPC `electronAPI.getCurrentToken()` — reads session.json,
 *      which the Python sync_engine refreshes every ~minute when the JWT
 *      is about to expire. Always fresh in real desktop installs.
 *   2. localStorage[`watchdog-token`] — the token written at login. Stale
 *      after ~1h but still works for the web build (no Electron, no
 *      sync_engine, no IPC).
 *
 * NOTE: we deliberately don't run our OWN refresh against Supabase here,
 * because sync_engine is already doing that. Two refreshers using the
 * same refresh_token would race and Supabase rotates the refresh_token
 * on every successful refresh — the loser of the race gets
 * "refresh_token already used".
 */
async function readFreshToken(): Promise<string | null> {
  const api = getElectronAPI()
  if (api?.getCurrentToken) {
    try {
      const t = await api.getCurrentToken()
      if (t) return t
    } catch { /* IPC failure → fall through to localStorage */ }
  }
  return readTokenSync()
}

/**
 * Push a fresh JWT into the live Supabase client without recreating it
 * (which would orphan any active realtime channels).
 *
 * Three things to update:
 *   - PostgREST Authorization header (REST queries)
 *   - Realtime auth (channel.subscribe re-uses this on next join)
 *   - localStorage so the rest of the app's HTTP code sees the new token
 *     too — useChat, chat history fetches, etc.
 */
function applyToken(client: SupabaseClient, token: string) {
  // PostgREST Authorization. supabase-js v2 doesn't expose a public setter,
  // but the `rest.headers` mutable object is stable across all v2.x versions
  // we use. If a future major rev drops it, the realtime + localStorage
  // updates below still kick in and only REST queries via this client's
  // .from() chain would degrade.
  try {
    const restHeaders = (client as unknown as { rest?: { headers?: Record<string, string> } })
      .rest?.headers
    if (restHeaders) restHeaders['Authorization'] = `Bearer ${token}`
  } catch { /* best-effort */ }

  try { client.realtime.setAuth(token) } catch { /* best-effort */ }

  try { window.localStorage.setItem(TOKEN_KEY, token) } catch { /* private mode */ }
}

/** Re-read the current token; if it changed, push it into the live client. */
async function refreshTokenIfChanged() {
  if (!_client) return
  const fresh = await readFreshToken()
  if (!fresh || fresh === _currentToken) return
  _currentToken = fresh
  applyToken(_client, fresh)
}

/** Start the periodic refresh loop. Idempotent. */
function ensureRefresher() {
  if (_refreshTimer || typeof window === 'undefined') return
  _refreshTimer = setInterval(() => { void refreshTokenIfChanged() }, REFRESH_INTERVAL_MS)
}


async function fetchPublicConfig() {
  const apiUrl = getWebsiteApiUrl()
  const r = await fetch(`${apiUrl}/api/config`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`/api/config returned ${r.status}`)
  const cfg = await r.json()
  const sb  = cfg?.supabase
  if (!sb?.url || !sb?.anonKey) {
    throw new Error('Server has no Supabase config (cfg.supabase.url / .anonKey).')
  }
  return { url: sb.url as string, anonKey: sb.anonKey as string }
}


/**
 * Returns the singleton Supabase client. First call kicks off the
 * /api/config fetch; subsequent calls resolve instantly.
 */
export function getSupabase(): Promise<SupabaseClient> {
  if (_client)   return Promise.resolve(_client)
  if (_initOnce) return _initOnce

  _initOnce = (async () => {
    const { url, anonKey } = await fetchPublicConfig()
    // Prefer the freshest token (Electron IPC). Falls back to localStorage
    // in web mode or if main process hasn't responded yet.
    const token = await readFreshToken()
    _currentToken = token

    _client = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,    // sync_engine manages refresh on the
        persistSession:   false,    // backend side; renderer is read-only.
        detectSessionInUrl: false,
      },
      global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
      realtime: { params: { eventsPerSecond: 10 } },
    })

    // Tell the realtime client which JWT to send when joining channels —
    // required so RLS sees `auth.uid()` = the signed-in user.
    if (token) _client.realtime.setAuth(token)

    // Start the 30s poller that re-reads session.json (via IPC) and
    // applies the fresh token to this same client whenever it changes.
    // Without this, the JWT goes stale after ~1h and chat dies with
    // "JWT expired" until the user restarts the app.
    ensureRefresher()

    return _client
  })()

  return _initOnce
}


/**
 * Notify the Supabase client that the JWT changed (e.g. user just signed in
 * on a page that previously had no token, or the token got refreshed).
 * Call this from your auth flow after writing the new token to localStorage.
 */
export function refreshSupabaseAuth(): void {
  if (!_client) return
  const token = readToken()
  if (!token) return
  _client.realtime.setAuth(token)
  // Refresh the global headers for HTTP calls. Supabase JS doesn't expose
  // a public setter, so we replace the client on next getSupabase() call.
  _client = null
  _initOnce = null
}
