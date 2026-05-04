'use client'
import React from 'react'
import { timeAgo } from '@/lib/time'

interface BotData {
  id: string | number; name: string; status: string
  run_count: number; last_run_at: string | null
}
interface LogEntry  { id: string | number; level: string; message: string; created_at: string }
interface ConnEntry { id: string | number; name: string }
interface TradeEntry {
  id: string | number; symbol: string; side: string
  entry_price: number | null; exit_price: number | null; pnl: number | null
  created_at: string
}
interface StatsEntry {
  total_trades: number; winning_trades: number; losing_trades: number
  win_rate: number; total_pnl: number; total_winning: number; total_losing: number
}

export interface BotTypeOverviewProps {
  botType: string
  panel: BotData
  panelLogs: LogEntry[]
  panelConns: ConnEntry[]
  trades: TradeEntry[]
  tradeStats: StatsEntry | null
}

const CARD = {
  background: 'var(--card)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  boxShadow: 'var(--shadow-card)',
} as React.CSSProperties

const STATUS_COLORS: Record<string, string> = {
  RUNNING: 'var(--accent)', IDLE: '#475569', ERROR: '#ff4444', STOPPED: '#f59e0b',
}

function pnlColor(n: number | null) {
  if (n == null) return '#94a3b8'
  return n > 0 ? '#00f5ff' : n < 0 ? '#ff4444' : '#94a3b8'
}
function fmt(n: number | null, prefix = '') {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const s = abs >= 1000
    ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : abs.toFixed(2)
  return `${n < 0 ? '-' : ''}${prefix}${s}`
}

function StatCard({ label, value, color, sub }: { label: string; value: React.ReactNode; color?: string; sub?: string }) {
  return (
    <div className="rounded-2xl p-4" style={CARD}>
      <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">{label}</p>
      <p className="font-black text-xl" style={{ color: color ?? 'white' }}>{value}</p>
      {sub && <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  )
}

function SH({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{children}</p>
}

function PlaceholderRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-bold" style={{ color: color ?? '#94a3b8' }}>{value}</span>
    </div>
  )
}

