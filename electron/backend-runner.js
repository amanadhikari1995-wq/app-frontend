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

const RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000]
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
function childEnv() {
  return {
    ...process.env,
    ...readEnvFile(),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8:       '1',
  }
}


// ──────────────────────────────────────────────────────────────────────
//  Path resolution
// ──────────────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to a bundled exe.
 *  - Packaged build:   <install>/resources/backend/<name>
 *  - Unpackaged build: <project>/resources/backend/<name>  (electron-builder --dir)
 *  - Dev:              ../../backend/dist/<name>           (raw PyInstaller output)
 */
function resolveExe(name) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', name)
  }
  // Dev/unpackaged: try the PyInstaller output first, then resources/.
  const devPath  = path.join(__dirname, '..', '..', 'backend', 'dist', name)
  const unpacked = path.join(__dirname, '..', 'resources', 'backend', name)
  if (fs.existsSync(devPath))  return devPath
  if (fs.existsSync(unpacked)) return unpacked
  return devPath  // fall back; spawn() error will surface it
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
    if (this.attempts >= MAX_RESTARTS) {
      console.error(`[${this.label}] crashed too many times (${this.attempts}). Giving up.`)
      return
    }
    const delay = RESTART_BACKOFF_MS[this.attempts] || 30_000
    this.attempts += 1
    console.warn(`[${this.label}] exited (code=${code}); restart in ${delay}ms (attempt ${this.attempts}/${MAX_RESTARTS})`)
    setTimeout(() => { if (!this.stopping) this.start() }, delay)
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
  // Reset crash counter so a fresh login gets the full 5-attempt budget
  cloud.attempts = 0
  cloud.stopping = false
  if (cloud.proc) {
    try { cloud.proc.kill('SIGTERM') } catch { /* already gone */ }
    // Service.onExit will restart it because stopping=false
  } else {
    cloud.start()
  }
}


module.exports = { start, stopAll, restartCloud }
