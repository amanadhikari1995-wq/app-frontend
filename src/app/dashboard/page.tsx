'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { dashboardApi, botsApi, connectionsApi, systemApi } from '@/lib/api'
import { sbBotsApi, sbDashboardApi, sbConnectionsApi } from '@/lib/supabase-data'
import { getTransportMode } from '@/lib/runtime-config'
import { formatTimeCT, todayLongCT, timeAgo } from '@/lib/time'
import Navbar, { useTradeMode } from '@/components/Navbar'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Log     { id: string | number; bot_id: string | number; level: string; message: string; created_at: string }
interface Bot     { id: string | number; name: string; status: string; run_count: number; last_run_at: string | null }
interface Stats   { total_bots: number; running_bots: number; total_runs: number; total_trades: number; recent_logs: Log[] }

// ─── Constants ───────────────────────────────────────────────────────────────
const BG = 'var(--bg)'
const CARD: React.CSSProperties = {
  background: 'var(--card)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  boxShadow: 'var(--shadow-card)',
}
const STATUS: Record<string,{label:string;color:string;bg:string;glow:string;pulse:boolean}> = {
  RUNNING: { label:'Running', color: 'var(--accent)', bg:'rgba(0,245,255,0.12)',   glow:'0 0 14px rgba(0,245,255,0.55)', pulse:true  },
  IDLE:    { label:'Idle',    color: 'var(--text-muted)', bg:'rgba(71,85,105,0.14)',   glow:'none',                           pulse:false },
  ERROR:   { label:'Error',   color:'#ff4444', bg:'rgba(255,68,68,0.12)',   glow:'0 0 14px rgba(255,68,68,0.5)',   pulse:false },
  STOPPED: { label:'Stopped', color:'#f59e0b', bg:'rgba(245,158,11,0.12)', glow:'none',                           pulse:false },
}
const TAG_META: Record<string,{color:string;bg:string}> = {
  // ── Trade entries / successes (green) ─────────────────────────────────
  BUY:     { color:'#22c55e', bg:'rgba(34,197,94,0.07)'   },
  SOLD:    { color:'#22c55e', bg:'rgba(34,197,94,0.07)'   },
  FILLED:  { color:'#22c55e', bg:'rgba(34,197,94,0.07)'   },
  OK:      { color:'#22c55e', bg:'rgba(34,197,94,0.05)'   },
  PNL:     { color:'#34d399', bg:'rgba(52,211,153,0.07)'  },

  // ── Trade exits / closing (orange) ────────────────────────────────────
  EXIT:    { color:'#fb923c', bg:'rgba(251,146,60,0.07)'  },
  CLOSED:  { color:'#fb923c', bg:'rgba(251,146,60,0.07)'  },
  TP:      { color:'#fb923c', bg:'rgba(251,146,60,0.07)'  },
  SL:      { color:'#fb923c', bg:'rgba(251,146,60,0.07)'  },
  WARN:    { color:'#f59e0b', bg:'rgba(245,158,11,0.05)'  },
  WARNING: { color:'#f59e0b', bg:'rgba(245,158,11,0.05)'  },

  // ── Errors (red) ──────────────────────────────────────────────────────
  ERROR:   { color:'#ef4444', bg:'rgba(239,68,68,0.05)'   },
  FAIL:    { color:'#ef4444', bg:'rgba(239,68,68,0.05)'   },
  SELL:    { color:'#f87171', bg:'rgba(248,113,113,0.07)' },   // legacy

  // ── HTTP auto-log tags (cyan for OK, red for fail) ────────────────────
  'HTTP →':  { color:'#22d3ee', bg:'rgba(34,211,238,0.04)' },
  'HTTP ←':  { color:'#22d3ee', bg:'rgba(34,211,238,0.04)' },
  'HTTP ✗':  { color:'#ef4444', bg:'rgba(239,68,68,0.06)'  },

  // ── WebSocket auto-log tags (purple) ──────────────────────────────────
  'WS →':    { color:'#a78bfa', bg:'rgba(167,139,250,0.05)' },
  'WS ←':    { color:'#a78bfa', bg:'rgba(167,139,250,0.05)' },

  // ── Diagnostic / informational (existing palette) ─────────────────────
  PRICE:   { color: 'var(--accent)', bg:'var(--accent-dim)'   },
  AI:      { color:'#a78bfa', bg:'rgba(167,139,250,0.07)' },
  SIGNAL:  { color:'#fbbf24', bg:'rgba(251,191,36,0.07)'  },
  TRADE:   { color:'#60a5fa', bg:'rgba(96,165,250,0.07)'  },
  SESSION: { color:'#60a5fa', bg:'rgba(96,165,250,0.07)'  },
  HOLDING: { color:'#94a3b8', bg:'transparent'            },
  INFO:    { color: 'var(--text-muted)', bg:'transparent' },
}
const PIE_COLOR: Record<string,string> = {
  IDLE:'#1e3a4a', RUNNING:'#00f5ff', ERROR:'#ff4444', STOPPED:'#f59e0b',
}
const BOT_PALETTE = ['#60a5fa','#34d399','#fb923c','#a78bfa','#f472b6','#facc15','#38bdf8']
function botColor(id: string | number) {
  const n = typeof id === 'number' ? id : (parseInt(String(id).replace(/-/g,'').slice(0,8), 16) || 1)
  return BOT_PALETTE[(Math.abs(n) - 1) % BOT_PALETTE.length]
}

// ─── Activity event parsed from a structured bot log ─────────────────────────
interface ActivityEvent {
  id: string | number; bot_id: string | number; botName: string
  type: 'ENTER' | 'EXIT' | 'SCALE' | 'WIN' | 'LOSS' | 'RAW'
  label: string; detail: string; ts: string; color: string
}

