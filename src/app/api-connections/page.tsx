'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { botsApi, connectionsApi } from '@/lib/api'
import Navbar from '@/components/Navbar'

interface Bot  { id: number; name: string; status: string }
interface Conn { id: number; bot_id: number; name: string; base_url: string | null; api_key: string | null; is_active: boolean; created_at: string }

const BG = 'var(--bg)'
const CARD  = { background: 'var(--card)', backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: 'var(--shadow-card)' } as React.CSSProperties
const MODAL = { background: 'rgba(4,6,18,0.96)', border: '1px solid var(--border-bright, rgba(255,255,255,0.12))', backdropFilter: 'blur(48px) saturate(200%)', WebkitBackdropFilter: 'blur(48px) saturate(200%)', boxShadow: 'var(--shadow-elevated)' } as React.CSSProperties
const INPUT = { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)'  } as React.CSSProperties

export default function ApiConnectionsPage() {
  const router = useRouter()
  const [bots,        setBots]        = useState<Bot[]>([])
  const [conns,       setConns]       = useState<Conn[]>([])
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null)
  const [modal,       setModal]       = useState(false)
  const [name,        setName]        = useState('')
  const [key,         setKey]         = useState('')
  const [secret,      setSecret]      = useState('')
  const [baseUrl,     setBaseUrl]     = useState('')
  const [showSecret,  setShowSecret]  = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [saveOk,      setSaveOk]      = useState(false)
  const [saveErr,     setSaveErr]     = useState('')

  const TEMPLATES = [
    {
      id: 'coinbase',
      label: 'Coinbase',
      icon: '🟡',
      name: 'Coinbase API',
      base_url: 'https://api.exchange.coinbase.com',
      hint: 'BTC/USD live price feed — public endpoints work without a key',
      keyLabel: 'API Key (optional for public price data)',
      secretLabel: 'API Secret (optional)',
    },
    {
      id: 'kalshi',
      label: 'Kalshi',
      icon: '🟢',
      name: 'Kalshi API',
      base_url: 'https://api.elections.kalshi.com/trade-api/v2',
      hint: 'Kalshi trading API — key required to place orders',
      keyLabel: 'API Key (KALSHI_API_KEY)',
      secretLabel: 'API Secret / Private Key',
    },
    {
      id: 'claude',
      label: 'Claude AI',
      icon: '🤖',
      name: 'Claude AI',
      base_url: '',
      hint: 'Anthropic Claude — used for AI decision-making',
      keyLabel: 'API Key (CLAUDE_AI_KEY)',
      secretLabel: '',
    },
  ]

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setName(t.name); setBaseUrl(t.base_url); setKey(''); setSecret('')
    setSaveOk(false); setSaveErr('')
    setModal(true)
  }

  const loadBots = useCallback(async () => {
    try { const r = await botsApi.getAll(); setBots(r.data) } catch {}
  }, [])

  const loadConns = useCallback(async (botId: number) => {
    try { const r = await connectionsApi.getByBot(botId); setConns(r.data) } catch {}
  }, [])

  useEffect(() => {
    loadBots()
  }, [router, loadBots])

  useEffect(() => {
    if (selectedBot) loadConns(selectedBot.id)
    else setConns([])
  }, [selectedBot, loadConns])

  const selectBot = (bot: Bot) => {
    setSelectedBot(prev => prev?.id === bot.id ? null : bot)
  }

  const create = async () => {
    if (!selectedBot || !name.trim()) return
    setSaving(true); setSaveOk(false); setSaveErr('')
    try {
      await connectionsApi.create({
        bot_id: selectedBot.id,
        name: name.trim(),
        base_url: baseUrl.trim() || undefined,
        api_key: key.trim() || undefined,
        api_secret: secret.trim() || undefined,
      })
      setSaveOk(true)
      setName(''); setKey(''); setSecret(''); setBaseUrl('')
      loadConns(selectedBot.id)
      setTimeout(() => setSaveOk(false), 2500)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSaveErr(msg || 'Failed to save. Make sure the backend is running.')
    }
    setSaving(false)
  }

  const openModal = () => {
    setName(''); setKey(''); setSecret(''); setBaseUrl(''); setSaveOk(false); setSaveErr('')
    setModal(true)
  }

  const remove = async (id: number) => {
    if (!selectedBot || !confirm('Remove this API key?')) return
    try { await connectionsApi.delete(id); loadConns(selectedBot.id) } catch {}
  }

  return (
    <div className="min-h-screen" style={{ background: BG }}>
      <Navbar />
      <main className="max-w-5xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">API Connections</h1>
          <p className="text-slate-500 mt-1.5">Assign API keys to individual bots</p>
        </div>

        {/* ── Quick Templates ── */}
        {selectedBot && (
          <div className="mb-8">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
              Quick Add — Select a provider
            </p>
            <div className="flex flex-wrap gap-3">
              {TEMPLATES.map(t => (
                <button key={t.id} onClick={() => applyTemplate(t)}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-semibold transition-all hover:scale-[1.03]"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--border)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}>
                  <span className="text-base">{t.icon}</span>
                  <span className="text-white">{t.label}</span>
                  <span className="text-[12px] font-mono px-1.5 py-0.5 rounded"
                    style={{ color: 'rgba(0,245,255,0.6)', background: 'var(--accent-dim)' }}>
                    + Add
                  </span>
                </button>
              ))}
              <button onClick={openModal}
                className="flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold text-slate-400 transition-all hover:text-white"
                style={{ border: '1px dashed rgba(255,255,255,0.12)' }}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Custom
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: Select a bot ── */}
        <div className="mb-8">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
            Step 1 — Select a bot
          </p>

          {bots.length === 0 ? (
            <div className="rounded-2xl p-10 text-center" style={{ ...CARD, border: '1px dashed rgba(255,255,255,0.09)' }}>
              <p className="text-slate-500 text-sm">No bots yet.</p>
              <button onClick={() => router.push('/bots')}
                className="mt-3 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                Create a bot first →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {bots.map(bot => {
                const active = selectedBot?.id === bot.id
                return (
                  <button key={bot.id} onClick={() => selectBot(bot)}
                    className="rounded-2xl p-4 text-left transition-all hover:scale-[1.02]"
                    style={{
                      background: active ? 'var(--accent-dim)' : 'rgba(255,255,255,0.02)',
                      border: active ? '1.5px solid rgba(0,245,255,0.35)' : '1px solid rgba(255,255,255,0.08)',
                      boxShadow: active ? '0 0 18px rgba(0,245,255,0.1)' : 'none',
                    }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3 text-sm font-black"
                      style={{
                        background: active ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.05)',
                        color: active ? '#00f5ff' : '#475569',
                      }}>
                      {bot.name[0].toUpperCase()}
                    </div>
                    <p className="text-sm font-bold truncate" style={{ color: active ? '#00f5ff' : '#e2e8f0' }}>
                      {bot.name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: active ? 'rgba(0,245,255,0.6)' : '#475569' }}>
                      {bot.status}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Step 2: Manage keys for selected bot ── */}
        {selectedBot && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">
                  Step 2 — API keys for
                </p>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span style={{ color: 'var(--accent)' }}>{selectedBot.name}</span>
                  <span className="text-slate-600 font-normal text-sm">
                    {conns.length} key{conns.length !== 1 ? 's' : ''}
                  </span>
                </h2>
              </div>
              <button onClick={openModal}
                className="flex items-center gap-2 font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
                style={{ background: 'var(--accent)', color: 'var(--bg)', boxShadow: '0 0 20px var(--accent)' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add API Key
              </button>
            </div>

            {/* Info banner */}
            <div className="rounded-2xl p-4 mb-6 flex items-start gap-3"
              style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
              <svg className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-slate-400 leading-relaxed">
                Keys are injected as environment variables when this bot runs.
                In your bot code use{' '}
                <code className="text-indigo-300 bg-indigo-900/30 px-1 py-0.5 rounded font-mono">
                  os.getenv("NAME_KEY")
                </code>
                {' '}— where <strong className="text-slate-300">NAME</strong> is the uppercased connection name
                (e.g. key named <em>"Kalshi API"</em> → <code className="text-indigo-300 bg-indigo-900/30 px-1 py-0.5 rounded font-mono">KALSHI_API_KEY</code>).
              </p>
            </div>

            {/* Keys list */}
            {conns.length === 0 ? (
              <div className="rounded-2xl p-12 text-center"
                style={{ ...CARD, border: '1px dashed rgba(255,255,255,0.08)' }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4"
                  style={{ background: 'var(--card)' }}>
                  <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <p className="text-slate-400 font-semibold">No API keys yet</p>
                <p className="text-slate-600 text-sm mt-1">Add the first key for {selectedBot.name}</p>
                <button onClick={openModal} className="mt-4 text-sm font-semibold px-4 py-2 rounded-xl transition-all"
                  style={{ color: 'var(--accent)', border: '1px solid rgba(0,245,255,0.25)', background: 'rgba(0,245,255,0.05)' }}>
                  + Add first key
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {conns.map(c => (
                  <div key={c.id} className="rounded-2xl p-5 flex items-center gap-5" style={CARD}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'var(--accent-dim)', border: '1px solid var(--border)' }}>
                      <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <p className="font-bold text-white">{c.name}</p>
                        <code className="text-[12px] font-mono px-2 py-0.5 rounded"
                          style={{ color: 'rgba(0,245,255,0.7)', background: 'var(--accent-dim)' }}>
                          {c.name.replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_KEY
                        </code>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        {c.base_url && (
                          <span className="truncate max-w-[220px]">{c.base_url}</span>
                        )}
                        <span>
                          Key: {c.api_key
                            ? <span className="text-slate-400 font-mono">{c.api_key.slice(0, 8)}••••</span>
                            : <span className="text-slate-700">Not set</span>}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => remove(c.id)}
                      className="p-2.5 rounded-xl transition-all text-slate-600 hover:text-red-400"
                      style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No bot selected placeholder */}
        {!selectedBot && bots.length > 0 && (
          <div className="rounded-2xl p-16 text-center" style={{ ...CARD, border: '1px dashed rgba(255,255,255,0.07)' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'var(--card)' }}>
              <svg className="w-7 h-7 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <p className="text-slate-400 font-semibold">Select a bot above</p>
            <p className="text-slate-600 text-sm mt-1">to view and manage its API keys</p>
          </div>
        )}

      </main>

      {/* ── Add Key Modal ── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget) setModal(false) }}>
          <div className="absolute inset-0 bg-black/80" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative w-full max-w-md rounded-3xl shadow-2xl overflow-y-auto max-h-[90vh]" style={MODAL}>
            <div className="flex items-start justify-between p-7 pb-5">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {name ? name : 'Add API Connection'}
                </h2>
                <p className="text-slate-500 text-sm mt-0.5">
                  For <span style={{ color: 'var(--accent)' }}>{selectedBot?.name}</span>
                </p>
              </div>
              <button onClick={() => setModal(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                style={{ border: '1px solid var(--border)' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-7 pb-7 space-y-4">

              {/* Coinbase hint */}
              {name === 'Coinbase API' && (
                <div className="rounded-2xl px-4 py-3 flex items-start gap-2.5"
                  style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }}>
                  <span className="text-lg leading-none mt-0.5">🟡</span>
                  <div>
                    <p className="text-xs font-bold text-yellow-300 mb-0.5">Coinbase BTC Price Feed</p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Public endpoints work <strong className="text-white">without a key</strong> — just save with name only
                      to get live BTC/USD price, bid/ask, momentum &amp; 24h stats fed into the AI.
                      Add a key only if you need private account data.
                    </p>
                  </div>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Connection Name <span className="text-red-400">*</span>
                </label>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Coinbase API, Kalshi API, Claude AI"
                  className="w-full rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                  style={INPUT}
                  onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.5)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                {name && (
                  <p className="text-xs mt-1.5" style={{ color: 'rgba(0,245,255,0.6)' }}>
                    Env var: <code>{name.replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_KEY</code>
                  </p>
                )}
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Base URL <span className="text-slate-600">(optional)</span>
                </label>
                <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors font-mono"
                  style={INPUT}
                  onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.5)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  API Key <span className="text-slate-600">(optional)</span>
                </label>
                <input value={key} onChange={e => setKey(e.target.value)}
                  placeholder="Your API key"
                  className="w-full rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                  style={INPUT}
                  onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.5)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
              </div>

              {/* API Secret */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  API Secret <span className="text-slate-600">(optional)</span>
                </label>
                <div className="relative">
                  <input type={showSecret ? 'text' : 'password'} value={secret} onChange={e => setSecret(e.target.value)}
                    placeholder="Your API secret"
                    className="w-full rounded-xl px-4 py-3.5 pr-12 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                    style={INPUT}
                    onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.5)')}
                    onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                  <button type="button" onClick={() => setShowSecret(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {showSecret
                        ? <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        : <><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                      }
                    </svg>
                  </button>
                </div>
              </div>

              {saveErr && (
                <div className="rounded-xl px-4 py-3 text-sm font-medium"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                  {saveErr}
                </div>
              )}
              {saveOk && (
                <div className="rounded-xl px-4 py-3 text-sm font-medium"
                  style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac' }}>
                  ✓ Saved! Add another or close.
                </div>
              )}
              <button onClick={create} disabled={!name.trim() || saving}
                className="w-full py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-40 mt-2"
                style={{ background: 'var(--accent)', color: 'var(--bg)', boxShadow: '0 0 20px rgba(0,245,255,0.25)' }}>
                {saving ? 'Saving...' : 'Save Connection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
