'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { dashboardApi, botsApi } from '@/lib/api'
import { formatShortDateTimeCT, getLocalTZAbbr } from '@/lib/time'
import Navbar from '@/components/Navbar'
import AiFixModal from '@/components/AiFixModal'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

interface Log { id: number; bot_id: number; level: string; message: string; created_at: string }
interface Bot { id: number; name: string; status?: string }

const CARD_STYLE = { background: 'var(--card)', backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: 'var(--shadow-card)' }

const LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  INFO:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  WARNING: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  ERROR:   { color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
}

const MAX_LOGS = 1000   // cap in-memory log array

export default function LogsPage() {
  const router = useRouter()
  const [logs, setLogs] = useState<Log[]>([])
  const [bots, setBots] = useState<Bot[]>([])
  const [botFilter, setBotFilter] = useState('ALL')
  const [levelFilter, setLevelFilter] = useState('ALL')
  const [netErr, setNetErr] = useState(false)
  const [tzAbbr, setTzAbbr] = useState('Local')

  // ── AI Fix modal ─────────────────────────────────────────────────────────
  const [aiFixOpen, setAiFixOpen] = useState(false)
  const [aiFixBotId, setAiFixBotId] = useState<number | null>(null)

  // ── Incremental streaming refs ────────────────────────────────────────────
  const sinceIdRef = useRef<number>(0)   // highest log id we have fetched

  // ── Auto-scroll refs ──────────────────────────────────────────────────────
  const scrollRef  = useRef<HTMLDivElement>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const pinnedRef  = useRef(true)
  const [pinned, setPinnedState] = useState(true)

  const setPinned = (v: boolean) => { pinnedRef.current = v; setPinnedState(v) }

  // Scroll to bottom when new logs arrive (only if pinned)
  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, botFilter, levelFilter])

  // Detect manual scroll: unpin on scroll-up, re-pin when reaching the bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setPinned(atBottom)
  }, [])

  // ── Initial full load ─────────────────────────────────────────────────────
  const initialLoad = useCallback(async () => {
    try {
      const [logsResp, botsResp] = await Promise.all([
        dashboardApi.logs(0, 500),   // latest 500 in desc order
        botsApi.getAll(),
      ])
      const fetched: Log[] = logsResp.data ?? []
      setLogs(fetched)
      setBots(botsResp.data ?? [])
      if (fetched.length > 0) {
        // Use Math.max in case created_at ties cause id order to differ from position
        sinceIdRef.current = Math.max(...fetched.map(l => l.id))
      }
      setNetErr(false)
    } catch { setNetErr(true) }
  }, [])

  // ── Incremental poll: only fetch new lines ────────────────────────────────
  const pollNewLogs = useCallback(async () => {
    try {
      const r = await dashboardApi.logs(sinceIdRef.current, 500)
      const newLines: Log[] = r.data ?? []
      if (newLines.length > 0) {
        // newLines is asc-ordered (since_id > 0); highest id is last
        sinceIdRef.current = newLines[newLines.length - 1].id
        // Append to the top (logs array is desc-ordered for display)
        setLogs(prev => [...newLines.reverse(), ...prev].slice(0, MAX_LOGS))
      }
      setNetErr(false)
    } catch { setNetErr(true) }
  }, [])

  // Refresh bot list (to know which are RUNNING → faster poll interval)
  const refreshBots = useCallback(async () => {
    try { const r = await botsApi.getAll(); setBots(r.data ?? []) } catch {}
  }, [])

  // Set timezone abbreviation client-side (after hydration)
  useEffect(() => { setTzAbbr(getLocalTZAbbr()) }, [])

  // ── Main polling loop ─────────────────────────────────────────────────────
  useEffect(() => {
    initialLoad()

    // Poll new log lines at 1.5 s — cheap incremental request
    const logTimer  = setInterval(pollNewLogs, 1500)
    // Refresh bot list every 3 s (keeps status badges and filter list fresh)
    const botTimer  = setInterval(refreshBots, 3000)

    return () => { clearInterval(logTimer); clearInterval(botTimer) }
  }, [initialLoad, pollNewLogs, refreshBots])

  // Immediate reload on reconnect
  useOnlineStatus(() => {
    sinceIdRef.current = 0
    initialLoad()
  })

  const botName = (id: number) => bots.find(b => b.id === id)?.name || `Bot #${id}`
  const anyRunning = bots.some(b => b.status === 'RUNNING')

  const filtered = logs.filter(l => {
    if (botFilter   !== 'ALL' && l.bot_id.toString() !== botFilter)  return false
    if (levelFilter !== 'ALL' && l.level !== levelFilter) return false
    return true
  })

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Navbar />
      <div className="flex" style={{minHeight:'100vh'}}>
        <main className="min-w-0 px-8 py-10" style={{width:'100%'}}>

        {/* Network error banner */}
        {netErr && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-6 text-sm font-semibold"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
            Local backend unreachable — retrying… Check that FastAPI is running on port 8000 and CORS allows the app.
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold text-white">Logs</h1>
            <p className="text-slate-500 mt-1.5">Real-time activity across all your bots</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Debug with Cloud AI */}
            <button
              onClick={() => {
                const targetId = botFilter !== 'ALL'
                  ? parseInt(botFilter)
                  : (logs.find(l => l.level === 'ERROR' || l.level === 'WARNING')?.bot_id ?? (bots[0]?.id ?? null))
                if (targetId) { setAiFixBotId(targetId); setAiFixOpen(true) }
              }}
              className="flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-xl transition-all hover:scale-105"
              style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.2)' }}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              Debug with Cloud AI
            </button>
            <span className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl"
              style={{ color: anyRunning ? '#00f5ff' : '#475569', background: anyRunning ? 'var(--accent-dim)' : 'rgba(255,255,255,0.04)', border: `1px solid ${anyRunning ? 'rgba(0,245,255,0.2)' : 'rgba(255,255,255,0.08)'}` }}>
              <span className={`w-2 h-2 rounded-full ${anyRunning ? 'bg-[#00f5ff] animate-pulse' : 'bg-slate-600'}`} />
              {anyRunning ? 'Live' : 'Idle'}
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <select value={botFilter} onChange={e => setBotFilter(e.target.value)}
            className="rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
            <option value="ALL">All Bots</option>
            {bots.map(b => <option key={b.id} value={b.id.toString()}>{b.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            {['ALL', 'INFO', 'WARNING', 'ERROR'].map(l => (
              <button key={l} onClick={() => setLevelFilter(l)}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                style={levelFilter === l
                  ? { background: l === 'ALL' ? 'rgba(255,255,255,0.1)' : LEVEL_STYLE[l]?.bg, color: l === 'ALL' ? 'white' : LEVEL_STYLE[l]?.color, border: `1px solid ${l === 'ALL' ? 'rgba(255,255,255,0.2)' : LEVEL_STYLE[l]?.color + '44'}` }
                  : { background: 'var(--card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                {l}
              </button>
            ))}
          </div>
          <span className="ml-auto text-slate-600 text-xs">{filtered.length} entries</span>
        </div>

        {/* Log table */}
        <div className="rounded-2xl overflow-hidden relative" style={CARD_STYLE}>
          <div className="px-5 py-3 border-b border-white/[0.05] flex items-center gap-3">
            <span className="text-xs text-slate-600 font-mono uppercase tracking-widest">Timestamp</span>
            <span className="text-xs text-slate-600 font-mono uppercase tracking-widest w-20">Level</span>
            <span className="text-xs text-slate-600 font-mono uppercase tracking-widest w-32">Bot</span>
            <span className="text-xs text-slate-600 font-mono uppercase tracking-widest">Message</span>
          </div>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-[560px] overflow-y-auto font-mono text-xs"
          >
            {filtered.length === 0 ? (
              <p className="text-slate-600 text-center pt-24 font-sans text-sm">No logs found</p>
            ) : (
              filtered.map(log => {
                const lvl = LEVEL_STYLE[log.level] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' }
                return (
                  <div key={log.id} className="flex items-start gap-3 px-5 py-3 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <span className="text-slate-600 tabular-nums shrink-0 w-36">
                      {formatShortDateTimeCT(log.created_at)} <span className="text-slate-700 text-[12px]">{tzAbbr}</span>
                    </span>
                    <span className="shrink-0 w-20 text-[12px] font-black px-2 py-0.5 rounded uppercase text-center"
                      style={{ color: lvl.color, background: lvl.bg }}>
                      {log.level}
                    </span>
                    <span className="shrink-0 w-32 text-slate-500 truncate">{botName(log.bot_id)}</span>
                    <span className="text-slate-300 break-all flex-1">{log.message}</span>
                  </div>
                )
              })
            )}
            {/* Sentinel — scrolled into view on new logs when pinned */}
            <div ref={bottomRef} />
          </div>

          {/* ── Scroll-to-bottom button (visible only when unpinned) ── */}
          {!pinned && (
            <button
              onClick={() => {
                setPinned(true)
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="absolute bottom-4 right-5 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all hover:scale-105 active:scale-95"
              style={{
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                boxShadow: '0 4px 16px rgba(0,245,255,0.15)',
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v10M3 9l5 5 5-5"/>
              </svg>
              Latest
            </button>
          )}
        </div>
      </main>
      </div>

      {/* ── AI Fix Modal ── */}
      {aiFixOpen && aiFixBotId !== null && (() => {
        const errLines = logs
          .filter(l => l.bot_id === aiFixBotId && (l.level === 'ERROR' || l.level === 'WARNING'))
          .slice(-60)
          .map(l => `${l.created_at} | ${l.level.padEnd(7)} | ${l.message}`)
        return (
          <AiFixModal
            botId={aiFixBotId}
            botCode={''}
            errorLogs={errLines}
            onApply={() => {}}
            onClose={() => { setAiFixOpen(false); setAiFixBotId(null) }}
          />
        )
      })()}
    </div>
  )
}
