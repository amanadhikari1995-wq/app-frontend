/**
 * WatchdogLogo — single source of truth for the brand mark.
 *
 * Wraps the existing /watchdog-logo.png in a premium animated frame:
 *   • Conic-gradient ring that slowly rotates (12 s cycle)
 *   • Halo behind the mark, opacity breathes 0.45 → 0.7 → 0.45 (5 s cycle)
 *   • The image itself breathes 1.000 → 1.018 → 1.000 (4.2 s cycle)
 *
 * All three are pure CSS keyframes on transform/opacity only — GPU-composited,
 * no layout thrash, no JS rerender, no extra heap. Set `animated={false}` to
 * disable everything (useful for static contexts like printable views).
 */
import React from 'react'

interface Props {
  size?: number
  animated?: boolean
  /** Override the corner radius of the inner image. Defaults to ~22% of size. */
  radius?: number
  /** Override the gradient ring thickness. Defaults to 3px for size>=80, else 2px. */
  ringWidth?: number
}

const KEYFRAMES = `
  @keyframes wd-spin   { from { transform: rotate(0) } to { transform: rotate(360deg) } }
  @keyframes wd-pulse  { 0%,100% { opacity: 0.45; transform: scale(1) } 50% { opacity: 0.72; transform: scale(1.08) } }
  @keyframes wd-breath { 0%,100% { transform: scale(1) } 50% { transform: scale(1.018) } }
`

export default function WatchdogLogo({
  size = 92,
  animated = true,
  radius,
  ringWidth,
}: Props) {
  const r       = radius    ?? Math.round(size * 0.22)
  const ring    = ringWidth ?? (size >= 80 ? 3 : 2)
  const haloPad = Math.round(size * 0.55)

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-block',
        flexShrink: 0,
      }}
    >
      {/* Halo — soft, behind everything, breathes */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left:   -haloPad,
          top:    -haloPad,
          right:  -haloPad,
          bottom: -haloPad,
          borderRadius: '50%',
          background:
            'radial-gradient(closest-side, rgba(0,245,255,0.32), rgba(124,58,237,0.18) 50%, transparent 75%)',
          filter: 'blur(10px)',
          opacity: 0.55,
          pointerEvents: 'none',
          willChange: animated ? 'opacity, transform' : undefined,
          animation: animated ? 'wd-pulse 5s ease-in-out infinite' : undefined,
        }}
      />

      {/* Rotating conic ring */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          padding: ring,
          borderRadius: r + ring,
          background:
            'conic-gradient(from 0deg, #00f5ff, #7c3aed, #ec4899, #f59e0b, #00f5ff)',
          willChange: animated ? 'transform' : undefined,
          animation: animated ? 'wd-spin 12s linear infinite' : undefined,
          // Mask out the centre so the ring is hollow — the image fills the hole below
          WebkitMask:
            `radial-gradient(circle at center, transparent calc(50% - ${ring}px), #000 calc(50% - ${ring}px + 1px))`,
          mask:
            `radial-gradient(circle at center, transparent calc(50% - ${ring}px), #000 calc(50% - ${ring}px + 1px))`,
          boxShadow:
            '0 0 28px rgba(0,245,255,0.40), 0 0 52px rgba(124,58,237,0.28), 0 0 72px rgba(236,72,153,0.18)',
        }}
      />

      {/* Breathing image */}
      <img
        src="/watchdog-logo.png"
        alt="WATCH-DOG"
        draggable={false}
        style={{
          position: 'absolute',
          left:   ring + 1,
          top:    ring + 1,
          width:  size - (ring + 1) * 2,
          height: size - (ring + 1) * 2,
          objectFit: 'cover',
          objectPosition: 'center top',
          borderRadius: r,
          display: 'block',
          willChange: animated ? 'transform' : undefined,
          animation: animated ? 'wd-breath 4.2s ease-in-out infinite' : undefined,
          userSelect: 'none',
        }}
      />

      <style>{KEYFRAMES}</style>
    </div>
  )
}
