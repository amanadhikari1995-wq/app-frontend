/**
 * supabase-data.ts — Supabase-backed data layer for web (relay) mode.
 *
 * When the frontend runs in the browser without a desktop app connected
 * (transport === 'relay'), all bot data lives in Supabase Postgres, not
 * in the local FastAPI / SQLite.
 *
 * These functions mirror the shape of `botsApi`, `connectionsApi`, etc.
 * in api.ts so the pages can switch between the two sources with minimal
 * branching.
 *
 * Key differences from the FastAPI layer:
 *   - IDs are UUID strings, not integers
 *   - status values are lowercase: 'idle' | 'running' | 'stopped' | 'error'
 *     → we normalise to uppercase on the way out so existing UI code is unchanged
 *   - run / stop / getLogs are NOT available here — desktop-only operations
 */

import { getSupabase } from './supabase'

// ── Shared types ──────────────────────────────────────────────────────────────

export interface SbBot {
  id:                      string          // UUID
  user_id:                 string
  name:                    string
  description:             string | null
  code:                    string
  bot_type:                string | null
  bot_secret:              string
  schedule_type:           string
  schedule_start:          string | null
  schedule_end:            string | null
  max_amount_per_trade:    number | null
  max_contracts_per_trade: number | null
  max_daily_loss:          number | null
  auto_restart:            boolean
  run_count:               number
  last_run_at:             string | null
  is_running:              boolean
  running_on:              string | null
  last_seen_at:            string | null
  status:                  string          // uppercase after normalisation
  created_at:              string
  updated_at:              string
}

export interface SbConnection {
  id:         string
  user_id:    string
  bot_id:     string | null
  name:       string
  base_url:   string | null
  api_key:    string | null
  api_secret: string | null
  enc_iv:     string | null
  enc_version: number
  is_active:  boolean
  created_at: string
}

export interface SbTrade {
  id:          string
  user_id:     string
  bot_id:      string
  symbol:      string
  side:        string
  entry_price: number | null
  exit_price:  number | null
  quantity:    number | null
  pnl:         number | null
  note:        string | null
  external_id: string | null
  occurred_at: string
  created_at:  string
}

export interface SbLog {
  id:         string
  user_id:    string
  bot_id:     string
  level:      string
  message:    string
  created_at: string
}

/** Normalise Supabase lowercase status → uppercase to match the UI's STATUS map. */
function normaliseStatus(s: string): string {
  return s.toUpperCase()
}

function normaliseBot(row: Record<string, unknown>): SbBot {
  return {
    ...(row as unknown as SbBot),
    status: normaliseStatus((row.status as string) ?? 'idle'),
  }
}

// ── Bots ──────────────────────────────────────────────────────────────────────

export const sbBotsApi = {
  /** Fetch all bots for the signed-in user. RLS enforces user_id. */
  async getAll(): Promise<SbBot[]> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('bots')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map(normaliseBot)
  },

  /** Fetch a single bot by UUID. */
  async get(id: string): Promise<SbBot> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('bots')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    return normaliseBot(data)
  },

  /** Create a new bot. */
  async create(fields: {
    name:                    string
    description?:            string
    code:                    string
    bot_type?:               string
    schedule_type?:          string
    schedule_start?:         string
    schedule_end?:           string
    max_amount_per_trade?:   number
    max_contracts_per_trade?: number
    max_daily_loss?:         number
    auto_restart?:           boolean
  }): Promise<SbBot> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('bots')
      .insert({
        name:                    fields.name,
        description:             fields.description ?? null,
        code:                    fields.code,
        bot_type:                fields.bot_type ?? null,
        schedule_type:           fields.schedule_type ?? 'always',
        schedule_start:          fields.schedule_start ?? null,
        schedule_end:            fields.schedule_end ?? null,
        max_amount_per_trade:    fields.max_amount_per_trade ?? null,
        max_contracts_per_trade: fields.max_contracts_per_trade ?? null,
        max_daily_loss:          fields.max_daily_loss ?? null,
        auto_restart:            fields.auto_restart ?? false,
        status:                  'idle',
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return normaliseBot(data)
  },

  /** Update mutable bot fields. */
  async update(id: string, fields: {
    name?:                   string
    description?:            string
    code?:                   string
    bot_type?:               string
    schedule_type?:          string
    schedule_start?:         string | null
    schedule_end?:           string | null
    max_amount_per_trade?:   number | null
    max_contracts_per_trade?: number | null
    max_daily_loss?:         number | null
    auto_restart?:           boolean
  }): Promise<SbBot> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('bots')
      .update(fields)
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return normaliseBot(data)
  },

  /** Delete a bot. */
  async delete(id: string): Promise<void> {
    const sb = await getSupabase()
    const { error } = await sb.from('bots').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  /**
   * Fetch the last N log lines from bot_logs_tail for a given bot.
   * Returns them newest-first (same order as the FastAPI endpoint).
   */
  async getLogs(botId: string, limit = 200): Promise<SbLog[]> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('bot_logs_tail')
      .select('*')
      .eq('bot_id', botId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as SbLog[]
  },

  /** Subscribe to real-time status changes for a single bot. */
  subscribeBot(id: string, cb: (bot: SbBot) => void) {
    let channel: ReturnType<Awaited<ReturnType<typeof getSupabase>>['channel']> | null = null
    void getSupabase().then((sb) => {
      channel = sb
        .channel(`bot-${id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'bots', filter: `id=eq.${id}` },
          (payload) => {
            if (payload.new) cb(normaliseBot(payload.new as Record<string, unknown>))
          },
        )
        .subscribe()
    })
    return () => {
      if (channel) void getSupabase().then((sb) => sb.removeChannel(channel!))
    }
  },

  /** Subscribe to real-time log lines for a single bot. */
  subscribeLogs(botId: string, cb: (log: SbLog) => void) {
    let channel: ReturnType<Awaited<ReturnType<typeof getSupabase>>['channel']> | null = null
    void getSupabase().then((sb) => {
      channel = sb
        .channel(`bot-logs-${botId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'bot_logs_tail', filter: `bot_id=eq.${botId}` },
          (payload) => {
            if (payload.new) cb(payload.new as SbLog)
          },
        )
        .subscribe()
    })
    return () => {
      if (channel) void getSupabase().then((sb) => sb.removeChannel(channel!))
    }
  },
}

