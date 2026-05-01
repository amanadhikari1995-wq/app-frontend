'use client'
import { useState, useEffect } from 'react'
import { botsApi } from '@/lib/api'
import { websiteAiApi } from '@/lib/websiteApi'

// ── Types ─────────────────────────────────────────────────────────────────────
interface AiFixChange {
  description: string
  old_code: string
  new_code: string
}

interface AiFixResult {
  explanation: string
  changes: AiFixChange[]
  fixed_code: string
}

interface Props {
  botId: number
  botCode: string
  errorLogs: string[]          // pre-filtered ERROR/WARNING lines
  onApply: (fixedCode: string) => void
  onClose: () => void
}

// ── Tiny diff renderer ────────────────────────────────────────────────────────
function DiffView({ oldCode, newCode }: { oldCode: string; newCode: string }) {
  if (!oldCode && !newCode) return null

  const oldLines = oldCode ? oldCode.split('\n') : []
  const newLines = newCode ? newCode.split('\n') : []

  // If either side is huge (full file diff), show a compact summary
  const compact = oldLines.length > 80 || newLines.length > 80

  if (compact) {
    const addedCount   = newLines.length - oldLines.length
    const changedLines = newLines.filter((l, i) => l !== oldLines[i]).length
    return (
      <div className="rounded-xl p-4 font-mono text-xs space-y-1"
        style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)' }}>
        <p className="text-slate-400 mb-2 font-sans font-semibold">Full-file rewrite:</p>
        {addedCount !== 0 && (
          <p style={{ color: addedCount > 0 ? '#34d399' : '#f87171' }}>
            {addedCount > 0 ? '+' : ''}{addedCount} lines
          </p>
        )}
        {changedLines > 0 && (
          <p style={{ color: '#fbbf24' }}>{changedLines} lines modified</p>
        )}
      </div>
    )
  }

  // Side-by-side line diff for small hunks
  const maxLen = Math.max(oldLines.length, newLines.length)
  return (
    <div className="rounded-xl overflow-hidden font-mono text-xs"
      style={{ border: '1px solid var(--border)' }}>
      <div className="grid grid-cols-2">
        {/* Old */}
        <div style={{ background: 'rgba(239,68,68,0.06)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-3 py-1.5 text-[12px] font-bold text-red-400/60 uppercase tracking-wider border-b border-white/5">Before</div>
          {Array.from({ length: maxLen }).map((_, i) => (
            <div key={i} className="flex items-start px-3 py-0.5 min-h-[20px]"
              style={{ background: oldLines[i] !== newLines[i] ? 'rgba(239,68,68,0.12)' : 'transparent' }}>
              <span className="text-red-400/40 tabular-nums mr-2 select-none text-[12px] pt-px">{i + 1}</span>
              <span className="text-red-300/80 break-all whitespace-pre-wrap">{oldLines[i] ?? ''}</span>
            </div>
          ))}
        </div>
        {/* New */}
        <div style={{ background: 'rgba(52,211,153,0.04)' }}>
          <div className="px-3 py-1.5 text-[12px] font-bold text-emerald-400/60 uppercase tracking-wider border-b border-white/5">After</div>
          {Array.from({ length: maxLen }).map((_, i) => (
            <div key={i} className="flex items-start px-3 py-0.5 min-h-[20px]"
              style={{ background: newLines[i] !== oldLines[i] ? 'rgba(52,211,153,0.1)' : 'transparent' }}>
              <span className="text-emerald-400/40 tabular-nums mr-2 select-none text-[12px] pt-px">{i + 1}</span>
              <span className="text-emerald-300/80 break-all whitespace-pre-wrap">{newLines[i] ?? ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function AiFixModal({ botId, botCode, errorLogs, onApply, onClose }: Props) {
  const [stage,       setStage]       = useState<'input' | 'loading' | 'result' | 'error'>('input')
  const [extraNote,   setExtraNote]   = useState('')
  const [result,      setResult]      = useState<AiFixResult | null>(null)
  const [errMsg,      setErrMsg]      = useState('')
  const [activeChange, setActiveChange] = useState(0)
  const [applying,    setApplying]    = useState(false)
  const [applied,     setApplied]     = useState(false)

  // If we already have error logs, jump straight to loading on mount
  const [autoStarted, setAutoStarted] = useState(false)
  useEffect(() => {
    if (errorLogs.length > 0 && !autoStarted) {
      setAutoStarted(true)
    }
  }, [errorLogs, autoStarted])

  const runAnalysis = async () => {
    setStage('loading')
    setErrMsg('')
    try {
      // Centralised AI Fix — calls watchdogbot.cloud /api/ai/fix with the
      // user's Supabase JWT. The Anthropic key lives there, so end users
      // never need to install one. The cloud endpoint enforces the
      // subscription gate and per-user daily limit.
      const resp = await websiteAiApi.fix({
        bot_code:      botCode,
        error_logs:    errorLogs,
        extra_context: extraNote || undefined,
      })
      // Coerce the cloud's looser shape (optional fields) into our local
      // AiFixResult shape (required fields). Missing values default to ''.
      const data = resp.data
      const normalized: AiFixResult = {
        explanation: data.explanation || '',
        fixed_code:  data.fixed_code  || '',
        changes: (data.changes || []).map((c) => ({
          description: c.description ?? '',
          old_code:    c.old_code    ?? '',
          new_code:    c.new_code    ?? '',
        })),
      }
      setResult(normalized)
      setActiveChange(0)
      setStage('result')
    } catch (e: unknown) {
      const ax = e as { response?: { status?: number; data?: { error?: string; detail?: string } }; message?: string }
      // The website backend returns { error: "..." }; the legacy local
      // backend used { detail: "..." }. Surface whichever is present.
      const msg = ax?.response?.data?.error
               ?? ax?.response?.data?.detail
               ?? ax?.message
               ?? 'Unknown error'
      setErrMsg(msg)
      setStage('error')
    }
  }

  const handleApply = async () => {
    if (!result) return
    setApplying(true)
    try {
      await botsApi.update(botId, { code: result.fixed_code })
      setApplied(true)
      setTimeout(() => {
        onApply(result.fixed_code)
        onClose()
      }, 900)
    } catch {
      setApplying(false)
    }
  }

  // ── Style constants ───────────────────────────────────────────────────────
  const OVERLAY_BG  = 'rgba(6,9,20,0.97)'
  const BORDER      = '1px solid var(--border)'
  const CYAN        = '#00f5ff'
  const BG = 'var(--bg)'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/85" style={{ backdropFilter: 'blur(10px)' }} />

      {/* Panel */}
      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl shadow-2xl overflow-hidden"
        style={{ background: OVERLAY_BG, border: BORDER }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/[0.07]">
          <div className="flex items-center gap-3">
            {/* Spark icon */}
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(0,245,255,0.1)', border: '1px solid rgba(0,245,255,0.2)' }}>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Fix with Cloud AI</h2>
              <p className="text-xs text-slate-500">Claude will analyse your errors and suggest a fix</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors"
            style={{ border: '1px solid var(--border)' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">

          {/* INPUT stage */}
          {stage === 'input' && (
            <>
              {/* Error log preview */}
              {errorLogs.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                    Error logs collected ({errorLogs.length} lines)
                  </p>
                  <div className="rounded-xl p-4 font-mono text-xs max-h-48 overflow-y-auto space-y-1"
                    style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
                    {errorLogs.slice(-20).map((l, i) => (
                      <div key={i} className="text-red-300/80 break-all">{l}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl p-4 text-center text-sm text-slate-500"
                  style={{ border: '1px dashed rgba(255,255,255,0.1)' }}>
                  No error logs detected. You can still run the analysis with your note below.
                </div>
              )}

              {/* Extra context */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Additional context (optional)
                </label>
                <textarea
                  value={extraNote}
                  onChange={e => setExtraNote(e.target.value)}
                  placeholder="Describe what you observed, what you changed recently, or any other context…"
                  rows={3}
                  className="w-full rounded-xl px-4 py-3 text-sm text-slate-300 resize-none focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                />
              </div>
            </>
          )}

          {/* LOADING stage */}
          {stage === 'loading' && (
            <div className="flex flex-col items-center justify-center py-16 gap-5">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-2 border-[#00f5ff]/20 animate-ping" />
                <div className="absolute inset-2 rounded-full border-2 border-[#00f5ff] border-t-transparent animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold">Analysing errors…</p>
                <p className="text-slate-500 text-sm mt-1">Claude is reading your code and logs</p>
              </div>
            </div>
          )}

          {/* ERROR stage */}
          {stage === 'error' && (
            <div className="space-y-4">
              <div className="rounded-xl p-4"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <p className="text-red-400 font-semibold text-sm mb-1">Analysis failed</p>
                <p className="text-red-300/70 text-xs font-mono break-all">{errMsg}</p>
              </div>
            </div>
          )}

          {/* RESULT stage */}
          {stage === 'result' && result && (
            <>
              {/* Explanation */}
              <div className="rounded-xl p-5"
                style={{ background: 'rgba(0,245,255,0.04)', border: '1px solid rgba(0,245,255,0.15)' }}>
                <p className="text-xs font-bold text-cyan-400/70 uppercase tracking-wider mb-2">Root cause &amp; fix</p>
                <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{result.explanation}</p>
              </div>

              {/* Changes list */}
              {result.changes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Changes ({result.changes.length})
                  </p>
                  {/* Tab selector */}
                  {result.changes.length > 1 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {result.changes.map((c, i) => (
                        <button key={i} onClick={() => setActiveChange(i)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          style={activeChange === i
                            ? { background: 'var(--accent-dim)', color: CYAN, border: `1px solid ${CYAN}44` }
                            : { background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                          Fix {i + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  {result.changes[activeChange] && (
                    <div className="space-y-3">
                      <p className="text-slate-300 text-sm font-medium">
                        {result.changes[activeChange].description}
                      </p>
                      <DiffView
                        oldCode={result.changes[activeChange].old_code}
                        newCode={result.changes[activeChange].new_code}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Warning */}
              <div className="flex items-start gap-2.5 rounded-xl px-4 py-3"
                style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                <svg className="w-4 h-4 shrink-0 mt-px text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                </svg>
                <p className="text-amber-300/80 text-xs">
                  Review the changes carefully before applying. The fix will overwrite your current bot code.
                  <strong className="text-amber-300"> Always test with dry-run mode first.</strong>
                </p>
              </div>
            </>
          )}
        </div>

        {/* ── Footer / Actions ── */}
        <div className="flex items-center justify-between px-8 py-5 border-t border-white/[0.07]">
          {stage === 'result' && result ? (
            <>
              <button onClick={() => { setStage('input'); setResult(null); setApplied(false) }}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                style={{ border: '1px solid var(--border)' }}>
                ← Re-analyse
              </button>
              <button onClick={handleApply} disabled={applying || applied}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-60"
                style={{
                  background: applied ? 'rgba(52,211,153,0.15)' : CYAN,
                  color: applied ? '#34d399' : BG,
                  border: applied ? '1px solid rgba(52,211,153,0.4)' : 'none',
                  boxShadow: applying || applied ? 'none' : '0 0 20px rgba(0,245,255,0.35)',
                }}>
                {applying ? (
                  <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Applying…</>
                ) : applied ? (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg> Applied!</>
                ) : (
                  'Apply Fix'
                )}
              </button>
            </>
          ) : stage === 'error' ? (
            <>
              <button onClick={() => setStage('input')}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                style={{ border: '1px solid var(--border)' }}>
                ← Back
              </button>
              <button onClick={runAnalysis}
                className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{ background: CYAN, color: BG, boxShadow: '0 0 20px rgba(0,245,255,0.35)' }}>
                Retry
              </button>
            </>
          ) : stage === 'input' ? (
            <>
              <button onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                style={{ border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button onClick={runAnalysis}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.03]"
                style={{ background: CYAN, color: BG, boxShadow: '0 0 20px rgba(0,245,255,0.35)' }}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
                Analyse with AI
              </button>
            </>
          ) : (
            /* loading — no actions */
            <div className="w-full" />
          )}
        </div>

      </div>
    </div>
  )
}
