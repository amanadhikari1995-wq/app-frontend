/**
 * relay-adapter.ts — Axios adapter that tunnels HTTP calls through the relay.
 *
 * When the frontend is running in a browser (web dashboard), calls to
 * `botsApi.getLogs(5)` etc. should NOT hit the network directly — the user's
 * local FastAPI is unreachable from the public internet. Instead, we ship
 * the request over the WebSocket relay to wd_cloud.py on the user's PC,
 * which replays it against http://localhost:8000.
 *
 * From Axios's point of view this looks identical to a real HTTP call —
 * same config in, same AxiosResponse out. Component code (the per-bot
 * dashboard, settings page, log viewers) doesn't change at all.
 */
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { relayClient } from './relay-client'

/**
 * Build the path string an Axios call would have produced,
 * including query parameters from `config.params`.
 */
function buildPath(config: AxiosRequestConfig): string {
  let url = config.url || ''
  // Strip baseURL if it leaked in — relay paths must be relative to localhost
  if (config.baseURL && url.startsWith(config.baseURL)) {
    url = url.slice(config.baseURL.length)
  }
  if (!url.startsWith('/')) url = '/' + url

  const params = config.params as Record<string, unknown> | undefined
  if (params && typeof params === 'object') {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue
      qs.append(k, String(v))
    }
    const s = qs.toString()
    if (s) url += (url.includes('?') ? '&' : '?') + s
  }
  return url
}

export const relayAdapter: AxiosAdapter = async (config) => {
  const method = (config.method || 'GET').toUpperCase()
  const path   = buildPath(config)

  // FormData / multipart is not yet supported over the relay tunnel.
  // Surface a clear error rather than silently dropping the body.
  if (config.data instanceof FormData) {
    return Promise.reject(Object.assign(new Error(
      'File uploads are not supported in the web dashboard yet. ' +
      'Please use the desktop app for this action.'
    ), { config, response: { status: 501, data: { error: 'multipart not supported' }, statusText: 'Not Implemented', headers: {}, config } }))
  }

  // Axios's default transformRequest serializes JSON bodies to a STRING
  // before the adapter is called. Detect that and parse back to an object
  // so wd_cloud.py's httpx call can re-encode it as real JSON, not a
  // double-encoded string.
  let body: unknown = config.data ?? undefined
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { body = JSON.parse(trimmed) } catch { /* leave as-is for non-JSON strings */ }
    }
  }
  const resp = await relayClient.request(method, path, body)

  const axiosResp: AxiosResponse = {
    data:       resp.data,
    status:     resp.status || 0,
    statusText: resp.error || (resp.status >= 200 && resp.status < 300 ? 'OK' : 'Error'),
    headers:    {},
    config:     config as unknown as AxiosResponse['config'],
    request:    null,
  }

  // Mirror Axios's default behavior — reject on non-2xx so that .catch()
  // in component code fires, and the global 401 interceptor still works.
  const validate = config.validateStatus || ((s: number) => s >= 200 && s < 300)
  if (!validate(axiosResp.status)) {
    const err: Error & { config?: unknown; response?: AxiosResponse; isAxiosError?: boolean } = new Error(
      resp.error || `Request failed with status code ${axiosResp.status}`
    )
    err.config = config
    err.response = axiosResp
    err.isAxiosError = true
    throw err
  }

  return axiosResp
}
