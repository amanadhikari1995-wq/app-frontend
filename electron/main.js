/**
 * main.js — Electron main process for WatchDog.
 *
 * Responsibilities:
 *   1. Load runtime-config.json from disk.
 *   2. Create a single BrowserWindow with secure webPreferences.
 *   3. Load the static Next.js export from ../out/index.html in production,
 *      or http://localhost:3000 in dev mode (so you can hot-reload the UI
 *      without re-running `next build`).
 *   4. Pass the runtime config to the renderer via preload + additionalArguments.
 *
 * Security model (matches Electron's official hardening guide):
 *   • contextIsolation: true   — renderer can't touch Node APIs directly
 *   • nodeIntegration: false   — page scripts run in plain browser context
 *   • sandbox:         true    — renderer process is fully sandboxed
 *   • webSecurity:     true    — same-origin policy enforced
 *   • Only the explicit IPC channels exposed via preload are available.
 */
const { app, BrowserWindow, shell, protocol, net, session, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const url  = require('url')
const windowState = require('./window-state')
const { buildMenu } = require('./app-menu')
const { installContextMenu } = require('./context-menu')
const backendRunner = require('./backend-runner')
const autoUpdater   = require('./auto-updater')
const sessionStore  = require('./session-store')

const isDev = !app.isPackaged && process.env.ELECTRON_DEV === '1'

// ── Shared data directory ─────────────────────────────────────────────────────
// MUST match the path computed by backend-runner.js and the Python backend
// (run_backend.py / wd_cloud.py). All three write to the same folder so that
// session.json, the SQLite DB, and log files are co-located and readable by
// every component.
//
// IMPORTANT: Do NOT use app.getPath('userData') here. On Windows that returns
// %APPDATA%\<npm-package-name> (e.g. Roaming\watchdog-frontend), while the
// Python processes use %LOCALAPPDATA%\WatchDog — a completely different path.
// Using app.getPath('userData') means session.json is written to the wrong
// folder and wd_cloud.exe never finds it.
function sharedDataDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(base, 'WatchDog')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'WatchDog')
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(base, 'WatchDog')
}

/* ──────────────────────────────────────────────────────────────────────
   Custom `app://` protocol — serves files from out/ with proper path
   resolution. Required because Next.js generates absolute asset paths
   (/_next/static/chunks/...) which under file:// resolve to the drive
   root and 404. With app://, the protocol handler maps them correctly.
   ────────────────────────────────────────────────────────────────────── */
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: {
      standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true,
  }},
])

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    try {
      const u = new URL(request.url)
      let p = decodeURIComponent(u.pathname || '/')
      // Map directory-style URLs to their index.html
      if (p.endsWith('/')) p += 'index.html'
      else if (!path.extname(p)) p += '/index.html'   // /login → /login/index.html

      const outDir = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar', 'out')
        : path.join(__dirname, '..', 'out')
      const filePath = path.join(outDir, p)

      // Use net.fetch on a file:// URL — Electron handles asar transparently
      return net.fetch(url.pathToFileURL(filePath).toString())
    } catch (e) {
      return new Response('app:// resolve error: ' + e.message, { status: 500 })
    }
  })
}

/* ──────────────────────────────────────────────────────────────────────
   Resolve runtime-config.json path
   ────────────────────────────────────────────────────────────────────── */
function configPath() {
  // In a packaged app, electron-builder will place runtime-config.json
  // alongside the executable as an "extraResources" entry (Phase 4 wires
  // this up). app.getAppPath() points at the asar archive; the resources
  // dir is its parent.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtime-config.json')
  }
  // Dev: read from the file we just wrote
  return path.join(__dirname, 'runtime-config.json')
}

function loadRuntimeConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    const cfg = JSON.parse(raw)
    // Strip _comment and any non-string fields before forwarding
    return {
      apiUrl:        typeof cfg.apiUrl        === 'string' ? cfg.apiUrl        : undefined,
      websiteApiUrl: typeof cfg.websiteApiUrl === 'string' ? cfg.websiteApiUrl : undefined,
    }
  } catch (e) {
    console.warn('[main] runtime-config.json not found / unreadable, using defaults:', e.message)
    return {}
  }
}

