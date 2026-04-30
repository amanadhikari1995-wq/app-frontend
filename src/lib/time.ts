/**
 * time.ts  —  Timezone-aware date/time formatting
 *
 * Auto-detects the user's browser timezone via the Intl API.
 * Falls back to 'America/Chicago' (CT) when running server-side or
 * when the browser does not expose timezone information.
 */

// ── Timezone helpers ──────────────────────────────────────────────────────────

/**
 * Returns the user's IANA timezone string (e.g. "America/New_York").
 * Safe to call in SSR — returns the CT fallback when `window` is absent.
 */
export function getDisplayTZ(): string {
  if (typeof window !== 'undefined' && typeof Intl !== 'undefined') {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) return tz
    } catch { /**/ }
  }
  return 'America/Chicago'
}

/**
 * Returns a short timezone abbreviation for the user's locale (e.g. "PST", "EST", "CST").
 */
export function getLocalTZAbbr(): string {
  const tz = getDisplayTZ()
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: tz })
      .formatToParts(new Date())
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz
  } catch {
    return 'CT'
  }
}

/**
 * Returns the user's current local time as a formatted string (e.g. "2:34:05 PM").
 */
export function getLocalTimeString(): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: getDisplayTZ(),
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ── SQLite UTC normalizer ──────────────────────────────────────────────────────
// SQLite stores naive datetimes without timezone info.
// Without a 'Z' suffix, JS interprets them as LOCAL time instead of UTC.
// This normalizer appends 'Z' so parsing is always UTC-based.
function utc(s: string): string {
  if (!s) return s
  if (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s)) return s
  return s + 'Z'
}

// ── Formatting functions (all use auto-detected local TZ) ─────────────────────

export function formatTimeCT(dateStr: string): string {
  return new Date(utc(dateStr)).toLocaleTimeString('en-US', {
    timeZone: getDisplayTZ(),
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatDateTimeCT(dateStr: string): string {
  return new Date(utc(dateStr)).toLocaleString('en-US', {
    timeZone: getDisplayTZ(),
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatShortDateTimeCT(dateStr: string): string {
  return new Date(utc(dateStr)).toLocaleString('en-US', {
    timeZone: getDisplayTZ(),
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatTradeDateCT(dateStr: string): string {
  return new Date(utc(dateStr)).toLocaleString('en-US', {
    timeZone: getDisplayTZ(),
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

export function todayLongCT(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: getDisplayTZ(),
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  })
}

export function timeAgo(dt: string | null): string {
  if (!dt) return 'Never'
  const s = Math.floor((Date.now() - new Date(utc(dt)).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
