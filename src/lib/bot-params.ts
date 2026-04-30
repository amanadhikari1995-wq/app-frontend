/**
 * bot-params.ts  —  Dynamic bot parameter detection & apply engine
 *
 * Scans Python bot code for every configurable value and returns
 * a typed, grouped list of editable parameters.
 *
 * Detection patterns:
 *   1. os.getenv("VAR", "default")          — env var with string default
 *   2. os.getenv("VAR", 123)                — env var with numeric default
 *   3. VAR = "value"   (top-level ALL_CAPS) — direct string assignment
 *   4. VAR = 123 / 0.5 (top-level)         — direct number assignment
 *   5. VAR = True/False (top-level)         — direct boolean assignment
 */

export type ParamType   = 'boolean' | 'integer' | 'float' | 'text' | 'url'
export type ParamSource = 'getenv'  | 'assignment'

export interface BotParam {
  name:    string      // VAR_NAME
  label:   string      // "Var Name"
  value:   string      // current value (always string for easy input binding)
  type:    ParamType
  source:  ParamSource
  section: string      // grouping key
}

// ── Section classification ─────────────────────────────────────────────────────

const SECTION_RULES: [RegExp, string][] = [
  [/SYMBOL|TICKER|PAIR|ASSET|MARKET|CURRENCY|COIN|CONTRACT|INSTRUMENT/i, 'Trading Pair'   ],
  [/MAX|MIN|RISK|LOSS|STOP|TRAIL|SIZE|AMOUNT|BUDGET|POSITION|EXPOSURE/i, 'Risk Management'],
  [/INTERVAL|SLEEP|DELAY|TIMEOUT|CYCLE|FREQ|PERIOD|WAIT|EVERY/i,        'Timing'          ],
  [/THRESHOLD|CONFIDENCE|SCORE|PCT|PERCENT|PROB|RATIO|WEIGHT|LIMIT/i,   'Thresholds'      ],
  [/TELEGRAM|WEBHOOK|URL|TOKEN|KEY|API|CHAT|BOT_ID|SECRET|HOST|PORT/i,  'Connections'     ],
  [/^(USE_|ENABLE_|ALLOW_|DISABLE_|IS_|HAS_)/i,                         'Toggles'         ],
]

function classifySection(name: string): string {
  for (const [re, section] of SECTION_RULES) {
    if (re.test(name)) return section
  }
  return 'General'
}

// ── Section display metadata ───────────────────────────────────────────────────

