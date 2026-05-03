/**
 * backend-runner.js — Spawn + supervise the bundled Python services.
 *
 * Responsibilities:
 *   • Locate watchdog-backend.exe and watchdog-cloud.exe (bundled as
 *     extraResources by electron-builder).
 *   • Spawn each as a child process with stdout/stderr piped into the
 *     Electron main-process console (so users can see logs from the
 *     Help → Toggle DevTools → Console panel if needed).
 *   • Restart automatically if a child crashes (exponential back-off,
 *     capped at 30s, ceiling 5 attempts then give up to avoid hot loops).
 *   • Wait for the FastAPI backend to be healthy before resolving — so
 *     the renderer doesn't try to fetch /api/bots before it can answer.
 *   • Kill both processes cleanly on app quit.
 *
 * Dev mode (ELECTRON_DEV=1): does NOTHING. Assumes you're running
 *   `uvicorn` and `wd_cloud.py` manually so you get hot reload.
 */
'use strict'

const { app, net } = require('electron')
const { spawn, execSync } = require('child_process')
const path         = require('path')
const fs           = require('fs')
const os           = require('os')


// ──────────────────────────────────────────────────────────────────────
//  Kill leftover backend / cloud processes from previous launches.
//
//  Symptoms this fixes: every time the user opens WatchDog, a new
//  watchdog-cloud.exe spawns. If they open it 6 times without quitting
//  cleanly (or it crashes the renderer without firing before-quit),
//  Task Manager piles up 6 cloud processes. They all try to log in to
//  Supabase and fight over the same realtime channel.
//
//  Run BEFORE we spawn our own — kills any process whose name matches,
//  EXCEPT our own PID and our PPID (the bootstrap that PyInstaller --
//  onefile leaves around while the real Python child runs).
// ──────────────────────────────────────────────────────────────────────
function killStalePythonServices() {
  if (process.platform !== 'win32') return
  const ourPid = process.pid
  const targets = ['watchdog-backend.exe', 'watchdog-cloud.exe']
  for (const exe of targets) {
    try {
      execSync(
        `taskkill /F /FI "IMAGENAME eq ${exe}" /FI "PID ne ${ourPid}"`,
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      )
      console.log(`[backend-runner] cleared stale ${exe} processes`)
    } catch (e) {
      // taskkill exits 128 when there's nothing to kill — that's fine
      const stderr = (e && e.stderr ? e.stderr.toString() : '').toLowerCase()
      if (!stderr.includes('not found') && !stderr.includes('no tasks')) {
        console.warn(`[backend-runner] taskkill ${exe}:`, stderr || e.message)
      }
    }
  }
}

const isDev = !app.isPackaged && process.env.ELECTRON_DEV === '1'

// Names of the bundled Python exes — built by app/backend/build-exes.bat
// and copied into resources/backend/ by extraResources in package.json.
const BACKEND_EXE = 'watchdog-backend.exe'
const CLOUD_EXE   = 'watchdog-cloud.exe'

// Health probe — backend is "up" when GET /api/health returns 200.
const HEALTH_URL  = 'http://127.0.0.1:8000/api/health'
const HEALTH_TIMEOUT_MS = 30_000          // give it a generous 30s to boot
const HEALTH_INTERVAL_MS = 250

// Backoff schedule for crash respawns (ms). Bumped from 5 attempts to 8
// because a fresh-install antivirus scan can hold the bundled exe for
// 20-40 seconds on the first launch — and giving up after 5 attempts in
// that window means the user sees "backend unreachable" forever even
// though the AV would have released the file shortly after. The final
// 60s slot gives a slow scanner enough time to clear before we quit.
const RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 45_000, 60_000]
const MAX_RESTARTS       = RESTART_BACKOFF_MS.length

// One supervisor per service so they restart independently.
const services = []


// ──────────────────────────────────────────────────────────────────────
//  User-writable data dir + .env loader
// ──────────────────────────────────────────────────────────────────────

