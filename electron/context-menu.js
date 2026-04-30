/**
 * context-menu.js — right-click context menu for every BrowserWindow.
 *
 * Electron does NOT show a default context menu on right-click — this is
 * different from a regular browser. Without explicit wiring, users can't
 * right-click an input/textarea/log line and get Cut/Copy/Paste/Select All.
 *
 * This module installs a single `context-menu` listener on a window's
 * webContents. The menu shown depends on what the user right-clicked:
 *
 *   • In an editable field (input, textarea, contenteditable):
 *     Undo, Redo, Cut, Copy, Paste, Delete, Select All
 *   • On selected text in a non-editable area (logs, labels, etc.):
 *     Copy, Select All
 *   • On nothing meaningful (empty area):
 *     menu is suppressed — feels native
 *   • In dev mode: Inspect Element is appended for debugging
 *
 * The menu items use Electron `role` strings, which means Electron handles
 * the actual cut/copy/paste/etc. behaviour and correctly enables/disables
 * each item based on selection and clipboard state.
 */
const { Menu, MenuItem, app } = require('electron')

function installContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const isEditable     = !!params.isEditable
    const hasSelection   = !!params.selectionText && params.selectionText.trim().length > 0
    const isLink         = !!params.linkURL
    const items          = []

    if (isLink) {
      items.push(new MenuItem({
        label: 'Copy Link',
        click: () => {
          require('electron').clipboard.writeText(params.linkURL)
        },
      }))
      items.push(new MenuItem({ type: 'separator' }))
    }

    if (isEditable) {
      // Editable field — full Cut/Copy/Paste/etc. set
      items.push(new MenuItem({ role: 'undo',      label: 'Undo' }))
      items.push(new MenuItem({ role: 'redo',      label: 'Redo' }))
      items.push(new MenuItem({ type: 'separator' }))
      items.push(new MenuItem({ role: 'cut',       label: 'Cut',   enabled: hasSelection }))
      items.push(new MenuItem({ role: 'copy',      label: 'Copy',  enabled: hasSelection }))
      items.push(new MenuItem({ role: 'paste',     label: 'Paste' }))
      items.push(new MenuItem({ role: 'delete',    label: 'Delete', enabled: hasSelection }))
      items.push(new MenuItem({ type: 'separator' }))
      items.push(new MenuItem({ role: 'selectAll', label: 'Select All' }))
    } else if (hasSelection) {
      // Non-editable area but text is selected — allow Copy + Select All
      items.push(new MenuItem({ role: 'copy',      label: 'Copy' }))
      items.push(new MenuItem({ role: 'selectAll', label: 'Select All' }))
    }

    // Inspect Element — only in dev mode, never in shipped builds
    if (!app.isPackaged) {
      if (items.length > 0) items.push(new MenuItem({ type: 'separator' }))
      items.push(new MenuItem({
        label: 'Inspect Element',
        click: () => win.webContents.inspectElement(params.x, params.y),
      }))
    }

    if (items.length === 0) return    // nothing to show — don't pop an empty menu

    const menu = Menu.buildFromTemplate(items)
    menu.popup({ window: win })
  })
}

module.exports = { installContextMenu }
