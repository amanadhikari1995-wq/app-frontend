/**
 * runtime-config.ts — single source of truth for environment-dependent URLs.
 *
 * In a static-export Electron build, NEXT_PUBLIC_* env vars get inlined at
 * build time and CAN'T be changed without rebuilding. To avoid that, Electron's
 * preload script reads `electron/runtime-config.json` and writes the values to
 * `window.__CONFIG__` BEFORE any page script runs. This module reads from there
 * first, then falls through to env vars (dev mode), then to hardcoded defaults.
 *
 * Read order (first non-empty wins):
 *   1. window.__CONFIG__         — Electron preload (runtime-config.json)
 *   2. process.env.NEXT_PUBLIC_* — `next dev` and explicit build-time overrides
 *   3. DEFAULTS                   — last resort, never null/undefined
 *
 * The functions are intentionally re-evaluated on every call so changes to
 * window.__CONFIG__ (e.g. via a settings UI in a future build) take effect
 * without a page reload.
 */

export interface RuntimeConfig {
  /** Local FastAPI backend — bots, trades, AI training, chat WebSocket, logs. */
  apiUrl: string
  /** Website backend — auth, subscription status, /api/auth/me. */
  websiteApiUrl: string
  /**
   * How the frontend talks to the local backend:
   *   'local' — direct HTTP to apiUrl (Electron app on user's PC)
   *   'relay' — tunneled over wss://websiteApiUrl/ws (web dashboard)
   * Auto-detected if not set.
   */
  transport?: 'local' | 'relay'
}

declare global {
  interface Window {
    __CONFIG__?: Partial<RuntimeConfig>
  }
}

const DEFAULTS: RuntimeConfig = {
  apiUrl:        'http://localhost:8000',
  websiteApiUrl: 'https://watchdogbot.cloud',
}

export function getRuntimeConfig(): RuntimeConfig {
  const winCfg = (typeof window !== 'undefined' && window.__CONFIG__) || {}
  const env    = (typeof process !== 'undefined' && process.env) || ({} as NodeJS.ProcessEnv)
  return {
    apiUrl:        winCfg.apiUrl        || env.NEXT_PUBLIC_API_URL         || DEFAULTS.apiUrl,
    websiteApiUrl: winCfg.websiteApiUrl || env.NEXT_PUBLIC_WEBSITE_API_URL || DEFAULTS.websiteApiUrl,
    transport:     (winCfg.transport as 'local' | 'relay' | undefined)
                   || (env.NEXT_PUBLIC_TRANSPORT as 'local' | 'relay' | undefined),
  }
}

export const getApiUrl        = (): string => getRuntimeConfig().apiUrl
export const getWebsiteApiUrl = (): string => getRuntimeConfig().websiteApiUrl

/**
 * Returns 'local' if the frontend should talk directly to apiUrl (Electron),
 * 'relay' if it should tunnel through the cloud relay (web dashboard).
 *
 * Resolution order:
 *   1. explicit `transport` in window.__CONFIG__ or NEXT_PUBLIC_TRANSPORT
 *   2. presence of window.electronAPI    → 'local'  (Electron preload)
 *   3. apiUrl points at localhost/127.*  → 'local'  (dev server)
 *   4. otherwise                         → 'relay'  (deployed website)
 */
export function getTransportMode(): 'local' | 'relay' {
  const cfg = getRuntimeConfig()
  if (cfg.transport === 'local' || cfg.transport === 'relay') return cfg.transport
  if (typeof window !== 'undefined' && (window as unknown as { electronAPI?: unknown }).electronAPI) {
    return 'local'
  }
  if (/^https?:\/\/(localhost|127\.|\[?::1\]?)/i.test(cfg.apiUrl)) {
    // Local API URL set, AND we're not in Electron → still treat as local
    // when running `next dev` against a local FastAPI on the developer's
    // machine. The web dashboard build will set NEXT_PUBLIC_TRANSPORT=relay
    // explicitly to override this.
    if (typeof window !== 'undefined' &&
        /^https?:\/\/(localhost|127\.)/i.test(window.location.origin)) {
      return 'local'
    }
  }
  return 'relay'
}
