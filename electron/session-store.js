/**
 * session-store.js — single source of truth for the Supabase session.
 *
 * The Electron main process owns this file. Two readers:
 *   1. The renderer (via IPC `wd:set-session` / `wd:clear-session`)
 *   2. wd_cloud.py running as a child process (reads the JSON directly)
 *
 * Why a file instead of just an env var:
 *   • Tokens expire after 1 hour. wd_cloud.py needs to refresh them. After
 *     refresh, it writes the new tokens back to disk so the renderer (on
 *     next read / restart) sees the same fresh tokens.
 *   • Survives Electron restarts. User signs in once, app remembers them.
 *   • Avoids having to round-trip through IPC every time wd_cloud.py
 *     wakes up to refresh.
 *
 * Path: <userData>/session.json   (e.g. %LOCALAPPDATA%/WatchDog/session.json)
 *
 * Schema:
 *   {
 *     "access_token":  "eyJ...",
 *     "refresh_token": "...",         (may be null in legacy installs)
 *     "expires_at":    1730483200,    (unix seconds)
 *     "user_id":       "uuid",
 *     "email":         "user@example.com",
 *     "saved_at":      "2026-04-30T22:00:00.000Z"
 *   }
 *
 * On Windows we leave the file plain JSON (the user data dir is per-user
 * profile-protected by NTFS ACLs). For belt-and-braces we could swap to
 * Electron's safeStorage in a follow-up — every byte still ends up on disk
 * either way, so the threat model is "another user on the same Windows
 * account", which `safeStorage` doesn't actually protect against.
 */
'use strict'

const path = require('path')
const fs   = require('fs')

const FILE_NAME = 'session.json'


function sessionPath(userDataDir) {
  return path.join(userDataDir, FILE_NAME)
}


function read(userDataDir) {
  const p = sessionPath(userDataDir)
  if (!fs.existsSync(p)) return null
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    if (!obj.access_token) return null
    return obj
  } catch (e) {
    console.warn('[session-store] read error:', e.message)
    return null
  }
}


function write(userDataDir, session) {
  if (!session || !session.access_token) {
    throw new Error('session-store.write: access_token is required')
  }
  const out = {
    access_token:  String(session.access_token),
    refresh_token: session.refresh_token ? String(session.refresh_token) : null,
    expires_at:    typeof session.expires_at === 'number'
                     ? session.expires_at
                     : Math.floor(Date.now() / 1000) + 3600,   // 1h default
    user_id:       session.user_id ? String(session.user_id) : null,
    email:         session.email   ? String(session.email)   : null,
    saved_at:      new Date().toISOString(),
  }
  const p = sessionPath(userDataDir)
  fs.mkdirSync(userDataDir, { recursive: true })
  // Write atomically — never leave a half-written file behind that wd_cloud.py
  // might try to parse mid-update.
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, p)
  return out
}


function clear(userDataDir) {
  const p = sessionPath(userDataDir)
  try { fs.rmSync(p, { force: true }) } catch { /* ignore */ }
}


module.exports = { sessionPath, read, write, clear }
