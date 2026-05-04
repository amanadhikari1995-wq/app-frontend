/**
 * relay-client.ts — Browser-side WebSocket client for the cloud relay.
 *
 * In the deployed web dashboard the same React/Next.js code that runs in
 * Electron has no localhost FastAPI to talk to. Instead, every API call
 * is tunneled over a single WebSocket to wss://watchdogbot.cloud/ws,
 * which forwards it to wd_cloud.py on the user's PC, which executes
 * the call against the real http://localhost:8000 backend.
 *
 * This module owns:
 *   - the singleton WebSocket (one per page load)
 *   - request/response correlation by request_id
 *   - reconnection with exponential back-off
 *   - desktop online/offline state broadcast to listeners
 *   - generic event subscription (Phase 3)
 *
 * The transport is intentionally a black box — `lib/api.ts` swaps in an
 * Axios adapter that calls `relayClient.request()` and gets back something
 * that looks exactly like a real HTTP response.
 */
import { getWebsiteApiUrl } from './runtime-config'
import { getToken } from './auth'

export interface RelayResponse {
  status: number
  data: unknown
  error: string | null
}

type Pending = {
  resolve: (resp: RelayResponse) => void
  reject:  (err: Error) => void
  timer:   ReturnType<typeof setTimeout>
}

type DesktopStateListener = (online: boolean) => void
type EventListener        = (data: unknown) => void

const REQUEST_TIMEOUT_MS    = 25_000
const RECONNECT_BASE_MS     = 1_000
const RECONNECT_MAX_MS      = 30_000

class RelayClient {
  private ws: WebSocket | null = null
  private connecting = false
  private shouldRun = false
  private reconnectDelay = RECONNECT_BASE_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private pending = new Map<string, Pending>()
  private subs    = new Map<string, Set<EventListener>>()
  private desktopListeners = new Set<DesktopStateListener>()

  private _desktopOnline = false

  /** Returns the current online state of the user's desktop, based on the
   *  most recent `desktop_state` message from the relay. */
  get desktopOnline(): boolean { return this._desktopOnline }

  /** Establish (or re-use) a connection. Idempotent; safe to call from
   *  React effects on every mount. */
  connect(): void {
    if (typeof window === 'undefined') return  // SSR no-op
    this.shouldRun = true
    if (this.ws && (this.ws.readyState === WebSocket.OPEN ||
                    this.ws.readyState === WebSocket.CONNECTING)) return
    if (this.connecting) return
    this._open()
  }

  /** Close the connection and cancel reconnection. Pending requests reject.
   *
   * Full teardown — safe to call on user logout.  After this returns the
   * client is in an identical state to a brand-new construction so the next
   * `connect()` (called e.g. by the first request after a new login) opens a
   * fresh WebSocket authenticated as the new user.
   */
  disconnect(): void {
    this.shouldRun = false
    this.connecting = false      // let the next connect() call pass the guard
    this.reconnectDelay = RECONNECT_BASE_MS   // reset backoff so new user doesn't wait
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.ws) {
      try { this.ws.close() } catch { /* already closed */ }
      this.ws = null
    }
    // Reject all in-flight requests so callers don't hang
    Array.from(this.pending.values()).forEach((p) => {
      clearTimeout(p.timer)
      p.reject(new Error('Relay disconnected'))
    })
    this.pending.clear()

    // Clear topic subscriptions — they belong to the previous user's session.
    // Components re-subscribe when they remount in the new user's session.
    this.subs.clear()