export const SECTION_META: Record<string, { icon: string; color: string; bg: string }> = {
  'Trading Pair'   : { icon: '📊', color: 'var(--accent)', bg: 'var(--accent-dim)'   },
  'Risk Management': { icon: '🛡️', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  'Timing'         : { icon: '⏱️', color: '#6366f1', bg: 'rgba(99,102,241,0.08)' },
  'Thresholds'     : { icon: '🎯', color: '#a855f7', bg: 'rgba(168,85,247,0.08)' },
  'Connections'    : { icon: '🔗', color: '#22c55e', bg: 'rgba(34,197,94,0.08)'  },
  'Toggles'        : { icon: '⚡', color: '#f87171', bg: 'rgba(248,113,113,0.08)'},
  'General'        : { icon: '⚙️', color: '#94a3b8', bg: 'rgba(148,163,184,0.06)'},
}

export const SECTION_ORDER = [
  'Trading Pair', 'Risk Management', 'Timing', 'Thresholds',
  'Connections', 'Toggles', 'General',
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function toLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

function detectType(name: string, value: string): ParamType {
  const v = value.trim()
  if (v === 'True' || v === 'False' || v === 'true' || v === 'false') return 'boolean'
  if (v.startsWith('http://') || v.startsWith('https://') ||
      /URL|WEBHOOK|ENDPOINT/i.test(name)) return 'url'
  if (/^-?\d+$/.test(v)) return 'integer'
  if (/^-?[\d]+\.[\d]*$/.test(v) || /^-?[\d]*\.[\d]+$/.test(v)) return 'float'
  return 'text'
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Escape $ signs in regex replacement strings */
function escapeReplacement(s: string): string {
  return s.replace(/\$/g, '$$$$')
}

// Skip internal/builtin names
const SKIP: Set<string> = new Set([
  'TRUE', 'FALSE', 'NONE', 'PRINT', 'INT', 'FLOAT', 'STR', 'BOOL',
  'LIST', 'DICT', 'SET', 'TUPLE', 'LEN', 'RANGE', 'TYPE', 'OPEN',
  'GET', 'POST', 'PUT', 'DELETE',
])

// ── Main: extract all configurable params from code ───────────────────────────

export function extractParams(code: string): BotParam[] {
  const params: BotParam[] = []
  const seen = new Set<string>()

  const add = (name: string, rawValue: string, source: ParamSource) => {
    if (seen.has(name)) return
    if (name.startsWith('WATCHDOG_')) return
    if (SKIP.has(name.toUpperCase())) return
    if (name.length < 2 || name.startsWith('_')) return
    seen.add(name)

    const v = rawValue.trim()
    // Normalize Python boolean casing
    const value = v === 'true' ? 'True' : v === 'false' ? 'False' : v
    const type = detectType(name, value)
    params.push({
      name,
      label:   toLabel(name),
      value,
      type,
      source,
      section: classifySection(name),
    })
  }

  // Pattern 1: os.getenv("VAR", "string_default")
  const re1 = /os\.getenv\(\s*["']([A-Z_][A-Z0-9_]*)["']\s*,\s*["']([^"']*)["']\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re1.exec(code)) !== null) add(m[1], m[2], 'getenv')

  // Pattern 2: os.getenv("VAR", numeric_default)
  const re2 = /os\.getenv\(\s*["']([A-Z_][A-Z0-9_]*)["']\s*,\s*(-?[\d.]+)\s*\)/g
  while ((m = re2.exec(code)) !== null) add(m[1], m[2], 'getenv')

  // Pattern 3: VAR = "string"  (non-indented, ALL_CAPS with at least 2 chars)
  const re3 = /^([A-Z][A-Z0-9_]{1,})\s*=\s*["']([^"'\n]*)["']/gm
  while ((m = re3.exec(code)) !== null) add(m[1], m[2], 'assignment')

  // Pattern 4: VAR = number  (non-indented)
  const re4 = /^([A-Z][A-Z0-9_]{1,})\s*=\s*(-?[\d.]+)\s*(?:#.*)?$/gm
  while ((m = re4.exec(code)) !== null) add(m[1], m[2], 'assignment')

  // Pattern 5: VAR = True/False  (non-indented)
  const re5 = /^([A-Z][A-Z0-9_]{1,})\s*=\s*(True|False)\s*(?:#.*)?$/gm
  while ((m = re5.exec(code)) !== null) add(m[1], m[2], 'assignment')

  return params
}

// ── Apply: write updated values back into code ────────────────────────────────

export function applyParams(code: string, params: BotParam[]): string {
  let updated = code
  for (const p of params) {
    const escapedName = escapeRegex(p.name)
    const escapedVal  = escapeReplacement(p.value)

    if (p.source === 'getenv') {
      // Replace string default: os.getenv("VAR", "old") → os.getenv("VAR", "new")
      const strRe = new RegExp(
        `(os\\.getenv\\(\\s*["']${escapedName}["']\\s*,\\s*)["'][^"']*["'](\\s*\\))`, 'g'
      )
      const numRe = new RegExp(
        `(os\\.getenv\\(\\s*["']${escapedName}["']\\s*,\\s*)-?[\\d.]+(\\s*\\))`, 'g'
      )
      const isNum = p.type === 'integer' || p.type === 'float'
      if (strRe.test(updated)) {
        strRe.lastIndex = 0
        updated = updated.replace(strRe, `$1"${escapedVal}"$2`)
      } else {
        updated = updated.replace(numRe, isNum ? `$1${escapedVal}$2` : `$1"${escapedVal}"$2`)
      }
    } else {
      // Direct assignment — replace the whole RHS
      const isBool  = p.type === 'boolean'
      const isNum   = p.type === 'integer' || p.type === 'float'
      const newVal  = isBool || isNum ? escapedVal : `"${escapedVal}"`
      const assignRe = new RegExp(`^(${escapedName}\\s*=\\s*).*$`, 'gm')
      updated = updated.replace(assignRe, `$1${newVal}`)
    }
  }
  return updated
}

// ── Group params by section (for rendering) ───────────────────────────────────

export interface ParamGroup {
  section: string
  icon:    string
  color:   string
  bg:      string
  params:  BotParam[]
}

export function groupParams(params: BotParam[]): ParamGroup[] {
  const map: Record<string, BotParam[]> = {}
  for (const p of params) {
    if (!map[p.section]) map[p.section] = []
    map[p.section].push(p)
  }
  return SECTION_ORDER
    .filter(s => map[s])
    .map(s => ({
      section: s,
      icon:    SECTION_META[s]?.icon  ?? '⚙️',
      color:   SECTION_META[s]?.color ?? '#94a3b8',
      bg:      SECTION_META[s]?.bg    ?? 'rgba(148,163,184,0.06)',
      params:  map[s],
    }))
}

// ── Step size for number inputs ────────────────────────────────────────────────

export function getStep(type: ParamType, value: string): number {
  if (type === 'integer') return 1
  const n = parseFloat(value)
  if (!isNaN(n) && Math.abs(n) < 0.1) return 0.001
  if (!isNaN(n) && Math.abs(n) < 1)   return 0.01
  return 0.1
}