function parseActivity(log: Log, botName: string): ActivityEvent | null {
  const color = botColor(log.bot_id)
  const base  = { id: log.id, bot_id: log.bot_id, botName, ts: log.created_at, color }
  let obj: Record<string, unknown> | null = null
  try { obj = JSON.parse(log.message) } catch { /**/ }
  if (obj) {
    const e = (obj.e as string) || ''
    if (e === 'entered') {
      const side  = (obj.side as string) || '?'
      const qty   = Number(obj.filled ?? obj.contracts ?? 0)
      const price = Number(obj.price ?? obj.price_cents ?? 0)
      return { ...base, type: 'ENTER', label: 'ENTERED',
        detail: `${botName} has ENTERED ${side} position with ${qty} contract${qty !== 1 ? 's' : ''} at ${price}¢` }
    }
    if (e === 'scaled') {
      const side  = (obj.side as string) || '?'
      const qty   = Number(obj.filled ?? obj.contracts ?? 0)
      const price = Number(obj.price ?? obj.price_cents ?? 0)
      return { ...base, type: 'SCALE', label: 'SCALED',
        detail: `${botName} has SCALED UP ${side} position by ${qty} contract${qty !== 1 ? 's' : ''} at ${price}¢` }
    }
    if (e === 'closed') {
      const pnl  = Number(obj.pnl ?? 0)
      const why  = (obj.why as string) || 'exit'
      const sign = pnl >= 0 ? '+' : ''
      const type: ActivityEvent['type'] = pnl >= 0 ? 'WIN' : 'LOSS'
      return { ...base, type, label: pnl >= 0 ? 'WIN' : 'LOSS',
        detail: `${botName} has CLOSED position (${why}) | PNL: ${sign}$${pnl.toFixed(2)}` }
    }
    return null
  }
  const m = log.message.match(/^\[([A-Z_]+)\]\s+(.+)$/)
  if (!m) return null
  const tag = m[1]; const body = m[2]
  if (tag === 'BUY')   return { ...base, type: 'ENTER', label: 'BUY',   detail: `${botName} → ${body}` }
  if (tag === 'SELL')  return { ...base, type: 'EXIT',  label: 'SELL',  detail: `${botName} → ${body}` }
  if (tag === 'SCALE') return { ...base, type: 'SCALE', label: 'SCALE', detail: `${botName} → ${body}` }
  if (tag === 'PNL')   return { ...base, type: 'WIN',   label: 'PNL',   detail: `${botName} → ${body}` }
  return null
}

const ACT_STYLE: Record<ActivityEvent['type'], { color: string; bg: string; icon: string }> = {
  ENTER: { color: '#34d399', bg: 'rgba(52,211,153,0.09)',  icon: '▲' },
  EXIT:  { color: '#f87171', bg: 'rgba(248,113,113,0.09)', icon: '▼' },
  SCALE: { color: '#60a5fa', bg: 'rgba(96,165,250,0.09)',  icon: '+' },
  WIN:   { color: '#34d399', bg: 'rgba(52,211,153,0.07)',  icon: '$' },
  LOSS:  { color: '#f87171', bg: 'rgba(248,113,113,0.07)', icon: '$' },
  RAW:   { color: 'var(--text-muted)', bg: 'transparent',  icon: '·' },
}

function parseTag(msg: string): {tag:string;body:string} {
  // Bot logs are formatted "HH:MM:SS | LEVEL    | [TAG] body" — strip the
  // timestamp+level prefix first so the tag-bracket matcher sees a clean line.
  const stripped = msg.replace(/^\d{2}:\d{2}:\d{2}\s*\|\s*\w+\s*\|\s*/, '')

  // Match anything in [...] — not just A-Z, because auto-log tags include
  // arrows ("HTTP →", "WS ←", "HTTP ✗"). Allow space, arrow, ✗ inside the tag.
  const m = stripped.match(/^\[([A-Za-z0-9_ →←✗]+)\]\s*([\s\S]*)$/)
  if (m) return { tag: m[1].trim(), body: m[2] }
  return { tag: 'INFO', body: msg }
}

