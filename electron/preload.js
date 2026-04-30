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
const { contextBridge } = require('electron')

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
})