/**
 * Returns the per-user data directory used by both the bundled Python
 * services and any local config (.env, logs, DB). Mirrors the path
 * computed in run_backend.py.
 *   Windows: %LOCALAPPDATA%\WatchDog
 *   macOS:   ~/Library/Application Support/WatchDog
 *   Linux:   ~/.local/share/WatchDog
 */
function userDataDir() {
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

/**
 * Read the user's .env file (if any) into a plain object. Tolerates
 * comments, empty lines, KEY=VALUE, and KEY="VALUE WITH SPACES".
 */
function readEnvFile() {
  const envPath = path.join(userDataDir(), '.env')
  if (!fs.existsSync(envPath)) return {}
  const out = {}
  try {
    for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      out[key] = val
    }
    console.log(`[backend-runner] loaded ${Object.keys(out).length} env vars from ${envPath}`)
  } catch (e) {
    console.warn(`[backend-runner] could not read ${envPath}:`, e.message)
  }
  return out
}

/**
 * Combined env passed to spawned services:
 *   1. start with our own process.env (PATH etc)
 *   2. overlay the user's .env (CLOUD_EMAIL/PASSWORD, etc)
 *   3. force PYTHONIOENCODING=utf-8 so the bundled Python can print
 *      Unicode characters (✓, ❌, →, ¢ …) without crashing on the
 *      Windows cp1252 default codepage.
 */