/* ──────────────────────────────────────────────────────────────────────
   Create the window
   ────────────────────────────────────────────────────────────────────── */
function createWindow() {
  const cfg = loadRuntimeConfig()

  // Restore saved bounds from disk (or defaults if first launch / off-screen)
  const restored = windowState.restore()

  const win = new BrowserWindow({
    ...restored.bounds,
    minWidth:  1100,
    minHeight: 700,
    backgroundColor: '#05070f',     // matches --bg so no white flash on first paint
    show: false,                     // wait for ready-to-show to avoid flash
    title: 'WatchDog',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
      webSecurity:      true,
      // Pass the runtime config to preload via argv. JSON-serialised so
      // preload can JSON.parse it back. Tagged with a prefix for safety.
      additionalArguments: [`--runtime-config=${JSON.stringify(cfg)}`],
    },
  })

  // Re-apply maximized state after creation (BrowserWindow constructor
  // doesn't accept it directly when bounds are also provided)
  if (restored.isMaximized) win.maximize()

  // Wire up auto-save of position/size on every meaningful change
  windowState.manage(win)

  win.once('ready-to-show', () => win.show())

  /* ──────────────────────────────────────────────────────────────────
     DIAGNOSTIC LOGGING — writes everything that happens in the
     renderer (console messages, page errors, navigation attempts,
     crashes) to userData/diag.log so we can see what's going wrong
     even after the window has been destroyed.
     ────────────────────────────────────────────────────────────────── */
  const diagPath = path.join(app.getPath('userData'), 'diag.log')
  const diag = (msg) => {
    try {
      fs.appendFileSync(diagPath, `${new Date().toISOString()} ${msg}\n`)
    } catch {/* best-effort */}
  }
  // Reset log on each launch so we don't accumulate across sessions
  try { fs.writeFileSync(diagPath, '') } catch {/* ignore */}
  // Unique marker per build — bump this string when shipping a new diagnostic
  // build so the user can verify they're actually running the latest installer.
  const BUILD_MARKER = 'BUILD-2026-04-27-APP-PROTOCOL'
  diag(`=== launch === packaged=${app.isPackaged} platform=${process.platform} marker=${BUILD_MARKER}`)

  // Console-message API changed across Electron versions: old signature is
  // (event, level, message, line, source); new signature is (event) where
  // event has .level/.message/.lineNumber/.sourceId. Handle both.
  win.webContents.on('console-message', function () {
    const args = Array.from(arguments)
    let level, message, line, source
    if (args.length >= 5) {
      level   = args[1]
      message = args[2]
      line    = args[3]
      source  = args[4]
    } else if (args[0] && typeof args[0] === 'object') {
      const e = args[0]
      level   = e.level
      message = e.message
      line    = e.lineNumber
      source  = e.sourceId
    }
    diag(`console[${level ?? '?'}] ${message ?? '(no msg)'} (${source ?? '?'}:${line ?? '?'})`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    diag(`did-fail-load url=${url} code=${code} desc=${desc}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    diag(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })
  win.webContents.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    if (isMainFrame) diag(`did-start-navigation url=${url} inPlace=${isInPlace}`)
  })
  win.webContents.on('did-navigate', (_e, url) => diag(`did-navigate url=${url}`))
  win.on('closed', () => diag('window closed'))

  // Light error capture — just enough to debug if something goes wrong in
  // production. Diagnostic readback removed (was a debugging aid for the
  // file:// hydration issue, no longer needed since app:// works).
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`
      window.addEventListener('error', e => {
        try { console.error('[WD-ERROR] ' + (e.error && e.error.stack || e.message)) } catch(_){}
      })
      window.addEventListener('unhandledrejection', e => {
        try { console.error('[WD-REJECT] ' + (e.reason && e.reason.stack || e.reason)) } catch(_){}
      })
    `, true).catch(() => { /* best effort */ })
  })

  // Load URL — dev server in dev, app:// custom protocol in production
  if (isDev) {
    win.loadURL('http://localhost:3000')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // app:// is registered above; "./" is the host placeholder, then the
    // protocol handler resolves /index.html, /login/, /_next/..., etc.
    win.loadURL('app://./')
  }

  // Open external links (http/https) in the user's default browser instead
  // of replacing the app's own page. Same security posture as a real desktop
  // app — clicking a link to https://watchdogbot.cloud opens the browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      shell.openExternal(target)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // Block top-level navigations to off-app origins. The app should only
  // navigate within app:// (production), file:// (legacy), or localhost (dev).
  win.webContents.on('will-navigate', (event, target) => {
    const allowed = isDev
      ? target.startsWith('http://localhost:3000')
      : (target.startsWith('app://') || target.startsWith('file://'))
    if (!allowed) {
      event.preventDefault()
      shell.openExternal(target)
    }
  })

  return win
}

/* ──────────────────────────────────────────────────────────────────────
   App lifecycle
   ────────────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────────────
   CORS BYPASS — inject permissive Access-Control-* headers on every
   response from localhost so the renderer (origin `app://`) can talk to
   the local FastAPI backend without it explicitly allowlisting `app://`.
   Also turns 4xx OPTIONS preflight responses into 200s (FastAPI without
   CORSMiddleware returns 405 for OPTIONS, which otherwise breaks every
   fetch that uses an Authorization header or JSON body).
   ────────────────────────────────────────────────────────────────────── */
function installCorsBypass() {
  const filter = { urls: [
    'http://localhost:*/*',
    'http://127.0.0.1:*/*',
    'ws://localhost:*/*',
    'ws://127.0.0.1:*/*',
  ]}
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...(details.responseHeaders || {}) }
    // Strip any existing CORS headers (case-insensitive) so we don't double up
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase().startsWith('access-control-')) delete headers[k]
    }
    headers['Access-Control-Allow-Origin']      = ['*']
    headers['Access-Control-Allow-Methods']     = ['GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD']
    headers['Access-Control-Allow-Headers']     = ['*']
    headers['Access-Control-Allow-Credentials'] = ['true']
    headers['Access-Control-Max-Age']           = ['3600']

    // Force OPTIONS preflight responses to look successful even if the
    // backend returned 405 / 404 (no CORS middleware configured).
    let statusLine = details.statusLine
    if (details.method === 'OPTIONS') {
      statusLine = 'HTTP/1.1 200 OK'
    }
    callback({ responseHeaders: headers, statusLine })
  })
}

