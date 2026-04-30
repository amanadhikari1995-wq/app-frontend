/**
 * app-nav.ts — Electron-aware navigation helpers.
 *
 * Under http(s) (next dev, hosted website) the app's routes are absolute
 * paths like `/login` that the server resolves. Under file:// (Electron
 * static export), there's no server — the browser literally looks for the
 * file path on disk, so `/login` becomes `file:///login` (drive root) and
 * 404s, which can crash the renderer.
 *
 * These helpers detect the protocol and produce a URL that works in both
 * contexts. Use them in place of `router.replace('/login')` or
 * `window.location.href = '/login'` anywhere a hard navigation is needed.
 */

/** Build a URL to one of the static export's top-level routes. */
function resolveAppRoute(route: string, qs: string): string {
  if (typeof window === 'undefined') return `/${route}${qs}`
  const u = new URL(window.location.href)

  // app:// (Electron production) — the protocol handler maps the path to
  // out/<route>/index.html, so just use absolute paths from app root.
  if (u.protocol === 'app:') {
    return `app://./${route}/${qs}`
  }

  // file:// (legacy fallback) — walk up to /out/ then build absolute URL
  if (u.protocol === 'file:') {
    const m = u.pathname.match(/^(.*\/out)\//)
    if (m) return `${u.protocol}//${u.host}${m[1]}/${route}/index.html${qs}`
    return new URL(`./${route}/index.html${qs}`, window.location.href).href
  }

  // http(s): server handles the route. Prepend basePath if Next.js was
  // built with one (web dashboard at /app/). NEXT_PUBLIC_BASE_PATH is
  // inlined at build time — empty for Electron, '/app' for the website
  // build. Falls back to deriving from window.location for safety.
  const fromEnv = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const fromUrl = typeof window !== 'undefined'
    ? (window.location.pathname.match(/^(\/app)(?:\/|$)/)?.[1] ?? '')
    : ''
  const basePath = fromEnv || fromUrl
  return `${basePath}/${route}${qs}`
}

export function gotoLogin(opts: { reason?: string; from?: string } = {}) {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams()
  if (opts.reason) params.set('reason', opts.reason)
  if (opts.from && opts.from !== '/') params.set('from', opts.from)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const url = resolveAppRoute('login', qs)
  window.location.replace(url)
}

export function gotoDashboard() {
  if (typeof window === 'undefined') return
  window.location.replace(resolveAppRoute('dashboard', ''))
}
