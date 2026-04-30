/**
 * auto-updater.js — Background update checker.
 *
 * Wraps `electron-updater` so the rest of the app doesn't have to know
 * how it works. Behavior:
 *
 *   1. On app boot, check GitHub Releases for a newer version (silently).
 *   2. If found, download in the background.
 *   3. When the download finishes, ask the user once: "Update available —
 *      restart now to install, or later." Restart applies the update.
 *   4. Repeat the check every 4 hours while the app is running, so a
 *      user who never restarts still gets the update within a day.
 *
 * The updater pulls metadata from the GitHub repo configured in
 * package.json -> build.publish. The repo must publish releases that
 * include both the .exe AND the .yml manifest produced by
 * electron-builder (latest.yml, latest-mac.yml, latest-linux.yml).
 *
 * Errors are logged but never thrown — the app must still start cleanly
 * even if GitHub is unreachable, the network is down, or the repo has
 * no releases yet.
 */
'use strict'

const { app, dialog, BrowserWindow } = require('electron')

let autoUpdater
try {
  // electron-updater is in dependencies; require lazily so the rest of
  // the app survives if for some reason it isn't installed (e.g. local
  // dev box that hasn't run `npm install` yet).
  ({ autoUpdater } = require('electron-updater'))
} catch (e) {
  console.warn('[auto-updater] electron-updater not installed:', e.message)
  autoUpdater = null
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000   // 4 hours

let promptShown = false      // don't pop the dialog twice for the same download


function setup() {
  if (!autoUpdater) return
  if (!app.isPackaged) {
    // Updater only does anything in a packaged build — skip in dev so
    // local runs don't spam the GitHub API.
    console.log('[auto-updater] skipped (running unpackaged / dev mode)')
    return
  }

  autoUpdater.autoDownload          = true     // download as soon as we find one
  autoUpdater.autoInstallOnAppQuit  = true     // install on next app close

  autoUpdater.on('checking-for-update', () => {
    console.log('[auto-updater] checking for update')
  })
  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] update available:', info.version)
  })
  autoUpdater.on('update-not-available', (info) => {
    console.log('[auto-updater] up-to-date:', info.version)
  })
  autoUpdater.on('error', (err) => {
    console.warn('[auto-updater] error:', err && err.message ? err.message : err)
  })
  autoUpdater.on('download-progress', (p) => {
    console.log(`[auto-updater] downloading ${Math.round(p.percent)}% — ${Math.round(p.bytesPerSecond / 1024)} KB/s`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] update downloaded:', info.version)
    if (promptShown) return
    promptShown = true
    promptUserToRestart(info)
  })

  // First check immediately, then every CHECK_INTERVAL_MS
  autoUpdater.checkForUpdates().catch(noop)
  setInterval(() => autoUpdater.checkForUpdates().catch(noop), CHECK_INTERVAL_MS)
}


function promptUserToRestart(info) {
  // Show the modal on the focused window if there is one, otherwise
  // attach to whichever main window exists.
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null

  dialog.showMessageBox(win, {
    type:    'info',
    title:   'Update ready',
    message: `WatchDog ${info.version} is ready to install.`,
    detail:  'Restart now to apply the update, or it will install automatically the next time you quit WatchDog.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId:  1,
  }).then(({ response }) => {
    if (response === 0) autoUpdater.quitAndInstall()
  }).catch(err => {
    console.warn('[auto-updater] dialog error:', err.message)
  })
}


function noop() { /* swallow rejections — they're already logged */ }


module.exports = { setup }
