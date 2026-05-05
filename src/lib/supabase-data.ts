/**
 * supabase-data.ts — Supabase Realtime subscriptions for WATCH-DOG.
 *
 * Subscribes to the `bots` and `api_connections` Postgres tables via
 * Supabase Realtime so the web dashboard receives INSERT / UPDATE / DELETE
 * events instantly — no polling required.
 *
 * Usage in a React component:
 *
 *   import { subscribeBotsRealtime, subscribeConnectionsRealtime } from '@/lib/supabase-data'
 *
 *   useEffect(() => {
 *     const unsub = subscribeBotsRealtime(userId, (event, row) => {
 *       if (event === 'INSERT') setBots(prev => [row, ...prev])
 *       if (event === 'UPDATE') setBots(prev => prev.map(b => b.cloud_id === row.id ? merge(b, row) : b))
 *       if (event === 'DELETE') setBots(prev => prev.filter(b => b.cloud_id !== row.id))
 *     })
 *     return () => unsub()
 *   }, [userId])
 *
 * How the ID mapping works
 * ────────────────────────
 * The desktop backend uses local SQLite integer IDs for relay calls (run/stop).
 * Supabase uses UUID primary keys. The bots page keeps BOTH:
 *   - bot.id          = local integer ID  (from initial relay fetch)
 *   - bot.cloud_id    = Supabase UUID     (from cloud_id field)
 *
 * Realtime events carry the Supabase UUID as `row.id`. Match against
 * `bot.cloud_id` to find the local record.
 */

import { getSupabase } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export interface CloudBot {
  id: string           // Supabase UUID
  user_id: string
  name: string
  description: string | null
  code: string
  bot_type: string | null
  status: string       // 'IDLE' | 'RUNNING' | 'STOPPED' | 'ERROR'
  is_running: boolean
  run_count: number
  last_run_at: string | null
  schedule_type: string
  schedule_start: string | null
  schedule_end: string | null
  max_amount_per_trade: number | null
  max_contracts_per_trade: number | null
  max_daily_loss: number | null
  auto_restart: boolean
  created_at: string
  updated_at: string
}

export interface CloudConn {
  id: string           // Supabase UUID
  user_id: string
  bot_id: string | null
  name: string
  base_url: string | null
  api_key: string | null
  api_secret: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type BotCallback  = (event: RealtimeEvent, row: CloudBot) => void
type ConnCallback = (event: RealtimeEvent, row: CloudConn) => void

// Track active channels so we can clean them up on unmount
const _channels: RealtimeChannel[] = []

/**
 * Subscribe to INSERT / UPDATE / DELETE events on the `bots` table
 * filtered to the current user_id. Returns an unsubscribe function.
 */
export function subscribeBotsRealtime(
  userId: string,
  callback: BotCallback,
): () => void {
  let channel: RealtimeChannel | null = null

  getSupabase().then((sb) => {
    channel = sb
      .channel(`bots:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'bots',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const event = payload.eventType as RealtimeEvent
          const row   = (payload.new ?? payload.old) as CloudBot
          if (row) callback(event, row)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[supabase-rt] bots channel subscribed')
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[supabase-rt] bots channel error')
        }
      })

    _channels.push(channel)
  }).catch((err) => {
    console.warn('[supabase-rt] getSupabase failed for bots subscription:', err)
  })

  return () => {
    if (channel) {
      getSupabase()
        .then((sb) => sb.removeChannel(channel!))
        .catch(() => { /* ignore cleanup errors */ })
    }
  }
}

/**
 * Subscribe to INSERT / UPDATE / DELETE events on the `api_connections`
 * table filtered to the current user_id. Returns an unsubscribe function.
 */
export function subscribeConnectionsRealtime(
  userId: string,
  callback: ConnCallback,
): () => void {
  let channel: RealtimeChannel | null = null

  getSupabase().then((sb) => {
    channel = sb
      .channel(`api_connections:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'api_connections',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const event = payload.eventType as RealtimeEvent
          const row   = (payload.new ?? payload.old) as CloudConn
          if (row) callback(event, row)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[supabase-rt] api_connections channel subscribed')
        }
      })

    _channels.push(channel)
  }).catch((err) => {
    console.warn('[supabase-rt] getSupabase failed for connections subscription:', err)
  })

  return () => {
    if (channel) {
      getSupabase()
        .then((sb) => sb.removeChannel(channel!))
        .catch(() => { /* ignore cleanup errors */ })
    }
  }
}

/**
 * Fetch the current user's Supabase UUID from the active session.
 * Returns null if not authenticated.
 */
export async function getSupabaseUserId(): Promise<string | null> {
  try {
    const sb  = await getSupabase()
    const { data: { session } } = await sb.auth.getSession()
    return session?.user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Remove all active Realtime channels. Call on page unload / logout.
 */
export async function removeAllChannels(): Promise<void> {
  try {
    const sb = await getSupabase()
    for (const ch of _channels) {
      await sb.removeChannel(ch)
    }
    _channels.length = 0
  } catch {
    /* best-effort cleanup */
  }
}