// ──────────────────────────────────────────────────────────────────────
//  Cloud-sync config (step 3 of bot data cloud-sync rollout)
//
//  The Python backend's cloud_client.py needs SUPABASE_URL + SUPABASE_ANON_KEY
//  in its env so it can validate user JWTs and mirror bot CRUD to the cloud.
//  Both values are PUBLIC (the anon key is safe to ship — it only authenticates
//  to Supabase as the "anon" role, which is locked down by RLS).
//
//  We fetch them once from the website's /api/config endpoint at process boot
//  and cache for the rest of the Electron lifetime. If the fetch fails the
//  Python backend silently degrades to local-only mode (no cross-device sync
//  but everything else keeps working).
// ──────────────────────────────────────────────────────────────────────
const WEBSITE_API = process.env.WEBSITE_API_URL || 'https://watchdogbot.cloud'
let _cloudCfg = null
async function loadCloudCfg() {
  if (_cloudCfg !== null) return _cloudCfg
  try {
    const res = await fetch(`${WEBSITE_API}/api/config`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const cfg = await res.json()
    _cloudCfg = {
      SUPABASE_URL:      cfg?.supabase?.url || '',
      SUPABASE_ANON_KEY: cfg?.supabase?.anonKey || '',
    }
    console.log('[backend-runner] loaded cloud config from', WEBSITE_API)
  } catch (e) {
    console.warn('[backend-runner] cloud config fetch failed:', e.message,
                 '— Python backend will run local-only')
    _cloudCfg = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
  }
  return _cloudCfg
}

function childEnv() {
  // _cloudCfg may still be null on the very first spawn before loadCloudCfg
  // resolves — that's fine, the Python side handles missing env gracefully
  // and the next spawn (or restart) will pick up the populated values.
  const cloud = _cloudCfg || { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
  return {
    ...process.env,
    ...readEnvFile(),
    ...cloud,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8:       '1',
  }
}


// ──────────────────────────────────────────────────────────────────────
//  Path resolution
// ──────────────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to a bundled exe.
 *
 * Layout (post-onedir migration):
 *   Packaged: <install>/resources/backend/<exe-stem>/<exe-stem>.exe
 *   Dev:      ../../backend/dist/<exe-stem>/<exe-stem>.exe   (PyInstaller --onedir output)
 *
 * The exe-stem is the name minus '.exe' (e.g. 'watchdog-backend' for
 * 'watchdog-backend.exe'). PyInstaller --onedir produces a folder
 * named after the stem with the exe inside.
 *
 * Falls back to legacy --onefile layout (just <name>.exe in backend/)
 * when the new path doesn't exist, so a stale install with the old
 * file structure still launches.
 */
function resolveExe(name) {
  const stem = name.endsWith('.exe') ? name.slice(0, -4) : name
  const onedirSegment = path.join('backend', stem, name)
  const onefileSegment = path.join('backend', name)

  if (app.isPackaged) {
    const onedir  = path.join(process.resourcesPath, onedirSegment)
    const onefile = path.join(process.resourcesPath, onefileSegment)
    if (fs.existsSync(onedir))  return onedir
    if (fs.existsSync(onefile)) return onefile
    return onedir
  }
  // Dev/unpackaged: try PyInstaller dist first (both layouts), then resources/.
  const candidates = [
    path.join(__dirname, '..', '..', 'backend', 'dist', stem, name),  // dev onedir
    path.join(__dirname, '..', '..', 'backend', 'dist', name),         // dev onefile
    path.join(__dirname, '..', 'resources', onedirSegment),
    path.join(__dirname, '..', 'resources', onefileSegment),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0]
}


// ──────────────────────────────────────────────────────────────────────
//  Service supervisor
// ──────────────────────────────────────────────────────────────────────

class Service {
  constructor(label, exeName) {
    this.label    = label
    this.exeName  = exeName
    this.proc     = null
    this.attempts = 0
    this.stopping = false
  }

  start() {
    const exePath = resolveExe(this.exeName)
    if (!fs.existsSync(exePath)) {
      console.error(`[${this.label}] exe not found at ${exePath}.`)
      console.error(`[${this.label}] run app/backend/build-exes.bat first.`)
      return
    }

    // CRITICAL: do NOT taskkill same-named processes here. (Earlier version
    // of this code did, and it killed the user's running bot — see commit
    // 5463cfc.)
    //
    // INSTEAD: detect-and-skip. If another instance of this exe is already
    // alive on this machine, we don't spawn a new one — the existing one is
    // doing the job. This eliminates the "sibling instance won the race"
    // log noise users were seeing, because no second instance gets spawned
    // in the first place. Source of duplicates was likely Electron multi-
    // process boot ordering or restartCloud IPC firing before the existing
    // service was tracked.
    if (process.platform === 'win32') {
      try {
        const out = execSync(
          `tasklist /FI "IMAGENAME eq ${this.exeName}" /FO CSV /NH`,
          { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, encoding: 'utf8' },
        )
        // tasklist prints "INFO: No tasks..." when nothing matches, OR a CSV
        // line per matching process when something does.
        const matches = out.split('\n').filter(line =>
          line.startsWith(`"${this.exeName}"`),
        )
        if (matches.length > 0) {
          console.log(`[${this.label}] ${matches.length} instance(s) of ${this.exeName} already running — skipping spawn`)
          // Mark this Service as "owning" the existing process so stop()
          // works. We don't have a Process handle for it, but we can no-op
          // on stop and rely on app-quit kill-stale to clean up.
          this.proc = null
          return
        }
      } catch (e) {
        // tasklist failure is non-fatal — fall through to spawn anyway.
        console.warn(`[${this.label}] pre-spawn tasklist check failed:`, e.message)
      }
    }

    console.log(`[${this.label}] spawning ${exePath}`)
    this.proc = spawn(exePath, [], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: childEnv(),    // overlay user .env + force UTF-8 stdout
    })

    this.proc.stdout.on('data', (d) => this._log('out', d))
    this.proc.stderr.on('data', (d) => this._log('err', d))
    this.proc.on('exit', (code, signal) => this._onExit(code, signal))
    this.proc.on('error', (err) => {
      console.error(`[${this.label}] spawn error:`, err.message)
    })
  }

  _log(channel, buf) {
    // Strip ANSI color codes the Python side emits — keeps logs readable
    // when piped into Electron's console.
    const text = buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '').trimEnd()
    if (!text) return
    const tag  = channel === 'err' ? `${this.label} ERR` : this.label
    for (const line of text.split('\n')) console.log(`[${tag}] ${line}`)
  }

  _onExit(code, signal) {
    this.proc = null
    if (this.stopping) {
      console.log(`[${this.label}] stopped (code=${code} signal=${signal})`)
      return
    }
    // Clean exit (code 0) = Python's pre-flight detected a sibling and bailed.
    if (code === 0) {
      console.log(`[${this.label}] exited cleanly (code=0). No respawn.`)
      return
    }
    if (this.attempts >= MAX_RESTARTS) {
      console.error(`[${this.label}] crashed too many times (${this.attempts}). Giving up.`)
      // Mark this Service as permanently failed so the rest of the app
      // (renderer health probe, IPC consumers) can show a real error
      // surface instead of a perpetual "backend unreachable, retrying…"
      // spinner. The renderer pings probeOnce() every 2s anyway; once
      // it sees `failedPermanently` it can swap UI to a clearer panel
      // pointing at backend.log + backend.crash.log.
      this.failedPermanently = true
      try {
        const { app: electronApp, BrowserWindow } = require('electron')
        // Notify all open renderer windows. They can listen via
        //   window.electronAPI.onBackendFailed?.((info) => …)
        // (or main.js can wire an IPC channel — keeping this best-effort).
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('backend:failed-permanently', {
            label:    this.label,
            exeName:  this.exeName,
            attempts: this.attempts,
            crashLogHint: 'Check %LOCALAPPDATA%\\WatchDog\\logs\\backend.crash.log for the failure reason.',
          })
        }
      } catch (e) {
        // Either we're in a headless context or no windows exist yet.
        // Either way, the failure is logged above, so this is just polish.
      }
      return
    }
    const delay = RESTART_BACKOFF_MS[this.attempts] || 30_000
    this.attempts += 1
    console.warn(`[${this.label}] exited (code=${code}); restart in ${delay}ms (attempt ${this.attempts}/${MAX_RESTARTS})`)
    setTimeout(() => {
      if (this.stopping) return
      // Re-check: if another instance is now alive (because the dying
      // proc had a sibling that's still up, or because some other code
      // path spawned one), do NOT add a duplicate. start() itself
      // re-checks too — this is just an early-out to skip the noise.
      if (process.platform === 'win32') {
        try {
          const out = execSync(
            `tasklist /FI "IMAGENAME eq ${this.exeName}" /FO CSV /NH`,
            { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, encoding: 'utf8' },
          )
          const alive = out.split('\n').filter(l => l.startsWith(`"${this.exeName}"`))
          if (alive.length > 0) {
            console.log(`[${this.label}] respawn skipped — ${alive.length} instance(s) of ${this.exeName} already alive`)
            return
          }
        } catch { /* fall through to start() */ }
      }
      this.start()
    }, delay)
  }

  stop() {
    this.stopping = true
    if (!this.proc) return
    try {
      // SIGTERM lets uvicorn flush + close cleanly.
      this.proc.kill('SIGTERM')
      // Force-kill if it ignores SIGTERM after 3s.
      setTimeout(() => {
        if (this.proc && !this.proc.killed) {
          try { this.proc.kill('SIGKILL') } catch { /* already gone */ }
        }
      }, 3_000)
    } catch (e) {
      console.error(`[${this.label}] stop error:`, e.message)
    }
  }
}


