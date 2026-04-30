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

let _client:    SupabaseClient | null = null
let _initOnce:  Promise<SupabaseClient> | null = null


/** Get the JWT we issued on sign-in. */
function readToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
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
    const token = readToken()

    _client = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,    // we manage our own JWT lifetime
        persistSession:   false,    // ditto — we read from localStorage directly
        detectSessionInUrl: false,
      },
      global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
      realtime: { params: { eventsPerSecond: 10 } },
    })

    // Tell the realtime client which JWT to send when joining channels —
    // required so RLS sees `auth.uid()` = the signed-in user.
    if (token) _client.realtime.setAuth(token)

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
