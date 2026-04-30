# WATCH-DOG — Desktop App (Frontend)

Next.js 14 dashboard wrapped in Electron, distributed as a single Windows
installer that also bundles the Python backend (see
[`app-backend`](https://github.com/amanadhikari1995-wq/app-backend)).

## Stack

- **UI**: Next.js 14 (App Router) + React 18 + TypeScript + Tailwind CSS
- **Desktop shell**: Electron 32 + electron-builder + NSIS
- **Auto-update**: electron-updater → GitHub Releases
- **Networking**: Axios → relays through a custom WebSocket adapter so the
  same code runs in Electron (HTTP to localhost) and in the web dashboard
  (tunneled to `wd_cloud.py` on the user's PC)

## Folder layout

```
electron/         Main process: spawns Python backend, supervises updater,
                  custom app:// protocol, window state, menus, context menu
src/              Next.js app — pages under src/app/, shared components,
                  hooks, lib code (api client, auth, runtime config)
public/           Static assets (logo, fonts, watchdog-logo.png)
build/            Build resources — icon.png + icon.ico for installer
scripts/          One-shot dev tools:
                    build-web.js     Build /app/ web dashboard
                    deploy-web.js    Build + commit + push web dashboard
                    install-logo.py  Replace all logo files from one source
```

## Common commands

```bash
# dev — UI hot reload, Electron points at localhost:3000
npm run dev

# build the Windows installer (calls electron-builder + NSIS)
npm run dist:win

# rebuild the /app/ web dashboard for the website
npm run build:web

# build + auto commit + push the web dashboard
npm run deploy:web
```

## Releasing a new version

```bash
# 1. bump "version" in package.json
# 2. (if backend changed) rebuild backend exes — see app-backend repo
# 3. build the installer
npm run dist:win

# 4. publish to GitHub Releases — auto-update kicks in for existing users
gh release create v3.5.X dist-electron/WatchDog-Setup-3.5.X.exe \
  dist-electron/WatchDog-Setup-3.5.X.exe.blockmap \
  dist-electron/latest.yml \
  --repo amanadhikari1995-wq/watchdog-website \
  --title "WatchDog v3.5.X" --notes "..."
```

## Auto-update

`electron-updater` polls
[`watchdog-website`](https://github.com/amanadhikari1995-wq/watchdog-website)
GitHub Releases every 4 hours. When a newer version is found, it downloads
in the background and prompts the user to restart. See
[`electron/auto-updater.js`](electron/auto-updater.js).

## Backend integration

On launch, [`electron/backend-runner.js`](electron/backend-runner.js)
spawns the two Python services bundled in `resources/backend/`:

- `watchdog-backend.exe` — FastAPI server on `localhost:8000`
- `watchdog-cloud.exe`   — relay client to `wss://watchdogbot.cloud/ws`

Both are PyInstaller-built from the
[`app-backend`](https://github.com/amanadhikari1995-wq/app-backend) repo.
The runner reads `%LOCALAPPDATA%/WatchDog/.env` for `CLOUD_EMAIL` /
`CLOUD_PASSWORD` and forwards it to the children, plus forces UTF-8
stdout so emoji log lines don't crash on Windows cp1252.