// ──────────────────────────────────────────────────────────────────────
//  Health probe — wait for /api/health
// ──────────────────────────────────────────────────────────────────────

function probeOnce() {
  return new Promise((resolve) => {
    const req = net.request({ method: 'GET', url: HEALTH_URL })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      try { req.abort() } catch {}
      resolve(ok)
    }
    req.on('response', (res) => finish(res.statusCode >= 200 && res.statusCode < 500))
    req.on('error', () => finish(false))
    req.on('abort', () => finish(false))
    setTimeout(() => finish(false), 1_500)
    req.end()
  })
}

async function waitForBackend() {
  const start = Date.now()
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    if (await probeOnce()) return true
    await new Promise(r => setTimeout(r, HEALTH_INTERVAL_MS))
  }
  return false
}


// ──────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────

/**
 * Start both services and resolve when the backend is healthy
 * (or the timeout elapses — in that case we let the UI load anyway,
 * and the renderer will retry its own API calls).
 */
async function start() {
  if (isDev) {
    console.log('[backend-runner] ELECTRON_DEV=1 — not spawning bundled exes.')
    console.log('[backend-runner] Run uvicorn / wd_cloud.py manually for hot reload.')
    return
  }

  // Pull cloud-sync config (SUPABASE_URL/ANON_KEY) from the website API so
  // the Python backend can talk to Supabase. Awaited so the first spawn has
  // the env populated; on failure we proceed anyway and Python runs
  // local-only (the assignment in childEnv() handles the empty case).
  await loadCloudCfg()

  // Wipe any backend/cloud processes left over from a crashed previous
  // launch BEFORE we spawn our own. Without this, Task Manager piles up
  // duplicates every time the app reopens uncleanly.
  killStalePythonServices()

  const backend = new Service('backend', BACKEND_EXE)
  const cloud   = new Service('cloud',   CLOUD_EXE)
  services.push(backend, cloud)

  backend.start()
  // Stagger cloud start by 500ms so backend gets the CPU first
  setTimeout(() => cloud.start(), 500)

  const ok = await waitForBackend()
  if (ok) {
    console.log('[backend-runner] backend healthy — UI may proceed.')
  } else {
    console.warn(`[backend-runner] backend not healthy after ${HEALTH_TIMEOUT_MS}ms — letting UI load anyway.`)
  }
}

