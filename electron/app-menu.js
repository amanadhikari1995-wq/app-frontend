/**
 * app-menu.js — native application menu.
 *
 * Without an explicit menu, Electron's renderer LOSES default keyboard
 * shortcuts for cut/copy/paste/select-all/undo/redo. Users will type
 * Ctrl+C in an input and nothing happens. This menu fixes that AND adds
 * the standard File/View/Window/Help structure users expect.
 *
 * Includes a production-friendly DevTools toggle (Ctrl+Shift+I) for
 * support troubleshooting.
 */
const { Menu, shell, app } = require('electron')

const isMac = process.platform === 'darwin'

function buildMenu(mainWindow) {
  const template = [
    // macOS app menu (must be first on Mac, omitted elsewhere)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),

    // File
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Edit — restores cut/copy/paste shortcuts that Electron loses without a menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
              },
            ]
          : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' },
            ]),
      ],
    },

    // View — Reload / DevTools / Zoom / Fullscreen
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        // DevTools toggle works in BOTH dev and production builds — useful
        // for support diagnostics ("open Help → DevTools and tell me what
        // the Network tab shows").
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.toggleDevTools()
            }
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
          : [{ role: 'close' }]),
      ],
    },

    // Help
    {
      role: 'help',
      submenu: [
        {
          label: 'Open watchdogbot.cloud',
          click: () => shell.openExternal('https://watchdogbot.cloud'),
        },
        {
          label: 'About WatchDog',
          click: () => {
            // Minimal about dialog — replace with a real BrowserWindow in
            // Phase 7 if you want a branded modal.
            const { dialog } = require('electron')
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About WatchDog',
              message: 'WatchDog',
              detail: `Version ${app.getVersion()}\nUniversal AI Bot Platform\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
              buttons: ['OK'],
            })
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

module.exports = { buildMenu }