// ── API Connections ───────────────────────────────────────────────────────────

export const sbConnectionsApi = {
  async getByBot(botId: string): Promise<SbConnection[]> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('api_connections')
      .select('*')
      .eq('bot_id', botId)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as SbConnection[]
  },

  async getAll(): Promise<SbConnection[]> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('api_connections')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as SbConnection[]
  },

  async create(fields: {
    bot_id?:     string
    name:        string
    base_url?:   string
    api_key?:    string
    api_secret?: string
  }): Promise<SbConnection> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('api_connections')
      .insert({
        bot_id:     fields.bot_id     ?? null,
        name:       fields.name,
        base_url:   fields.base_url   ?? null,
        api_key:    fields.api_key    ?? null,
        api_secret: fields.api_secret ?? null,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as SbConnection
  },

  async update(id: string, fields: {
    bot_id?:     string
    name:        string
    base_url?:   string
    api_key?:    string
    api_secret?: string
  }): Promise<SbConnection> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('api_connections')
      .update({
        bot_id:     fields.bot_id     ?? null,
        name:       fields.name,
        base_url:   fields.base_url   ?? null,
        api_key:    fields.api_key    ?? null,
        api_secret: fields.api_secret ?? null,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as SbConnection
  },

  async delete(id: string): Promise<void> {
    const sb = await getSupabase()
    const { error } = await sb.from('api_connections').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ── Trades ────────────────────────────────────────────────────────────────────

export const sbTradesApi = {
  async getByBot(botId: string, limit = 500): Promise<SbTrade[]> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('trades')
      .select('*')
      .eq('bot_id', botId)
      .order('occurred_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as SbTrade[]
  },

  async getStats(botId: string): Promise<{
    total_trades:   number
    winning_trades: number
    losing_trades:  number
    win_rate:       number
    total_pnl:      number
    total_winning:  number
    total_losing:   number
  }> {
    const sb = await getSupabase()
    const { data, error } = await sb
      .from('trades')
      .select('pnl')
      .eq('bot_id', botId)
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as { pnl: number | null }[]
    const total   = rows.length
    const winning = rows.filter((r) => (r.pnl ?? 0) > 0)
    const losing  = rows.filter((r) => (r.pnl ?? 0) < 0)
    const totalPnl     = rows.reduce((a, r) => a + (r.pnl ?? 0), 0)
    const totalWinning = winning.reduce((a, r) => a + (r.pnl ?? 0), 0)
    const totalLosing  = losing.reduce((a, r) => a + (r.pnl ?? 0), 0)

    return {
      total_trades:   total,
      winning_trades: winning.length,
      losing_trades:  losing.length,
      win_rate:       total > 0 ? (winning.length / total) * 100 : 0,
      total_pnl:      totalPnl,
      total_winning:  totalWinning,
      total_losing:   totalLosing,
    }
  },

  async delete(tradeId: string): Promise<void> {
    const sb = await getSupabase()
    const { error } = await sb.from('trades').delete().eq('id', tradeId)
    if (error) throw new Error(error.message)
  },

  async clearBot(botId: string): Promise<void> {
    const sb = await getSupabase()
    const { error } = await sb.from('trades').delete().eq('bot_id', botId)
    if (error) throw new Error(error.message)
  },
}

// ── Dashboard aggregates ──────────────────────────────────────────────────────

export const sbDashboardApi = {
  /**
   * Returns the same shape as FastAPI's GET /api/dashboard/stats so the
   * dashboard page can use it without changes.
   */
  async stats(): Promise<{
    total_bots:   number
    running_bots: number
    total_runs:   number
    total_trades: number
    recent_logs:  {
      id: string; bot_id: string; level: string; message: string; created_at: string
    }[]
  }> {
    const sb = await getSupabase()
    const [botsRes, tradesRes, logsRes] = await Promise.all([
      sb.from('bots').select('id, is_running, run_count, status'),
      sb.from('trades').select('id', { count: 'exact', head: true }),
      sb
        .from('bot_logs_tail')
        .select('id, bot_id, level, message, created_at')
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (botsRes.error) throw new Error(botsRes.error.message)
    if (logsRes.error) throw new Error(logsRes.error.message)

    const bots       = (botsRes.data ?? []) as { id: string; is_running: boolean; run_count: number; status: string }[]
    const totalRuns  = bots.reduce((a, b) => a + (b.run_count ?? 0), 0)
    const runningCnt = bots.filter((b) => b.is_running).length

    return {
      total_bots:   bots.length,
      running_bots: runningCnt,
      total_runs:   totalRuns,
      total_trades: tradesRes.count ?? 0,
      recent_logs:  (logsRes.data ?? []) as {
        id: string; bot_id: string; level: string; message: string; created_at: string
      }[],
    }
  },
}