// ─── Live Activity Feed — real-time log stream from all active bots ───────────
function LiveActivityFeed({
  bots, botLogs,
}: { bots: Bot[]; botLogs: Record<string, Log[]> }) {
  const feedRef   = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const prevTopId = useRef<string | number>(0)

  const botMap = Object.fromEntries(bots.map(b => [String(b.id), b]))

  type EnrichedLog = Log & { botName: string; botCol: string }
  const allLogs: EnrichedLog[] = []
  for (const [bidStr, logs] of Object.entries(botLogs)) {
    const bot = botMap[bidStr]
    if (!bot) continue
    for (const log of logs) {
      allLogs.push({ ...log, botName: bot.name, botCol: botColor(bot.id) })
    }
  }
  allLogs.sort((a, b) => {
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    return tb - ta
  })
  const visible = allLogs.filter(l => !l.message.trimStart().startsWith('{')).slice(0, 200)

  useEffect(() => {
    const topId = visible[0]?.id ?? 0
    if (topId !== prevTopId.current && feedRef.current && pinnedRef.current) {
      feedRef.current.scrollTop = 0
    }
    prevTopId.current = topId
  })

  const onScroll = () => {
    if (feedRef.current) pinnedRef.current = feedRef.current.scrollTop < 60
  }

  if (visible.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)' }}>
          <svg className="w-6 h-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
        </div>
        <div className="text-center">
          <p className="text-slate-400 font-bold text-sm">Waiting for logs…</p>
          <p className="text-slate-600 text-xs mt-1">All bot activity will stream here live.</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={feedRef} onScroll={onScroll}
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ scrollbarWidth: 'none', padding: '4px 0' } as React.CSSProperties}>
      {visible.map((log, idx) => {
        const { tag, body } = parseTag(log.message)
        const meta  = TAG_META[tag] || TAG_META.INFO
        const isNew = idx === 0
        // Three coarse buckets drive the row tint. Tag-meta drives the
        // text color of the [TAG] pill; these buckets drive the row stripe
        // and message text color.
        const isErr     = tag === 'ERROR' || tag === 'FAIL'
                       || tag === 'HTTP ✗' || log.level === 'ERROR'
        const isBuyTag  = tag === 'BUY'    || tag === 'SOLD'   || tag === 'FILLED'
                       || tag === 'OK'     || tag === 'PNL'
        const isExitTag = tag === 'EXIT'   || tag === 'CLOSED' || tag === 'TP' || tag === 'SL'
        const isWarn    = tag === 'WARNING'|| tag === 'WARN'   || log.level === 'WARNING'
        const isHttp    = tag === 'HTTP →' || tag === 'HTTP ←'
        const isWs      = tag === 'WS →'   || tag === 'WS ←'
        // Legacy SELL kept red so old logs render the same
        const isSellTag = tag === 'SELL'

        const msgColor = isErr     ? '#fca5a5'                // red
                       : isExitTag ? '#fdba74'                // orange
                       : isWarn    ? '#fcd34d'                // amber
                       : isBuyTag  ? '#86efac'                // green
                       : isSellTag ? '#fca5a5'                // legacy red
                       : isHttp    ? '#a5f3fc'                // cyan
                       : isWs      ? '#c4b5fd'                // purple
                       : tag === 'AI' ? '#c4b5fd'
                       : '#94a3b8'                            // default slate

        const leftBorder = isNew     ? `2px solid ${meta.color}`
                         : isErr     ? '2px solid rgba(239,68,68,0.35)'
                         : isExitTag ? '2px solid rgba(251,146,60,0.4)'    // ORANGE
                         : isBuyTag  ? '2px solid rgba(34,197,94,0.35)'
                         : isSellTag ? '2px solid rgba(248,113,113,0.35)'
                         : isHttp    ? '2px solid rgba(34,211,238,0.25)'
                         : isWs      ? '2px solid rgba(167,139,250,0.30)'
                         :              '2px solid transparent'

        const rowBg = isNew     ? `${meta.color}0e`
                    : isErr     ? 'rgba(239,68,68,0.05)'
                    : isExitTag ? 'rgba(251,146,60,0.05)'                  // ORANGE
                    : isBuyTag  ? 'rgba(34,197,94,0.04)'
                    : isSellTag ? 'rgba(248,113,113,0.04)'
                    : isHttp    ? 'rgba(34,211,238,0.03)'
                    : isWs      ? 'rgba(167,139,250,0.03)'
                    :              'transparent'

        return (
          <div key={log.id}
            className="flex items-start gap-2 px-3 py-[3px] mx-1 rounded transition-colors duration-150"
            style={{ background: rowBg, borderLeft: leftBorder }}>
            <span className="text-[10.8px] text-slate-600 tabular-nums shrink-0 mt-[3px] w-[42px]">
              {formatTimeCT(log.created_at)}
            </span>
            <span className="flex items-center gap-1 shrink-0 mt-[2px]">
              <span className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: log.botCol, boxShadow: `0 0 4px ${log.botCol}` }}/>
              <span className="text-[9.6px] font-black uppercase tracking-wide max-w-[48px] truncate"
                style={{ color: log.botCol }}>{log.botName}</span>
            </span>
            <span className="text-[9.6px] font-black px-1 py-px rounded shrink-0 mt-[1px]"
              style={{ color: meta.color, background: `${meta.color}18` }}>
              {tag.slice(0, 5)}
            </span>
            <span className="flex-1 text-[12.6px] leading-snug break-words min-w-0" style={{ color: msgColor }}>
              {body.length > 130 ? body.slice(0, 130) + '…' : body}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Board Activity Panel — compact per-bot log terminal ─────────────────────
function BoardActivityPanel({bot,logs}:{bot:Bot;logs:Log[]}) {
  const st        = STATUS[bot.status] || STATUS.IDLE
  const isRunning = bot.status === 'RUNNING'
  const isError   = bot.status === 'ERROR'
  const border    = isRunning ? '1px solid var(--border)'
                  : isError   ? '1px solid rgba(255,68,68,0.22)'
                  :              '1px solid rgba(255,255,255,0.07)'
  const headerBg  = isRunning ? 'rgba(0,245,255,0.04)'
                  : isError   ? 'rgba(255,68,68,0.04)'
                  :              'transparent'
  const bc        = botColor(bot.id)
  const lines     = logs.slice(0, 60)

  return (
    <div className="rounded-xl overflow-hidden flex flex-col h-full" style={{...CARD, border}}>
      <div className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{background: headerBg}}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0${st.pulse?' animate-pulse':''}`}
            style={{background: bc, boxShadow:`0 0 6px ${bc}88`}}/>
          <span className="font-bold text-white text-sm truncate">{bot.name}</span>
          <span className="text-[10.8px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
            style={{color:st.color, background:st.bg}}>{st.label}</span>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 ml-2">
          {isRunning && (
            <span className="flex items-center gap-1 text-[10.8px] font-black uppercase tracking-widest" style={{color: bc}}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background: bc}}/>LIVE
            </span>
          )}
          <Link href={`/bots/detail?id=${bot.id}`}
            className="text-[12px] font-semibold transition-colors hover:text-[#00f5ff]"
            style={{color:'#334155'}}>View →</Link>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-px"
        style={{scrollbarWidth:'none', msOverflowStyle:'none'} as React.CSSProperties}>
        {lines.length === 0
          ? <p className="text-slate-700 text-[12px] text-center py-6">Waiting for logs…</p>
          : lines.map((log, idx) => {
              const ev = parseActivity(log, bot.name)
              if (ev) {
                const s = ACT_STYLE[ev.type]
                return (
                  <div key={log.id} className="flex items-center gap-1.5 px-2 py-1 rounded"
                    style={{ background: s.bg, borderLeft: idx === 0 ? `2px solid ${s.color}` : '2px solid transparent' }}>
                    <span className="text-slate-600 shrink-0 text-[10.8px] tabular-nums w-[44px]">{formatTimeCT(log.created_at)}</span>
                    <span className="text-[9.6px] font-black px-1 py-px rounded" style={{ color: s.color, background: `${s.color}22` }}>{ev.label}</span>
                    <span className="flex-1 text-[12px] leading-snug" style={{ color: '#e2e8f0' }}>{ev.detail}</span>
                  </div>
                )
              }
              if (log.message.trimStart().startsWith('{')) return null
              const m     = log.message.match(/^\[([A-Z_]+)\]\s+(.+)$/)
              const tag   = m ? m[1] : log.level
              const body  = m ? m[2] : log.message
              const meta  = TAG_META[tag] || TAG_META.INFO
              const isNew = idx === 0
              return (
                <div key={log.id}
                  className="flex items-start gap-1.5 px-2 py-[3px] rounded"
                  style={{
                    background: meta.bg || 'transparent',
                    borderLeft: isNew && isRunning ? `2px solid ${meta.color || bc}` : '2px solid transparent',
                  }}>
                  <span className="text-slate-600 shrink-0 tabular-nums text-[10.8px] w-[44px] mt-px">{formatTimeCT(log.created_at)}</span>
                  <span className="shrink-0 text-[9.6px] font-black px-1 py-px rounded min-w-[28px] text-center"
                    style={{color:meta.color, background:`${meta.color}22`}}>
                    {tag.slice(0,5)}
                  </span>
                  <span className="flex-1 text-[12.6px] leading-snug break-words"
                    style={{color: tag==='INFO' ? '#94a3b8' : meta.color}} title={body}>
                    {body.length > 80 ? body.slice(0,80)+'…' : body}
                  </span>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// RIGHT SIDEBAR PANELS
// ══════════════════════════════════════════════════════════════════════════════
function RPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="h-full rounded-2xl flex flex-col overflow-hidden" style={{
      background: 'var(--card)', boxShadow: 'var(--shadow-card)',
    }}>
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0">
        <span className="text-slate-400 flex items-center">{icon}</span>
        <span className="text-[12px] font-bold text-white/50 uppercase tracking-widest">{title}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function ClockPanel() {
  const [now,  setNow]  = useState<Date | null>(null)
  const [mode, setMode] = useState<'analog' | 'digital'>('analog')
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!now) return <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-muted)', fontSize: 14.4 }}>——:——</div>

  const h = now.getHours(); const m = now.getMinutes(); const s = now.getSeconds()
  const secRad = (s * 6       * Math.PI) / 180
  const minRad = ((m * 6 + s * 0.1) * Math.PI) / 180
  const hrRad  = (((h % 12) * 30 + m * 0.5) * Math.PI) / 180
  const dayStr  = now.toLocaleDateString('en-US', { weekday: 'long' })
  const dateStr = now.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })
  const yearStr = now.getFullYear().toString()

  return (
    <div className="flex h-full px-3 py-3 gap-3">
      <div className="flex flex-col justify-between shrink-0" style={{ width: '42%' }}>
        <div className="flex flex-col gap-2.5 pt-1">
          <p className="font-black text-white uppercase leading-none" style={{ fontSize: '1rem', letterSpacing: '0.08em' }}>{dayStr}</p>
          <p className="font-black text-white leading-tight" style={{ fontSize: '1.15rem' }}>{dateStr}</p>
          <p className="font-bold leading-none" style={{ fontSize: '0.95rem', color: 'rgba(0,245,255,0.65)' }}>{yearStr}</p>
        </div>
        <div className="flex rounded-lg overflow-hidden" style={{ background: 'rgba(0,0,0,0.25)' }}>
          {(['analog', 'digital'] as const).map(md => (
            <button key={md} onClick={() => setMode(md)}
              className="flex-1 py-1 text-[13.2px] font-bold transition-all duration-150"
              style={{ color: mode === md ? '#00f5ff' : 'rgba(255,255,255,0.28)', background: mode === md ? 'rgba(0,245,255,0.1)' : 'transparent' }}>
              {md === 'analog' ? 'A' : 'D'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center">
        {mode === 'analog' ? (
          <svg viewBox="0 0 200 200" style={{ height: '100%', width: 'auto', maxHeight: '100%', filter: 'drop-shadow(0 0 28px rgba(0,245,255,0.2))' }}>
            <circle cx="100" cy="100" r="96" fill="rgba(5,7,15,0.65)" stroke="rgba(0,245,255,0.18)" strokeWidth="1.5"/>
            <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(0,245,255,0.05)" strokeWidth="4"/>
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i * 30 * Math.PI) / 180
              return <line key={i} x1={100+79*Math.sin(a)} y1={100-79*Math.cos(a)} x2={100+90*Math.sin(a)} y2={100-90*Math.cos(a)} stroke="rgba(0,245,255,0.55)" strokeWidth="2.5" strokeLinecap="round"/>
            })}
            {Array.from({ length: 60 }).map((_, i) => {
              if (i % 5 === 0) return null
              const a = (i * 6 * Math.PI) / 180
              return <line key={i} x1={100+85*Math.sin(a)} y1={100-85*Math.cos(a)} x2={100+91*Math.sin(a)} y2={100-91*Math.cos(a)} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeLinecap="round"/>
            })}
            <line x1={100-14*Math.sin(hrRad)}  y1={100+14*Math.cos(hrRad)}  x2={100+50*Math.sin(hrRad)}  y2={100-50*Math.cos(hrRad)}  stroke="white" strokeWidth="4.5" strokeLinecap="round"/>
            <line x1={100-16*Math.sin(minRad)} y1={100+16*Math.cos(minRad)} x2={100+68*Math.sin(minRad)} y2={100-68*Math.cos(minRad)} stroke="rgba(255,255,255,0.88)" strokeWidth="3" strokeLinecap="round"/>
            <line x1={100-18*Math.sin(secRad)} y1={100+18*Math.cos(secRad)} x2={100+74*Math.sin(secRad)} y2={100-74*Math.cos(secRad)} stroke="#00f5ff" strokeWidth="1.5" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 3px #00f5ff)' }}/>
            <circle cx="100" cy="100" r="5" fill="#00f5ff" style={{ filter: 'drop-shadow(0 0 5px rgba(0,245,255,0.9))' }}/>
            <circle cx="100" cy="100" r="2" fill="#05070f"/>
          </svg>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono font-black tabular-nums text-white leading-none"
              style={{ fontSize: '2.8rem', textShadow: '0 0 36px rgba(0,245,255,0.55)', letterSpacing: '0.04em' }}>
              {String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}
            </span>
            <span className="font-mono font-bold tabular-nums"
              style={{ fontSize: '1.3rem', color: 'rgba(0,245,255,0.65)', letterSpacing: '0.12em' }}>
              {String(s).padStart(2,'0')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Bot Intelligence ──────────────────────────────────────────────────────────
interface ExtSysStats {
  cpu_percent: number; ram_used: number; ram_total: number; ram_percent: number
  net_sent: number; net_recv: number
  token_input: number; token_output: number; token_total: number; ai_requests: number
}

function fmtBytes(b: number) {
  if (b < 1_024)         return `${b} B`
  if (b < 1_048_576)     return `${(b/1_024).toFixed(1)} KB`
  if (b < 1_073_741_824) return `${(b/1_048_576).toFixed(1)} MB`
  return `${(b/1_073_741_824).toFixed(2)} GB`
}
function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n/1_000).toFixed(1)}K`
  return String(n)
}
function uptime(lastRunAt: string | null): string {
  if (!lastRunAt) return '—'
  const secs = Math.floor((Date.now() - new Date(lastRunAt).getTime()) / 1000)
  if (secs < 0)    return '—'
  if (secs < 60)   return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs/60)}m ${secs%60}s`
  return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`
}