// ──────────────────────────────────────────────────────────────────────
//  IPC: session management — pipes the renderer's Supabase JWT through
//  to the cloud connector. Called from src/app/login/page.tsx on
//  successful login. See electron/session-store.js for the on-disk
//  schema.
// ──────────────────────────────────────────────────────────────────────
ipcMain.handle('wd:set-session', async (_event, raw) => {
  try {
    if (!raw || typeof raw !== 'object' || !raw.access_token) {
      return { ok: false, error: 'invalid session payload' }
    }
    const written = sessionStore.write(sharedDataDir(), raw)
    console.log('[main] session persisted for user', written.user_id, 'email', written.email)
    // Bounce the cloud connector so it re-reads session.json with the
    // new token. Backend stays up — that runs against localhost only and
    // doesn't care about the user's cloud identity.
    backendRunner.restartCloud()
    return { ok: true, saved_at: written.saved_at }
  } catch (e) {
    console.error('[main] wd:set-session failed:', e)
    return { ok: false, error: e.message }
  }
})

// Returns the always-fresh access_token from session.json. The Python
// sync_engine already keeps this file refreshed every ~minute when the JWT
// is about to expire, so renderers can poll us instead of running their
// own refresh logic — which would race with sync_engine and produce
// "refresh_token already used" errors from Supabase.
//
// Used by src/lib/supabase.ts to keep the renderer's Supabase client
// authenticated long after the JWT it had at startup has expired.
ipcMain.handle('wd:get-current-token', async () => {
  try {
    const sess = sessionStore.read(sharedDataDir())
    return sess?.access_token || null
  } catch (e) {
    console.warn('[main] wd:get-current-token failed:', e.message)
    return null
  }
})

