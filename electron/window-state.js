/**
 * window-state.js — minimal window position/size persistence.
 *
 * Saves the BrowserWindow's last position, size, and maximized state to a
 * JSON file in app.getPath('userData') and restores it on next launch.
 * Handles the edge cases that always bite naive implementations:
 *   • Saved bounds may be on a monitor that's no longer attached
 *   • Saved size may be larger than the current display
 *   • Maximized state takes precedence over bounds
 *
 * No external dependency — about 60 lines, all-Node.
 */
const { app, screen } = require('electron')
const path = require('path')
const fs   = require('fs')

const DEFAULTS = { width: 1400, height: 900, x: undefined, y: undefined, isMaximized: false }
const FILE_NAME = 'window-state.json'

function statePath() {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function load() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8')
    return Object.assign({}, DEFAULTS, JSON.parse(raw))
  } catch {
    return { ...DEFAULTS }
  }
}

function save(state) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8')
  } catch { /* best-effort — failing here shouldn't crash the app */ }
}

/**
 * Validate that the saved bounds are visible on at least one current display.
 * Without this, the window can open completely off-screen if the user
 * unplugs a monitor between sessions.
 */
function isVisibleOnAnyScreen(bounds) {
  const displays = screen.getAllDisplays()
  return displays.some(d => {
    const a = d.workArea
    return (
      bounds.x + bounds.width  > a.x &&
      bounds.y + bounds.height > a.y &&
      bounds.x < a.x + a.width &&
      bounds.y < a.y + a.height
    )
  })
}

/**
 * Returns BrowserWindow constructor options merged with the restored bounds.
 * Pass the resulting object straight to `new BrowserWindow(...)`. Then call
 * `manage(win)` on the created window to wire up auto-save.
 */
function restore() {
  const s = load()
  const out = { width: s.width, height: s.height }
  if (
    typeof s.x === 'number' &&
    typeof s.y === 'number' &&
    isVisibleOnAnyScreen({ x: s.x, y: s.y, width: s.width, height: s.height })
  ) {
    out.x = s.x
    out.y = s.y
  }
  return { bounds: out, isMaximized: !!s.isMaximized }
}

function manage(win) {
  // Save on every meaningful state change. Debounce so rapid drags don't
  // spam disk writes.
  let timer = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const isMaximized = win.isMaximized()
      const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
      save({ ...bounds, isMaximized })
    }, 400)
  }
  win.on('resize',    schedule)
  win.on('move',      schedule)
  win.on('maximize',  schedule)
  win.on('unmaximize', schedule)
  win.on('close',     () => {
    if (timer) clearTimeout(timer)
    const isMaximized = win.isMaximized()
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    save({ ...bounds, isMaximized })
  })
}

module.exports = { restore, manage }