function PnlSparkline({ trades }: { trades: TradeEntry[] }) {
  const pts = trades.filter(t => t.pnl != null)
  if (pts.length < 2) {
    return <p className="text-xs text-slate-700 text-center py-6">No trade data yet — run the bot to see performance</p>
  }
  const vals = pts.map(t => t.pnl as number)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const W = 400; const H = 56
  const points = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`)
  const isPos = vals[vals.length - 1] >= vals[0]
  const stroke = isPos ? '#00f5ff' : '#ff4444'
  const lastPnl = vals[vals.length - 1]
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline points={points.join(' ')} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-xs mt-1">
        <span className="text-slate-600">{pts.length} data points</span>
        <span className="font-bold" style={{ color: pnlColor(lastPnl) }}>
          Latest: {(lastPnl >= 0 ? '+' : '') + fmt(lastPnl, '$')}
        </span>
      </div>
    </div>
  )
}

export default function BotTypeOverview({ botType, panel, panelLogs, panelConns, trades, tradeStats }: BotTypeOverviewProps) {
  const errCount = panelLogs.filter(l => l.level === 'ERROR').length
  const pnl      = tradeStats?.total_pnl ?? null
  const pnlStr   = pnl != null ? ((pnl >= 0 ? '+' : '') + fmt(pnl, '$')) : '—'
  const winRate  = tradeStats ? tradeStats.win_rate + '%' : '—'
  const sc       = STATUS_COLORS[panel.status] ?? '#94a3b8'

  // ── Trading Bot ──────────────────────────────────────────────────────────────
  if (botType === 'trading') {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total Runs"  value={panel.run_count} />
          <StatCard label="Error Count" value={errCount} color={errCount > 0 ? '#ef4444' : '#94a3b8'} />
          <StatCard label="Last Run"    value={timeAgo(panel.last_run_at)} />
          <StatCard label="Bot Status"  value={panel.status} color={sc} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>Current P&L</SH>
            <p className="text-3xl font-black" style={{ color: pnlColor(pnl) }}>{pnlStr}</p>
            {tradeStats && (
              <p className="text-xs text-slate-600 mt-1.5">
                {tradeStats.winning_trades}W / {tradeStats.losing_trades}L · {winRate} win rate
              </p>
            )}
          </div>
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>Active Positions</SH>
            <p className="text-slate-500 text-sm">No open positions</p>
            <p className="text-xs text-slate-700 mt-1">Live positions will appear here when the bot enters trades</p>
          </div>
        </div>

        {trades.length > 0 && (
          <div>
            <SH>Recent Trades</SH>
            <div className="rounded-2xl overflow-hidden" style={CARD}>
              {trades.slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                  <span className="text-xs font-black w-12" style={{ color: (t.side === 'BUY' || t.side === 'LONG') ? 'var(--accent)' : '#f59e0b' }}>{t.side}</span>
                  <span className="text-xs text-slate-400 font-mono flex-1">{t.symbol}</span>
                  <span className="text-xs font-black font-mono tabular-nums" style={{ color: pnlColor(t.pnl) }}>
                    {t.pnl != null ? ((t.pnl >= 0 ? '+' : '') + fmt(t.pnl, '$')) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl p-5" style={CARD}>
          <SH>Performance Chart</SH>
          <PnlSparkline trades={trades} />
        </div>
      </div>
    )
  }

  // ── Prediction Market Bot ────────────────────────────────────────────────────
  if (botType === 'prediction') {
    const totalVol = tradeStats
      ? fmt(Math.abs(tradeStats.total_winning) + Math.abs(tradeStats.total_losing), '$')
      : '—'
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total Markets" value={panel.run_count} />
          <StatCard label="Active Bets"   value={trades.filter(t => !t.exit_price).length || '—'} color="var(--accent)" />
          <StatCard label="Win Rate"      value={winRate} color={tradeStats && tradeStats.win_rate >= 50 ? '#00f5ff' : '#94a3b8'} />
          <StatCard label="Total Volume"  value={totalVol} />
        </div>

        <div>
          <SH>Live Events</SH>
          <div className="space-y-2">
            <PlaceholderRow label="Scanning for market events..." value="Active" color="var(--accent)" />
            {panelConns.length === 0 && <PlaceholderRow label="Add Kalshi API key to see live events" value="" />}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>My Predictions</SH>
            {trades.length === 0
              ? <><p className="text-slate-500 text-sm">No active predictions</p><p className="text-xs text-slate-700 mt-1">Open positions will appear here</p></>
              : trades.slice(0, 3).map(t => (
                  <div key={t.id} className="flex justify-between text-xs py-1.5 border-b border-white/[0.04] last:border-0">
                    <span className="text-slate-400 font-mono">{t.symbol}</span>
                    <span className="font-bold" style={{ color: (t.side === 'BUY' || t.side === 'LONG') ? '#22c55e' : '#ef4444' }}>
                      {(t.side === 'BUY' || t.side === 'LONG') ? 'YES' : 'NO'}
                    </span>
                  </div>
                ))
            }
          </div>
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>Leaderboard</SH>
            <p className="text-slate-500 text-sm">Ranking not available</p>
            <p className="text-xs text-slate-700 mt-1">Platform integration required</p>
          </div>
        </div>

        {trades.length > 0 && (
          <div>
            <SH>Recent Outcomes</SH>
            <div className="rounded-2xl overflow-hidden" style={CARD}>
              {trades.slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                  <span className="text-xs font-black" style={{ color: (t.side === 'BUY' || t.side === 'LONG') ? '#22c55e' : '#ef4444' }}>
                    {(t.side === 'BUY' || t.side === 'LONG') ? 'YES' : 'NO'}
                  </span>
                  <span className="text-xs text-slate-400 font-mono flex-1">{t.symbol}</span>
                  <span className="text-xs font-black font-mono tabular-nums" style={{ color: pnlColor(t.pnl) }}>
                    {t.pnl != null ? ((t.pnl >= 0 ? '+' : '') + fmt(t.pnl, '$')) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl p-5" style={CARD}>
          <SH>Probability Chart</SH>
          <PnlSparkline trades={trades} />
        </div>
      </div>
    )
  }

  // ── Grid Trading Bot ─────────────────────────────────────────────────────────
  if (botType === 'grid') {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Grid Levels"     value="—" />
          <StatCard label="Current Range"   value="—" />
          <StatCard label="Grids Filled"    value={tradeStats?.total_trades ?? '—'} />
          <StatCard label="Grid P&L"        value={pnlStr} color={pnlColor(pnl)} />
        </div>

        <div>
          <SH>Active Orders</SH>
          <div className="space-y-2">
            {trades.length === 0 ? (
              <>
                <PlaceholderRow label="No active grid orders" value="—" />
                <PlaceholderRow label="Set grid parameters in bot code" value="" />
              </>
            ) : trades.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="text-xs font-bold" style={{ color: (t.side === 'BUY' || t.side === 'LONG') ? 'var(--accent)' : '#f59e0b' }}>{t.side}</span>
                <span className="text-xs text-slate-400 font-mono">{t.symbol}</span>
                <span className="text-xs font-mono" style={{ color: pnlColor(t.pnl) }}>{fmt(t.entry_price, '$')}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>Range History</SH>
            <p className="text-slate-500 text-sm">No range data</p>
            <p className="text-xs text-slate-700 mt-1">Grid boundaries will appear here</p>
          </div>
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>Performance Chart</SH>
            <PnlSparkline trades={trades} />
          </div>
        </div>
      </div>
    )
  }

  // ── DCA Bot ──────────────────────────────────────────────────────────────────
  if (botType === 'dca') {
    const avgBuy = tradeStats && tradeStats.total_trades > 0
      ? fmt((tradeStats.total_winning + tradeStats.total_losing) / tradeStats.total_trades, '$')
      : '—'
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total Investments" value={tradeStats?.total_trades ?? '—'} sub="buy orders" />
          <StatCard label="Avg Buy Price"      value={avgBuy} />
          <StatCard label="Total Coins"        value={tradeStats?.total_trades ? `${tradeStats.total_trades}` : '—'} sub="units accumulated" />
          <StatCard label="Current Value"      value={pnlStr} color={pnlColor(pnl)} />
        </div>

        <div>
          <SH>DCA History</SH>
          <div className="space-y-2">
            {trades.length === 0 ? (
              <PlaceholderRow label="No DCA purchases yet" value="—" />
            ) : trades.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="text-xs text-slate-600 font-mono">{new Date(t.created_at).toLocaleDateString()}</span>
                <span className="text-xs text-slate-400">{t.symbol}</span>
                <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>{fmt(t.entry_price, '$')}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>Next Buy Time</SH>
            <p className="text-slate-500 text-sm">Scheduled by bot</p>
            <p className="text-xs text-slate-700 mt-1">Depends on your DCA interval settings</p>
          </div>
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>Profit / Loss Summary</SH>
            <p className="text-2xl font-black" style={{ color: pnlColor(pnl) }}>{pnlStr}</p>
            {tradeStats && <p className="text-xs text-slate-600 mt-1">{winRate} win rate</p>}
          </div>
        </div>
      </div>
    )
  }

  // ── Arbitrage Bot ────────────────────────────────────────────────────────────
  if (botType === 'arbitrage') {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Active Exchanges"    value={panelConns.length || '—'} color={panelConns.length > 0 ? 'var(--accent)' : undefined} />
          <StatCard label="Price Differences"   value="—" />
          <StatCard label="Arb Trades"          value={tradeStats?.total_trades ?? '—'} />
          <StatCard label="Profit from Spreads" value={pnlStr} color={pnlColor(pnl)} />
        </div>

        <div>
          <SH>Live Opportunities</SH>
          <div className="space-y-2">
            <PlaceholderRow label="Scanning exchanges for price discrepancies..." value="Active" color="var(--accent)" />
            {panelConns.length === 0 && <PlaceholderRow label="Add exchange API keys to start scanning" value="" />}
          </div>
        </div>

        <div>
          <SH>Execution Log</SH>
          <div className="rounded-2xl overflow-hidden" style={CARD}>
            <div className="max-h-36 overflow-y-auto p-4 font-mono text-xs space-y-1.5">
              {panelLogs.length === 0 ? (
                <p className="text-slate-700">No execution logs yet — run the bot.</p>
              ) : [...panelLogs].slice(-8).reverse().map(l => (
                <div key={l.id} className="flex gap-2">
                  <span className="shrink-0 font-black"
                    style={{ color: l.level === 'ERROR' ? '#ef4444' : l.level === 'WARNING' ? '#f59e0b' : '#3b82f6' }}>
                    [{l.level}]
                  </span>
                  <span className="text-slate-400 break-all">{l.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-5" style={CARD}>
          <SH>Total Profit</SH>
          <p className="text-3xl font-black" style={{ color: pnlColor(pnl) }}>{pnlStr}</p>
          {tradeStats && (
            <p className="text-xs text-slate-600 mt-1.5">
              {tradeStats.total_trades} arbitrage executions · {winRate} success rate
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Scalping Bot ─────────────────────────────────────────────────────────────
  if (botType === 'scalping') {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const todayCount = trades.filter(t => new Date(t.created_at).getTime() >= startOfDay.getTime()).length
    const settled    = trades.filter(t => t.pnl != null)
    const winsArr    = settled.filter(t => (t.pnl ?? 0) > 0)
    const totalWin   = winsArr.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
    const totalLoss  = settled.filter(t => (t.pnl ?? 0) < 0).reduce((acc, t) => acc + (t.pnl ?? 0), 0)

    let avgSec: number | null = null
    if (trades.length >= 2) {
      const sorted = [...trades].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const gaps: number[] = []
      for (let i = 1; i < sorted.length; i++) {
        const dt = (new Date(sorted[i].created_at).getTime() - new Date(sorted[i - 1].created_at).getTime()) / 1000
        if (dt > 0 && dt < 3600) gaps.push(dt)
      }
      if (gaps.length > 0) avgSec = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
    }
    const fmtDur = (s: number | null) => {
      if (s == null) return '—'
      if (s < 60) return `${s}s`
      const m = Math.floor(s / 60); const r = s % 60
      return `${m}m ${r}s`
    }

    const recent = settled.slice(0, 10)
    const recentPnl = recent.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
    const momentumLabel = recent.length === 0 ? 'NEUTRAL' : recentPnl > 0 ? 'BULLISH' : recentPnl < 0 ? 'BEARISH' : 'NEUTRAL'
    const momentumColor = momentumLabel === 'BULLISH' ? '#22c55e' : momentumLabel === 'BEARISH' ? '#ff4444' : '#94a3b8'

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Trades Today"        value={todayCount} color={todayCount > 0 ? '#ec4899' : undefined} />
          <StatCard label="Avg Trade Duration"  value={fmtDur(avgSec)} />
          <StatCard label="Win Rate"            value={winRate} color={tradeStats && tradeStats.win_rate >= 50 ? '#22c55e' : '#94a3b8'} />
          <StatCard label="Total Scalps"        value={trades.length} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>Current Momentum</SH>
            <p className="text-2xl font-black" style={{ color: momentumColor }}>{momentumLabel}</p>
            <p className="text-xs text-slate-600 mt-1.5">
              {recent.length === 0 ? 'no settled scalps yet' : `last ${recent.length} settled · ${recentPnl >= 0 ? '+' : ''}${fmt(recentPnl, '$')}`}
            </p>
          </div>
          <div className="rounded-2xl p-5" style={CARD}>
            <SH>P&L Summary</SH>
            <p className="text-3xl font-black" style={{ color: pnlColor(pnl) }}>{pnlStr}</p>
            <div className="flex justify-between mt-2 text-xs">
              <span style={{ color: '#22c55e' }}>+{fmt(totalWin, '$')} wins</span>
              <span style={{ color: '#ff4444' }}>{fmt(totalLoss, '$')} losses</span>
            </div>
          </div>
        </div>

        {trades.length > 0 && (
          <div>
            <SH>Recent Scalps</SH>
            <div className="rounded-2xl overflow-hidden" style={CARD}>
              {trades.slice(0, 6).map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-0">
                  <span className="text-xs font-black w-12" style={{ color: (t.side === 'BUY' || t.side === 'LONG') ? '#22c55e' : '#ff4444' }}>{t.side}</span>
                  <span className="text-xs text-slate-400 font-mono flex-1">{t.symbol}</span>
                  <span className="text-xs font-black font-mono tabular-nums" style={{ color: pnlColor(t.pnl) }}>
                    {t.pnl != null ? ((t.pnl >= 0 ? '+' : '') + fmt(t.pnl, '$')) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Telegram Bot ─────────────────────────────────────────────────────────────
  if (botType === 'telegram') {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Runs"     value={panel.run_count} />
          <StatCard label="Messages Sent"  value="—" />
          <StatCard label="Last Run"       value={timeAgo(panel.last_run_at)} />
        </div>

        <div>
          <SH>Connected Chats</SH>
          <div className="space-y-2">
            <PlaceholderRow label="No chats connected" value="—" />
            <PlaceholderRow label="Set TELEGRAM_BOT_TOKEN in bot code" value="" />
          </div>
        </div>

        <div>
          <SH>Recent Messages</SH>
          <div className="rounded-2xl overflow-hidden" style={CARD}>
            <div className="p-4 font-mono text-xs space-y-2 max-h-48 overflow-y-auto">
              {panelLogs.length === 0 ? (
                <p className="text-slate-700">No messages logged yet</p>
              ) : [...panelLogs].reverse().slice(0, 6).map(l => (
                <div key={l.id} className="flex gap-2">
                  <span className="shrink-0 text-slate-600">{new Date(l.created_at).toLocaleTimeString()}</span>
                  <span className="text-slate-400 break-all">{l.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Default (custom / untyped) ───────────────────────────────────────────────
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard label="Total Runs" value={panel.run_count} />
      <StatCard label="Last Run"   value={timeAgo(panel.last_run_at)} />
      <StatCard label="API Keys"   value={panelConns.length} />
    </div>
  )
}