ipcMain.handle('wd:clear-session', async () => {
  try {
    sessionStore.clear(sharedDataDir())
    console.log('[main] session cleared')
    backendRunner.restartCloud()
    return { ok: true }
  } catch (e) {
    console.error('[main] wd:clear-session failed:', e)
    return { ok: false, error: e.message }
  }
})


// ──────────────────────────────────────────────────────────────────────
//  SINGLE-INSTANCE LOCK
// ──────────────────────────────────────────────────────────────────────
// Without this lock, double-clicking the WatchDog icon, hitting the
// Start menu twice, or auto-update relaunching mid-session creates a
// SECOND app instance. Each instance runs backendRunner.start() →
// killStalePythonServices() → kills the OTHER instance's bundled
// Python services → spawns its own. Race condition produces zombie
// backend processes and was the actual cause of users seeing
// "sibling won the race" messages plus duplicate processes.
//
// requestSingleInstanceLock() makes the second launch attempt fail
// gracefully (we focus the existing window instead) — guaranteeing
// exactly one backendRunner per machine.
const __gotLock = app.requestSingleInstanceLock()
if (!__gotLock) {
  console.log('[main] another WatchDog instance is already running — exiting this one.')
  app.quit()
} else {
  app.on('second-instance', () => {
    // A second launch attempt: just bring our existing window to the front.
    const wins = require('electron').BrowserWindow.getAllWindows()
    const win = wins[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(async () => {
  // CRITICAL: re-check the single-instance lock here. The lock is
  // requested at module-load time, but app.whenReady fires regardless
  // of whether app.quit() has been called. Without this guard, a
  // second-instance launch races to spawn its own backend before its
  // own quit propagates, causing the "sibling won the race" message
  // 3+ minutes after first launch.
  if (!__gotLock) {
    console.log('[main] whenReady aborted — second-instance lock not held')
    return
  }

  registerAppProtocol()    // must be done after app ready, before first load
  installCorsBypass()      // make localhost API calls work regardless of backend CORS config

  // Spawn the bundled Python backend + cloud connector. In packaged
  // builds these are the .exes produced by app/backend/build-exes.bat.
  // In dev (ELECTRON_DEV=1) this is a no-op — you run them manually.
  // We don't `await` here because the splash screen / window can render
  // while the backend boots; the renderer's own API calls will retry
  // on failure until the backend answers.
  backendRunner.start().catch(err => {
    console.error('[main] backend-runner.start failed:', err)
  })

  // Background update checker — only does anything in a packaged build.
  // Polls GitHub Releases on the repo configured in package.json `publish`.
  autoUpdater.setup()

  const win = createWindow()
  // Native menu — also restores cut/copy/paste keyboard shortcuts that
  // Electron loses without an explicit menu, plus DevTools toggle.
  buildMenu(win)
  // Right-click context menu (Cut/Copy/Paste/Select All) on every input
  // and selectable area. Electron has no default context menu — without
  // this listener, right-click does nothing.
  installContextMenu(win)

  // macOS: re-create a window when the dock icon is clicked and there are
  // no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow()
      buildMenu(newWin)
      installContextMenu(newWin)
    }
  })
})

// Stop the bundled Python services BEFORE the app fully quits so they
// get a chance to flush state and close DB connections cleanly. SIGTERM
// goes out first, SIGKILL after 3s if they ignore it.
app.on('before-quit', () => {
  backendRunner.stopAll()
})

// Quit when all windows are closed except on macOS, where it's standard
// for apps to stay active until the user explicitly quits with Cmd+Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Disable navigating webContents to a new origin via webview tag (defense
// in depth — we don't use webview, but explicit denial is safer).
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
})
