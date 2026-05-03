/**
 * preload.js — bridges Electron's main process to the renderer (the Next
 * static-export bundle running in the BrowserWindow).
 *
 * Runs in an isolated context BEFORE any page script. Has access to a
 * subset of Node APIs (require, process) but a separate `window` from
 * the page itself. Anything we want to expose to the page must go through
 * `contextBridge.exposeInMainWorld`.
 *
 * Right now we expose exactly one thing:
 *   window.__CONFIG__ = { apiUrl, websiteApiUrl }
 * which the page reads via src/lib/runtime-config.ts.
 *
 * Config travels from main.js → preload via the second arg of
 * webPreferences.additionalArguments (parsed out of process.argv here).
 * That keeps file-system reads centralised in main.js and avoids preload
 * needing to know absolute paths in packaged builds.
 */
const { contextBridge, ipcRenderer } = require('electron')

// Pull the JSON config string out of process.argv. main.js passes it as
// `--runtime-config={...}` so it's easy to grep for and survives packaging.
function readConfigFromArgv() {
  const PREFIX = '--runtime-config='
  const arg = process.argv.find(a => a.startsWith(PREFIX))
  if (!arg) return {}
  try {
    return JSON.parse(arg.slice(PREFIX.length))
  } catch (e) {
    // Bad JSON → fall through to defaults baked into runtime-config.ts
    console.error('[preload] failed to parse --runtime-config:', e)
    return {}
  }
}

const cfg = readConfigFromArgv()

contextBridge.exposeInMainWorld('__CONFIG__', {
  apiUrl:        typeof cfg.apiUrl        === 'string' ? cfg.apiUrl        : undefined,
  websiteApiUrl: typeof cfg.websiteApiUrl === 'string' ? cfg.websiteApiUrl : undefined,
})

// Optional: expose a small electron namespace the renderer can use later
// for things like opening external links in the system browser, native
// menu actions, or auto-updater. Empty for now — Phase 6 will add to it.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform:   process.platform,

  /**
   * Pipe the user's Supabase session to Electron's main process so it can
   * (a) persist it to disk for wd_cloud.py to read, and (b) restart the
   * cloud connector with the fresh token. Called from the login page after
   * /api/auth/login succeeds, and from any place that refreshes the JWT.
   */
  setSession: (session) => ipcRenderer.invoke('wd:set-session', session),

  /** Tell main to clear the session file + kill the cloud connector. */
  clearSession: () => ipcRenderer.invoke('wd:clear-session'),

  /**
   * Subscribe to the 'backend:failed-permanently' event that
   * backend-runner.js fires when its supervisor finally gives up after
   * all respawn attempts. Renderer can use this to swap the perpetual
   * "backend unreachable, retrying…" spinner for a real error panel
   * pointing at backend.crash.log.
   *
   * Returns an unsubscribe function so the caller can clean up.
   *
   *   const off = window.electronAPI.onBackendFailed?.((info) => {
   *     setBackendDown(info)   // info.label, info.exeName, info.attempts, info.crashLogHint
   *   })
   *   return () => off?.()
   */
  onBackendFailed: (cb) => {
    if (typeof cb !== 'function') return () => {}
    const handler = (_event, info) => {
      try { cb(info) } catch (e) { console.error('[onBackendFailed]', e) }
    }
    ipcRenderer.on('backend:failed-permanently', handler)
    return () => ipcRenderer.removeListener('backend:failed-permanently', handler)
  },
})
