'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { newsApi } from '@/lib/api'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

interface NewsItem {
  title: string
  description?: string
  link: string
  source: string
  color: string
  pubDate: string
  ts: number
  image?: string
}

function relTime(ts: number) {
  const diff = Date.now() / 1000 - ts
  if (diff < 60)    return `${Math.floor(diff)}s ago`
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
  return `${Math.floor(diff/86400)}d ago`
}

/* ──────────────────────────────────────────────────────────────────────────────
   CLOCK SECTION — Analog + Digital toggle
   `now` is left null on first render to avoid SSR/CSR hydration mismatch
   from sin/cos floating-point precision in the SVG line coordinates.
────────────────────────────────────────────────────────────────────────────── */
function ClockSection() {
  const [now, setNow]   = useState<Date | null>(null)
  const [mode, setMode] = useState<'analog' | 'digital'>('analog')

  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const cardStyle: React.CSSProperties = {
    background: 'var(--card)',
    backdropFilter: 'blur(40px) saturate(200%)',
    WebkitBackdropFilter: 'blur(40px) saturate(200%)',
    boxShadow: 'var(--shadow-card)',
    borderRadius: 20,
  }

  if (!now) {
    return (
      <div className="h-full flex items-center justify-center" style={cardStyle}>
        <span style={{ fontSize: 14.4, color: 'var(--text-muted)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          ——:——
        </span>
      </div>
    )
  }

  const h = now.getHours()
  const m = now.getMinutes()
  const s = now.getSeconds()
  const secRad = (s * 6 * Math.PI) / 180
  const minRad = ((m * 6 + s * 0.1) * Math.PI) / 180
  const hrRad  = (((h % 12) * 30 + m * 0.5) * Math.PI) / 180

  const dayStr  = now.toLocaleDateString('en-US', { weekday: 'long' })
  const dateStr = now.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })
  const yearStr = now.getFullYear().toString()

  return (
    <div className="h-full flex flex-col px-3 py-3 gap-2" style={cardStyle}>
      {/* Top row: date info on left, A/D toggle on right */}
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div className="flex flex-col gap-1 min-w-0">
          <p className="font-black text-white uppercase leading-none truncate"
            style={{ fontSize: 14.4, letterSpacing: '0.10em' }}>{dayStr}</p>
          <p className="font-bold text-white leading-tight truncate"
            style={{ fontSize: 15.6 }}>{dateStr}</p>
          <p className="font-bold leading-none truncate"
            style={{ fontSize: 13.2, color: 'var(--accent)' }}>{yearStr}</p>
        </div>
        <div className="flex rounded-lg overflow-hidden shrink-0"
          style={{ border: '1px solid var(--border)', background: 'rgba(0,0,0,0.30)' }}>
          {(['analog', 'digital'] as const).map(md => (
            <button key={md} onClick={() => setMode(md)}
              className="transition-all duration-150"
              style={{
                padding: '4px 8px',
                fontSize: 12,
                fontWeight: 800,
                color:      mode === md ? 'var(--accent)' : 'rgba(255,255,255,0.30)',
                background: mode === md ? 'var(--accent-dim)' : 'transparent',
              }}>
              {md === 'analog' ? 'A' : 'D'}
            </button>
          ))}
        </div>
      </div>

      {/* Clock face */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {mode === 'analog' ? (
          <svg viewBox="0 0 200 200"
            style={{
              height: '100%', width: 'auto', maxHeight: '100%', maxWidth: '100%',
              filter: 'drop-shadow(0 0 28px var(--accent-dim))',
            }}>
            <circle cx="100" cy="100" r="96" fill="rgba(5,7,15,0.65)" stroke="var(--accent-dim)" strokeWidth="1.5"/>
            <circle cx="100" cy="100" r="88" fill="none" stroke="var(--accent-glow)" strokeWidth="4"/>
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i * 30 * Math.PI) / 180
              return (
                <line key={i}
                  x1={100+79*Math.sin(a)} y1={100-79*Math.cos(a)}
                  x2={100+90*Math.sin(a)} y2={100-90*Math.cos(a)}
                  stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round"/>
              )
            })}
            {Array.from({ length: 60 }).map((_, i) => {
              if (i % 5 === 0) return null
              const a = (i * 6 * Math.PI) / 180
              return (
                <line key={i}
                  x1={100+85*Math.sin(a)} y1={100-85*Math.cos(a)}
                  x2={100+91*Math.sin(a)} y2={100-91*Math.cos(a)}
                  stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeLinecap="round"/>
              )
            })}
            <line x1={100-14*Math.sin(hrRad)}  y1={100+14*Math.cos(hrRad)}
                  x2={100+50*Math.sin(hrRad)}  y2={100-50*Math.cos(hrRad)}
                  stroke="white" strokeWidth="4.5" strokeLinecap="round"/>
            <line x1={100-16*Math.sin(minRad)} y1={100+16*Math.cos(minRad)}
                  x2={100+68*Math.sin(minRad)} y2={100-68*Math.cos(minRad)}
                  stroke="rgba(255,255,255,0.88)" strokeWidth="3" strokeLinecap="round"/>
            <line x1={100-18*Math.sin(secRad)} y1={100+18*Math.cos(secRad)}
                  x2={100+74*Math.sin(secRad)} y2={100-74*Math.cos(secRad)}
                  stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"
                  style={{ filter: 'drop-shadow(0 0 3px var(--accent))' }}/>
            <circle cx="100" cy="100" r="5" fill="var(--accent)" style={{ filter: 'drop-shadow(0 0 5px var(--accent))' }}/>
            <circle cx="100" cy="100" r="2" fill="#05070f"/>
          </svg>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono font-black tabular-nums text-white leading-none"
              style={{ fontSize: '2.2rem', textShadow: '0 0 32px var(--accent-glow)', letterSpacing: '0.04em' }}>
              {String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}
            </span>
            <span className="font-mono font-bold tabular-nums"
              style={{ fontSize: '1.05rem', color: 'var(--accent)', letterSpacing: '0.12em' }}>
              {String(s).padStart(2,'0')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────────
   NEWS SECTION — one unified, cohesive feed
   • Single styled container with rows inside (no separate cards).
   • Exactly 3 items visible in the viewport; the rest scrolls below.
   • Newest items prepend to the top; older items shift down. Dedupe by link.
   • Auto-refresh every 30 s; paused while user is actively scrolling and
     resumed ~1.5 s after the user stops scrolling.
────────────────────────────────────────────────────────────────────────────── */
const NEWS_CAP            = 50      // cap on items kept in memory
const REFRESH_MS          = 30_000  // 30-second auto-refresh
const SCROLL_RESUME_MS    = 1500    // resume refresh 1.5 s after scroll stops
const VISIBLE_ITEMS       = 3       // exactly 3 rows visible in the viewport

function NewsSection() {
  const [items, setItems]       = useState<NewsItem[]>([])
  const [isPaused, setIsPaused] = useState(false)

  const scrollRef        = useRef<HTMLDivElement>(null)
  const isScrollingRef   = useRef(false)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchNews = useCallback(async (force = false) => {
    if (!force && isScrollingRef.current) return
    try {
      const r = await newsApi.get()
      const incoming: NewsItem[] = r.data.items || []
      setItems(prev => {
        if (prev.length === 0) return incoming.slice(0, NEWS_CAP)
        const seen = new Set(prev.map(p => p.link))
        const fresh = incoming.filter(i => !seen.has(i.link))
        if (fresh.length === 0) return prev
        return [...fresh, ...prev].slice(0, NEWS_CAP)
      })
    } catch { /* silent — retry on next tick */ }
  }, [])

  useEffect(() => { fetchNews(true) }, [fetchNews])
  useOnlineStatus(() => fetchNews(true))

  // 30-second poll. fetchNews skips internally if user is scrolling.
  useEffect(() => {
    const t = setInterval(() => fetchNews(false), REFRESH_MS)
    return () => clearInterval(t)
  }, [fetchNews])

  // Track active scroll: pause refresh; resume after a quiet period.
  const handleScroll = useCallback(() => {
    isScrollingRef.current = true
    setIsPaused(true)
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false
      setIsPaused(false)
    }, SCROLL_RESUME_MS)
  }, [])

  useEffect(() => () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
  }, [])

  // Container — ONE styled card holding the whole feed.
  const containerStyle: React.CSSProperties = {
    background: 'var(--card)',
    backdropFilter: 'blur(40px) saturate(180%)',
    WebkitBackdropFilter: 'blur(40px) saturate(180%)',
    boxShadow: 'var(--shadow-card)',
    borderRadius: 20,
    overflow: 'hidden',
  }
  // Each row sized so exactly VISIBLE_ITEMS rows fill the scroll viewport.
  const rowHeightCss = `calc(100% / ${VISIBLE_ITEMS})`

  return (
    <div className="h-full flex flex-col min-h-0" style={containerStyle}>
      {/* Header strip — single section title + live/paused indicator */}
      <div className="flex items-center justify-between px-3.5 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full${isPaused ? '' : ' animate-pulse'}`}
            style={{ background: isPaused ? '#f59e0b' : 'var(--accent)' }} />
          <span className="text-[12px] font-black uppercase tracking-widest text-white">
            Live News
          </span>
        </span>
        <span className="text-[10.8px] font-semibold tabular-nums"
          style={{ color: isPaused ? '#f59e0b' : 'rgba(255,255,255,0.45)' }}>
          {isPaused ? 'Paused' : 'Auto · 30s'}
        </span>
      </div>

      {/* Scrollable feed — rows inside one container; no card-per-item styling */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto custom-news-scroll"
        style={{ scrollBehavior: 'smooth' }}
      >
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600 text-sm">
            Loading news…
          </div>
        ) : items.map((item, idx) => (
          <a key={item.link} href={item.link} target="_blank" rel="noopener noreferrer"
            className="group block relative transition-colors"
            style={{
              height: rowHeightCss,
              minHeight: 132,
              textDecoration: 'none',
              borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
            }}>
            {/* Background photo (or coloured fallback) */}
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              {item.image ? (
                <img src={item.image} alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55, transition: 'opacity 0.2s' }}
                  onError={e => {
                    const img = e.target as HTMLImageElement
                    img.style.display = 'none'
                    if (img.parentElement) {
                      img.parentElement.style.background =
                        `linear-gradient(135deg, ${item.color}33 0%, rgba(5,7,15,0.95) 100%)`
                    }
                  }} />
              ) : (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: `linear-gradient(135deg, ${item.color}28 0%, rgba(5,7,15,0.95) 100%)`,
                }} />
              )}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to right, rgba(5,7,15,0.92) 0%, rgba(5,7,15,0.78) 55%, rgba(5,7,15,0.55) 100%)',
                pointerEvents: 'none',
              }} />
            </div>

            {/* Foreground — source badge, time, headline, description */}
            <div className="relative h-full flex flex-col justify-between px-3.5 py-2.5">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10.8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
                  style={{
                    color: item.color,
                    background: `${item.color}26`,
                    border: `1px solid ${item.color}55`,
                  }}>
                  {item.source}
                </span>
                {item.ts > 0 && (
                  <span className="text-[10.8px] font-semibold text-white/55 tabular-nums">
                    {relTime(item.ts)}
                  </span>
                )}
              </div>

              <div className="min-h-0">
                <p className="font-bold text-white leading-snug group-hover:text-[var(--accent)] transition-colors"
                  style={{
                    fontSize: 13.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textShadow: '0 1px 6px rgba(0,0,0,0.85)',
                  } as React.CSSProperties}>
                  {item.title}
                </p>
                {item.description && (
                  <p className="text-white/65 leading-snug mt-1"
                    style={{
                      fontSize: 11.5,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      textShadow: '0 1px 4px rgba(0,0,0,0.75)',
                    } as React.CSSProperties}>
                    {item.description}
                  </p>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>

      <style jsx>{`
        .custom-news-scroll::-webkit-scrollbar { width: 5px }
        .custom-news-scroll::-webkit-scrollbar-track { background: transparent }
        .custom-news-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.10);
          border-radius: 3px;
        }
        .custom-news-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.20);
        }
      `}</style>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────────
   RightSidebar — fixed right rail, 1/3 Clock + 2/3 News
────────────────────────────────────────────────────────────────────────────── */
// Hide on auth/landing routes. Use startsWith — under the Electron app://
// protocol the pathname ends with a trailing slash (e.g. "/login/") so a
// strict equality check would miss it.
const HIDE_PATHS = ['/login', '/signup']

export default function RightSidebar() {
  const pathname = usePathname() ?? ''
  if (HIDE_PATHS.some(p => pathname.startsWith(p))) return null

  return (
    <aside
      className="fixed right-0 top-0 z-40 flex flex-col"
      style={{
        width: 'var(--sidebar-r)',
        height: '100vh',
        padding: '20px 14px',
        gap: 12,
        background: 'var(--navbar)',
        backdropFilter: 'blur(48px) saturate(200%)',
        WebkitBackdropFilter: 'blur(48px) saturate(200%)',
        boxShadow: '-8px 0 60px rgba(0,0,0,0.42)',
      }}
    >
      {/* TOP 1/3 — Analog + Digital Clock */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ClockSection />
      </div>

      {/* BOTTOM 2/3 — Single News Section, 3 cards */}
      <div style={{ flex: 2, minHeight: 0 }}>
        <NewsSection />
      </div>
    </aside>
  )
}
