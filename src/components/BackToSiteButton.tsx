'use client'
/**
 * BackToSiteButton — top-right close (X) button shown ONLY in the web
 * dashboard (browser mode). Clicking it sends the user back to their
 * previous page if one exists in the same tab's history, otherwise
 * navigates to https://watchdogbot.cloud/ (the marketing site root).
 *
 * Hidden when running inside Electron — the desktop app has no
 * "previous site" to go back to.
 */
import { useEffect, useState } from 'react'
import { getTransportMode } from '@/lib/runtime-config'

export default function BackToSiteButton() {
  // Only render in browser/relay mode. We resolve at mount so SSR
  // matches the static export, then re-evaluate after hydration.
  const [show, setShow] = useState(false)
  useEffect(() => { setShow(getTransportMode() === 'relay') }, [])

  if (!show) return null

  const onClick = () => {
    // If the user navigated to /app/ from a link on the same site
    // (referrer same-origin), `history.length > 1` will be true and
    // history.back() reliably returns them where they came from.
    // Otherwise (direct URL hit, opened in new tab) fall back to /
    if (typeof window === 'undefined') return
    const sameOriginReferrer =
      document.referrer && (() => {
        try { return new URL(document.referrer).origin === window.location.origin }
        catch { return false }
      })()
    if (sameOriginReferrer && window.history.length > 1) {
      window.history.back()
    } else {
      window.location.href = '/'
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to website"
      title="Back to website"
      style={{
        position:    'fixed',
        top:         16,
        right:       16,
        zIndex:      100,
        width:       40,
        height:      40,
        display:     'grid',
        placeItems:  'center',
        background:  'rgba(15,15,30,0.72)',
        border:      '1px solid rgba(255,255,255,0.14)',
        borderRadius:12,
        color:       '#e2e8f0',
        cursor:      'pointer',
        backdropFilter:        'blur(18px) saturate(160%)',
        WebkitBackdropFilter:  'blur(18px) saturate(160%)',
        boxShadow:   '0 8px 24px rgba(0,0,0,0.4)',
        transition:  'background 0.18s ease, transform 0.18s ease, border-color 0.18s ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.background    = 'rgba(255,68,68,0.18)'
        el.style.borderColor   = 'rgba(255,68,68,0.5)'
        el.style.color         = '#ff8a8a'
        el.style.transform     = 'scale(1.05)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.background    = 'rgba(15,15,30,0.72)'
        el.style.borderColor   = 'rgba(255,255,255,0.14)'
        el.style.color         = '#e2e8f0'
        el.style.transform     = 'scale(1.0)'
      }}
    >
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6"  y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  )
}