/**
 * Stop all services. Called from app `before-quit` / `window-all-closed`.
 */
function stopAll() {
  console.log('[backend-runner] stopping all services...')
  for (const s of services) s.stop()
  // Belt-and-braces: a Service whose start() short-circuited via the
  // skip-if-already-running path has proc=null, so its stop() can't kill
  // anything. Do an OS-level taskkill of all bundled exes by name on the
  // way out so users don't see leftover processes after they quit the app.
  if (process.platform === 'win32') {
    for (const exe of [BACKEND_EXE, CLOUD_EXE]) {
      try {
        execSync(
          `taskkill /F /FI "IMAGENAME eq ${exe}" /FI "PID ne ${process.pid}"`,
          { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
        )
      } catch {
        /* nothing to kill — fine */
      }
    }
  }
}


/**
 * Stop just the cloud connector (not the backend) and restart it.
 * Called from main.js when the user signs in / signs out — wd_cloud.py
 * picks up the new session.json on its next start.
 */
function restartCloud() {
  if (isDev) {
    console.log('[backend-runner] restartCloud skipped — dev mode.')
    return
  }
  const cloud = services.find((s) => s.exeName === CLOUD_EXE)
  if (!cloud) {
    console.warn('[backend-runner] no cloud service registered yet — start() must run first')
    return
  }
  console.log('[backend-runner] restarting cloud connector with new session…')
  // Reset crash counter + permanent-failure flag so a fresh login gets a
  // full respawn budget even after the previous instance crash-looped.
  cloud.attempts          = 0
  cloud.failedPermanently = false

  if (!cloud.proc) {
    // Nothing to kill. Just (re)start fresh.
    cloud.stopping = false
    cloud.start()
    return
  }

  // CAREFUL: wd_cloud.py installs SIGTERM/SIGINT handlers that exit
  // gracefully with code 0. Service._onExit treats "code === 0" as
  // "exited cleanly, do NOT respawn" — which is correct for the
  // sibling-detection path (run_backend.py exits 0 when another
  // instance already won the port) but WRONG here, because we WANT
  // it to come back. So we explicitly respawn after SIGTERM has time
  // to flush, and set stopping=true to suppress _onExit's auto-respawn
  // path that would otherwise race with our explicit start().
  cloud.stopping = true
  try { cloud.proc.kill('SIGTERM') } catch { /* already gone */ }
  setTimeout(() => {
    // Re-check: maybe the user signed in/out twice and stop() already
    // ran. In that case `services` array would have been emptied — no-op.
    if (!services.includes(cloud)) return
    cloud.stopping = false
    cloud.start()
  }, 2_000)
}


module.exports = { start, stopAll, restartCloud }