function detectBotFeatures(logs: Log[]): string[] {
  const text = logs.map(l => l.message).join(' ').toLowerCase()
  const tags: string[] = []
  if (/binance|bybit|okx|kraken|coinbase|kucoin|ccxt|mexc|bitget/.test(text)) tags.push('Exchange')
  if (/telegram|telebot|bot\.send|message_handler/.test(text))                  tags.push('Telegram')
  if (/discord|on_message|on_ready|commands\.bot/.test(text))                   tags.push('Discord')
  if (/openai|anthropic|claude|gpt|gemini|groq/.test(text))                     tags.push('AI')
  if (/buy|sell|order|trade|position|contract/.test(text))                      tags.push('Trading')
  if (/scraped|beautifulsoup|selenium|playwright|requests\.get/.test(text))     tags.push('Scraper')
  if (/webhook|smtp|send_email|twilio/.test(text))                              tags.push('Notifier')
  if (/predict|confidence|accuracy|model/.test(text))                           tags.push('Prediction')
  return tags.slice(0, 3)
}

function BotStatsPanel({ bots, botLogs }: { bots: Bot[]; botLogs: Record<string, Log[]> }) {
  const [sys, setSys] = useState<ExtSysStats | null>(null)
  const loadSys = useCallback(async () => {
    try { const r = await systemApi.stats(); setSys(r.data) } catch { /**/ }
  }, [])
  useEffect(() => { loadSys(); const t = setInterval(loadSys, 4000); return () => clearInterval(t) }, [loadSys])

  const activeBots = [...bots]
    .filter(b => b.status === 'RUNNING' || b.status === 'ERROR')
    .sort((a, b) => (a.status === 'RUNNING' ? -1 : 1) - (b.status === 'RUNNING' ? -1 : 1))

  const botMetrics = activeBots.map(bot => {
    const logs    = botLogs[String(bot.id)] ?? []
    const lastLog = logs[0]
    const recent  = logs.slice(0, 30)
    const errorCount = recent.filter(l => l.level === 'ERROR' || /\[ERROR\]/i.test(l.message)).length
    const features   = detectBotFeatures(recent)
    let lpm = 0
    if (logs.length >= 2) {
      const newest  = new Date(logs[0].created_at).getTime()
      const oldest  = new Date(logs[Math.min(logs.length-1,9)].created_at).getTime()
      const spanMin = (newest - oldest) / 60000
      if (spanMin > 0) lpm = Math.round(Math.min(logs.length, 10) / spanMin)
    }
    return { bot, lastLog, errorCount, features, lpm }
  })

  return (
    <div className="flex flex-col h-full overflow-y-auto"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>

      <div className="px-3 pt-2.5 pb-2 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-0.5">
          <p className="text-[10.8px] font-bold text-white/40 uppercase tracking-widest">Active Bots</p>
          <span className="text-[10.8px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ color:'var(--accent)', background:'rgba(0,245,255,0.1)', border:'1px solid rgba(0,245,255,0.2)' }}>
            {activeBots.length} live
          </span>
        </div>

        {activeBots.length === 0 ? (
          <p className="text-[12px] text-slate-600 py-3 text-center">No bots running</p>
        ) : (
          botMetrics.map(({ bot, lastLog, errorCount, features, lpm }) => {
            const st = STATUS[bot.status] || STATUS.IDLE
            const bc = botColor(bot.id)
            return (
              <div key={bot.id} className="rounded-lg px-3 py-2.5"
                style={{ background:'rgba(255,255,255,0.03)', border:`1px solid ${bc}22` }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0${st.pulse?' animate-pulse':''}`}
                    style={{ background:bc, boxShadow:`0 0 5px ${bc}` }}/>
                  <p className="text-[13.2px] font-black text-white flex-1 truncate">{bot.name}</p>
                  <span className="text-[9.6px] font-bold shrink-0 px-1.5 py-0.5 rounded-full"
                    style={{ color:st.color, background:st.bg }}>{st.label}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 mb-1.5">
                  {[
                    { label:'Uptime', val: uptime(bot.last_run_at), color:'#94a3b8' },
                    { label:'Runs',   val: String(bot.run_count),   color: bc },
                    { label:'Logs/m', val: lpm > 0 ? `~${lpm}` : '—', color: errorCount > 0 ? '#f87171' : lpm > 5 ? '#34d399' : '#94a3b8' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="rounded px-1.5 py-1" style={{ background:'rgba(0,0,0,0.2)' }}>
                      <p className="text-[8.4px] text-slate-600 uppercase tracking-wide leading-none mb-0.5">{label}</p>
                      <p className="text-[10.8px] font-bold tabular-nums leading-none" style={{ color }}>{val}</p>
                    </div>
                  ))}
                </div>
                {features.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {features.map(f => (
                      <span key={f} className="text-[8.4px] font-black px-1.5 py-0.5 rounded-full"
                        style={{ color:bc, background:`${bc}18`, border:`1px solid ${bc}30` }}>{f}</span>
                    ))}
                  </div>
                )}
                {lastLog && (
                  <p className="text-[10.8px] leading-snug truncate"
                    style={{ color: lastLog.level==='ERROR' ? '#fca5a5' : '#475569' }}
                    title={lastLog.message}>
                    {lastLog.message.replace(/^\[[A-Z_]+\]\s*/, '').slice(0, 60)}
                  </p>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="mx-3 shrink-0" style={{ height:'1px', background:'rgba(255,255,255,0.06)' }}/>

      <div className="px-3 pt-2 pb-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between mb-0.5">
          <p className="text-[10.8px] font-bold text-white/40 uppercase tracking-widest">AI Tokens</p>
          {sys && sys.ai_requests > 0 && (
            <span className="text-[10.8px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ color:'#a78bfa', background:'rgba(167,139,250,0.1)', border:'1px solid rgba(167,139,250,0.2)' }}>
              {fmtNum(sys.ai_requests)} calls
            </span>
          )}
        </div>
        {!sys ? (
          <p className="text-[12px] text-slate-600 py-2 text-center">Loading…</p>
        ) : sys.token_total === 0 ? (
          <p className="text-[12px] text-slate-600 py-1 text-center">No AI calls this session</p>
        ) : (
          <>
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
              style={{ background:'rgba(167,139,250,0.07)', border:'1px solid rgba(167,139,250,0.18)' }}>
              <span className="text-[10.8px] text-slate-500">↓ Input</span>
              <span className="text-[13.2px] font-black text-purple-400 tabular-nums">{fmtNum(sys.token_input)}</span>
            </div>
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
              style={{ background:'rgba(96,165,250,0.07)', border:'1px solid rgba(96,165,250,0.18)' }}>
              <span className="text-[10.8px] text-slate-500">↑ Output</span>
              <span className="text-[13.2px] font-black text-blue-400 tabular-nums">{fmtNum(sys.token_output)}</span>
            </div>
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg"
              style={{ background:'var(--accent-dim)', border:'1px solid var(--border)' }}>
              <span className="text-[10.8px] text-slate-500">⚡ Total</span>
              <span className="text-[13.2px] font-black tabular-nums" style={{ color:'var(--accent)' }}>{fmtNum(sys.token_total)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Live Stats ────────────────────────────────────────────────────────────────
function LiveStatsPanel({ bots }: { bots: Bot[] }) {
  const [sys, setSys] = useState<ExtSysStats | null>(null)
  const load = useCallback(async () => {
    try { const r = await systemApi.stats(); setSys(r.data) } catch { /**/ }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [load])

  const activeBots = bots.filter(b => b.status === 'RUNNING' || b.status === 'ERROR')
  const cpuColor = !sys ? '#475569' : sys.cpu_percent > 75 ? '#ef4444' : sys.cpu_percent > 50 ? '#f59e0b' : '#22c55e'
  const ramColor = !sys ? '#475569' : sys.ram_percent > 85 ? '#ef4444' : sys.ram_percent > 70 ? '#f59e0b' : '#22c55e'

  return (
    <div className="flex flex-col h-full overflow-y-auto"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>

      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10.8px] font-bold text-white/40 uppercase tracking-widest">Bot Usage</p>
          {activeBots.length > 0 && (
            <span className="text-[10.8px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ color:'var(--accent)', background:'rgba(0,245,255,0.1)', border:'1px solid rgba(0,245,255,0.2)' }}>
              {activeBots.length} active
            </span>
          )}
        </div>
        {activeBots.length === 0 ? (
          <p className="text-[12px] text-slate-600 py-3 text-center">No bots running</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {activeBots.map(bot => {
              const st = STATUS[bot.status] || STATUS.IDLE
              return (
                <div key={bot.id} className="px-3 py-2 rounded-lg"
                  style={{ background:'rgba(255,255,255,0.03)', border:`1px solid ${st.color}22` }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0${st.pulse?' animate-pulse':''}`}
                      style={{ background:st.color, boxShadow:`0 0 6px ${st.color}88` }}/>
                    <p className="text-[13.2px] font-bold text-white flex-1 truncate">{bot.name}</p>
                    <span className="text-[10.8px] font-bold shrink-0" style={{ color:st.color }}>{st.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded px-2 py-1" style={{ background:'rgba(255,255,255,0.04)' }}>
                      <p className="text-[9.6px] text-slate-600 uppercase tracking-wide">Uptime</p>
                      <p className="text-[12px] font-bold text-slate-300 tabular-nums">{uptime(bot.last_run_at)}</p>
                    </div>
                    <div className="rounded px-2 py-1" style={{ background:'rgba(255,255,255,0.04)' }}>
                      <p className="text-[9.6px] text-slate-600 uppercase tracking-wide">Power</p>
                      <p className="text-[12px] font-bold tabular-nums"
                        style={{ color: bot.status==='RUNNING' ? '#22c55e' : '#ef4444' }}>
                        {bot.status==='RUNNING' ? 'Active' : 'Fault'}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="mx-4 shrink-0" style={{ height:'1px', background:'rgba(255,255,255,0.06)' }}/>

      <div className="px-4 pt-2.5 pb-3 flex flex-col gap-2.5">
        <p className="text-[10.8px] font-bold text-white/40 uppercase tracking-widest">Computer Usage</p>
        {!sys ? (
          <p className="text-[12px] text-slate-600 py-2 text-center">Loading…</p>
        ) : (
          <>
            {[
              { label:'CPU', val: sys.cpu_percent, color: cpuColor },
              { label:'RAM', val: sys.ram_percent, color: ramColor },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] font-semibold text-slate-400">{label}</span>
                  <span className="text-[13.2px] font-black tabular-nums" style={{ color }}>{val.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width:`${val}%`, background:`linear-gradient(90deg,${color}88,${color})`, boxShadow:`0 0 6px ${color}55` }}/>
                </div>
                {label==='RAM' && <p className="text-[10.8px] text-slate-600 mt-1">{fmtBytes(sys.ram_used)} / {fmtBytes(sys.ram_total)}</p>}
              </div>
            ))}
            {(sys.cpu_percent > 75 || sys.ram_percent > 85) && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-medium"
                style={{ background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.25)', color:'#f59e0b' }}>
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                High resource usage
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const router = useRouter()
  const [tradeMode]          = useTradeMode()
  const isRelayMode = typeof window !== 'undefined' && getTransportMode() === 'relay'

  const [stats,    setStats] = useState<Stats|null>(null)
  const [bots,     setBots]  = useState<Bot[]>([])
  const [apiCount, setApi]   = useState(0)
  const [botLogs,  setBotLogs] = useState<Record<string,Log[]>>({})
  const [netErr,   setNetErr]  = useState(false)

  const sinceIdsRef   = useRef<Record<string,number>>({})
  const activeBotsRef = useRef<Bot[]>([])

  const load = useCallback(async () => {
    try {
      if (isRelayMode) {
        const [s, b, c] = await Promise.all([
          sbDashboardApi.stats(),
          sbBotsApi.getAll(),
          sbConnectionsApi.getAll(),
        ])
        setNetErr(false)
        setStats(s as unknown as Stats)
        setBots(b as unknown as Bot[])
        setApi(c.length)
        const active = (b as unknown as Bot[]).filter(bot => bot.status==='RUNNING'||bot.status==='ERROR')
        activeBotsRef.current = active
        if (active.length === 0) setBotLogs({})
      } else {
        const [s,b,c] = await Promise.all([dashboardApi.stats(), botsApi.getAll(), connectionsApi.getAll()])
        setNetErr(false)
        setStats(s.data); setBots(b.data); setApi(c.data.length)
        const active = (b.data as Bot[]).filter(bot => bot.status==='RUNNING'||bot.status==='ERROR')
        activeBotsRef.current = active
        const activeIds = new Set(active.map(b => String(b.id)))
        for (const id of Object.keys(sinceIdsRef.current)) {
          if (!activeIds.has(String(id))) delete sinceIdsRef.current[id]
        }
        if (active.length === 0) setBotLogs({})
      }
    } catch { setNetErr(true) }
  }, [isRelayMode])

  const pollLogs = useCallback(async () => {
    // In relay mode, logs come from Supabase bot_logs_tail (written by the desktop);
    // we skip the FastAPI since_id polling since those are integer-ID based.
    if (isRelayMode) {
      const active = activeBotsRef.current
      if (active.length === 0) return
      const res = await Promise.all(
        active.map(bot =>
          sbBotsApi.getLogs(String(bot.id), 50)
            .then(logs => ({ id: String(bot.id), logs: logs as unknown as Log[] }))
            .catch(() => ({ id: String(bot.id), logs: [] as Log[] }))
        )
      )
      setBotLogs(prev => {
        const next = { ...prev }
        for (const { id, logs } of res) { next[id] = logs }
        return next
      })
      return
    }
    const active = activeBotsRef.current
    if (active.length === 0) return
    const fresh    = active.filter(b => sinceIdsRef.current[String(b.id)] === undefined)
    const existing = active.filter(b => sinceIdsRef.current[String(b.id)] !== undefined)
    if (fresh.length > 0) {
      const res = await Promise.all(
        fresh.map(bot =>
          botsApi.getLogs(bot.id as number, 50)
            .then(r => ({ id: String(bot.id), logs: r.data as Log[] }))
            .catch(() => ({ id: String(bot.id), logs: [] as Log[] }))
        )
      )
      setBotLogs(prev => {
        const next = { ...prev }
        for (const { id, logs } of res) {
          next[id] = logs
          sinceIdsRef.current[id] = logs.length > 0 ? Math.max(...logs.map((l: Log) => Number(l.id))) : 0
        }
        return next
      })
    }
    if (existing.length > 0) {
      const toFetch = existing.filter(b => sinceIdsRef.current[String(b.id)] >= 0)
      if (!toFetch.length) return
      const res = await Promise.all(
        toFetch.map(bot =>
          botsApi.getLogs(bot.id as number, 100, sinceIdsRef.current[String(bot.id)])
            .then(r => ({ id: String(bot.id), logs: r.data as Log[] }))
            .catch(() => ({ id: String(bot.id), logs: [] as Log[] }))
        )
      )
      setBotLogs(prev => {
        const next = { ...prev }
        for (const { id, logs } of res) {
          if (!logs.length) continue
          sinceIdsRef.current[id] = Number(logs[logs.length-1].id)
          const merged = [...logs, ...(prev[id]??[])]
          merged.sort((a:Log, b:Log) => Number(b.id) - Number(a.id))
          next[id] = merged.slice(0, 100)
        }
        return next
      })
    }
  }, [isRelayMode])

  const resetAndLoad = useCallback(() => {
    sinceIdsRef.current   = {}
    activeBotsRef.current = []
    load()
  }, [load])

  useEffect(() => {
    let alive = true
    let loadInflight = false
    let pollInflight = false
    const safeLoad = async () => {
      if (!alive || loadInflight) return
      loadInflight = true
      try { await load() } finally { loadInflight = false }
    }
    const safePoll = async () => {
      if (!alive || pollInflight) return
      pollInflight = true
      try { await pollLogs() } finally { pollInflight = false }
    }
    safeLoad()
    const statusTimer = setInterval(safeLoad, 4000)
    const logTimer    = setInterval(safePoll, 1500)
    return () => { alive = false; clearInterval(statusTimer); clearInterval(logTimer) }
  }, [load, pollLogs])

  useOnlineStatus(resetAndLoad)

  const activeBots   = bots.filter(b => b.status==='RUNNING'||b.status==='ERROR')
  const runningCount = bots.filter(b => b.status==='RUNNING').length
  const barData      = bots.map(b => ({ name: b.name.length>12 ? b.name.slice(0,12)+'…' : b.name, runs: b.run_count }))
  const pieData      = Object.entries(
    bots.reduce((acc,b) => { acc[b.status]=(acc[b.status]||0)+1; return acc }, {} as Record<string,number>)
  ).map(([name,value]) => ({ name, value }))

  const statCards = [
    { label:'Total Bots',   value:stats?.total_bots   ??0, sub:'All bots created',    accent:'#00f5ff', highlight:false, icon:'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18' },
    { label:'Active Bots',  value:stats?.running_bots ??0, sub:'Currently running',   accent:'#00f5ff', highlight:true,  icon:'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z' },
    { label:'APIs',         value:apiCount,                sub:'Active connections',  accent:'#6366f1', highlight:false, icon:'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
    { label:'Total Runs',   value:stats?.total_runs   ??0, sub:'All-time executions', accent:'#f59e0b', highlight:false, icon:'M13 10V3L4 14h7v7l9-11h-7z' },
    { label:'Trades',       value:stats?.total_trades ??0, sub:'Across all bots',     accent:'#8b5cf6', highlight:false, icon:'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  ]

  const NAVBAR_H = 0

  return (
    <div className="min-h-screen" style={{background:BG}}>
      <Navbar/>

      {tradeMode==='demo' && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold"
          style={{background:'rgba(245,158,11,0.1)',borderBottom:'1px solid rgba(245,158,11,0.2)',color:'#f59e0b'}}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          DEMO MODE — No real trades will be executed
        </div>
      )}
      {/* Backend-offline banner — silent under Admin Mode (no real backend
          expected) and silent if user is on the /login page. */}
      {netErr && (() => {
        // Different message in browser vs Electron — the user's mental model
        // is completely different. In Electron the local FastAPI on port 8000
        // is what's down; in the web dashboard there's no local backend at
        // all, only the cloud relay → user's PC tunnel.
        const isWeb = typeof window !== 'undefined' &&
                      /^https?:/i.test(window.location.protocol)
        return (
          <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold"
            style={{background:'rgba(239,68,68,0.1)',borderBottom:'1px solid rgba(239,68,68,0.2)',color:'#ef4444'}}>
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            {isWeb
              ? <>Your desktop app appears to be offline. Open WatchDog on your PC and sign in with the same account to use this dashboard.</>
              : <>Local backend unreachable — retrying… Check that the bundled backend is running.</>
            }
          </div>
        )
      })()}

      <div className="flex items-start" style={{minHeight:`calc(100vh - ${NAVBAR_H}px)`}}>

        {/* CENTER — fills the 60vw between left + right sidebars */}
        <main className="min-w-0 px-8 py-8 flex flex-col" style={{width:'100%', height:`calc(100vh - ${NAVBAR_H}px)`, overflowY:'auto'}}>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-5 gap-4 mb-8">
            {statCards.map((c,i) => (
              <div key={i} className="rounded-2xl p-5 transition-all hover:scale-[1.02]" style={CARD}>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{background:c.accent+'18',border:`1px solid ${c.accent}30`}}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{color:c.accent}}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={c.icon}/>
                    </svg>
                  </div>
                  {c.highlight&&(stats?.running_bots??0)>0&&(
                    <span className="w-2 h-2 rounded-full bg-[#00f5ff] animate-pulse mt-1"/>
                  )}
                </div>
                <p className="text-3xl font-black text-white mb-1"
                  style={{color:c.highlight&&(stats?.running_bots??0)>0?c.accent:undefined}}>
                  {c.value}
                </p>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{c.label}</p>
                <p className="text-xs text-slate-600 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* My Bots + Live Activity */}
          <div className="grid grid-cols-2 gap-6 mb-4 flex-1 min-h-0">

            {/* My Bots */}
            <div className="rounded-2xl overflow-hidden flex flex-col" style={CARD}>
              <div className="flex items-center justify-between px-5 py-4 shrink-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-white">My Bots</h2>
                  {bots.length > 0 && (
                    <span className="text-[12px] font-bold px-2 py-0.5 rounded-full"
                      style={{color:'var(--text-muted)',background:'rgba(71,85,105,0.15)',border:'1px solid rgba(71,85,105,0.25)'}}>
                      {bots.length} total
                    </span>
                  )}
                </div>
                <Link href="/bots" className="text-xs font-semibold" style={{color:'var(--accent)'}}>View all →</Link>
              </div>
              <div className="flex-1 min-h-0">
                {bots.length === 0
                  ? <div className="flex flex-col items-center justify-center h-full text-center px-8">
                      <p className="text-slate-500 text-sm">No bots yet.</p>
                      <Link href="/bots" className="mt-3 inline-block text-sm font-semibold" style={{color:'var(--accent)'}}>+ Create your first bot</Link>
                    </div>
                  : <div className="overflow-y-auto h-full p-3"
                      style={{scrollbarWidth:'none',msOverflowStyle:'none'} as React.CSSProperties}>
                      <div className="grid grid-cols-2 gap-2.5" style={{gridAutoRows:'128px'}}>
                        {[...bots]
                          .sort((a,b) => ({RUNNING:0,ERROR:1,STOPPED:2,IDLE:3}[a.status]??4)-({RUNNING:0,ERROR:1,STOPPED:2,IDLE:3}[b.status]??4))
                          .map(bot => {
                            const st        = STATUS[bot.status] || STATUS.IDLE
                            const isRunning = bot.status === 'RUNNING'
                            const isError   = bot.status === 'ERROR'
                            return (
                              <div key={bot.id}
                                className="rounded-xl p-3 flex flex-col justify-between cursor-pointer group transition-all hover:scale-[1.015]"
                                style={{
                                  background: isRunning ? 'linear-gradient(145deg,#0d1e2f 0%,#0f1626 100%)' : isError ? 'linear-gradient(145deg,#1a0f0f 0%,#0f1626 100%)' : 'rgba(255,255,255,0.03)',
                                  border:     isRunning ? '1px solid var(--border)' : isError ? '1px solid rgba(255,68,68,0.22)' : '1px solid rgba(255,255,255,0.07)',
                                  boxShadow:  isRunning ? '0 0 20px var(--accent-dim), inset 0 1px 0 var(--accent-dim)' : isError ? '0 0 20px rgba(255,68,68,0.06)' : 'none',
                                }}
                                onClick={() => router.push(`/bots/detail?id=${bot.id}`)}>
                                <div className="flex items-center justify-between">
                                  <span className="flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-full"
                                    style={{color:st.color,background:st.bg,boxShadow:st.glow}}>
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0${st.pulse?' animate-pulse':''}`} style={{background:st.color}}/>
                                    {st.label}
                                  </span>
                                  <span className="text-slate-700 group-hover:text-[#00f5ff] transition-colors text-xs">→</span>
                                </div>
                                <p className="font-black text-white text-[16.8px] leading-snug group-hover:text-[#00f5ff] transition-colors truncate">
                                  {bot.name}
                                </p>
                                <div className="flex items-end justify-between">
                                  <div>
                                    <p className="text-base font-black leading-none tabular-nums"
                                      style={{color: isRunning ? '#00f5ff' : isError ? '#ff6b6b' : '#94a3b8'}}>
                                      {bot.run_count}
                                    </p>
                                    <p className="text-[10.8px] text-slate-600 mt-0.5 uppercase tracking-widest">runs</p>
                                  </div>
                                  <p className="text-[12px] text-slate-500 text-right leading-tight">{timeAgo(bot.last_run_at)}</p>
                                </div>
                              </div>
                            )
                          })
                        }
                      </div>
                    </div>
                }
              </div>
            </div>

            {/* Live Activity */}
            <div className="rounded-2xl overflow-hidden flex flex-col" style={CARD}>
              <div className="flex items-center justify-between px-5 py-4 shrink-0">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-bold text-white">Live Activity</h2>
                  {activeBots.slice(0, 3).map(b => (
                    <span key={b.id} className="flex items-center gap-1 text-[10.8px] font-bold"
                      style={{ color: botColor(b.id) }}>
                      <span className={`w-1.5 h-1.5 rounded-full${b.status==='RUNNING'?' animate-pulse':''}`}
                        style={{ background: botColor(b.id) }}/>
                      {b.name.length > 10 ? b.name.slice(0, 10) + '…' : b.name}
                    </span>
                  ))}
                </div>
                {runningCount > 0
                  ? <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
                      style={{color:'var(--accent)',background:'var(--accent-dim)',border:'1px solid rgba(0,245,255,0.2)'}}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00f5ff] animate-pulse"/>{runningCount} Live
                    </span>
                  : activeBots.length > 0
                  ? <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
                      style={{color:'#ff4444',background:'rgba(255,68,68,0.08)',border:'1px solid rgba(255,68,68,0.2)'}}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ff4444]"/>{activeBots.length} Error
                    </span>
                  : <span className="text-xs text-slate-600">No active bots</span>
                }
              </div>

              {activeBots.length === 0
                ? <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-6">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
                      style={{background:'rgba(255,255,255,0.03)',border:'1px dashed rgba(255,255,255,0.08)'}}>
                      <svg className="w-6 h-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                      </svg>
                    </div>
                    <p className="text-slate-400 font-bold text-sm">No bots running</p>
                    <p className="text-slate-600 text-xs mt-2 max-w-[160px]">Start a bot to see live logs here instantly.</p>
                    <Link href="/bots" className="mt-4 text-xs font-bold px-4 py-2 rounded-xl"
                      style={{color:'var(--accent)',background:'var(--accent-dim)',border:'1px solid rgba(0,245,255,0.2)'}}>
                      Go to My Bots →
                    </Link>
                  </div>
                : <div className="flex-1 min-h-0 flex flex-col">
                    <LiveActivityFeed bots={activeBots} botLogs={botLogs}/>
                  </div>
              }
            </div>

          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-6 pb-6 shrink-0">

            <div className="rounded-2xl p-6" style={CARD}>
              <h3 className="text-base font-bold text-white mb-5">Status Distribution</h3>
              {pieData.length === 0
                ? <p className="text-slate-600 text-sm text-center py-10">No bots yet</p>
                : <div className="flex items-center gap-8">
                    <ResponsiveContainer width="40%" height={180}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={4} dataKey="value">
                          {pieData.map((_,i) => <Cell key={i} fill={PIE_COLOR[pieData[i].name]||'#334155'}/>)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      {pieData.map(d => (
                        <div key={d.name} className="flex items-center gap-3 rounded-xl px-4 py-3"
                          style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}>
                          <span className="w-3 h-3 rounded-full shrink-0" style={{background:PIE_COLOR[d.name]||'#334155',boxShadow:`0 0 8px ${PIE_COLOR[d.name]||'#334155'}88`}}/>
                          <span className="text-slate-400 text-sm font-medium flex-1">{d.name}</span>
                          <span className="text-white font-black text-lg">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
              }
            </div>

            <div className="rounded-2xl p-6" style={CARD}>
              <h3 className="text-base font-bold text-white mb-5">Runs Per Bot</h3>
              {barData.length === 0
                ? <p className="text-slate-600 text-sm text-center py-10">No data yet</p>
                : <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={barData} margin={{top:0,right:0,left:-20,bottom:0}}>
                      <XAxis dataKey="name" tick={{fill:'#475569',fontSize: 13.2}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:'#475569',fontSize: 13.2}} axisLine={false} tickLine={false}/>
                      <Tooltip contentStyle={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,fontSize: 14.4}} cursor={{fill:'rgba(255,255,255,0.04)'}}/>
                      <Bar dataKey="runs" fill="#00f5ff" radius={[6,6,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
              }
            </div>

          </div>

        </main>

        {/* Right rail (Clock + News) is rendered globally by <RightSidebar/> in layout.tsx */}
      </div>
    </div>
  )
}
