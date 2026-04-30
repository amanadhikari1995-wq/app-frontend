'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Navbar from '@/components/Navbar'
import { aiModelsApi, botsApi } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelFile {
  id: number; original_name: string; file_type: string | null
  size_bytes: number; record_count: number; created_at: string
}

interface RunPerf {
  overview?:        { total_sessions: number; win_rate: number; total_pnl: number; avg_pnl_per_session: number; best_session: number; worst_session: number }
  by_side?:         { yes: { count: number; win_rate: number; total_pnl: number }; no: { count: number; win_rate: number; total_pnl: number }; preferred_side: string }
  risk?:            { win_loss_ratio: number; profit_factor: number; expectancy: number; max_drawdown: number; total_wins: number; total_losses: number }
  position?:        { avg_size: number; optimal_size_suggestion: number }
  recommendations?: { type: 'positive' | 'neutral' | 'warning' | 'danger'; msg: string }[]
  generated_at?:    string
}

interface TrainingRun {
  id: number; started_at: string; completed_at: string | null
  duration_sec: number | null; status: string
  data_summary: { total_trades: number; total_sessions: number; total_data_points: number; bots_used: { id: number; name: string }[]; files_used: { name: string; records: number }[] } | null
  performance:  RunPerf | null
  error_msg: string | null
}

interface Bot { id: number; name: string; status: string; run_count: number }

interface AIModel {
  id: number; name: string; description: string
  status: 'idle' | 'training' | 'ready' | 'error'
  total_data_points: number; last_trained_at: string | null; created_at: string
  connected_bot_ids: number[]
  live_sync: boolean; training_mode: string
  training_frequency: string; data_weight: string; learn_risk: boolean
  trades_since_train: number
  files: ModelFile[]; training_runs: TrainingRun[]
}

// ── Theme ─────────────────────────────────────────────────────────────────────

const BG = 'var(--bg)'
const CARD   = { background: '#0d1117', borderRadius: '20px', boxShadow: '0 6px 32px rgba(0,0,0,0.55)' }
const CYAN   = '#00f5ff'
const GREEN  = '#22c55e'
const RED    = '#ef4444'
const PURPLE = '#a78bfa'
const AMBER  = '#f59e0b'
const BLUE   = '#60a5fa'

const inp = {
  padding: '10px 14px', borderRadius: 10,
  background: '#0a0e1a', border: '1px solid var(--border)',
  color: '#fff', fontSize: 16.8, outline: 'none', width: '100%',
  boxSizing: 'border-box' as const,
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(sec: number | null) {
  if (!sec) return '—'
  return sec < 60 ? `${sec.toFixed(1)}s` : `${(sec / 60).toFixed(1)}m`
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

function statusMeta(s: string) {
  if (s === 'ready')    return { label: 'TRAINED',     color: GREEN,     glow: 'rgba(34,197,94,0.2)'    }
  if (s === 'training') return { label: 'TRAINING…',   color: AMBER,     glow: 'rgba(245,158,11,0.2)'   }
  if (s === 'error')    return { label: 'ERROR',        color: RED,       glow: 'rgba(239,68,68,0.2)'    }
  return                       { label: 'NOT TRAINED', color: 'var(--text-muted)', glow: 'transparent'             }
}

function RecBadge({ type }: { type: string }) {
  const cfg = type === 'positive' ? { bg: 'rgba(34,197,94,0.12)', c: GREEN, icon: '✓' }
    : type === 'warning' ? { bg: 'rgba(245,158,11,0.12)', c: AMBER, icon: '⚠' }
    : type === 'danger'  ? { bg: 'rgba(239,68,68,0.12)', c: RED, icon: '✕' }
    : { bg: 'rgba(96,165,250,0.12)', c: BLUE, icon: 'ℹ' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: 6, fontSize: 13.2, fontWeight: 700,
      background: cfg.bg, color: cfg.c, flexShrink: 0,
    }}>{cfg.icon}</span>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 19.2,
        background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.2)',
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 14.4, color: 'var(--text-muted)', marginTop: 1 }}>{subtitle}</div>}
      </div>
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!on)} style={{
      width: 44, height: 24, borderRadius: 12, cursor: 'pointer',
      background: on ? GREEN : 'rgba(255,255,255,0.1)',
      transition: 'all 0.2s', position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 3, left: on ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'all 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
      }} />
    </div>
  )
}

// ── Radio group ───────────────────────────────────────────────────────────────

