'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import { aiModelsApi } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────
interface AIModel {
  id:                 number
  name:               string
  description:        string
  status:             'idle' | 'training' | 'ready' | 'error'
  total_data_points:  number
  last_trained_at:    string | null
  created_at:         string
  connected_bot_ids:  number[]
  live_sync:          boolean
  training_mode:      string
  training_frequency: string
  files:              { id: number }[]
  training_runs:      { id: number; status: string; created_at?: string }[]
}

// ── Design tokens — exactly matching the main dashboard ───────────────────────
const BG = 'var(--bg)'
const CARD: React.CSSProperties = {
  background: 'var(--card)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  boxShadow: 'var(--shadow-card)',
}
const CYAN   = '#00f5ff'
const GREEN  = '#22c55e'
const RED    = '#ef4444'
const PURPLE = '#a78bfa'
const AMBER  = '#f59e0b'
const NAVY = 'var(--card)'

const NAVBAR_H = 96

// ── Status helpers ────────────────────────────────────────────────────────────
function statusMeta(s: string) {
  if (s === 'ready')    return { label: 'TRAINED',     color: GREEN,  glow: GREEN,  pulse: false }
  if (s === 'training') return { label: 'TRAINING…',   color: AMBER,  glow: AMBER,  pulse: true  }
  if (s === 'error')    return { label: 'ERROR',        color: RED,    glow: RED,    pulse: false }
  return                       { label: 'NOT TRAINED',  color: 'var(--text-muted)', glow: 'transparent', pulse: false }
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function relTime(d: string | null) {
  if (!d) return '—'
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TrainerPage() {
  const router = useRouter()
  const [models, setModels]     = useState<AIModel[]>([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew]   = useState(false)
  const [newName, setNewName]   = useState('')
  const [newDesc, setNewDesc]   = useState('')
  const [toast, setToast]       = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const load = async () => {
    try {
      const r = await aiModelsApi.getAll()
      setModels(r.data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    pollRef.current = setInterval(load, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) { showToast('Enter a model name', 'err'); return }
    setCreating(true)
    try {
      const r = await aiModelsApi.create({ name: newName.trim(), description: newDesc.trim() })
      setModels(prev => [r.data, ...prev])
      setShowNew(false); setNewName(''); setNewDesc('')
      router.push(`/trainer/detail?id=${r.data.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err?.response?.data?.detail || 'Failed to create model', 'err')
    } finally { setCreating(false) }
  }

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    if (!confirm('Delete this AI model? Uploaded files will be removed.')) return
    try {
      await aiModelsApi.delete(id)
      setModels(prev => prev.filter(m => m.id !== id))
      showToast('Model deleted')
    } catch { showToast('Failed to delete', 'err') }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const totalDataPts  = models.reduce((a, m) => a + m.total_data_points, 0)
  const trainedCount  = models.filter(m => m.status === 'ready').length
  const trainingNow   = models.filter(m => m.status === 'training')
  const liveSyncCount = models.filter(m => m.live_sync).length
  const allBotIds     = Array.from(new Set(models.flatMap(m => m.connected_bot_ids)))

  const statCards = [
    { label: 'Total Models',    value: models.length,              sub: 'All AI models',        accent: PURPLE, icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
    { label: 'Trained',         value: trainedCount,               sub: 'Ready to use',         accent: GREEN,  icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    { label: 'Data Points',     value: totalDataPts.toLocaleString(), sub: 'Across all models',  accent: CYAN,   icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { label: 'Bots Connected',  value: allBotIds.length,           sub: 'Unique bots',          accent: AMBER,  icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  ]

  if (loading) return (
    <div className="min-h-screen" style={{ background: BG }}>
      <Navbar />
      <div className="flex items-center justify-center" style={{ minHeight: `calc(100vh - ${NAVBAR_H}px)` }}>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-[#a78bfa] border-t-transparent animate-spin" />
          <span className="text-slate-500 text-sm font-medium">Loading AI Lab…</span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: BG }}>
      <Navbar />

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed z-[100] text-sm font-semibold px-5 py-3 rounded-2xl transition-all"
          style={{
            top: 108, right: 24,
            background: toast.type === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${toast.type === 'ok' ? GREEN : RED}44`,
            color: toast.type === 'ok' ? GREEN : RED,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
          {toast.msg}
        </div>
      )}

      {/* ── Create Model Modal ── */}
      {showNew && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          onClick={() => setShowNew(false)}>
          <div className="absolute inset-0" style={{ background: 'rgba(2,4,12,0.78)', backdropFilter: 'blur(16px)' }} />
          <div className="relative w-full max-w-lg rounded-[28px] p-10 overflow-hidden"
            onClick={e => e.stopPropagation()}
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015)), var(--card)',
              backdropFilter: 'blur(56px) saturate(220%)',
              WebkitBackdropFilter: 'blur(56px) saturate(220%)',
              boxShadow: '0 48px 120px rgba(0,0,0,0.8), 0 0 0 1px rgba(167,139,250,0.18) inset, 0 0 80px rgba(167,139,250,0.12)',
              border: '1px solid rgba(167,139,250,0.28)',
            }}>
            {/* Ambient glow */}
            <div className="absolute -top-32 -right-24 w-[420px] h-[420px] pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.18), transparent 60%)' }} />
            <div className="absolute -bottom-32 -left-24 w-[360px] h-[360px] pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(0,245,255,0.10), transparent 60%)' }} />

            {/* Modal header */}
            <div className="flex items-center gap-4 mb-8 relative">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                style={{
                  background: 'linear-gradient(135deg,rgba(167,139,250,0.28),rgba(0,245,255,0.12))',
                  border: '1px solid rgba(167,139,250,0.35)',
                  boxShadow: '0 8px 32px rgba(167,139,250,0.3), 0 0 0 1px rgba(255,255,255,0.06) inset',
                }}>
                🧠
              </div>
              <div>
                <h2 className="text-[22px] font-black text-white tracking-[-0.02em]"
                  style={{ fontFamily: 'Poppins, Inter, system-ui, sans-serif' }}>
                  New AI Model
                </h2>
                <p className="text-[13px] text-slate-400 mt-0.5">Name it — we'll set up the workspace.</p>
              </div>
            </div>

            <label className="block text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] mb-2.5 relative">
              Model Name <span style={{ color: RED }}>*</span>
            </label>
            <input
              autoFocus value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. BTC Scalper v1"
              className="relative w-full rounded-2xl px-4 py-3.5 text-[15px] text-white placeholder-slate-600 focus:outline-none mb-5 transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.02) inset',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = `${PURPLE}60`; e.currentTarget.style.boxShadow = `0 0 0 4px ${PURPLE}22` }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.02) inset' }}
            />

            <label className="block text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] mb-2.5 relative">
              Description <span className="text-slate-600 font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="What will this model learn?"
              rows={3}
              className="relative w-full rounded-2xl px-4 py-3.5 text-[15px] text-white placeholder-slate-600 focus:outline-none resize-none mb-8 transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                fontFamily: 'inherit',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.02) inset',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = `${PURPLE}60`; e.currentTarget.style.boxShadow = `0 0 0 4px ${PURPLE}22` }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.02) inset' }}
            />

            <div className="flex gap-3 relative">
              <button onClick={() => setShowNew(false)}
                className="flex-1 py-3.5 rounded-2xl text-[14px] font-bold text-slate-400 hover:text-white transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)' }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={creating}
                className="flex-[2] py-3.5 rounded-2xl text-[14px] font-black text-white transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98] tracking-wide"
                style={{
                  background: creating ? 'rgba(167,139,250,0.35)' : 'linear-gradient(135deg,#a78bfa 0%,#7c3aed 60%,#5b21b6 100%)',
                  boxShadow: creating ? 'none' : '0 10px 36px rgba(124,58,237,0.55), 0 0 0 1px rgba(255,255,255,0.12) inset',
                }}>
                {creating ? 'Creating…' : 'Create & Open →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          THREE-COLUMN LAYOUT  —  15% / 62% / 23%  (mirrors Dashboard)
      ══════════════════════════════════════════════════════════════ */}
      <div className="flex items-start" style={{ minHeight: `calc(100vh - ${NAVBAR_H}px)` }}>

        {/* ── LEFT SIDEBAR — 15% ──────────────────────────────────── */}
        <aside className="shrink-0 sticky p-3 flex flex-col gap-3"
          style={{ width: '15%', top: NAVBAR_H, height: `calc(100vh - ${NAVBAR_H}px)`, overflowY: 'auto' }}>

          {/* Lab identity card */}
          <div className="rounded-2xl p-4" style={CARD}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
                style={{ background: 'linear-gradient(135deg,rgba(167,139,250,0.25),rgba(0,245,255,0.12))', border: '1px solid rgba(167,139,250,0.3)' }}>
                🧠
              </div>
              <div>
                <p className="text-sm font-black text-white leading-none">AI Lab</p>
                <p className="text-[12px] text-slate-600 mt-0.5">Model Training</p>
              </div>
            </div>
            <p className="text-[13.2px] text-slate-500 leading-relaxed">
              Train AI models on your bot's live trade data to improve prediction accuracy over time.
            </p>
          </div>

          {/* Mini stat pills */}
          <div className="rounded-2xl p-4 flex flex-col gap-2.5" style={CARD}>
            <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-0.5">Lab Stats</p>
            {[
              { label: 'Models',      value: models.length,                 color: PURPLE },
              { label: 'Trained',     value: trainedCount,                  color: GREEN  },
              { label: 'Live Sync',   value: liveSyncCount,                 color: CYAN   },
              { label: 'Data Pts',    value: totalDataPts.toLocaleString(), color: AMBER  },
            ].map(s => (
              <div key={s.label} className="flex items-center justify-between px-3 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="text-[13.2px] text-slate-500">{s.label}</span>
                <span className="text-sm font-black" style={{ color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Training status */}
          {trainingNow.length > 0 && (
            <div className="rounded-2xl p-4" style={{ ...CARD, borderColor: `${AMBER}33` }}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: AMBER }} />
                <p className="text-xs font-bold" style={{ color: AMBER }}>Training Active</p>
              </div>
              {trainingNow.map(m => (
                <div key={m.id} className="text-[13.2px] text-slate-400 py-1.5 border-b last:border-0"
                  style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  <span className="font-semibold text-white truncate block">{m.name}</span>
                  <span className="text-slate-600">{m.total_data_points.toLocaleString()} pts</span>
                </div>
              ))}
            </div>
          )}

          {/* How it works */}
          <div className="rounded-2xl p-4" style={CARD}>
            <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-3">How It Works</p>
            {[
              { step: '1', text: 'Create a model',        color: PURPLE },
              { step: '2', text: 'Connect it to bots',    color: CYAN   },
              { step: '3', text: 'Enable Live Sync',       color: AMBER  },
              { step: '4', text: 'Train on trade data',    color: GREEN  },
            ].map(s => (
              <div key={s.step} className="flex items-center gap-2.5 mb-2 last:mb-0">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-black shrink-0"
                  style={{ background: s.color + '18', color: s.color, border: `1px solid ${s.color}30` }}>
                  {s.step}
                </div>
                <span className="text-[13.2px] text-slate-500">{s.text}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* ── CENTER — 62% ────────────────────────────────────────── */}
        <main className="min-w-0 px-6 py-8 flex flex-col" style={{ width: '62%', minHeight: `calc(100vh - ${NAVBAR_H}px)` }}>

          {/* Page header */}
          <div className="flex items-end justify-between mb-10">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-black tracking-[0.2em] uppercase px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(167,139,250,0.1)', color: PURPLE, border: '1px solid rgba(167,139,250,0.22)' }}>
                  AI Lab
                </span>
                <span className="text-[11px] font-bold tracking-wider text-slate-600">v3 · Neural Workspace</span>
              </div>
              <h1 className="text-[44px] font-black text-white leading-[1.05] tracking-[-0.03em]"
                style={{ fontFamily: 'Poppins, Inter, system-ui, sans-serif' }}>
                Train models that <span style={{
                  background: 'linear-gradient(135deg, #a78bfa, #00f5ff)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>think with your bots</span>
              </h1>
              <p className="text-slate-400 text-[15px] mt-3 max-w-xl leading-relaxed">
                {models.length === 0
                  ? 'Spin up your first model — connect bots, stream live trade data, and watch it sharpen with every cycle.'
                  : `${models.length} model${models.length !== 1 ? 's' : ''} · ${totalDataPts.toLocaleString()} data points · ${trainedCount} trained`}
              </p>
            </div>
            <button onClick={() => setShowNew(true)}
              className="group flex items-center gap-2.5 px-7 py-4 rounded-2xl font-black text-[14px] text-white transition-all hover:scale-[1.04] active:scale-[0.98] relative overflow-hidden shrink-0"
              style={{
                background: 'linear-gradient(135deg,#a78bfa 0%,#7c3aed 60%,#5b21b6 100%)',
                boxShadow: '0 10px 40px rgba(124,58,237,0.5), 0 0 1px rgba(255,255,255,0.4) inset, 0 -1px 0 rgba(0,0,0,0.3) inset',
                letterSpacing: '-0.01em',
              }}>
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.18), transparent 60%)' }} />
              <svg className="w-4 h-4 relative" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              <span className="relative">Create New Model</span>
            </button>
          </div>

          {/* ── Stat cards (4 across — mirrors dashboard) ── */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {statCards.map((c, i) => (
              <div key={i} className="rounded-2xl p-5 transition-all hover:scale-[1.02]" style={CARD}>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: c.accent + '18', border: `1px solid ${c.accent}30` }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: c.accent }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={c.icon} />
                    </svg>
                  </div>
                  {c.label === 'Trained' && trainedCount > 0 && (
                    <span className="w-2 h-2 rounded-full mt-1" style={{ background: GREEN }} />
                  )}
                </div>
                <p className="text-3xl font-black text-white mb-1">{c.value}</p>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{c.label}</p>
                <p className="text-xs text-slate-600 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* ── Model List ── */}
          {models.length === 0 ? (
            /* Empty state — no duplicate button; subtle guidance pointing to header CTA */
            <div className="flex-1 flex flex-col items-center justify-center rounded-3xl py-28 relative overflow-hidden"
              style={{
                ...CARD,
                border: '1px dashed rgba(167,139,250,0.18)',
                background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(167,139,250,0.06), transparent 60%), var(--card)',
              }}>
              {/* Ambient glow */}
              <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[420px] h-[420px] pointer-events-none"
                style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.16), transparent 60%)' }} />

              <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 relative"
                style={{
                  background: 'linear-gradient(135deg,rgba(167,139,250,0.22),rgba(0,245,255,0.08))',
                  border: '1px solid rgba(167,139,250,0.28)',
                  boxShadow: '0 12px 48px rgba(167,139,250,0.25), 0 0 0 1px rgba(255,255,255,0.04) inset',
                }}>
                🧠
              </div>
              <h2 className="text-2xl font-black text-white mb-2.5 tracking-[-0.02em]"
                style={{ fontFamily: 'Poppins, Inter, system-ui, sans-serif' }}>
                Your workspace is ready
              </h2>
              <p className="text-slate-400 text-[14px] text-center max-w-sm leading-relaxed mb-6">
                Build your first model to start streaming bot trades into a live training pipeline.
              </p>
              <div className="flex items-center gap-2 text-[13px] font-bold text-slate-500">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
                Use <span style={{ color: PURPLE }}>Create New Model</span> at the top right
              </div>
            </div>
          ) : (
            /* Model grid — 2 columns, premium glass cards */
            <div className="grid grid-cols-2 gap-6">
              {models.map(m => {
                const sm        = statusMeta(m.status)
                const isTraining = m.status === 'training'
                const isReady    = m.status === 'ready'
                const isError    = m.status === 'error'

                return (
                  <div key={m.id}
                    className="rounded-3xl overflow-hidden cursor-pointer group transition-all hover:-translate-y-1 relative"
                    style={{
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%), var(--card)',
                      backdropFilter: 'blur(48px) saturate(200%)',
                      WebkitBackdropFilter: 'blur(48px) saturate(200%)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: isTraining
                        ? `0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 40px ${AMBER}22`
                        : isReady
                        ? `0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 32px ${GREEN}18`
                        : isError
                        ? `0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 32px ${RED}18`
                        : '0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = `${PURPLE}55`
                      ;(e.currentTarget as HTMLDivElement).style.boxShadow = `0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px ${PURPLE}22 inset, 0 0 60px ${PURPLE}30`
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)'
                      ;(e.currentTarget as HTMLDivElement).style.boxShadow = isTraining
                        ? `0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 40px ${AMBER}22`
                        : isReady
                        ? `0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 32px ${GREEN}18`
                        : isError
                        ? `0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 32px ${RED}18`
                        : '0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset'
                    }}
                    onClick={() => router.push(`/trainer/detail?id=${m.id}`)}>

                    {/* Top accent gradient */}
                    <div style={{
                      height: 4,
                      background: isReady    ? `linear-gradient(90deg, ${GREEN}, ${GREEN}88, transparent)`
                        : isTraining ? `linear-gradient(90deg, ${AMBER}, ${AMBER}88, transparent)`
                        : isError    ? `linear-gradient(90deg, ${RED}, ${RED}88, transparent)`
                        : `linear-gradient(90deg, ${PURPLE}66, transparent)`,
                    }} />

                    {/* Ambient glow inside card */}
                    <div className="absolute -top-20 -right-20 w-64 h-64 pointer-events-none opacity-60"
                      style={{ background: `radial-gradient(circle, ${sm.color}22, transparent 60%)` }} />

                    <div className="p-7 relative">
                      {/* Header: icon + name + badge */}
                      <div className="flex items-start justify-between mb-6">
                        <div className="flex items-start gap-3.5 flex-1 min-w-0 mr-3">
                          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-[22px] shrink-0"
                            style={{
                              background: 'linear-gradient(135deg,rgba(167,139,250,0.28),rgba(0,245,255,0.10))',
                              border: '1px solid rgba(167,139,250,0.3)',
                              boxShadow: '0 6px 24px rgba(167,139,250,0.2), 0 0 0 1px rgba(255,255,255,0.05) inset',
                            }}>
                            🤖
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-black text-white text-[18px] leading-tight truncate group-hover:text-[#a78bfa] transition-colors tracking-[-0.01em]"
                              style={{ fontFamily: 'Poppins, Inter, system-ui, sans-serif' }}>
                              {m.name}
                            </h3>
                            {m.description ? (
                              <p className="text-[13px] text-slate-400 mt-1 truncate">{m.description}</p>
                            ) : (
                              <p className="text-[13px] text-slate-700 mt-1 italic">No description</p>
                            )}
                          </div>
                        </div>

                        {/* Status badge */}
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.08em] shrink-0"
                          style={{
                            background: sm.color + '18',
                            color: sm.color,
                            border: `1px solid ${sm.color}38`,
                            boxShadow: `0 0 16px ${sm.color}22`,
                          }}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0${sm.pulse ? ' animate-pulse' : ''}`}
                            style={{ background: sm.color, boxShadow: `0 0 8px ${sm.glow}` }} />
                          {sm.label}
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-3 mb-5">
                        {[
                          { label: 'Data Points', value: m.total_data_points.toLocaleString(), color: CYAN   },
                          { label: 'Bots',        value: m.connected_bot_ids.length,           color: PURPLE },
                          { label: 'Runs',        value: m.training_runs.length,               color: AMBER  },
                        ].map(s => (
                          <div key={s.label} className="rounded-2xl px-3 py-3.5 text-center transition-colors group-hover:bg-white/[0.04]"
                            style={{
                              background: 'rgba(255,255,255,0.025)',
                              border: '1px solid rgba(255,255,255,0.06)',
                            }}>
                            <p className="text-[22px] font-black leading-none mb-1" style={{ color: s.color, textShadow: `0 0 16px ${s.color}55` }}>{s.value}</p>
                            <p className="text-[10.5px] text-slate-500 uppercase tracking-[0.12em] font-bold">{s.label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Mode + frequency + live badges */}
                      <div className="flex items-center gap-2 flex-wrap mb-5 min-h-[24px]">
                        {m.training_mode && (
                          <span className="text-[11px] font-black px-2.5 py-1 rounded-lg capitalize tracking-wider"
                            style={{ background: PURPLE + '18', color: PURPLE, border: `1px solid ${PURPLE}30` }}>
                            {m.training_mode.replace(/_/g, ' ')}
                          </span>
                        )}
                        {m.training_frequency && (
                          <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg capitalize tracking-wider"
                            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                            {m.training_frequency.replace(/_/g, ' ')}
                          </span>
                        )}
                        {m.live_sync && (
                          <span className="flex items-center gap-1.5 text-[11px] font-black px-2.5 py-1 rounded-lg tracking-wider"
                            style={{ background: GREEN + '18', color: GREEN, border: `1px solid ${GREEN}30` }}>
                            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: GREEN, boxShadow: `0 0 6px ${GREEN}` }} />
                            LIVE SYNC
                          </span>
                        )}
                      </div>

                      {/* Footer: timestamp + actions */}
                      <div className="flex items-center justify-between pt-4"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div>
                          <p className="text-[10px] text-slate-600 uppercase tracking-[0.15em] font-bold">
                            {m.last_trained_at ? 'Last trained' : 'Created'}
                          </p>
                          <p className="text-[13px] text-slate-300 font-semibold mt-0.5">
                            {relTime(m.last_trained_at ?? m.created_at)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={e => handleDelete(e, m.id)}
                            className="px-3.5 py-2 rounded-xl text-[12px] font-bold text-slate-500 transition-all hover:text-red-400"
                            style={{ border: '1px solid rgba(239,68,68,0.18)', background: 'transparent' }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLButtonElement).style.borderColor = RED + '60'
                              ;(e.currentTarget as HTMLButtonElement).style.background = RED + '12'
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.18)'
                              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                            }}>
                            Delete
                          </button>
                          <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-black tracking-wider transition-all group-hover:scale-[1.06]"
                            style={{
                              background: `linear-gradient(135deg, ${PURPLE}28, ${PURPLE}10)`,
                              color: PURPLE,
                              border: `1px solid ${PURPLE}40`,
                              boxShadow: `0 4px 16px ${PURPLE}22`,
                            }}>
                            OPEN
                            <svg className="w-3.5 h-3.5 ml-0.5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </main>

        {/* ── RIGHT SIDEBAR — 23% ────────────────────────────────── */}
        <aside className="shrink-0 sticky p-3 flex flex-col gap-3"
          style={{ width: '23%', top: NAVBAR_H, height: `calc(100vh - ${NAVBAR_H}px)`, overflowY: 'auto' }}>

          {/* Training activity feed */}
          <div className="rounded-2xl overflow-hidden" style={CARD}>
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2.5">
                <h3 className="text-sm font-bold text-white">Model Activity</h3>
                {trainingNow.length > 0 && (
                  <span className="flex items-center gap-1 text-[12px] font-black px-2 py-0.5 rounded-full"
                    style={{ background: AMBER + '14', color: AMBER, border: `1px solid ${AMBER}28` }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: AMBER }} />
                    {trainingNow.length} training
                  </span>
                )}
              </div>
              <span className="text-[12px] text-slate-600 font-medium">live</span>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
              {models.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)' }}>
                    <span className="text-lg">🧠</span>
                  </div>
                  <p className="text-slate-500 text-xs font-medium">No models yet</p>
                  <p className="text-slate-700 text-[13.2px] mt-1">Create a model to see activity</p>
                </div>
              ) : (
                models.map(m => {
                  const sm = statusMeta(m.status)
                  return (
                    <div key={m.id}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-all hover:bg-white/[0.02]"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                      onClick={() => router.push(`/trainer/detail?id=${m.id}`)}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
                        style={{ background: sm.color + '14', border: `1px solid ${sm.color}25` }}>
                        {m.status === 'ready' ? '✓' : m.status === 'training' ? '⟳' : m.status === 'error' ? '✕' : '○'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{m.name}</p>
                        <p className="text-[12px] text-slate-600 mt-0.5">{m.total_data_points.toLocaleString()} pts · {relTime(m.last_trained_at ?? m.created_at)}</p>
                      </div>
                      <span className="text-[12px] font-black shrink-0" style={{ color: sm.color }}>{sm.label}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Model health overview */}
          {models.length > 0 && (
            <div className="rounded-2xl p-5" style={CARD}>
              <h3 className="text-sm font-bold text-white mb-4">Model Health</h3>
              <div className="space-y-3">
                {[
                  { label: 'Ready',       count: models.filter(m => m.status === 'ready').length,    total: models.length, color: GREEN  },
                  { label: 'Training',    count: models.filter(m => m.status === 'training').length, total: models.length, color: AMBER  },
                  { label: 'Error',       count: models.filter(m => m.status === 'error').length,    total: models.length, color: RED    },
                  { label: 'Not trained', count: models.filter(m => m.status === 'idle').length,     total: models.length, color: '#334155' },
                ].map(row => row.count > 0 && (
                  <div key={row.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13.2px] text-slate-500">{row.label}</span>
                      <span className="text-[13.2px] font-bold" style={{ color: row.color }}>{row.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${(row.count / row.total) * 100}%`, background: row.color, boxShadow: `0 0 8px ${row.color}88` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent training runs */}
          {models.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={CARD}>
              <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <h3 className="text-sm font-bold text-white">Recent Runs</h3>
              </div>
              <div>
                {models
                  .filter(m => m.training_runs.length > 0)
                  .slice(0, 5)
                  .flatMap(m =>
                    m.training_runs.slice(0, 1).map(r => ({
                      ...r, modelName: m.name,
                      statusColor: r.status === 'completed' ? GREEN : r.status === 'running' ? AMBER : r.status === 'failed' ? RED : '#475569',
                    }))
                  )
                  .slice(0, 6)
                  .map((run, i) => (
                    <div key={`${run.id}-${i}`} className="flex items-center gap-3 px-4 py-2.5"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: run.statusColor }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.2px] text-white font-medium truncate">{run.modelName}</p>
                        <p className="text-[12px] text-slate-600 capitalize">{run.status}</p>
                      </div>
                      <span className="text-[12px] font-bold" style={{ color: run.statusColor }}>#{run.id}</span>
                    </div>
                  ))
                }
                {models.every(m => m.training_runs.length === 0) && (
                  <div className="px-4 py-8 text-center">
                    <p className="text-xs text-slate-600">No training runs yet</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tips card */}
          <div className="rounded-2xl p-4" style={CARD}>
            <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-3">Pro Tips</p>
            {[
              { tip: 'Enable Live Sync to train automatically as your bot trades.', icon: '⚡', color: AMBER  },
              { tip: 'Connect multiple bots to one model for richer datasets.',     icon: '🔗', color: CYAN   },
              { tip: 'Upload historical CSV data to kick-start training.',          icon: '📄', color: PURPLE },
            ].map(t => (
              <div key={t.tip} className="flex items-start gap-2.5 mb-3 last:mb-0">
                <span className="text-sm shrink-0 mt-0.5">{t.icon}</span>
                <p className="text-[13.2px] text-slate-500 leading-relaxed">{t.tip}</p>
              </div>
            ))}
          </div>

        </aside>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        aside::-webkit-scrollbar { display: none; }
        aside { scrollbar-width: none; }
      `}</style>
    </div>
  )
}