    // Reset desktop state synchronously so listeners see offline immediately,
    // rather than waiting for the async WebSocket close event to fire.
    if (this._desktopOnline) {
      this._desktopOnline = false
      Array.from(this.desktopListeners).forEach((l) => l(false))
    }
  }

  /**
   * Send an arbitrary HTTP-shaped request through the relay. Returns a
   * promise that resolves with the desktop's response (or rejects on
   * timeout / disconnection).
   */
  request(method: string, path: string, body?: unknown): Promise<RelayResponse> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        return reject(new Error('relay request attempted during SSR'))
      }
      this.connect()  // ensure socket is alive

      const request_id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)

      const timer = setTimeout(() => {
        const p = this.pending.get(request_id)
        if (p) {
          this.pending.delete(request_id)
          reject(new Error(`Relay request timed out after ${REQUEST_TIMEOUT_MS}ms`))
        }
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(request_id, { resolve, reject, timer })

      const payload = {
        type: 'rpc_request',
        request_id,
        method: method.toUpperCase(),
        path,
        body: body ?? null,
      }

      this._send(payload).catch((err) => {
        // _send queues if the socket isn't open yet — only fails on hard error
        const p = this.pending.get(request_id)
        if (p) {
          clearTimeout(p.timer)
          this.pending.delete(request_id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
  }

  /** Subscribe to a topic — placeholder for Phase 3 streaming. */
  subscribe(topic: string, listener: EventListener): () => void {
    let set = this.subs.get(topic)
    if (!set) { set = new Set(); this.subs.set(topic, set) }
    set.add(listener)
    void this._send({ type: 'subscribe', topic })
    return () => {
      const s = this.subs.get(topic)
      if (s) { s.delete(listener); if (s.size === 0) {
        this.subs.delete(topic)
        void this._send({ type: 'unsubscribe', topic })
      } }
    }
  }

  /** Listen for desktop online/offline transitions. */
  onDesktopState(listener: DesktopStateListener): () => void {
    this.desktopListeners.add(listener)
    listener(this._desktopOnline)  // fire immediately with current state
    return () => { this.desktopListeners.delete(listener) }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async _send(payload: unknown): Promise<void> {
    // Wait up to 5s for the socket to be ready before giving up
    const start = Date.now()
    while (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (Date.now() - start > 5_000) throw new Error('Relay socket not connected')
      await new Promise((r) => setTimeout(r, 50))
    }
    this.ws.send(JSON.stringify(payload))
  }

  private _open(): void {
    if (this.connecting) return
    this.connecting = true

    const token = getToken()
    if (!token) {
      // No JWT yet — schedule a retry; the user is probably mid-login.
      this.connecting = false
      this._scheduleReconnect()
      return
    }

    const wsBase = getWebsiteApiUrl().replace(/^http/i, 'ws')
    const url = `${wsBase}/ws?role=browser&token=${encodeURIComponent(token)}`

    let ws: WebSocket
    try { ws = new WebSocket(url) } catch (e) {
      this.connecting = false
      console.warn('[relay] WebSocket constructor threw:', e)
      this._scheduleReconnect()
      return
    }
    this.ws = ws

    ws.addEventListener('open', () => {
      this.connecting = false
      this.reconnectDelay = RECONNECT_BASE_MS
      console.info('[relay] connected')
      // Re-issue any active subscriptions on reconnect
      Array.from(this.subs.keys()).forEach((topic) => {
        ws.send(JSON.stringify({ type: 'subscribe', topic }))
      })
    })

    ws.addEventListener('message', (ev) => {
      let msg: { type?: string;[k: string]: unknown }
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}') }
      catch { return }

      switch (msg.type) {
        case 'rpc_response': {
          const id = msg.request_id as string
          const p = this.pending.get(id)
          if (!p) return  // late or unknown — ignore
          this.pending.delete(id)
          clearTimeout(p.timer)
          p.resolve({
            status: typeof msg.status === 'number' ? msg.status : 0,
            data:   msg.data ?? null,
            error:  typeof msg.error === 'string' ? msg.error : null,
          })
          break
        }
        case 'desktop_state': {
          const online = !!msg.online
          this._desktopOnline = online
          Array.from(this.desktopListeners).forEach((l) => l(online))
          break
        }
        case 'event': {
          const topic = msg.topic as string
          const set = this.subs.get(topic)
          if (set) Array.from(set).forEach((l) => l(msg.data))
          break
        }
        case 'error':
          console.warn('[relay] server error:', msg.message)
          break
        // bots_list, status_update, log — Phase 3 will surface these
        // via subscribe(); for now they're just informational on the wire.
      }
    })

    ws.addEventListener('close', () => {
      this.connecting = false
      this.ws = null
      const wasOnline = this._desktopOnline
      this._desktopOnline = false
      if (wasOnline) Array.from(this.desktopListeners).forEach((l) => l(false))
      if (this.shouldRun) this._scheduleReconnect()
    })

    ws.addEventListener('error', () => {
      // 'close' will fire next — handle reconnection there
    })
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = this.reconnectDelay
    console.info(`[relay] reconnecting in ${delay}ms`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldRun) this._open()
    }, delay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
  }
}

// Module-level singleton — one connection per page load.
export const relayClient = new RelayClient()