function RadioGroup<T extends string>({ value, options, onChange }: {
  value: T; options: { v: T; label: string; desc?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          padding: '8px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
          background: value === o.v ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${value === o.v ? PURPLE + '55' : 'rgba(255,255,255,0.08)'}`,
          color: value === o.v ? PURPLE : '#64748b',
          transition: 'all 0.15s',
        }}>
          <div style={{ fontSize: 15.6, fontWeight: 700 }}>{o.label}</div>
          {o.desc && <div style={{ fontSize: 13.2, opacity: 0.7, marginTop: 2 }}>{o.desc}</div>}
        </button>
      ))}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ModelDetailPage() {
  // Static-export-friendly: model id comes from ?id= query param
  // (was useParams() under the old [model_id] dynamic route).
  const router       = useRouter()
  const searchParams = useSearchParams()
  const model_id     = searchParams?.get('id') ?? ''
  const mid          = parseInt(model_id)

  const [model,     setModel]     = useState<AIModel | null>(null)
  const [allBots,   setAllBots]   = useState<Bot[]>([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [training,  setTraining]  = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast,     setToast]     = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [editName,  setEditName]  = useState(false)
  const [nameVal,   setNameVal]   = useState('')
  const [expandRun, setExpandRun] = useState<number | null>(null)
  const [isDrag,    setIsDrag]    = useState(false)
  const fileRef  = useRef<HTMLInputElement>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    try {
      const [mr, br] = await Promise.all([aiModelsApi.get(mid), botsApi.getAll()])
      setModel(mr.data)
      setAllBots(br.data)
      if (!nameVal) setNameVal(mr.data.name)
    } catch { router.push('/trainer') }
    finally { setLoading(false) }
  }, [mid])

  useEffect(() => {
    load()
    let inflight = false
    let alive = true
    pollRef.current = setInterval(() => {
      if (!alive || inflight) return
      inflight = true
      aiModelsApi.get(mid)
        .then(r => { if (alive) setModel(r.data) })
        .catch(() => {})
        .finally(() => { inflight = false })
    }, 4000)
    return () => {
      alive = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [load, mid])

  // ── Patch helper — persists one or more fields immediately ─────────────────
  const patch = async (fields: Record<string, unknown>, silent = false) => {
    if (!model) return
    setSaving(true)
    try {
      const r = await aiModelsApi.update(mid, fields)
      setModel(r.data)
      if (!silent) showToast('Saved')
    } catch { if (!silent) showToast('Save failed', 'err') }
    finally { setSaving(false) }
  }

  // ── Train ──────────────────────────────────────────────────────────────────
  const handleTrain = async () => {
    setTraining(true)
    try {
      await aiModelsApi.train(mid)
      showToast('Training started!')
      setModel(prev => prev ? { ...prev, status: 'training' } : prev)
    } catch (e: any) {
      showToast(e?.response?.data?.detail || 'Failed to start training', 'err')
    } finally { setTraining(false) }
  }

  // ── Bot connect/disconnect ─────────────────────────────────────────────────
  const toggleBot = async (botId: number) => {
    if (!model) return
    const cur = model.connected_bot_ids || []
    const next = cur.includes(botId) ? cur.filter(id => id !== botId) : [...cur, botId]
    await patch({ connected_bot_ids: next }, true)
  }

  // ── File upload ────────────────────────────────────────────────────────────
  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await aiModelsApi.uploadFile(mid, fd)
      showToast(`✓ ${file.name} uploaded`)
      const r = await aiModelsApi.get(mid)
      setModel(r.data)
    } catch (e: any) {
      showToast(e?.response?.data?.detail || 'Upload failed', 'err')
    } finally { setUploading(false) }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) uploadFile(f)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) uploadFile(f)
  }

  const deleteFile = async (fileId: number, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return
    try {
      await aiModelsApi.deleteFile(mid, fileId)
      setModel(prev => prev ? { ...prev, files: prev.files.filter(f => f.id !== fileId) } : prev)
      showToast('File removed')
    } catch { showToast('Failed to remove file', 'err') }
  }

  const deleteRun = async (runId: number) => {
    if (!confirm('Delete this training run?')) return
    try {
      await aiModelsApi.deleteRun(mid, runId)
      setModel(prev => prev ? { ...prev, training_runs: prev.training_runs.filter(r => r.id !== runId) } : prev)
    } catch { showToast('Failed to delete run', 'err') }
  }

  if (loading) return (
    <div style={{ background: BG, minHeight: '100vh' }}>
      <Navbar />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 'calc(100vh - 80px)' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 18 }} className="animate-pulse">Loading model…</div>
      </div>
    </div>
  )
  if (!model) return null

  const sm      = statusMeta(model.status)
  const isTraining = model.status === 'training'
  const runs    = [...(model.training_runs || [])].sort((a, b) =>
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  const latestRun = runs.find(r => r.status === 'completed')

  return (
    <div style={{ background: BG, minHeight: '100vh' }}>
      <Navbar />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 88, right: 24, zIndex: 999,
          padding: '12px 20px', borderRadius: 12, fontSize: 15.6, fontWeight: 600,
          background: toast.type === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${toast.type === 'ok' ? GREEN : RED}44`,
          color: toast.type === 'ok' ? GREEN : RED,
        }}>{toast.msg}</div>
      )}

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 32px 60px' }}>

        {/* ── Breadcrumb ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 28, fontSize: 15.6, color: '#334155' }}>
          <button onClick={() => router.push('/trainer')} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
            fontSize: 15.6, padding: 0,
          }}>← AI Lab</button>
          <span>/</span>
          <span style={{ color: 'var(--text-muted)' }}>{model.name}</span>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 1 — MODEL HEADER
        ═════════════════════════════════════════════════════════════════════ */}
        <div style={{ ...CARD, padding: 28, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start',
            justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>

            {/* Left: name + status */}
            <div style={{ flex: 1, minWidth: 240 }}>
              {editName ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    autoFocus value={nameVal}
                    onChange={e => setNameVal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { patch({ name: nameVal }); setEditName(false) }
                      if (e.key === 'Escape') setEditName(false)
                    }}
                    style={{ ...inp, fontSize: 26.4, fontWeight: 800, flex: 1 }}
                  />
                  <button onClick={() => { patch({ name: nameVal }); setEditName(false) }} style={{
                    padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: GREEN, color: '#fff', fontSize: 15.6, fontWeight: 700,
                  }}>Save</button>
                  <button onClick={() => setEditName(false)} style={{
                    padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                    cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', fontSize: 15.6,
                  }}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <h1 style={{ margin: 0, fontSize: 28.8, fontWeight: 800, color: '#fff' }}>{model.name}</h1>
                  <button onClick={() => { setNameVal(model.name); setEditName(true) }} style={{
                    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                    borderRadius: 7, padding: '4px 8px', color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: 14.4,
                  }}>✏ Edit</button>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* Status badge */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', borderRadius: 8,
                  background: sm.color + '18', color: sm.color,
                  border: `1px solid ${sm.color}33`, fontSize: 13.2, fontWeight: 800,
                  letterSpacing: '0.06em',
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', background: sm.color,
                    ...(isTraining ? { animation: 'pulse 1.2s infinite' } : {}),
                  }} />
                  {sm.label}
                </div>

                {saving && (
                  <span style={{ fontSize: 14.4, color: '#334155' }}>Saving…</span>
                )}
              </div>

              {model.description && (
                <p style={{ margin: '10px 0 0', fontSize: 15.6, color: 'var(--text-muted)' }}>
                  {model.description}
                </p>
              )}
            </div>

            {/* Right: metrics + Train button */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 16 }}>
              {/* Metrics row */}
              <div style={{ display: 'flex', gap: 16 }}>
                {[
                  { label: 'Data Points',  value: model.total_data_points.toLocaleString(), color: CYAN   },
                  { label: 'Connected Bots',value: model.connected_bot_ids.length,          color: PURPLE },
                  { label: 'Training Runs', value: model.training_runs.length,              color: AMBER  },
                  { label: 'Files',         value: model.files.length,                      color: BLUE   },
                ].map(m2 => (
                  <div key={m2.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 26.4, fontWeight: 800, color: m2.color, lineHeight: 1 }}>{m2.value}</div>
                    <div style={{ fontSize: 12, color: '#334155', marginTop: 3 }}>{m2.label}</div>
                  </div>
                ))}
              </div>

              {/* Train button */}
              <button onClick={handleTrain}
                disabled={training || isTraining}
                style={{
                  padding: '13px 28px', borderRadius: 14, border: 'none', cursor:
                    (training || isTraining) ? 'not-allowed' : 'pointer',
                  fontSize: 18, fontWeight: 800, letterSpacing: '0.02em',
                  background: (training || isTraining)
                    ? 'rgba(34,197,94,0.2)'
                    : 'linear-gradient(135deg, #22c55e, #16a34a)',
                  color: '#fff', opacity: (training || isTraining) ? 0.7 : 1,
                  boxShadow: (training || isTraining) ? 'none' : '0 4px 20px rgba(34,197,94,0.35)',
                  display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
                }}>
                {isTraining ? (
                  <><span className="animate-spin" style={{ display: 'inline-block' }}>⟳</span> Training…</>
                ) : (
                  <>⚡ Train Model Now</>
                )}
              </button>

              <div style={{ fontSize: 13.2, color: '#334155', textAlign: 'right' }}>
                {model.last_trained_at
                  ? `Last trained: ${fmtDate(model.last_trained_at)}`
                  : 'Never trained'}
                {model.training_frequency !== 'manual' && (
                  <> · Auto: {model.training_frequency.replace('_', ' ')}</>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start' }}>
          {/* ─── LEFT COLUMN ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ═══════════════════════════════════════════════════════════════
                SECTION 2 — DATA SOURCES
            ═══════════════════════════════════════════════════════════════ */}
            <div style={{ ...CARD, padding: 28 }}>
              <SectionHeader icon="📡" title="Data Sources"
                subtitle="Choose which bots and files feed this model" />

              {/* ── Live sync toggle ── */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', borderRadius: 12, marginBottom: 24,
                background: model.live_sync ? 'rgba(34,197,94,0.07)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${model.live_sync ? GREEN + '33' : 'rgba(255,255,255,0.08)'}`,
                transition: 'all 0.2s',
              }}>
                <div>
                  <div style={{ fontSize: 16.8, fontWeight: 700, color: model.live_sync ? GREEN : '#64748b', marginBottom: 3 }}>
                    🔄 Live Data Sync
                  </div>
                  <div style={{ fontSize: 14.4, color: 'var(--text-muted)' }}>
                    {model.live_sync
                      ? 'Every new trade from connected bots feeds this model automatically'
                      : 'Enable to auto-sync every new trade in real-time'}
                  </div>
                </div>
                <Toggle on={model.live_sync} onChange={v => patch({ live_sync: v }, true)} />
              </div>

              {/* ── Connected bots ── */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 15.6, fontWeight: 700, color: '#94a3b8', marginBottom: 12,
                  display: 'flex', alignItems: 'center', gap: 6 }}>
                  🤖 Connected Bots
                  {model.connected_bot_ids.length > 0 && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 6, fontSize: 13.2, fontWeight: 700,
                      background: 'rgba(167,139,250,0.15)', color: PURPLE,
                    }}>{model.connected_bot_ids.length} selected</span>
                  )}
                </div>

                {allBots.length === 0 ? (
                  <div style={{ padding: 16, borderRadius: 10, textAlign: 'center',
                    color: '#334155', fontSize: 15.6,
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px dashed rgba(255,255,255,0.08)' }}>
                    No bots yet — create a bot first
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {allBots.map(bot => {
                      const connected = model.connected_bot_ids.includes(bot.id)
                      return (
                        <div key={bot.id}
                          onClick={() => toggleBot(bot.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
                            background: connected ? 'rgba(167,139,250,0.08)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${connected ? PURPLE + '44' : 'rgba(255,255,255,0.07)'}`,
                            transition: 'all 0.15s',
                          }}
                        >
                          {/* Checkbox */}
                          <div style={{
                            width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: connected ? PURPLE : 'transparent',
                            border: `2px solid ${connected ? PURPLE : 'rgba(255,255,255,0.2)'}`,
                            transition: 'all 0.15s',
                          }}>
                            {connected && <span style={{ color: '#fff', fontSize: 13.2, fontWeight: 900 }}>✓</span>}
                          </div>

                          {/* Bot info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15.6, fontWeight: 700,
                              color: connected ? '#e2e8f0' : '#64748b' }}>
                              Bot #{bot.id} — {bot.name}
                            </div>
                            <div style={{ fontSize: 13.2, color: '#334155' }}>
                              {bot.run_count} run{bot.run_count !== 1 ? 's' : ''}
                            </div>
                          </div>

                          {/* Status dot */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{
                              width: 7, height: 7, borderRadius: '50%',
                              background: bot.status === 'RUNNING' ? GREEN
                                : bot.status === 'ERROR' ? RED : '#334155',
                            }} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                              {bot.status}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── File upload ── */}
              <div>
                <div style={{ fontSize: 15.6, fontWeight: 700, color: '#94a3b8', marginBottom: 12 }}>
                  📁 Uploaded Files
                  <span style={{ fontSize: 13.2, color: '#334155', fontWeight: 400, marginLeft: 8 }}>
                    PDF, CSV, Excel, TXT, JSON
                  </span>
                </div>

                {/* Drop zone */}
                <div
                  onDrop={handleDrop}
                  onDragOver={e => { e.preventDefault(); setIsDrag(true) }}
                  onDragLeave={() => setIsDrag(false)}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDrag ? CYAN : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: 12, padding: '20px 16px', textAlign: 'center',
                    cursor: uploading ? 'not-allowed' : 'pointer',
                    background: isDrag ? 'rgba(0,245,255,0.04)' : 'rgba(255,255,255,0.02)',
                    transition: 'all 0.2s', marginBottom: 12,
                  }}>
                  <input ref={fileRef} type="file"
                    accept=".csv,.json,.jsonl,.txt,.pdf,.xlsx,.xls"
                    style={{ display: 'none' }} onChange={handleFileChange} />
                  {uploading ? (
                    <div style={{ color: CYAN, fontSize: 15.6 }} className="animate-pulse">Uploading…</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 26.4, marginBottom: 6 }}>⬆</div>
                      <div style={{ fontSize: 15.6, color: 'var(--text-muted)', fontWeight: 600 }}>
                        {isDrag ? 'Drop it!' : 'Drag & drop or click to upload'}
                      </div>
                      <div style={{ fontSize: 13.2, color: '#334155', marginTop: 3 }}>
                        .csv · .json · .jsonl · .txt · .pdf · .xlsx
                      </div>
                    </>
                  )}
                </div>

                {/* File list */}
                {model.files.length === 0 ? (
                  <div style={{ fontSize: 14.4, color: '#334155', textAlign: 'center', padding: '8px 0' }}>
                    No files uploaded yet
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {model.files.map(f => (
                      <div key={f.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border)',
                      }}>
                        <span style={{ fontSize: 19.2 }}>
                          {f.file_type === 'pdf' ? '📄'
                            : f.file_type === 'csv' ? '📊'
                            : f.file_type === 'xlsx' || f.file_type === 'xls' ? '📗'
                            : '📝'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14.4, fontWeight: 600, color: '#e2e8f0',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f.original_name}
                          </div>
                          <div style={{ fontSize: 12, color: '#334155', marginTop: 1 }}>
                            {fmtBytes(f.size_bytes)}
                            {f.record_count > 0 && ` · ${f.record_count.toLocaleString()} records`}
                          </div>
                        </div>
                        <button onClick={() => deleteFile(f.id, f.original_name)} style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#334155', fontSize: 19.2, padding: '0 4px',
                          transition: 'color 0.15s',
                        }}
                          onMouseEnter={e => (e.currentTarget.style.color = RED)}
                          onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                SECTION 4 — TRAINING HISTORY
            ═══════════════════════════════════════════════════════════════ */}
            <div style={{ ...CARD, padding: 28 }}>
              <SectionHeader icon="📈" title="Training History"
                subtitle="Past training runs with performance metrics" />

              {runs.length === 0 ? (
                <div style={{
                  padding: '40px 20px', textAlign: 'center',
                  border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12,
                  color: '#334155', fontSize: 15.6,
                }}>
                  No training runs yet — click "Train Model Now" to start
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {runs.map((run, idx) => {
                    const isExpanded = expandRun === run.id
                    const perf = run.performance
                    const ov   = perf?.overview
                    const risk = perf?.risk
                    const prev = runs[idx + 1]?.performance?.overview

                    return (
                      <div key={run.id} style={{
                        borderRadius: 14, overflow: 'hidden',
                        border: `1px solid ${run.status === 'completed' ? 'rgba(255,255,255,0.08)' : run.status === 'failed' ? RED + '33' : AMBER + '33'}`,
                        background: '#0a0e1a',
                      }}>
                        {/* Row header */}
                        <div
                          onClick={() => run.status === 'completed' && setExpandRun(isExpanded ? null : run.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '14px 18px', cursor: run.status === 'completed' ? 'pointer' : 'default',
                          }}>
                          {/* Status icon */}
                          <div style={{
                            width: 28, height: 28, borderRadius: 8, display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontSize: 15.6, flexShrink: 0,
                            background: run.status === 'completed' ? 'rgba(34,197,94,0.15)'
                              : run.status === 'running' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                            color: run.status === 'completed' ? GREEN
                              : run.status === 'running' ? AMBER : RED,
                          }}>
                            {run.status === 'completed' ? '✓' : run.status === 'running' ? '⟳' : '✕'}
                          </div>

                          {/* Date + duration */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15.6, fontWeight: 700, color: '#e2e8f0' }}>
                              Run #{run.id}
                              {idx === 0 && run.status === 'completed' && (
                                <span style={{
                                  marginLeft: 8, fontSize: 10.8, padding: '2px 6px', borderRadius: 4,
                                  background: 'var(--accent-dim)', color: CYAN, fontWeight: 700,
                                }}>LATEST</span>
                              )}
                            </div>
                            <div style={{ fontSize: 13.2, color: 'var(--text-muted)', marginTop: 1 }}>
                              {fmtDate(run.started_at)}
                              {run.duration_sec && ` · ${fmtDuration(run.duration_sec)}`}
                            </div>
                          </div>

                          {/* Quick metrics */}
                          {ov && (
                            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                              <div style={{ textAlign: 'center' }}>
                                <div style={{
                                  fontSize: 18, fontWeight: 800,
                                  color: ov.win_rate >= 55 ? GREEN : ov.win_rate >= 45 ? AMBER : RED,
                                }}>{ov.win_rate}%</div>
                                <div style={{ fontSize: 10.8, color: '#334155' }}>Win Rate</div>
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                <div style={{
                                  fontSize: 18, fontWeight: 800,
                                  color: ov.total_pnl >= 0 ? GREEN : RED,
                                }}>{ov.total_pnl >= 0 ? '+' : ''}{ov.total_pnl.toFixed(2)}</div>
                                <div style={{ fontSize: 10.8, color: '#334155' }}>Total PnL</div>
                              </div>
                              {prev && (
                                <div style={{ textAlign: 'center' }}>
                                  <div style={{
                                    fontSize: 14.4, fontWeight: 700,
                                    color: ov.win_rate > (prev.win_rate || 0) ? GREEN : RED,
                                  }}>
                                    {ov.win_rate > (prev.win_rate || 0) ? '↑' : '↓'}
                                    {Math.abs(ov.win_rate - (prev.win_rate || 0)).toFixed(1)}%
                                  </div>
                                  <div style={{ fontSize: 10.8, color: '#334155' }}>vs prev</div>
                                </div>
                              )}
                            </div>
                          )}
                          {run.status === 'running' && (
                            <span style={{ fontSize: 14.4, color: AMBER }} className="animate-pulse">
                              Training in progress…
                            </span>
                          )}

                          {/* Expand + delete */}
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {run.status === 'completed' && (
                              <span style={{ fontSize: 19.2, color: '#334155', transition: 'all 0.2s',
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
                            )}
                            <button onClick={e => { e.stopPropagation(); deleteRun(run.id) }} style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: '#1e293b', fontSize: 16.8, padding: '0 4px',
                            }}
                              onMouseEnter={e => (e.currentTarget.style.color = RED)}
                              onMouseLeave={e => (e.currentTarget.style.color = '#1e293b')}
                            >✕</button>
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && perf && (
                          <div style={{
                            padding: '0 18px 18px',
                            borderTop: '1px solid rgba(255,255,255,0.05)',
                          }}>
                            {/* Data summary */}
                            {run.data_summary && (
                              <div style={{
                                display: 'flex', gap: 12, padding: '12px 0', marginBottom: 14,
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                              }}>
                                {[
                                  { label: 'Sessions',  value: run.data_summary.total_sessions  },
                                  { label: 'Trades',    value: run.data_summary.total_trades     },
                                  { label: 'Data Points', value: run.data_summary.total_data_points },
                                ].map(s => (
                                  <div key={s.label} style={{
                                    padding: '8px 14px', borderRadius: 8, flex: 1, textAlign: 'center',
                                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                                  }}>
                                    <div style={{ fontSize: 19.2, fontWeight: 800, color: CYAN }}>{s.value}</div>
                                    <div style={{ fontSize: 12, color: '#334155' }}>{s.label}</div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Performance grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                              {/* Overview */}
                              {ov && (
                                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <div style={{ fontSize: 13.2, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>OVERVIEW</div>
                                  {[
                                    { k: 'Win Rate',       v: `${ov.win_rate}%`, c: ov.win_rate >= 55 ? GREEN : ov.win_rate >= 45 ? AMBER : RED },
                                    { k: 'Total PnL',      v: `$${ov.total_pnl.toFixed(2)}`, c: ov.total_pnl >= 0 ? GREEN : RED },
                                    { k: 'Avg per Session',v: `$${ov.avg_pnl_per_session?.toFixed(2) ?? '—'}`, c: '#e2e8f0' },
                                    { k: 'Best Session',   v: `$${ov.best_session?.toFixed(2) ?? '—'}`, c: GREEN },
                                    { k: 'Worst Session',  v: `$${ov.worst_session?.toFixed(2) ?? '—'}`, c: RED },
                                  ].map(r => (
                                    <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                      <span style={{ fontSize: 13.2, color: 'var(--text-muted)' }}>{r.k}</span>
                                      <span style={{ fontSize: 14.4, fontWeight: 700, color: r.c }}>{r.v}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Side breakdown */}
                              {perf.by_side && (
                                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <div style={{ fontSize: 13.2, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                                    BY SIDE
                                    <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 4, fontSize: 10.8,
                                      background: 'rgba(0,245,255,0.1)', color: CYAN }}>
                                      Preferred: {perf.by_side.preferred_side}
                                    </span>
                                  </div>
                                  {[
                                    { k: 'YES Win Rate', v: `${perf.by_side.yes.win_rate}% (${perf.by_side.yes.count})`, c: perf.by_side.yes.win_rate >= 55 ? GREEN : AMBER },
                                    { k: 'NO Win Rate',  v: `${perf.by_side.no.win_rate}% (${perf.by_side.no.count})`,  c: perf.by_side.no.win_rate >= 55 ? GREEN : AMBER },
                                    { k: 'YES PnL',      v: `$${perf.by_side.yes.total_pnl?.toFixed(2)}`, c: perf.by_side.yes.total_pnl >= 0 ? GREEN : RED },
                                    { k: 'NO PnL',       v: `$${perf.by_side.no.total_pnl?.toFixed(2)}`,  c: perf.by_side.no.total_pnl >= 0 ? GREEN : RED },
                                  ].map(r => (
                                    <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                      <span style={{ fontSize: 13.2, color: 'var(--text-muted)' }}>{r.k}</span>
                                      <span style={{ fontSize: 14.4, fontWeight: 700, color: r.c }}>{r.v}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Risk */}
                              {risk && (
                                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <div style={{ fontSize: 13.2, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>RISK METRICS</div>
                                  {[
                                    { k: 'Win/Loss Ratio', v: risk.win_loss_ratio?.toFixed(2) ?? '—', c: (risk.win_loss_ratio ?? 0) >= 1 ? GREEN : RED },
                                    { k: 'Profit Factor',  v: risk.profit_factor?.toFixed(2) ?? '—',  c: (risk.profit_factor ?? 0) >= 1 ? GREEN : RED },
                                    { k: 'Expectancy',     v: `$${risk.expectancy?.toFixed(2) ?? '—'}`, c: (risk.expectancy ?? 0) >= 0 ? GREEN : RED },
                                    { k: 'Max Drawdown',   v: `$${risk.max_drawdown?.toFixed(2) ?? '—'}`, c: RED },
                                    { k: 'Wins / Losses',  v: `${risk.total_wins} / ${risk.total_losses}`, c: '#e2e8f0' },
                                  ].map(r => (
                                    <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                      <span style={{ fontSize: 13.2, color: 'var(--text-muted)' }}>{r.k}</span>
                                      <span style={{ fontSize: 14.4, fontWeight: 700, color: r.c }}>{r.v}</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Position */}
                              {perf.position && (
                                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <div style={{ fontSize: 13.2, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>POSITION SIZING</div>
                                  {[
                                    { k: 'Avg Size',        v: perf.position.avg_size },
                                    { k: 'AI Suggestion',   v: perf.position.optimal_size_suggestion },
                                  ].map(r => (
                                    <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                      <span style={{ fontSize: 13.2, color: 'var(--text-muted)' }}>{r.k}</span>
                                      <span style={{ fontSize: 14.4, fontWeight: 700, color: CYAN }}>{r.v} contracts</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Recommendations */}
                            {perf.recommendations && perf.recommendations.length > 0 && (
                              <div style={{ padding: 14, borderRadius: 10,
                                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <div style={{ fontSize: 13.2, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                                  🤖 AI RECOMMENDATIONS
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {perf.recommendations.map((rec, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                      <RecBadge type={rec.type} />
                                      <span style={{ fontSize: 14.4, color: '#94a3b8', lineHeight: 1.5 }}>{rec.msg}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Error message */}
                        {run.status === 'failed' && run.error_msg && (
                          <div style={{ padding: '10px 18px', fontSize: 14.4, color: RED,
                            background: 'rgba(239,68,68,0.08)', borderTop: `1px solid ${RED}22` }}>
                            Error: {run.error_msg}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ─── RIGHT COLUMN ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'sticky', top: 20 }}>

            {/* ═══════════════════════════════════════════════════════════════
                SECTION 3 — TRAINING CONFIGURATION
            ═══════════════════════════════════════════════════════════════ */}
            <div style={{ ...CARD, padding: 24 }}>
              <SectionHeader icon="⚙️" title="Training Config" />

              {/* Training mode */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14.4, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Training Mode
                </div>
                <RadioGroup
                  value={model.training_mode as any}
                  onChange={v => patch({ training_mode: v }, true)}
                  options={[
                    { v: 'backtest', label: '📊 Backtest',   desc: 'Learn from history' },
                    { v: 'live',     label: '⚡ Live Learn', desc: 'Adapt in real-time' },
                  ]}
                />
              </div>

              {/* Training frequency */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14.4, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Auto-Training Frequency
                </div>
                <RadioGroup
                  value={model.training_frequency as any}
                  onChange={v => patch({ training_frequency: v }, true)}
                  options={[
                    { v: 'manual',    label: 'Manual'         },
                    { v: 'every_25',  label: 'Every 25 trades' },
                    { v: 'every_50',  label: 'Every 50 trades' },
                    { v: 'daily',     label: 'Daily'           },
                  ]}
                />
                {model.training_frequency !== 'manual' && model.live_sync && (
                  <div style={{ marginTop: 8, fontSize: 13.2, color: 'var(--text-muted)' }}>
                    Trades since last train: <strong style={{ color: CYAN }}>{model.trades_since_train}</strong>
                    {model.training_frequency === 'every_25' && ` / 25`}
                    {model.training_frequency === 'every_50' && ` / 50`}
                  </div>
                )}
              </div>

              {/* Data weight */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14.4, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Data Weight
                </div>
                <RadioGroup
                  value={model.data_weight as any}
                  onChange={v => patch({ data_weight: v }, true)}
                  options={[
                    { v: 'historical', label: '📜 Historical', desc: 'Weight older data' },
                    { v: 'balanced',   label: '⚖ Balanced',   desc: 'Equal weight'      },
                    { v: 'recent',     label: '🔥 Recent',     desc: 'Weight new data'   },
                  ]}
                />
              </div>

              {/* Risk learning */}
              <div>
                <div style={{ fontSize: 14.4, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Risk Parameter Learning
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 10,
                  background: model.learn_risk ? 'rgba(34,197,94,0.07)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${model.learn_risk ? GREEN + '33' : 'rgba(255,255,255,0.08)'}`,
                }}>
                  <div>
                    <div style={{ fontSize: 15.6, fontWeight: 700, color: model.learn_risk ? GREEN : '#64748b' }}>
                      Learn Risk Parameters
                    </div>
                    <div style={{ fontSize: 13.2, color: 'var(--text-muted)', marginTop: 2 }}>
                      Stop-loss, sizing & entry logic
                    </div>
                  </div>
                  <Toggle on={model.learn_risk} onChange={v => patch({ learn_risk: v }, true)} />
                </div>
              </div>
            </div>

            {/* ── Latest Performance Snapshot ── */}
            {latestRun?.performance?.overview && (
              <div style={{ ...CARD, padding: 24 }}>
                <SectionHeader icon="📊" title="Latest Performance" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Win Rate',    value: `${latestRun.performance.overview.win_rate}%`,
                      color: latestRun.performance.overview.win_rate >= 55 ? GREEN
                        : latestRun.performance.overview.win_rate >= 45 ? AMBER : RED },
                    { label: 'Total PnL',  value: `$${latestRun.performance.overview.total_pnl.toFixed(2)}`,
                      color: latestRun.performance.overview.total_pnl >= 0 ? GREEN : RED },
                    { label: 'Sessions',   value: latestRun.performance.overview.total_sessions, color: CYAN },
                    { label: 'Avg PnL',    value: `$${latestRun.performance.overview.avg_pnl_per_session?.toFixed(2) ?? '—'}`,
                      color: '#e2e8f0' },
                  ].map(s => (
                    <div key={s.label} style={{
                      padding: '10px 12px', borderRadius: 10, textAlign: 'center',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <div style={{ fontSize: 20.4, fontWeight: 800, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Side preference badge */}
                {latestRun.performance.by_side?.preferred_side && (
                  <div style={{
                    marginTop: 10, padding: '8px 12px', borderRadius: 10, textAlign: 'center',
                    background: 'var(--accent-dim)', border: `1px solid ${CYAN}22`,
                    fontSize: 14.4, color: '#94a3b8',
                  }}>
                    Preferred Side: <strong style={{ color: CYAN }}>
                      {latestRun.performance.by_side.preferred_side}
                    </strong>
                  </div>
                )}
              </div>
            )}

            {/* ── Quick Recommendations ── */}
            {latestRun?.performance?.recommendations && latestRun.performance.recommendations.length > 0 && (
              <div style={{ ...CARD, padding: 24 }}>
                <SectionHeader icon="🤖" title="AI Insights" subtitle="From latest training run" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {latestRun.performance.recommendations.slice(0, 4).map((rec, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '10px 12px', borderRadius: 10,
                      background: rec.type === 'positive' ? 'rgba(34,197,94,0.06)'
                        : rec.type === 'warning' ? 'rgba(245,158,11,0.06)'
                        : rec.type === 'danger' ? 'rgba(239,68,68,0.06)'
                        : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${rec.type === 'positive' ? GREEN + '22'
                        : rec.type === 'warning' ? AMBER + '22'
                        : rec.type === 'danger' ? RED + '22' : 'rgba(255,255,255,0.06)'}`,
                    }}>
                      <RecBadge type={rec.type} />
                      <span style={{ fontSize: 14.4, color: '#94a3b8', lineHeight: 1.5 }}>{rec.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Danger zone ── */}
            <div style={{ ...CARD, padding: 20 }}>
              <div style={{ fontSize: 14.4, fontWeight: 700, color: '#334155',
                marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Danger Zone
              </div>
              <button onClick={async () => {
                if (!confirm('Delete this AI model? Uploaded files will be removed. Bot training data stays.')) return
                await aiModelsApi.delete(mid)
                router.push('/trainer')
              }} style={{
                width: '100%', padding: '10px 0', borderRadius: 10,
                background: 'rgba(239,68,68,0.08)', border: `1px solid ${RED}33`,
                color: RED, fontSize: 15.6, fontWeight: 700, cursor: 'pointer',
              }}>
                Delete Model
              </button>
              <p style={{ fontSize: 13.2, color: '#334155', marginTop: 8, textAlign: 'center' }}>
                This only deletes the model record. Bot training data is preserved.
              </p>
            </div>

          </div>{/* end right col */}
        </div>{/* end grid */}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin   { to { transform: rotate(360deg) } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
