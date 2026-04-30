'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import WatchdogLogo from './WatchdogLogo'

/* ── Logo mark — re-exported as WatchdogIcon for backward compat with existing imports ── */
export function WatchdogIcon({ size = 92, animated = true }: { size?: number; animated?: boolean }) {
  return <WatchdogLogo size={size} animated={animated} />
}

/* ── Nav icons ──────────────────────────────────────────────────────────────── */
function HomeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: size, height: size }} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z"/>
      <path d="M9 21V12h6v9"/>
    </svg>
  )
}
function BotIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: size, height: size }} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="12" rx="2"/>
      <path d="M8 8V6a4 4 0 0 1 8 0v2"/>
      <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/>
      <path d="M12 2v2"/>
    </svg>
  )
}
function BrainIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: size, height: size }} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
    </svg>
  )
}
function ChatIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: size, height: size }} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <path d="M8 10h.01"/>
      <path d="M12 10h.01"/>
      <path d="M16 10h.01"/>
    </svg>
  )
}
function GearIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: size, height: size }} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
    </svg>
  )
}

/* ── Demo / Live mode ───────────────────────────────────────────────────────── */
export type TradeMode = 'demo' | 'live'

export function useTradeMode(): [TradeMode, (m: TradeMode) => void] {
  const [mode, setModeState] = useState<TradeMode>('demo')

  useEffect(() => {
    const saved = localStorage.getItem('watchdog-trade-mode')
    if (saved === 'live') setModeState('live')

    const onModeChange = (e: Event) => {
      setModeState((e as CustomEvent<TradeMode>).detail)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'watchdog-trade-mode')
        setModeState(e.newValue === 'live' ? 'live' : 'demo')
    }
    window.addEventListener('watchdog-mode-change', onModeChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('watchdog-mode-change', onModeChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setMode = (m: TradeMode) => {
    localStorage.setItem('watchdog-trade-mode', m)
    setModeState(m)
    window.dispatchEvent(new CustomEvent('watchdog-mode-change', { detail: m }))
  }
  return [mode, setMode]
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SIDEBAR — compact 10vw left rail
═══════════════════════════════════════════════════════════════════════════════ */
export default function Navbar() {
  const path = usePathname()
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const apply = () => {
      const t = localStorage.getItem('watchdog-theme')
      if (t) document.documentElement.setAttribute('data-theme', t)
    }
    apply()
    window.addEventListener('watchdog-theme-change', apply)
    return () => window.removeEventListener('watchdog-theme-change', apply)
  }, [])

  useEffect(() => {
    const FADE_DIST = 260
    const MIN_OPA  = 0.13

    // Coalesce mousemove → 1 update per frame via rAF. Without this, mutating
    // opacity on every move while the element has a CSS transition causes the
    // transition to cancel + restart dozens of times per second, which renders
    // as a visible flicker/white-flash. We also drop the CSS transition on the
    // nav (set inline below) — per-frame updates are already smooth.
    let alive = true
    let lastX = -1
    let lastY = -1
    let scheduled = false
    let lastApplied = ''

    const apply = () => {
      scheduled = false
      if (!alive) return
      const nav = navRef.current
      if (!nav) return
      const rect = nav.closest('aside')?.getBoundingClientRect()
      if (!rect) return
      const dx = Math.max(0, rect.left - lastX, lastX - rect.right)
      const dy = Math.max(0, rect.top  - lastY, lastY - rect.bottom)
      const dist = Math.sqrt(dx * dx + dy * dy)
      const o = dist <= 0 ? 1 : Math.max(MIN_OPA, 1 - dist / FADE_DIST)
      // Round to 2 decimals so we don't write the same value over and over,
      // and avoid sub-pixel paint thrash from imperceptible deltas.
      const next = o.toFixed(2)
      if (next === lastApplied) return
      lastApplied = next
      nav.style.opacity = next
    }

    const onMove = (e: MouseEvent) => {
      lastX = e.clientX
      lastY = e.clientY
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(apply)
    }
    const onLeave = () => {
      const nav = navRef.current
      if (!nav) return
      lastApplied = String(MIN_OPA)
      nav.style.opacity = String(MIN_OPA)
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave, { passive: true })
    return () => {
      alive = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const links = [
    { href: '/dashboard', label: 'Home',     Icon: HomeIcon  },
    { href: '/bots',      label: 'My Bots',  Icon: BotIcon   },
    { href: '/trainer',   label: 'AI Lab',   Icon: BrainIcon },
    { href: '/chat',      label: 'Chat',     Icon: ChatIcon  },
    { href: '/settings',  label: 'Settings', Icon: GearIcon  },
  ]

  return (
    <aside
      className="fixed left-0 top-0 z-50 flex flex-col"
      style={{
        width: 'var(--sidebar-w)',
        height: '100vh',
        background: 'var(--navbar)',
        backdropFilter: 'blur(56px) saturate(210%)',
        WebkitBackdropFilter: 'blur(56px) saturate(210%)',
        boxShadow: '8px 0 60px rgba(0,0,0,0.42)',
      }}
    >
      {/* ── LOGO + BRAND ─────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center" style={{ paddingTop: 18, paddingBottom: 0, flexShrink: 0 }}>
        <Link
          href="/dashboard"
          className="flex flex-col items-center"
          style={{ transition: 'opacity 0.22s ease' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.82'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          aria-label="WATCH-DOG"
        >
          {/* Animated brand mark — rotating ring + breathing glow + image breath */}
          <WatchdogLogo size={120} animated />
          <div style={{ marginTop: 16, textAlign: 'center', padding: '0 4px' }}>
            <div style={{
              fontSize: 28,
              fontWeight: 900,
              background: 'linear-gradient(90deg, #00f5ff, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '-0.02em',
              lineHeight: 1,
              fontFamily: 'Poppins, Inter, system-ui, sans-serif',
            }}>
              WatchDog
            </div>
            <div style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text-muted)',
              letterSpacing: '0.06em',
              lineHeight: 1.5,
              marginTop: 8,
              textTransform: 'uppercase' as const,
            }}>
              Universal AI<br />Bot Platform
            </div>
          </div>
        </Link>
      </div>

      {/* ── spacer before nav ───────────────────────────────────────────────── */}
      <div style={{ height: 96, flexShrink: 0 }} />

      {/* ── NAV LINKS ──────────────────────────────────────────────────────── */}
      <nav ref={navRef} className="flex flex-col items-center px-2 flex-1 overflow-y-auto"
        style={{ paddingTop: 0, paddingBottom: 24, gap: 6, opacity: 0.13, willChange: 'opacity' }}>
        {links.map(({ href, label, Icon }) => {
          const active = href === '/bots'
            ? path.startsWith('/bots')
            : path === href || path.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className="flex flex-col items-center justify-center rounded-2xl w-full"
              style={{
                padding: '12px 4px 10px',
                gap: 6,
                transition: 'all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
                ...(active ? {
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)',
                  boxShadow: '0 6px 24px var(--accent-dim), 0 1px 0 rgba(255,255,255,0.07) inset',
                } : {
                  color: 'var(--text-muted)',
                }),
              }}
              onMouseEnter={e => {
                if (!active) {
                  const el = e.currentTarget as HTMLElement
                  el.style.color = 'var(--text-primary)'
                  el.style.background = 'rgba(255,255,255,0.06)'
                  el.style.transform = 'translateY(-2px)'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  const el = e.currentTarget as HTMLElement
                  el.style.color = 'var(--text-muted)'
                  el.style.background = 'transparent'
                  el.style.transform = 'translateY(0)'
                }
              }}
            >
              <Icon size={29} />
              <span style={{
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: '-0.01em',
                textAlign: 'center',
                lineHeight: 1,
                fontFamily: 'Poppins, Inter, system-ui, sans-serif',
              }}>{label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
