'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { botsApi, connectionsApi, analyzeApi, type AnalyzeResponse } from '@/lib/api'
import { formatTimeCT, formatDateTimeCT } from '@/lib/time'
import Navbar, { useTradeMode } from '@/components/Navbar'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import {
  BotParam, extractParams, applyParams, groupParams, getStep, SECTION_META,
} from '@/lib/bot-params'
import { detectRequiredApis, detectAllApis, unconfiguredApis, type DetectedApi } from '@/lib/api-detector'
import { detectBotType, detectBotSubLabel, BOT_TYPE_META, type BotType } from '@/lib/bot-detector'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import AiFixModal from '@/components/AiFixModal'

const BG = 'var(--bg)'
const CARD = { background: 'var(--card)', backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: 'var(--shadow-card)' } as React.CSSProperties

// ── Interfaces ────────────────────────────────────────────────────────────────
interface Bot  {
  id: number; name: string; description: string | null; status: string
  run_count: number; last_run_at: string | null; code: string
  max_amount_per_trade: number | null; max_contracts_per_trade: number | null
  max_daily_loss: number | null; schedule_type: string; schedule_start: string | null
  schedule_end: string | null; auto_restart: boolean
}
interface Log  { id: number; level: string; message: string; created_at: string }
interface Conn { id: number; bot_id: number; name: string; base_url: string | null; api_key: string | null; is_active: boolean; created_at: string }

function isLockedBot(botId: number): boolean {
  try {
    const raw = localStorage.getItem('watchdog-locked-bots')
    if (!raw) return false
    return (JSON.parse(raw) as number[]).includes(botId)
  } catch { return false }
}

// User-selected bot type stored at creation (see /bots page type selector).
// Maps to the BotType enum used by the detail dashboard.
const USER_TYPE_TO_BOT_TYPE: Record<string, BotType> = {
  trading:    'trading',
  arbitrage:  'arbitrage',
  prediction: 'prediction',
  grid:       'grid',
  dca:        'dca',
  scalping:   'scalping',
  telegram:   'telegram',
  custom:     'generic',
}
function getUserSelectedBotType(botId: number): BotType | null {
  try {
    const raw = localStorage.getItem('watchdog-bot-types')
    if (!raw) return null
    const map = JSON.parse(raw) as Record<string, string>
    const sel = map[String(botId)]
    return sel && USER_TYPE_TO_BOT_TYPE[sel] ? USER_TYPE_TO_BOT_TYPE[sel] : null
  } catch { return null }
}

// BOT_TYPE_META, BotType, detectBotType, detectBotSubLabel imported from @/lib/bot-detector

// ── Prediction metrics ────────────────────────────────────────────────────────
interface PredRow { time: string; text: string; result: 'correct' | 'wrong' | 'unknown'; conf: number | null }
interface PredMetrics { total: number; correct: number; wrong: number; accuracy: number; avgConf: number; recent: PredRow[] }

function parsePredMetrics(logs: Log[]): PredMetrics {
  let correct = 0, wrong = 0, totalConf = 0, confCount = 0
  const recent: PredRow[] = []
  for (const log of logs) {
    const msg = log.message
    const isC = /\bcorrect\b|accurate|right prediction|true positive|SETTLED WIN/i.test(msg)
    const isW = /\bwrong\b|incorrect|inaccurate|false positive|false negative|SETTLED LOSS/i.test(msg)
    if (isC) correct++; else if (isW) wrong++
    const cm = msg.match(/confidence[=:\s]+([0-9.]+)(%?)/i)
    if (cm) { let c = parseFloat(cm[1]); if (!cm[2] && c <= 1) c *= 100; totalConf += c; confCount++ }
    // Match [prediction]/[signal]/[ai] tagged lines OR Kalshi bot "Decision:"/"Claude:" lines
    const isPredLine = /\[prediction\]|\[signal\]|\[ai\]/i.test(msg)
      || /^(Decision|Claude)[\s:]/i.test(msg)
      || /\b(Decision|AI decision|Claude decision):\s*(YES|NO)\b/i.test(msg)
    if (isPredLine && recent.length < 10) {
      recent.push({ time: log.created_at, text: msg.replace(/^\[.*?\]\s*/, '').slice(0, 90), result: isC ? 'correct' : isW ? 'wrong' : 'unknown', conf: cm ? Math.round(parseFloat(cm[1]) * (cm[2] ? 1 : 100)) : null })
    }
  }
  // Total predictions = explicit correct/wrong counts OR count of decision log lines
  const decisionLines = logs.filter(l =>
    /\[prediction\]|\[signal\]/i.test(l.message)
    || /^(Decision|Claude)[\s:]/i.test(l.message)
    || /ORDER PLACED/i.test(l.message)
  ).length
  const total = correct + wrong || decisionLines
  return { total, correct, wrong, accuracy: correct + wrong > 0 ? Math.round(correct / (correct + wrong) * 100) : 0, avgConf: confCount > 0 ? Math.round(totalConf / confCount) : 0, recent }
}

// ── Scraper metrics ───────────────────────────────────────────────────────────
interface ScraperMetrics { totalItems: number; lastTime: string | null; successRate: number; fetchCount: number; preview: string[] }

function parseScraperMetrics(logs: Log[]): ScraperMetrics {
  let totalItems = 0, success = 0, fail = 0, lastTime: string | null = null
  const preview: string[] = []
  for (const log of logs) {
    const msg = log.message
    const im = msg.match(/(\d+)\s+items?/i)
    if (im) totalItems += parseInt(im[1])
    if (/saved|scraped|fetched|done|completed/i.test(msg) && log.level !== 'ERROR') { success++; lastTime = log.created_at }
    if (log.level === 'ERROR') fail++
    if (/saved|data|result|→/i.test(msg) && preview.length < 5) preview.push(msg.replace(/^\[.*?\]\s*/, '').slice(0, 85))
  }
  const total = success + fail
  return { totalItems, lastTime, successRate: total > 0 ? Math.round(success / total * 100) : success > 0 ? 100 : 0, fetchCount: total, preview }
}

// ── Notification metrics ──────────────────────────────────────────────────────
interface NotifEntry { time: string; msg: string; ok: boolean }
interface NotifMetrics { sent: number; failed: number; successRate: number; lastTime: string | null; history: NotifEntry[] }

function parseNotifMetrics(logs: Log[]): NotifMetrics {
  let sent = 0, failed = 0, lastTime: string | null = null
  const history: NotifEntry[] = []
  for (const log of logs) {
    const msg = log.message
    const isOk   = /webhook sent|notification sent|delivered|message sent|sent.*20[0-9]/i.test(msg)
    const isFail = log.level === 'ERROR' || /failed|rejected|error.*send/i.test(msg)
    if (isOk && !isFail) { sent++; lastTime = log.created_at; if (history.length < 10) history.push({ time: log.created_at, msg: msg.replace(/^\[.*?\]\s*/, '').slice(0, 80), ok: true }) }
    else if (isFail && /webhook|notification|send/i.test(msg)) { failed++; if (history.length < 10) history.push({ time: log.created_at, msg: msg.replace(/^\[.*?\]\s*/, '').slice(0, 80), ok: false }) }
  }
  const total = sent + failed
  return { sent, failed, successRate: total > 0 ? Math.round(sent / total * 100) : sent > 0 ? 100 : 0, lastTime, history }
}

// ── Telegram metrics ──────────────────────────────────────────────────────────
interface TelegramMetrics { sent: number; received: number; commands: number; uniqueUsers: number; uniqueChats: number; errors: number; lastTime: string | null; recentCmds: { time: string; msg: string }[] }

function parseTelegramMetrics(logs: Log[]): TelegramMetrics {
  let sent = 0, received = 0, commands = 0, errors = 0
  let lastTime: string | null = null
  const users = new Set<string>(), chats = new Set<string>()
  const recentCmds: { time: string; msg: string }[] = []
  for (const log of logs) {
    const msg = log.message
    if (/send.*message|replied|sent.*reply|bot.*sent|message sent|send_message/i.test(msg)) { sent++; lastTime = log.created_at }
    if (/received.*message|incoming.*message|new.*message|update.*from|message.*from user/i.test(msg)) received++
    if (/command.*handled|\/start|\/help|\/status|\/price|command:.*executed|handling.*command/i.test(msg)) {
      commands++
      if (recentCmds.length < 8) recentCmds.push({ time: log.created_at, msg: msg.replace(/^\[.*?\]\s*/, '').slice(0, 80) })
    }
    if (log.level === 'ERROR') errors++
    const uid = msg.match(/user[_\s]?id[=:\s]+(\d+)/i); if (uid) users.add(uid[1])
    const cid = msg.match(/chat[_\s]?id[=:\s]+(-?\d+)/i); if (cid) chats.add(cid[1])
  }
  return { sent, received, commands, uniqueUsers: users.size, uniqueChats: chats.size, errors, lastTime, recentCmds }
}

// ── Discord metrics ───────────────────────────────────────────────────────────
interface DiscordMetrics { commands: number; messagesSent: number; eventsHandled: number; guilds: number; errors: number; lastTime: string | null; recentCmds: { time: string; msg: string }[] }

function parseDiscordMetrics(logs: Log[]): DiscordMetrics {
  let commands = 0, messagesSent = 0, eventsHandled = 0, errors = 0
  let lastTime: string | null = null
  const guilds = new Set<string>()
  const recentCmds: { time: string; msg: string }[] = []
  for (const log of logs) {
    const msg = log.message
    if (/command.*invoked|slash.*command|![\w]+|command.*executed|handling command/i.test(msg)) {
      commands++; lastTime = log.created_at
      if (recentCmds.length < 8) recentCmds.push({ time: log.created_at, msg: msg.replace(/^\[.*?\]\s*/, '').slice(0, 80) })
    }
    if (/sent message|replied|message.*sent|response.*sent|ctx\.send|channel\.send/i.test(msg)) messagesSent++
    if (/on_ready|on_message|event.*trigger|event.*handled|bot.*ready/i.test(msg)) eventsHandled++
    if (log.level === 'ERROR') errors++
    const guild = msg.match(/guild[=:\s"']+([^\s"',\]]+)/i); if (guild) guilds.add(guild[1])
  }
  return { commands, messagesSent, eventsHandled, guilds: guilds.size, errors, lastTime, recentCmds }
}

// ── AI Agent metrics ──────────────────────────────────────────────────────────
interface AiAgentMetrics { apiCalls: number; totalTokens: number; responses: number; avgLatencyMs: number; errors: number; lastTime: string | null; recentResponses: { time: string; msg: string }[] }

function parseAiAgentMetrics(logs: Log[]): AiAgentMetrics {
  let apiCalls = 0, totalTokens = 0, responses = 0, errors = 0, latencySum = 0, latencyCount = 0
  let lastTime: string | null = null
  const recentResponses: { time: string; msg: string }[] = []
  for (const log of logs) {
    const msg = log.message
    if (/api.*call|completion.*creat|chat.*complet|anthropic.*request|openai.*request|llm.*call|model.*call/i.test(msg)) { apiCalls++; lastTime = log.created_at }
    if (/response.*received|assistant.*reply|model.*response|ai.*response/i.test(msg)) {
      responses++
      if (recentResponses.length < 8) recentResponses.push({ time: log.created_at, msg: msg.replace(/^\[.*?\]\s*/, '').slice(0, 90) })
    }
    if (log.level === 'ERROR') errors++
    const tok = msg.match(/(?:total_)?tokens?[=:\s]+(\d+)/i); if (tok) totalTokens += parseInt(tok[1])
    const lat = msg.match(/(?:latency|elapsed|took)[=:\s]+([\d.]+)\s*(ms|s)/i)
    if (lat) { let ms = parseFloat(lat[1]); if (lat[2] === 's') ms *= 1000; latencySum += ms; latencyCount++ }
  }
  return { apiCalls, totalTokens, responses, avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0, errors, lastTime, recentResponses }
}

// ── Twitter metrics ───────────────────────────────────────────────────────────
interface TwitterMetrics { tweets: number; replies: number; retweets: number; likes: number; errors: number; lastTime: string | null }

function parseTwitterMetrics(logs: Log[]): TwitterMetrics {
  let tweets = 0, replies = 0, retweets = 0, likes = 0, errors = 0; let lastTime: string | null = null
  for (const log of logs) {
    const msg = log.message
    if (/tweet.*posted|create.*tweet|status.*updated|tweeted|post.*tweet/i.test(msg)) { tweets++; lastTime = log.created_at }
    if (/repl(?:y|ied)|in_reply_to/i.test(msg)) replies++
    if (/retweet|rt.*done/i.test(msg)) retweets++
    if (/lik(?:e|ed)|favorit/i.test(msg)) likes++
    if (log.level === 'ERROR') errors++
  }
  return { tweets, replies, retweets, likes, errors, lastTime }
}

// ── Slack metrics ─────────────────────────────────────────────────────────────
interface SlackMetrics { messagesSent: number; commands: number; reactions: number; channels: number; errors: number; lastTime: string | null }

function parseSlackMetrics(logs: Log[]): SlackMetrics {
  let messagesSent = 0, commands = 0, reactions = 0, errors = 0; let lastTime: string | null = null
  const channels = new Set<string>()
  for (const log of logs) {
    const msg = log.message
    if (/message.*sent|posted.*channel|slack.*sent|chat\.postMessage/i.test(msg)) { messagesSent++; lastTime = log.created_at }
    if (/command.*handled|slash.*command|app.*command/i.test(msg)) commands++
    if (/reaction|emoji.*add|reactions\.add/i.test(msg)) reactions++
    if (log.level === 'ERROR') errors++
    const ch = msg.match(/channel[=:\s"#]+([^\s"',\]]+)/i); if (ch) channels.add(ch[1])
  }
  return { messagesSent, commands, reactions, channels: channels.size, errors, lastTime }
}

// ── Alert metrics ─────────────────────────────────────────────────────────────
interface AlertMetrics { alertsTriggered: number; checksPerformed: number; errors: number; lastAlertTime: string | null; recentAlerts: { time: string; msg: string }[] }

function parseAlertMetrics(logs: Log[]): AlertMetrics {
  let alertsTriggered = 0, checksPerformed = 0, errors = 0; let lastAlertTime: string | null = null
  const recentAlerts: { time: string; msg: string }[] = []
  for (const log of logs) {
    const msg = log.message
    if (/alert.*trigger|threshold.*reached|price.*above|price.*below|alert.*sent|notification.*sent|signal.*fire/i.test(msg)) {
      alertsTriggered++; lastAlertTime = log.created_at
      if (recentAlerts.length < 10) recentAlerts.push({ time: log.created_at, msg: msg.replace(/^\[.*?\]\s*/, '').slice(0, 90) })
    }
    if (/checking|monitoring|scanning|polling|watching/i.test(msg)) checksPerformed++
    if (log.level === 'ERROR') errors++
  }
  return { alertsTriggered, checksPerformed, errors, lastAlertTime, recentAlerts }
}

// ── News metrics ──────────────────────────────────────────────────────────────
interface NewsMetrics { articlesFetched: number; sources: number; errors: number; lastFetchTime: string | null; headlines: { time: string; text: string }[] }

function parseNewsMetrics(logs: Log[]): NewsMetrics {
  let articlesFetched = 0, errors = 0; let lastFetchTime: string | null = null
  const sources = new Set<string>()
  const headlines: { time: string; text: string }[] = []
  for (const log of logs) {
    const msg = log.message
    const am = msg.match(/(\d+)\s+articles?/i); if (am) articlesFetched += parseInt(am[1])
    if (/article.*fetch|news.*fetch|fetched.*article|fetched.*news|headlines?\s+from/i.test(msg)) {
      if (!am) articlesFetched++
      lastFetchTime = log.created_at
      if (headlines.length < 8) headlines.push({ time: log.created_at, text: msg.replace(/^\[.*?\]\s*/, '').slice(0, 90) })
    }
    const src = msg.match(/source[=:\s"]+([^\s"',]+)/i); if (src) sources.add(src[1])
    if (log.level === 'ERROR') errors++
  }
  return { articlesFetched, sources: sources.size, errors, lastFetchTime, headlines }
}

// ── Trading helpers ───────────────────────────────────────────────────────────
function buildEquityCurve(closed: TradePair[]): { t: number; eq: number }[] {
  let eq = 0
  return closed.map((c, i) => ({ t: i + 1, eq: parseFloat((eq += c.pnl ?? 0).toFixed(4)) }))
}
function calcMaxDrawdown(closed: TradePair[]): number {
  let peak = 0, maxDD = 0, eq = 0
  for (const c of closed) { eq += c.pnl ?? 0; if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) maxDD = dd }
  return parseFloat(maxDD.toFixed(4))
}

const STATUS: Record<string, { color: string; bg: string; glow: string; pulse: boolean; label: string }> = {
  RUNNING: { color: 'var(--accent)', bg: 'rgba(0,245,255,0.12)',  glow: '0 0 14px rgba(0,245,255,0.5)',  pulse: true,  label: 'Running' },
  IDLE:    { color: 'var(--text-muted)', bg: 'rgba(71,85,105,0.14)',  glow: 'none',                          pulse: false, label: 'Idle'    },
  ERROR:   { color: '#ff4444', bg: 'rgba(255,68,68,0.12)',  glow: '0 0 14px rgba(255,68,68,0.5)',  pulse: false, label: 'Error'   },
  STOPPED: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', glow: 'none',                         pulse: false, label: 'Stopped' },
}

const TAG: Record<string, { color: string; bg: string }> = {
  PRICE:  { color: 'var(--accent)', bg: 'var(--accent-dim)'    },
  AI:     { color: '#a78bfa', bg: 'rgba(167,139,250,0.07)'  },
  BUY:    { color: '#22c55e', bg: 'rgba(34,197,94,0.07)'    },
  SELL:   { color: '#f87171', bg: 'rgba(248,113,113,0.07)'  },
  EXIT:   { color: '#fb923c', bg: 'rgba(251,146,60,0.07)'   },
  SIGNAL: { color: '#fbbf24', bg: 'rgba(251,191,36,0.07)'   },
  PNL:    { color: '#34d399', bg: 'rgba(52,211,153,0.07)'   },
  TRADE:  { color: '#60a5fa', bg: 'rgba(96,165,250,0.07)'   },
  WARNING:{ color: '#f59e0b', bg: 'rgba(245,158,11,0.05)'   },
  ERROR:  { color: '#ef4444', bg: 'rgba(239,68,68,0.05)'    },
  INFO:   { color: 'var(--text-muted)', bg: 'transparent'             },
}

function parseTag(msg: string): { tag: string; body: string } {
  const m = msg.match(/^\[([A-Z_0-9]+)\]\s*([\s\S]*)$/)
  if (m) return { tag: m[1], body: m[2] }
  return { tag: 'INFO', body: msg }
}

// ── Trade parsing ─────────────────────────────────────────────────────────────
interface RawTradeEvent {
  logId: number; ts: string
  type: 'BUY' | 'SELL' | 'STOP_LOSS' | 'AUTO_SELL'
  side: string; contracts: number; price: number; pnl: number | null
}
interface TradePair {
  key: string; status: 'open' | 'closed'; side: string; contracts: number
  entryTime: string; exitTime: string | null; entryPrice: number
  exitPrice: number | null; pnl: number | null; closeReason: string | null
}

function parseRawEvents(logs: Log[]): RawTradeEvent[] {
  const events: RawTradeEvent[] = []
  // Track (side, contracts, price, second) combos seen via "Bought" to skip duplicate ORDER PLACED lines
  const boughtSigs = new Set<string>()

  for (const log of logs) {
    const msg = log.message

    // ── Standard format: Bought X YES/NO @ Xc ────────────────────────────────
    // This is the canonical buy line — always present when ORDER PLACED is logged.
    const buy = msg.match(/Bought (\d+) (YES|NO) @ (\d+)[c¢]/i)
    if (buy) {
      const sig = `${buy[2].toUpperCase()}-${buy[1]}-${buy[3]}-${log.created_at.slice(0, 19)}`
      boughtSigs.add(sig)
      events.push({ logId: log.id, ts: log.created_at, type: 'BUY', side: buy[2].toUpperCase(), contracts: +buy[1], price: +buy[3], pnl: null })
      continue
    }

    // ── Kalshi bot: ORDER PLACED / [ORDER PLACED] ─────────────────────────────
    // e.g. "ORDER PLACED: KXBTC15M-... NO x2 @ 62c  order_id=..."
    // Only use this when no matching "Bought" line exists (older bots / edge cases)
    const op = msg.match(/ORDER PLACED.*?\b(YES|NO)\b.*?x(\d+)\s*@\s*(\d+)c/i)
    if (op) {
      const sig = `${op[1].toUpperCase()}-${op[2]}-${op[3]}-${log.created_at.slice(0, 19)}`
      // Skip if a "Bought" line with same side/qty/price in the same second was already recorded
      if (!boughtSigs.has(sig)) {
        events.push({ logId: log.id, ts: log.created_at, type: 'BUY', side: op[1].toUpperCase(), contracts: +op[2], price: +op[3], pnl: null })
      }
      continue
    }

    // ── Settlement result: SETTLED WIN / SETTLED LOSS ─────────────────────────
    // e.g. "SETTLED WIN: NO x35 @ 78c -> +$7.70  PnL: +$7.70"
    // Handles both → (arrow) and -> variants, and $+/- prefix formats
    const win = msg.match(/SETTLED WIN.*?\b(YES|NO)\b.*?x(\d+)\s*@\s*(\d+)c.*?PnL:\s*([+\-]?\$?-?[\d.]+)/i)
    if (win) {
      const pnl = parseFloat(win[4].replace(/[$+]/g, ''))
      events.push({ logId: log.id, ts: log.created_at, type: 'SELL', side: win[1].toUpperCase(), contracts: +win[2], price: 100, pnl: isNaN(pnl) ? null : Math.abs(pnl) })
      continue
    }
    const loss = msg.match(/SETTLED LOSS.*?\b(YES|NO)\b.*?x(\d+)\s*@\s*(\d+)c.*?PnL:\s*([+\-]?\$?-?[\d.]+)/i)
    if (loss) {
      const pnl = parseFloat(loss[4].replace(/[$+]/g, ''))
      events.push({ logId: log.id, ts: log.created_at, type: 'SELL', side: loss[1].toUpperCase(), contracts: +loss[2], price: 0, pnl: isNaN(pnl) ? null : -Math.abs(pnl) })
      continue
    }

    // ── Standard sell ─────────────────────────────────────────────────────────
    const sell = msg.match(/Sold (\d+) (YES|NO) @ (\d+)[c¢].*?PnL:\s*([+\-]?\$?-?[\d.]+)/i)
    if (sell) { const pnl = parseFloat(sell[4].replace(/[$+]/g, '')); events.push({ logId: log.id, ts: log.created_at, type: 'SELL', side: sell[2].toUpperCase(), contracts: +sell[1], price: +sell[3], pnl: isNaN(pnl)?null:pnl }); continue }

    const sl = msg.match(/Stop-loss @ (\d+)[c¢].*?closing (\d+)/i)
    if (sl) { events.push({ logId: log.id, ts: log.created_at, type: 'STOP_LOSS', side: '', contracts: +sl[2], price: +sl[1], pnl: null }); continue }
    const as_ = msg.match(/Auto-sell @ ([\d.]+)[c¢].*?selling all (\d+)/i)
    if (as_) events.push({ logId: log.id, ts: log.created_at, type: 'AUTO_SELL', side: '', contracts: +as_[2], price: +as_[1], pnl: null })
  }
  return events
}

function buildTradePairs(events: RawTradeEvent[]): TradePair[] {
  // Secondary dedup: if two BUY events share the same side/contracts/price within 10 s, keep the later one
  const deduped: RawTradeEvent[] = []
  for (const ev of events) {
    if (ev.type === 'BUY') {
      const evMs = new Date(ev.ts).getTime()
      const isDup = deduped.some(r =>
        r.type === 'BUY' &&
        r.side === ev.side &&
        r.contracts === ev.contracts &&
        r.price === ev.price &&
        Math.abs(new Date(r.ts).getTime() - evMs) <= 10_000
      )
      if (isDup) continue
    }
    deduped.push(ev)
  }

  const sorted = [...deduped].sort((a,b) => new Date(a.ts).getTime()-new Date(b.ts).getTime())
  const openBuys: RawTradeEvent[] = []
  const pairs: TradePair[] = []
  for (const ev of sorted) {
    if (ev.type === 'BUY') { openBuys.push(ev) }
    else {
      const buy = openBuys.shift()
      pairs.push({ key:`${buy?.logId??ev.logId}-${ev.logId}`, status:'closed', side:ev.side||buy?.side||'—', contracts:ev.contracts||buy?.contracts||0, entryTime:buy?.ts??ev.ts, exitTime:ev.ts, entryPrice:buy?.price??0, exitPrice:ev.price, pnl:ev.pnl, closeReason:ev.type==='STOP_LOSS'?'Stop Loss':ev.type==='AUTO_SELL'?'Auto Sell':'Closed' })
    }
  }
  for (const buy of openBuys) pairs.push({ key:`open-${buy.logId}`, status:'open', side:buy.side, contracts:buy.contracts, entryTime:buy.ts, exitTime:null, entryPrice:buy.price, exitPrice:null, pnl:null, closeReason:null })
  return pairs.reverse()
}

function formatDuration(secs: number): string {
  if (secs <= 0) return '0s'
  const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60), s = secs%60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtPnl(n: number | null): string {
  if (n == null) return '—'
  return `${n>=0?'+':''}$${Math.abs(n).toFixed(2)}`
}

// ── Functions extractor ───────────────────────────────────────────────────────
interface BotFunction { name: string; args: string; line: number; docstring: string | null }

function extractFunctions(code: string): BotFunction[] {
  const result: BotFunction[] = []
  const lines = code.split('\n')
  const re = /^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*:/
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i])
    if (!m) continue
    const name = m[1]
    if (name.startsWith('__') && name.endsWith('__')) continue  // skip dunder
    const args = m[2].trim()
    const nextLine = lines[i + 1]?.trim() ?? ''
    const docMatch = nextLine.match(/^["']{3}(.+?)["']{3}/) || nextLine.match(/^["'](.+?)["']/)
    result.push({ name, args, line: i + 1, docstring: docMatch ? docMatch[1].slice(0, 80) : null })
  }
  return result
}

// ── Live telemetry extractor — parse numeric key=value patterns from logs ─────
interface LiveMetric { key: string; value: string; prefix: string; suffix: string; ts: string }

const TELEM_PATTERNS: Array<[RegExp, string, string, string]> = [
  // [regex, label, prefix, suffix]
  [/\bBalance[:\s=]+\$?([\d,]+\.?\d*)/i,          'Balance',    '$', ''],
  [/\bPortfolio[:\s=]+\$?([\d,]+\.?\d*)/i,         'Portfolio',  '$', ''],
  [/\b(?:Current\s+)?Price[:\s=]+\$?([\d,]+\.?\d*)/i,'Price',   '$', ''],
  [/\bBTC[\s/]*USD[:\s=]+\$?([\d,]+\.?\d*)/i,      'BTC/USD',   '$', ''],
  [/\bETH[\s/]*USD[:\s=]+\$?([\d,]+\.?\d*)/i,      'ETH/USD',   '$', ''],
  [/\bConfidence[:\s=]+([\d.]+)%?/i,               'Confidence', '',  '%'],
  [/\bAccuracy[:\s=]+([\d.]+)%?/i,                 'Accuracy',   '',  '%'],
  [/\bWin\s*Rate[:\s=]+([\d.]+)%?/i,               'Win Rate',   '',  '%'],
  [/\bCycle[:\s=#]+([\d]+)/i,                      'Cycle #',    '',  ''],
  [/\bRound[:\s=#]+([\d]+)/i,                      'Round',      '',  ''],
  [/\bItems?\s+scraped[:\s=]+([\d]+)/i,            'Items',      '',  ''],
  [/\bSent[:\s=]+([\d]+)\s*notif/i,                'Sent',       '',  ''],
  [/\bSleep(?:ing)?[:\s=]+([\d.]+)\s*s/i,          'Sleep',      '',  's'],
  [/\bProfit[:\s=]+\$?([\d.,+-]+)/i,               'Profit',     '$', ''],
  [/\bP&?L[:\s=]+\$?([\d.,+-]+)/i,                 'PnL',        '$', ''],
]

function parseLiveTelemetry(logs: Log[]): LiveMetric[] {
  const latest = new Map<string, LiveMetric>()
  for (const log of logs) {
    for (const [re, key, prefix, suffix] of TELEM_PATTERNS) {
      re.lastIndex = 0
      const m = re.exec(log.message)
      if (m) {
        const raw = m[1].replace(/,/g, '')
        const num = parseFloat(raw)
        latest.set(key, {
          key,
          value: isNaN(num) ? raw : prefix === '$' ? num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : raw,
          prefix,
          suffix,
          ts: log.created_at,
        })
      }
    }
  }
  return Array.from(latest.values())
}

// ── API review entry (used by save-time API review modal) ────────────────────
interface ReviewEntry {
  id:                string   // unique key = api.name
  name:              string   // editable
  variableName:      string   // exact variable name from code, e.g. "KALSHI_API_KEY" — non-editable
  baseUrl:           string   // editable
  apiKey:            string   // editable, always starts empty
  apiSecret:         string   // editable, always starts empty
  needsSecret:       boolean  // show secret field
  isPublic:          boolean  // no key required
  icon:              string
  color:             string
  description:       string
  alreadyConfigured: boolean  // existing connection found
}

// ── Persistent dashboard stats (survive log-panel clears) ────────────────────
// All dashboard metrics are derived from this — NOT from the ephemeral logs[]
// display buffer. Clearing the Live Log panel never blanks the stats.
interface DashStats {
  sortedAllLogs: Log[]       // every log ever seen this session, sorted id asc
  tradePairs:    TradePair[]
  errorCount:    number
  lastErrorMsg:  string | null
}
const emptyDash = (): DashStats => ({
  sortedAllLogs: [], tradePairs: [], errorCount: 0, lastErrorMsg: null,
})

// ─────────────────────────────────────────────────────────────────────────────
export default function BotDetailPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Static-export-friendly: bot id comes from ?id= query param
  // (was useParams() under the old [id] dynamic route).
  const id = searchParams?.get('id') ?? ''
  const botId  = parseInt(id)
  const [tradeMode, setTradeMode] = useTradeMode()
  const editAutoOpened = useRef(false)

  const [bot,       setBot]       = useState<Bot | null>(null)
  const [logs,      setLogs]      = useState<Log[]>([])
  // dashStats holds all derived metrics; allLogsRef is the accumulator behind it.
  // Both survive setLogs([]) — stats never reset when the log panel is cleared.
  const [dashStats, setDashStats] = useState<DashStats>(emptyDash())
  const allLogsRef  = useRef<Map<number, Log>>(new Map())
  const [conns,  setConns]  = useState<Conn[]>([])
  const [sessionElapsed, setSessionElapsed] = useState(0)
  const [sessionStart,   setSessionStart]   = useState<number | null>(null)
  const [lastUpdated,    setLastUpdated]    = useState<Date | null>(null)
  const [secAgo,         setSecAgo]         = useState(0)
  const [actionErr, setActionErr] = useState('')   // run/stop errors
  // Surfaced when the log-polling REST call fails — was previously a silent
  // catch which hid backend/network issues from the user.
  const [logFetchError,  setLogFetchError]  = useState<string | null>(null)
  const logFetchErrorRef = useRef<string | null>(null)

  // ── AI Fix modal state ────────────────────────────────────────────────────
  // Opened by the "Fix with AI" button — only visible when the latest log
  // poll surfaces ERROR-level entries. Pre-populated with the last 60
  // ERROR/WARNING lines so Claude has the relevant traceback in context.
  const [aiFixOpen, setAiFixOpen] = useState(false)
  const [aiFixLogs, setAiFixLogs] = useState<string[]>([])

  /** Snapshot recent ERROR/WARNING lines and open the modal. Resolves
   *  dashStats lazily from a ref so the callback identity stays stable
   *  even though the underlying state churns every poll. */
  const dashStatsLatest = useRef<DashStats>(emptyDash())
  const openAiFix = useCallback(() => {
    const all = dashStatsLatest.current?.sortedAllLogs || []
    const errLines = all
      .filter(l => l.level === 'ERROR' || l.level === 'WARNING')
      .slice(-60)
      .map(l => `${l.created_at} | ${l.level.padEnd(7)} | ${l.message}`)
    setAiFixLogs(errLines)
    setAiFixOpen(true)
  }, [])

  // Mirror dashStats into the ref so openAiFix always sees fresh logs
  // without re-creating its callback identity on every poll.
  useEffect(() => { dashStatsLatest.current = dashStats }, [dashStats])

  // ── Edit Code modal state ─────────────────────────────────────────────────
  const [codeModal, setCodeModal] = useState(false)
  // Mirror of codeModal in a ref. Used by loadBot() to skip overwriting the
  // editor state during the 2s polling interval while the modal is open.
  // We use a ref (not the state directly) so loadBot's useCallback identity
  // doesn't churn every time the modal toggles — that would tear down the
  // polling interval each open/close.
  const codeModalRef = useRef(false)
  useEffect(() => { codeModalRef.current = codeModal }, [codeModal])

  const [code,      setCode]      = useState('')
  const [name,      setName]      = useState('')
  const [desc,      setDesc]      = useState('')
  const [saving,    setSaving]    = useState(false)
  const [saveCodeErr, setSaveCodeErr] = useState('')

  // ── Bot Settings modal state ──────────────────────────────────────────────
  const [settingsModal,  setSettingsModal]  = useState(false)
  const [botParams,      setBotParams]      = useState<BotParam[]>([])
  const [scheduleType,   setScheduleType]   = useState<'always'|'custom'>('always')
  const [scheduleStart,  setScheduleStart]  = useState('09:00')
  const [scheduleEnd,    setScheduleEnd]    = useState('17:00')
  const [maxAmount,      setMaxAmount]      = useState('')
  const [maxContracts,   setMaxContracts]   = useState('')
  const [maxLoss,        setMaxLoss]        = useState('')
  const [autoRestart,    setAutoRestart]    = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaved,  setSettingsSaved]  = useState(false)
  const [settingsErr,    setSettingsErr]    = useState('')

  const openSettings = () => {
    if (!bot) return
    setBotParams(extractParams(bot.code))
    setScheduleType((bot.schedule_type as 'always' | 'custom') || 'always')
    setScheduleStart(bot.schedule_start || '09:00')
    setScheduleEnd(bot.schedule_end || '17:00')
    setMaxAmount(bot.max_amount_per_trade != null ? String(bot.max_amount_per_trade) : '')
    setMaxContracts(bot.max_contracts_per_trade != null ? String(bot.max_contracts_per_trade) : '')
    setMaxLoss(bot.max_daily_loss != null ? String(bot.max_daily_loss) : '')
    setAutoRestart(bot.auto_restart ?? false)
    setSettingsSaved(false)
    setSettingsErr('')
    setSettingsModal(true)
  }

  // ── API Keys modal state ──────────────────────────────────────────────────
  const [keyModal,      setKeyModal]      = useState(false)
  const [keyView,       setKeyView]       = useState<'list' | 'form'>('list')
  const [editingConn,   setEditingConn]   = useState<Conn | null>(null)
  const [kName,         setKName]         = useState('')
  const [kUrl,          setKUrl]          = useState('')
  const [kKey,          setKKey]          = useState('')
  const [kSecret,       setKSecret]       = useState('')
  const [kShowSec,      setKShowSec]      = useState(false)
  const [kSaving,       setKSaving]       = useState(false)
  const [keyErr,        setKeyErr]        = useState('')
  const [detectedApis,  setDetectedApis]  = useState<DetectedApi[]>([])

  // ── API Review modal state (shown when saving code) ───────────────────────
  const [apiReviewModal, setApiReviewModal] = useState(false)
  const [reviewApis,     setReviewApis]     = useState<ReviewEntry[]>([])
  const [reviewSaving,   setReviewSaving]   = useState(false)

  // ── API scan animation (5-second scan before showing review modal) ────────
  const [scanningApis, setScanningApis] = useState(false)
  const [scanStep,     setScanStep]     = useState(0)

  // ── Bot-type analysis (3-4 s delay on first load / code change) ──────────
  const [botType,     setBotType]     = useState<BotType>('generic')
  const [botSubLabel, setBotSubLabel] = useState('Custom Bot')
  const [analysing,   setAnalysing]   = useState(false)
  const [aiAnalysis,  setAiAnalysis]  = useState<AnalyzeResponse | null>(null)
  const analysedCodeRef = useRef<string | null>(null)

  const openKeyModal = () => {
    setKeyView('list')
    setEditingConn(null)
    setKName(''); setKUrl(''); setKKey(''); setKSecret('')
    setKeyErr('')
    // Detect which APIs this bot code needs
    if (bot) setDetectedApis(detectAllApis(bot.code))
    setKeyModal(true)
  }
  const openAddForm = (prefill?: DetectedApi) => {
    setEditingConn(null)
    setKName(prefill?.name ?? '')
    setKUrl(prefill?.baseUrl ?? '')
    setKKey(''); setKSecret(''); setKShowSec(false)
    setKeyView('form')
  }
  const openEditForm = (c: Conn) => {
    setEditingConn(c)
    setKName(c.name)
    setKUrl(c.base_url || '')
    setKKey(c.api_key || '')
    setKSecret('')          // never pre-fill secret
    setKShowSec(false)
    setKeyView('form')
  }

  // ── Log streaming refs ────────────────────────────────────────────────────
  const sinceIdRef = useRef<number>(0)

  // ── Log panel auto-scroll ─────────────────────────────────────────────────
  const logScrollRef = useRef<HTMLDivElement>(null)
  const logBottomRef = useRef<HTMLDivElement>(null)
  const pinnedRef    = useRef(true)
  const [pinned, setPinnedState] = useState(true)
  const setPinned = (v: boolean) => { pinnedRef.current = v; setPinnedState(v) }

  const handleLogScroll = useCallback(() => {
    const el = logScrollRef.current
    if (!el) return
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }, [])

  useEffect(() => {
    if (pinnedRef.current) logBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // ── Stats accumulator ────────────────────────────────────────────────────
  // Called every time new logs arrive (initial load OR incremental poll).
  // Deduplicates by log ID so re-fetching the same logs never double-counts.
  // Re-parses ALL accumulated logs on every new batch to keep pairs consistent.
  const processLogsForStats = useCallback((incoming: Log[]) => {
    let changed = false
    for (const log of incoming) {
      if (!allLogsRef.current.has(log.id)) {
        allLogsRef.current.set(log.id, log)
        changed = true
      }
    }
    if (!changed) return
    // Cap the Map at 5000 entries — without this the Map grows linearly with
    // every polled log forever, leaking memory over a long session.
    const MAX = 5000
    if (allLogsRef.current.size > MAX) {
      const overflow = allLogsRef.current.size - MAX
      const it = allLogsRef.current.keys()
      for (let i = 0; i < overflow; i++) {
        const k = it.next().value
        if (k != null) allLogsRef.current.delete(k)
      }
    }
    const sorted     = Array.from(allLogsRef.current.values()).sort((a, b) => a.id - b.id)
    const rawEvents  = parseRawEvents(sorted)
    const tradePairs = buildTradePairs(rawEvents)
    const errLogs    = sorted.filter(l => l.level === 'ERROR')
    setDashStats({
      sortedAllLogs: sorted,
      tradePairs,
      errorCount:   errLogs.length,
      lastErrorMsg: errLogs.length > 0 ? errLogs[errLogs.length - 1].message : null,
    })
  }, [])

  // ── Data loading ──────────────────────────────────────────────────────────
  // CRITICAL: This runs every 2 seconds via a polling interval. Without the
  // `!codeModal` guard below, every poll would overwrite the user's live
  // edits in the Edit Code modal — typing and deleting would "come back"
  // because the server's stale copy was being re-applied to local state on
  // every tick. Only sync editor state when the user isn't actively editing.
  const loadBot = useCallback(async () => {
    try {
      const b = await botsApi.get(botId)
      setBot(b.data)
      // Always refresh the API-detection panel; that's read-only.
      setDetectedApis(detectAllApis(b.data.code))
      // Only refresh the editable form fields when the modal is CLOSED
      // (i.e. the user isn't currently editing). Once the modal closes
      // — whether via Save or Cancel — the next poll picks up whatever
      // the server now considers truth.
      if (!codeModalRef.current) {
        setCode(b.data.code)
        setName(b.data.name)
        setDesc(b.data.description || '')
      }
    } catch { router.push('/bots') }
  }, [botId, router])

  // Initial full load — fetches last 500 in desc order, sets sinceIdRef to highest id
  const initialLoadLogs = useCallback(async () => {
    try {
      const l = await botsApi.getLogs(botId, 500)
      const fetched: Log[] = l.data ?? []
      setLogs(fetched)
      sinceIdRef.current = fetched.length > 0 ? Math.max(...fetched.map((lg: Log) => lg.id)) : 0
      processLogsForStats(fetched)   // feed all loaded logs into the stats accumulator
      setLastUpdated(new Date())
      setLogFetchError(null)
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e)
      console.error('[BotDetail] initialLoadLogs failed:', msg, e)
      setLogFetchError(`Initial log load failed: ${msg}`)
    }
  }, [botId, processLogsForStats])

  // Incremental poll — fetches only new lines since last seen id, appends to front.
  // When sinceIdRef is 0 (bot has no prior logs yet, or just after a page mount with
  // an empty DB), falls back to a full fetch to establish the baseline rather than
  // silently skipping — this is the key fix for the "stats never start" dead-zone.
  const pollNewLogs = useCallback(async () => {
    try {
      if (sinceIdRef.current === 0) {
        // No baseline yet — full fetch to establish sinceId
        const l = await botsApi.getLogs(botId, 500)
        const fetched: Log[] = l.data ?? []
        if (fetched.length > 0) {
          sinceIdRef.current = Math.max(...fetched.map((lg: Log) => lg.id))
          setLogs(fetched)
          processLogsForStats(fetched)
          setLastUpdated(new Date())
        }
        return
      }
      const l = await botsApi.getLogs(botId, 300, sinceIdRef.current)
      const newLines: Log[] = l.data ?? []
      if (newLines.length > 0) {
        // since_id>0 returns asc order — highest id is last
        sinceIdRef.current = newLines[newLines.length - 1].id
        setLogs(prev => [...newLines, ...prev].slice(0, 2000))
        processLogsForStats(newLines)   // feed new lines into stats accumulator
        setLastUpdated(new Date())
      }
      setLogFetchError(null)            // clear stale error after a successful poll
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e)
      // Don't spam the console every 1.5s if the same error keeps firing
      if (logFetchErrorRef.current !== msg) {
        console.error('[BotDetail] pollNewLogs failed:', msg, e)
        logFetchErrorRef.current = msg
      }
      setLogFetchError(`Log polling failed: ${msg}. Backend may be unreachable.`)
    }
  }, [botId, processLogsForStats])

  const loadConns = useCallback(async () => { try { const c = await connectionsApi.getByBot(botId); setConns(c.data) } catch {} }, [botId])

  useEffect(() => {
    sinceIdRef.current = 0
    loadBot(); initialLoadLogs(); loadConns()
    const botTimer = setInterval(loadBot, 2000)           // bot status + health every 2s
    const logTimer = setInterval(pollNewLogs, 1500)      // new log lines every 1.5s
    return () => { clearInterval(botTimer); clearInterval(logTimer) }
  }, [loadBot, initialLoadLogs, pollNewLogs, loadConns])

  // Auto-reconnect: immediately reload bot + logs when internet is restored
  useOnlineStatus(useCallback(() => {
    sinceIdRef.current = 0
    loadBot(); initialLoadLogs(); loadConns()
  }, [loadBot, initialLoadLogs, loadConns]))

  // Auto-open code editor when arriving with ?edit=1 (from My Bots "Edit" button)
  useEffect(() => {
    if (editAutoOpened.current) return
    if (searchParams?.get('edit') !== '1') return
    if (!bot) return
    editAutoOpened.current = true
    setCodeModal(true)
  }, [searchParams, bot])

  // ── Session uptime ────────────────────────────────────────────────────────
  // Lock the start time the FIRST time we see RUNNING in this browser session.
  // Auto-restarts keep last_run_at changing on the server, but we only update
  // sessionStart when the bot transitions from non-RUNNING → RUNNING.
  const prevBotStatusRef = useRef<string>('')
  useEffect(() => {
    if (!bot) return
    const prev = prevBotStatusRef.current
    prevBotStatusRef.current = bot.status
    if (bot.status === 'RUNNING' && prev !== 'RUNNING') {
      // Just became running — lock start time from server's last_run_at
      setSessionStart(bot.last_run_at ? new Date(bot.last_run_at).getTime() : Date.now())
    } else if (bot.status !== 'RUNNING' && prev === 'RUNNING') {
      // Genuinely stopped
      setSessionStart(null)
      setSessionElapsed(0)
    }
  }, [bot?.status, bot?.last_run_at])  // eslint-disable-line react-hooks/exhaustive-deps

  // Tick the uptime clock every second
  useEffect(() => {
    if (sessionStart === null) return
    const tick = () => setSessionElapsed(Math.max(0, Math.floor((Date.now() - sessionStart) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [sessionStart])

  // "Updated X ago" ticker
  useEffect(() => {
    const t = setInterval(() => {
      setSecAgo(lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000) : 0)
    }, 1000)
    return () => clearInterval(t)
  }, [lastUpdated])

  // ── Bot-type analysis — calls LangGraph AI backend once per unique code ──
  // If the user selected a type at creation (stored in localStorage), that
  // takes precedence over auto-detection — the dashboard mirrors the user's choice.
  useEffect(() => {
    if (!bot?.code || analysedCodeRef.current === bot.code) return
    analysedCodeRef.current = bot.code

    const userType = getUserSelectedBotType(botId)
    if (userType) {
      setBotType(userType)
      setBotSubLabel(BOT_TYPE_META[userType].label)
      setAnalysing(false)
      return
    }

    setAnalysing(true)
    let cancelled = false
    ;(async () => {
      try {
        const res = await analyzeApi.analyze(bot.code)
        if (cancelled) return
        const data = res.data
        setAiAnalysis(data)
        const type = (data.bot_type as BotType) in BOT_TYPE_META
          ? (data.bot_type as BotType)
          : detectBotType(bot.code)
        const sub = data.bot_sublabel || detectBotSubLabel(bot.code, type)
        setBotType(type)
        setBotSubLabel(sub)
      } catch {
        if (cancelled) return
        // Fallback to local detection if backend unavailable
        const type = detectBotType(bot.code)
        setBotType(type)
        setBotSubLabel(detectBotSubLabel(bot.code, type))
      } finally {
        if (!cancelled) setAnalysing(false)
      }
    })()
    return () => { cancelled = true }
  }, [bot?.code, botId])

  // ── Actions ───────────────────────────────────────────────────────────────
  const run  = async () => {
    setActionErr('')
    try {
      await botsApi.run(botId, tradeMode === 'demo')
      setTimeout(() => {
        sinceIdRef.current = 0
        loadBot(); initialLoadLogs()
      }, 800)
    }
    catch { setActionErr('Failed to start bot. Check the server.') }
  }
  const stop = async () => {
    setActionErr('')
    try { await botsApi.stop(botId); setTimeout(() => { loadBot(); pollNewLogs() }, 400) }
    catch { setActionErr('Failed to stop bot. Check the server.') }
  }

  const saveCode = async () => {
    // ── 5-second deep scan animation ────────────────────────────────────────
    setScanningApis(true)
    setScanStep(0)
    const STEP_DELAYS = [900, 1800, 2700, 3600, 4500]
    const stepTimers = STEP_DELAYS.map((ms, i) => setTimeout(() => setScanStep(i + 1), ms))
    await new Promise<void>(resolve => setTimeout(resolve, 5000))
    stepTimers.forEach(clearTimeout)
    setScanningApis(false)
    setScanStep(0)

    // ── Now run the actual detection — prefer AI result, fallback to local ──
    // User-selected type at creation always wins over re-detection.
    const userType = getUserSelectedBotType(botId)
    let aiApis: AnalyzeResponse['detected_apis'] | null = null
    try {
      const res = await analyzeApi.analyze(code)
      aiApis = res.data.detected_apis
      const data = res.data
      setAiAnalysis(data)
      if (!userType) {
        const type = (data.bot_type as BotType) in BOT_TYPE_META ? (data.bot_type as BotType) : detectBotType(code)
        setBotType(type)
        setBotSubLabel(data.bot_sublabel || detectBotSubLabel(code, type))
      }
    } catch { /* backend unavailable — use local */ }
    const detected: DetectedApi[] = aiApis && aiApis.length > 0
      ? aiApis.map(a => ({
          name:           a.name,
          baseUrl:        a.baseUrl,
          icon:           a.icon,
          color:          a.color,
          needsSecret:    a.needsSecret,
          description:    a.description,
          matchedPattern: a.matchedPattern,
          variableName:   a.variableName,
        }))
      : detectAllApis(code)
    if (detected.length > 0) {
      const entries: ReviewEntry[] = detected.map(api => {
        const existing = conns.find(c => c.name.toLowerCase() === api.name.toLowerCase())
        return {
          id:                api.name,
          name:              api.name,
          variableName:      api.variableName,
          baseUrl:           existing?.base_url || api.baseUrl || '',
          apiKey:            '',
          apiSecret:         '',
          needsSecret:       api.needsSecret,
          isPublic:          !api.needsSecret,
          icon:              api.icon,
          color:             api.color,
          description:       api.description,
          alreadyConfigured: !!existing,
        }
      })
      setReviewApis(entries)
      setApiReviewModal(true)
      return
    }
    // No APIs detected — save directly
    setSaving(true); setSaveCodeErr('')
    try { await botsApi.update(botId, { name, description: desc, code }); await loadBot(); setCodeModal(false) }
    catch { setSaveCodeErr('Save failed — check your connection.') }
    setSaving(false)
  }

  const _doSaveCode = async (): Promise<boolean> => {
    try { await botsApi.update(botId, { name, description: desc, code }); await loadBot(); return true }
    catch { setSaveCodeErr('Save failed — check your connection.'); return false }
  }

  const confirmApiReview = async () => {
    setReviewSaving(true); setSaveCodeErr('')
    try {
      // Save/update connections for entries that have any data filled in
      for (const entry of reviewApis) {
        const hasData = entry.apiKey.trim() || entry.baseUrl.trim() || entry.apiSecret.trim()
        if (!hasData) continue
        const existing = conns.find(c => c.name.toLowerCase() === entry.name.toLowerCase())
        const payload = {
          bot_id:     botId,
          name:       entry.name.trim() || entry.id,
          base_url:   entry.baseUrl.trim()    || undefined,
          api_key:    entry.apiKey.trim()     || undefined,
          api_secret: entry.apiSecret.trim()  || undefined,
        }
        if (existing) {
          await connectionsApi.update(existing.id, payload)
        } else {
          await connectionsApi.create(payload)
        }
      }
      await loadConns()
      const ok = await _doSaveCode()
      if (ok) { setApiReviewModal(false); setCodeModal(false) }
    } catch { setSaveCodeErr('Save failed — check your connection.') }
    setReviewSaving(false)
  }

  const skipApiReview = async () => {
    setReviewSaving(true); setSaveCodeErr('')
    const ok = await _doSaveCode()
    if (ok) { setApiReviewModal(false); setCodeModal(false) }
    setReviewSaving(false)
  }

  const saveSettings = async () => {
    if (!bot) return
    setSettingsSaving(true); setSettingsErr('')
    const updatedCode = applyParams(bot.code, botParams)
    try {
      await botsApi.update(botId, {
        code:                    updatedCode,
        schedule_type:           scheduleType,
        schedule_start:          scheduleType === 'custom' ? scheduleStart : undefined,
        schedule_end:            scheduleType === 'custom' ? scheduleEnd   : undefined,
        max_amount_per_trade:    maxAmount    !== '' ? parseFloat(maxAmount)    : undefined,
        max_contracts_per_trade: maxContracts !== '' ? parseInt(maxContracts)   : undefined,
        max_daily_loss:          maxLoss      !== '' ? parseFloat(maxLoss)      : undefined,
        auto_restart:            autoRestart,
      })
      await loadBot()
      setSettingsSaved(true)
      setTimeout(() => { setSettingsModal(false); setSettingsSaved(false) }, 1200)
    } catch { setSettingsErr('Save failed — check your connection.') }
    setSettingsSaving(false)
  }

  const saveKey = async () => {
    if (!kName.trim()) return
    setKSaving(true); setKeyErr('')
    try {
      const payload = {
        bot_id:     botId,
        name:       kName.trim(),
        base_url:   kUrl.trim()    || undefined,
        api_key:    kKey.trim()    || undefined,
        api_secret: kSecret.trim() || undefined,
      }
      if (editingConn) {
        await connectionsApi.update(editingConn.id, payload)
      } else {
        await connectionsApi.create(payload)
      }
      await loadConns()
      setKeyView('list')
      setEditingConn(null)
    } catch { setKeyErr('Save failed — check your connection.') }
    setKSaving(false)
  }

  const removeKey = async (connId: number) => {
    if (!confirm('Remove this API key?')) return
    try { await connectionsApi.delete(connId); loadConns() }
    catch { setKeyErr('Delete failed — check your connection.') }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!bot) return (
    <div className="min-h-screen" style={{ background: BG }}>
      <Navbar />
      <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 96px)' }}>
        <div className="w-8 h-8 border-2 border-[#00f5ff] border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  )

  // ── Derived data ──────────────────────────────────────────────────────────
  const st = STATUS[bot.status] || STATUS.IDLE

  // Pull from dashStats (backed by allLogsRef) — NOT from the logs[] display buffer.
  // This means stats stay intact when the user hits "Clear Log".
  const { sortedAllLogs, tradePairs, errorCount, lastErrorMsg } = dashStats
  const lastError       = lastErrorMsg
    ? ({ id: -1, level: 'ERROR', message: lastErrorMsg, created_at: '' } as Log)
    : undefined
  const closedTrades    = tradePairs.filter(t => t.status === 'closed')
  const openTrades      = tradePairs.filter(t => t.status === 'open')
  // Pending = open trades placed in a slot that has already closed (awaiting settlement log)
  const nowMs           = Date.now()
  const pendingTrades   = openTrades.filter(t =>
    nowMs - new Date(t.entryTime).getTime() > 16 * 60 * 1000
  )
  const totalPnl        = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const wins            = closedTrades.filter(t => (t.pnl??0) > 0).length
  const losses          = closedTrades.filter(t => (t.pnl??0) < 0).length
  const winRate         = closedTrades.length > 0 ? Math.round(wins/closedTrades.length*100) : null
  const totalSettled    = closedTrades.length

  // botType / botSubLabel come from the async analysis useEffect above (3.5 s delay)
  const typeMeta     = BOT_TYPE_META[botType]
  const equityCurve  = buildEquityCurve(closedTrades)
  const maxDrawdown  = calcMaxDrawdown(closedTrades)
  // Prediction / scraper / notification metrics also use sortedAllLogs so they
  // survive log clears too — consistent behaviour across all bot types.
  const isTradingBot = (['trading', 'arbitrage', 'dca', 'grid', 'market_maker'] as BotType[]).includes(botType)
  const predMetrics    = (botType === 'prediction' || isTradingBot) ? parsePredMetrics(sortedAllLogs) : null
  const scraperStats   = botType === 'scraper'      ? parseScraperMetrics(sortedAllLogs)  : null
  const notifStats     = botType === 'notification' ? parseNotifMetrics(sortedAllLogs)    : null
  const telegramStats  = botType === 'telegram'     ? parseTelegramMetrics(sortedAllLogs) : null
  const discordStats   = botType === 'discord'      ? parseDiscordMetrics(sortedAllLogs)  : null
  const aiAgentStats   = botType === 'ai_agent'     ? parseAiAgentMetrics(sortedAllLogs)  : null
  const twitterStats   = botType === 'twitter'      ? parseTwitterMetrics(sortedAllLogs)  : null
  const slackStats     = botType === 'slack'        ? parseSlackMetrics(sortedAllLogs)    : null
  const alertStats     = botType === 'alert'        ? parseAlertMetrics(sortedAllLogs)    : null
  const newsStats      = botType === 'news'         ? parseNewsMetrics(sortedAllLogs)     : null
  const eqColor        = totalPnl >= 0 ? '#22c55e' : '#ff4444'

  // ── Render ────────────────────────────────────────────────────────────────
  const SCAN_STEPS = [
    'Reading imports & library calls…',
    'Scanning credential variables…',
    'Matching known API URL patterns…',
    'Detecting WebSocket connections…',
    'Finalising API inventory…',
  ]

  return (
    <div className="min-h-screen" style={{ background: BG }}>
      <Navbar />

      {/* ── API Scan overlay (shown for 5 s when saving code) ── */}
      {scanningApis && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(5,7,15,0.88)', backdropFilter: 'blur(10px)' }}>
          <div className="w-full max-w-sm rounded-2xl px-8 py-9"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', boxShadow: '0 0 60px var(--accent-dim)' }}>
            {/* Spinning radar icon */}
            <div className="flex justify-center mb-6">
              <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.2)' }}>
                <svg className="w-8 h-8 text-[#00f5ff] animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
                {/* Pulse rings */}
                <span className="absolute inset-0 rounded-2xl animate-ping opacity-20"
                  style={{ border: '1px solid #00f5ff' }}/>
              </div>
            </div>
            <h3 className="text-center text-white font-black text-lg mb-1">
              Scanning Code
            </h3>
            <p className="text-center text-slate-500 text-xs mb-7">
              Deep-scanning every line for APIs, credentials &amp; connections…
            </p>
            {/* Animated step list */}
            <div className="flex flex-col gap-3">
              {SCAN_STEPS.map((step, i) => {
                const done    = scanStep > i
                const active  = scanStep === i
                const pending = scanStep < i
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                      {done ? (
                        <svg className="w-5 h-5 text-[#22c55e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                      ) : active ? (
                        <svg className="w-4 h-4 text-[#00f5ff] animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2"/>
                          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                        </svg>
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-slate-700"/>
                      )}
                    </div>
                    <span className={`text-xs font-medium transition-colors duration-300
                      ${done ? 'text-[#22c55e]' : active ? 'text-[#00f5ff]' : 'text-slate-600'}`}>
                      {step}
                    </span>
                  </div>
                )
              })}
            </div>
            {/* Progress bar */}
            <div className="mt-6 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.round((scanStep / SCAN_STEPS.length) * 100)}%`,
                  background: 'linear-gradient(90deg, #00f5ff, #00b4d8)',
                }}/>
            </div>
            <p className="text-center text-[12px] text-slate-700 mt-3 font-mono">
              {Math.round((scanStep / SCAN_STEPS.length) * 100)}% complete
            </p>
          </div>
        </div>
      )}

      <div className="flex" style={{minHeight:'100vh'}}>
        <div className="flex flex-col min-w-0 px-8 py-8" style={{width:'100%', minHeight:0}}>

        {/* ── Trade Mode Toggle (Demo / Live) ── */}
        <div className="flex items-center justify-end mb-4 shrink-0">
          <div className="inline-flex items-center gap-1 p-1 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              onClick={() => setTradeMode('demo')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black transition-all"
              style={tradeMode === 'demo' ? {
                background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
                color: '#1a1300',
                boxShadow: '0 4px 16px rgba(245,158,11,0.45), 0 0 24px rgba(251,191,36,0.35)',
              } : {
                background: 'transparent',
                color: '#94a3b8',
              }}>
              <span className={`w-2 h-2 rounded-full${tradeMode === 'demo' ? ' animate-pulse' : ''}`}
                style={{ background: tradeMode === 'demo' ? '#1a1300' : '#475569' }} />
              Demo Mode
            </button>
            <button
              onClick={() => setTradeMode('live')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black transition-all"
              style={tradeMode === 'live' ? {
                background: 'linear-gradient(135deg, #10b981, #34d399)',
                color: '#04140d',
                boxShadow: '0 4px 16px rgba(16,185,129,0.45), 0 0 24px rgba(52,211,153,0.35)',
              } : {
                background: 'transparent',
                color: '#94a3b8',
              }}>
              <span className={`w-2 h-2 rounded-full${tradeMode === 'live' ? ' animate-pulse' : ''}`}
                style={{ background: tradeMode === 'live' ? '#04140d' : '#475569' }} />
              Live Mode
            </button>
          </div>
        </div>

        {/* ── Demo mode banner ── */}
        {tradeMode === 'demo' && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl mb-4 shrink-0"
            style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <span className="text-xs font-black px-2 py-0.5 rounded-md"
              style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.15)' }}>DEMO</span>
            <p className="text-xs font-medium" style={{ color: 'rgba(245,158,11,0.8)' }}>
              Demo mode — bot runs are simulated. Switch to Live in the top bar for real execution.
            </p>
          </div>
        )}

        {/* ── Page header ── */}
        <div className="flex items-center gap-4 mb-6 shrink-0">
          {/* Back */}
          <button onClick={() => router.back()}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors shrink-0"
            style={{ border: '1px solid var(--border)' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Name + status */}
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white truncate">{bot.name}</h1>
            <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full shrink-0"
              style={{ color: st.color, background: st.bg, boxShadow: st.glow }}>
              <span className={`w-1.5 h-1.5 rounded-full${st.pulse ? ' animate-pulse' : ''}`}
                style={{ background: st.color }} />
              {st.label}
            </span>
            {bot.description && (
              <p className="text-slate-500 text-sm truncate hidden md:block">{bot.description}</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Edit Code — hidden for locked bots */}
            {!isLockedBot(botId) && (
              <button onClick={() => setCodeModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                Edit Code
              </button>
            )}

            {/* ── Fix with AI ───────────────────────────────────────────────
                Conditionally rendered — only when there is at least one
                ERROR-level log in the recent window. The animated red→amber
                gradient + sparkle icon + glow draws the eye to it the
                instant something breaks. */}
            {!isLockedBot(botId) && dashStats.errorCount > 0 && (
              <button
                onClick={openAiFix}
                title={`${dashStats.errorCount} error${dashStats.errorCount === 1 ? '' : 's'} in recent logs — let Claude analyse and patch`}
                className="ai-fix-cta flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-transform"
                style={{
                  background:    'linear-gradient(135deg, #ff4444 0%, #ff8a3d 55%, #fbbf24 100%)',
                  color:         '#0a0e14',
                  border:        '1px solid rgba(255, 138, 61, 0.55)',
                  boxShadow:     '0 0 28px rgba(255, 100, 60, 0.45), 0 6px 18px rgba(255,68,68,0.18)',
                  letterSpacing: '0.01em',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px) scale(1.03)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(0)   scale(1)'}
              >
                {/* sparkle icon */}
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2zm6.5 11l.9 3.1 3.1.9-3.1.9-.9 3.1-.9-3.1L15.4 17l3.1-.9.9-3.1z" />
                </svg>

                <span>Fix with AI</span>

                {dashStats.errorCount > 0 && (
                  <span
                    className="ai-fix-badge"
                    aria-hidden="true"
                    style={{
                      minWidth: 22, height: 22, padding: '0 6px',
                      borderRadius: 999,
                      background: '#0a0e14',
                      color: '#ffffff',
                      fontSize: 11, fontWeight: 800,
                      display: 'grid', placeItems: 'center',
                      marginLeft: 2,
                    }}
                  >
                    {dashStats.errorCount > 99 ? '99+' : dashStats.errorCount}
                  </span>
                )}
              </button>
            )}

            {/* Bot Settings */}
            <button onClick={openSettings}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Bot Settings
            </button>

            {/* API Keys */}
            {(() => {
              const missing = unconfiguredApis(detectedApis, conns.map(c => c.name))
              return (
                <button onClick={openKeyModal}
                  className="relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  API Keys
                  {missing.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-black"
                      style={{ background: '#ef4444', color: 'white' }}>
                      {missing.length}
                    </span>
                  )}
                </button>
              )
            })()}

            {/* Run / Stop */}
            {bot.status === 'RUNNING' ? (
              <button onClick={stop}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{ background: 'rgba(255,68,68,0.12)', color: '#ff4444', border: '1px solid rgba(255,68,68,0.25)' }}>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop
              </button>
            ) : (
              <button onClick={run}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{ background: 'var(--accent)', color: 'var(--bg)', boxShadow: '0 0 18px var(--accent)' }}>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Run Bot
              </button>
            )}
          </div>
        </div>

        {/* Action error banner */}
        {actionErr && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold mb-2"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
            {actionErr}
          </div>
        )}

        {/* ── Split layout ── */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: '20px', height: 'calc(100vh - 220px)', minHeight: 0 }}>

          {/* ════════════════════════════════════════════
              LEFT 1/3 — Live Logs
          ════════════════════════════════════════════ */}
          <div className="flex flex-col rounded-2xl" style={{ width: '33.333%', flexShrink: 0, minWidth: 0, overflow: 'hidden', order: 1, ...CARD }}>

            {/* Log panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2">
                {bot.status === 'RUNNING' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00f5ff] animate-pulse" />
                )}
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  {bot.status === 'RUNNING' ? 'Live Logs' : 'Logs'}
                </span>
                <span className="text-[12px] text-slate-600 font-mono">{logs.length}</span>
              </div>
              <div className="flex items-center gap-3">
                {/* Clear Live Log only — stats panels are NOT affected */}
                <button
                  title="Clear the log display only. Stats and trade history are preserved."
                  onClick={async () => {
                    try {
                      await botsApi.clearLogs(botId)
                      setLogs([])
                      // sinceIdRef stays — incremental poll continues from current position.
                      // dashStats / allLogsRef are intentionally NOT touched here.
                    } catch {}
                  }}
                  className="text-[12px] text-slate-700 hover:text-red-400 transition-colors font-semibold">
                  Clear Log
                </button>
                <span className="text-slate-800 select-none">·</span>
                {/* Reset Stats — clears dashboard panels, NOT the log display */}
                <button
                  title="Reset all dashboard stats (PNL, trades, errors). Log display is NOT affected."
                  onClick={() => { allLogsRef.current.clear(); setDashStats(emptyDash()) }}
                  className="text-[12px] text-slate-700 hover:text-amber-400 transition-colors font-semibold">
                  Reset Stats
                </button>
              </div>
            </div>

            {/* Scrollable log area */}
            <div
              ref={logScrollRef}
              onScroll={handleLogScroll}
              className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-0.5"
            >
              {logs.length === 0 ? (
                <p className="text-slate-600 text-center pt-16 font-sans text-sm">
                  No logs yet. Run the bot to see output.
                </p>
              ) : (
                [...logs].reverse().map(log => {
                  const { tag, body } = parseTag(log.message)
                  const isLevel    = tag === 'INFO' || tag === 'WARNING' || tag === 'ERROR'
                  const effectiveTag = isLevel
                    ? (log.level === 'WARNING' ? 'WARNING' : log.level === 'ERROR' ? 'ERROR' : 'INFO')
                    : tag
                  const meta     = TAG[effectiveTag] || TAG.INFO
                  const isPnlNeg = tag === 'PNL' && body.includes('-')
                  const useMeta  = tag === 'PNL'
                    ? (isPnlNeg ? { color: '#f87171', bg: 'rgba(248,113,113,0.07)' } : { color: '#34d399', bg: 'rgba(52,211,153,0.07)' })
                    : meta
                  return (
                    <div key={log.id}
                      className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg"
                      style={{ background: useMeta.bg }}>
                      <span className="text-slate-600 shrink-0 tabular-nums text-[10.8px] mt-0.5 w-[60px]">
                        {formatTimeCT(log.created_at)}
                      </span>
                      <span className="shrink-0 text-[9.6px] font-black px-1 py-[2px] rounded min-w-[38px] text-center leading-none"
                        style={{ color: useMeta.color, background: `${useMeta.color}22`, border: `1px solid ${useMeta.color}44` }}>
                        {effectiveTag.slice(0, 5)}
                      </span>
                      <span className="break-all flex-1 leading-relaxed text-[12px]"
                        style={{ color: effectiveTag === 'INFO' ? '#94a3b8' : useMeta.color }}>
                        {body}
                      </span>
                    </div>
                  )
                })
              )}
              <div ref={logBottomRef} />
            </div>

            {/* Scroll-to-bottom button */}
            {!pinned && (
              <div className="shrink-0 flex justify-end px-3 py-2 border-t border-white/[0.04]">
                <button
                  onClick={() => { setPinned(true); logBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                  className="flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg transition-all"
                  style={{ background: 'rgba(0,245,255,0.1)', color: 'var(--accent)', border: '1px solid rgba(0,245,255,0.25)' }}>
                  <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3v10M3 9l5 5 5-5"/>
                  </svg>
                  Latest
                </button>
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════
              RIGHT 2/3 — Dynamic Bot Dashboard
          ════════════════════════════════════════════ */}
          <div className="overflow-y-auto space-y-4" style={{ flex: '1 1 0', minWidth: 0, minHeight: 0 }}>

            {/* ── Universal status bar ── */}
            <div className="grid grid-cols-4 gap-3">

              {/* Bot Health */}
              <div className="rounded-2xl p-4 relative overflow-hidden" style={CARD}>
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
                  style={{ background: `linear-gradient(90deg, ${st.color}99, transparent)` }} />
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Bot Health</p>
                  {bot.status === 'RUNNING' && (
                    <span className="flex items-center gap-1 text-[10.8px] font-black px-2 py-0.5 rounded-full"
                      style={{ color: 'var(--accent)', background: 'rgba(0,245,255,0.1)', border: '1px solid rgba(0,245,255,0.2)' }}>
                      <span className="w-1 h-1 rounded-full bg-[#00f5ff] animate-pulse" />LIVE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: st.bg, border: `1px solid ${st.color}33` }}>
                    <span className={`w-2.5 h-2.5 rounded-full${st.pulse ? ' animate-pulse' : ''}`}
                      style={{ background: st.color, boxShadow: st.glow }} />
                  </div>
                  <div>
                    <p className="text-base font-black" style={{ color: st.color }}>{st.label}</p>
                    <p className="text-[12px] text-slate-600 mt-0.5">
                      {errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''} detected` : 'Running clean'}
                    </p>
                  </div>
                </div>
                {lastError ? (
                  <div className="rounded-lg px-2 py-1.5" style={{ background: 'rgba(255,68,68,0.06)', border: '1px solid rgba(255,68,68,0.18)' }}>
                    <p className="text-[10.8px] text-red-400 font-mono line-clamp-2">{parseTag(lastError.message).body}</p>
                  </div>
                ) : (
                  <p className="text-[12px] text-slate-700">
                    {bot.last_run_at ? `Last: ${formatDateTimeCT(bot.last_run_at)}` : 'Never run'}
                  </p>
                )}
              </div>

              {/* Session Uptime */}
              <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
                  style={{ background: 'linear-gradient(90deg, #22c55e99, transparent)' }} />
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Uptime</p>
                  {bot.status === 'RUNNING' && (
                    <span className="flex items-center gap-1 text-[10.8px] font-black px-2 py-0.5 rounded-full"
                      style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />TICK
                    </span>
                  )}
                </div>
                <p className="text-2xl font-black text-white font-mono tabular-nums leading-none mb-1.5">
                  {sessionStart ? formatDuration(sessionElapsed) : bot.last_run_at ? formatDuration(sessionElapsed) : '—'}
                </p>
                <p className="text-[12px] text-slate-600 mb-1.5">
                  {sessionStart
                    ? `since ${formatTimeCT(new Date(sessionStart).toISOString())} CT`
                    : bot.last_run_at
                      ? `started ${formatTimeCT(bot.last_run_at)} CT`
                      : 'Not running'}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-black text-slate-400">{bot.run_count}</span>
                  <span className="text-[12px] text-slate-600">total run{bot.run_count !== 1 ? 's' : ''}</span>
                </div>
              </div>

              {/* API Connections */}
              <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
                  style={{ background: conns.length > 0 ? 'linear-gradient(90deg, #00f5ff99, transparent)' : 'linear-gradient(90deg, #47556999, transparent)' }} />
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">API Keys</p>
                  {conns.length > 0 && (
                    <span className="flex items-center gap-1 text-[10.8px] font-black px-2 py-0.5 rounded-full"
                      style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                      <span className="w-1 h-1 rounded-full bg-emerald-400" />{conns.length} OK
                    </span>
                  )}
                </div>
                {conns.length === 0 ? (
                  <div>
                    <p className="text-2xl font-black text-slate-600 mb-1">0</p>
                    <p className="text-[12px] text-slate-600 mb-2">No keys configured</p>
                    <button onClick={openKeyModal}
                      className="text-[12px] font-bold transition-colors" style={{ color: 'var(--accent)' }}>
                      + Add API Key →
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-2xl font-black mb-2" style={{ color: 'var(--accent)' }}>{conns.length}</p>
                    <div className="space-y-1">
                      {conns.slice(0, 3).map(c => (
                        <div key={c.id} className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-[12px] text-slate-300 truncate font-medium">{c.name}</span>
                        </div>
                      ))}
                      {conns.length > 3 && <p className="text-[10.8px] text-slate-600">+{conns.length - 3} more</p>}
                    </div>
                  </div>
                )}
              </div>

              {/* Session Info */}
              <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
                  style={{ background: 'linear-gradient(90deg, #a78bfa99, transparent)' }} />
                <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-2.5">Session Info</p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-slate-600">Schedule</span>
                    <span className="text-[12px] font-bold text-slate-300">
                      {bot.schedule_type === 'custom'
                        ? `${bot.schedule_start ?? '?'} – ${bot.schedule_end ?? '?'}`
                        : 'Always On'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-slate-600">Auto-Restart</span>
                    <span className="text-[12px] font-bold" style={{ color: bot.auto_restart ? '#22c55e' : '#475569' }}>
                      {bot.auto_restart ? '✓ Enabled' : '✗ Off'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-slate-600">Total Runs</span>
                    <span className="text-[12px] font-bold text-white">{bot.run_count}</span>
                  </div>
                  {bot.max_daily_loss != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-slate-600">Max Daily Loss</span>
                      <span className="text-[12px] font-bold text-red-400">${bot.max_daily_loss}</span>
                    </div>
                  )}
                  {bot.max_amount_per_trade != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-slate-600">Max/Trade</span>
                      <span className="text-[12px] font-bold text-slate-300">${bot.max_amount_per_trade}</span>
                    </div>
                  )}
                  {bot.last_run_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-slate-600">Last Run</span>
                      <span className="text-[12px] font-bold text-slate-400">{formatTimeCT(bot.last_run_at)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Locked Strategy Card (only for locked bots) ── */}
            {isLockedBot(botId) && (
              <div className="rounded-2xl p-5 flex items-start gap-4"
                style={{ background: 'rgba(168,85,247,0.07)', border: '1.5px solid rgba(168,85,247,0.28)', boxShadow: '0 0 24px rgba(168,85,247,0.08)' }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(168,85,247,0.14)', border: '1px solid rgba(168,85,247,0.35)' }}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#a855f7" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-black" style={{ color: '#a855f7' }}>Strategy Locked</p>
                    <span className="text-[10.8px] font-black px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
                      PROTECTED
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    This is a purchased strategy. The code is protected and cannot be viewed or edited.
                    All settings and risk controls remain fully adjustable via <strong className="text-slate-300">Bot Settings</strong>.
                  </p>
                  <p className="text-[12px] text-slate-600 mt-2 font-mono">{bot.name}</p>
                </div>
              </div>
            )}

            {/* ── Bot type divider ── */}
            <div className="flex items-center gap-3">
              {analysing ? (
                /* ── Scanning animation ── */
                <span className="flex items-center gap-2 text-xs font-black px-3 py-1.5 rounded-full"
                  style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.2)' }}>
                  <svg className="w-3 h-3 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Analysing code…
                </span>
              ) : (
                /* ── Detected type badge ── */
                <span className="flex items-center gap-2 text-xs font-black px-3 py-1.5 rounded-full"
                  style={{ color: typeMeta.color, background: typeMeta.bg, border: `1px solid ${typeMeta.color}30` }}>
                  <span>{typeMeta.icon}</span>{botSubLabel}
                </span>
              )}
              {bot.status === 'RUNNING' && (
                <span className="flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-full"
                  style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--border)' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00f5ff] animate-pulse" />
                  Live Feed
                </span>
              )}
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
              <span className="text-[12px] font-mono"
                style={{ color: logFetchError ? '#ef4444' : secAgo < 5 ? '#22c55e' : secAgo < 15 ? '#f59e0b' : '#475569' }}>
                {logFetchError
                  ? '⚠ poll failed — open DevTools (F12)'
                  : lastUpdated
                    ? secAgo === 0 ? 'just updated' : `updated ${secAgo}s ago`
                    : 'auto-detected · live'}
              </span>
            </div>
            {logFetchError && (
              <div
                style={{
                  margin: '8px 0',
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  color: '#ef4444',
                  fontSize: 12,
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {logFetchError}
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                TRADING BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {isTradingBot && (<>

              {/* Row A: P&L | Win Rate | Max Drawdown | Error Count */}
              <div className="grid grid-cols-4 gap-4">
                {/* Real-time P&L */}
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Real-time P&L</p>
                    {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: totalPnl >= 0 ? '#22c55e' : '#ff4444' }} />}
                  </div>
                  <p className="text-3xl font-black font-mono leading-none tabular-nums"
                    style={{ color: totalSettled === 0 ? '#475569' : totalPnl >= 0 ? '#22c55e' : '#ff4444' }}>
                    {totalSettled === 0 ? '$0.00' : fmtPnl(totalPnl)}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-2">
                    {totalSettled} settled{pendingTrades.length > 0 ? ` · ${pendingTrades.length} pending` : ''}
                  </p>
                </div>

                {/* Win Rate */}
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Win Rate</p>
                    {bot.status === 'RUNNING' && (
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ background: winRate == null ? '#475569' : winRate >= 60 ? '#22c55e' : winRate >= 45 ? '#f59e0b' : '#ff4444' }} />
                    )}
                  </div>
                  <p className="text-3xl font-black leading-none"
                    style={{ color: winRate == null ? '#475569' : winRate >= 60 ? '#22c55e' : winRate >= 45 ? '#f59e0b' : '#ff4444' }}>
                    {winRate == null ? (pendingTrades.length > 0 ? '…' : '—') : `${winRate}%`}
                  </p>
                  {winRate != null ? (
                    <>
                      <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${winRate}%`, background: winRate >= 60 ? '#22c55e' : winRate >= 45 ? '#f59e0b' : '#ff4444' }} />
                      </div>
                      <p className="text-[12px] text-slate-600 mt-1">{wins}W / {losses}L</p>
                    </>
                  ) : (
                    <p className="text-[12px] text-slate-600 mt-2">
                      {pendingTrades.length > 0 ? 'awaiting settlement' : 'no settled trades yet'}
                    </p>
                  )}
                </div>

                {/* Max Drawdown */}
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Max Drawdown</p>
                    {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: maxDrawdown > 0 ? '#ff4444' : '#22c55e' }} />}
                  </div>
                  <p className="text-3xl font-black font-mono leading-none tabular-nums"
                    style={{ color: maxDrawdown > 0 ? '#ff4444' : '#475569' }}>
                    {maxDrawdown > 0 ? `-$${maxDrawdown.toFixed(2)}` : (pendingTrades.length > 0 ? '…' : '—')}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-2">
                    {maxDrawdown > 0 ? 'peak-to-trough' : pendingTrades.length > 0 ? 'awaiting settlement' : 'peak-to-trough'}
                  </p>
                </div>

                {/* Error Count */}
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Error Count</p>
                    {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: errorCount > 0 ? '#ff4444' : '#22c55e' }} />}
                  </div>
                  <p className="text-3xl font-black leading-none" style={{ color: errorCount > 0 ? '#ff4444' : '#22c55e' }}>{errorCount}</p>
                  <p className="text-[12px] mt-2" style={{ color: errorCount > 0 ? '#f87171' : '#34d399' }}>
                    {errorCount === 0 ? 'Running clean' : 'errors detected'}
                  </p>
                </div>
              </div>

              {/* Row B: Total Trades | Profitable | Loss Trades | Open Position */}
              <div className="grid grid-cols-4 gap-4">
                {/* Total Trades */}
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Total Trades</p>
                    {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] animate-pulse" />}
                  </div>
                  <p className="text-4xl font-black leading-none" style={{ color: '#a78bfa' }}>{tradePairs.length}</p>
                  <p className="text-[12px] text-slate-500 mt-2">
                    {totalSettled} settled{pendingTrades.length > 0 ? ` · ${pendingTrades.length} pending` : ''}
                  </p>
                </div>

                {/* Profitable */}
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Profitable</p>
                    {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                  </div>
                  <p className="text-4xl font-black leading-none" style={{ color: wins > 0 ? '#22c55e' : '#475569' }}>
                    {wins > 0 ? wins : (pendingTrades.length > 0 ? '…' : wins)}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-2">
                    {wins > 0 ? 'winning trades' : pendingTrades.length > 0 ? 'awaiting settlement' : 'winning trades'}
                  </p>
                </div>

                {/* Loss Trades */}
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Loss Trades</p>
                    {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: losses > 0 ? '#ff4444' : '#475569' }} />}
                  </div>
                  <p className="text-4xl font-black leading-none" style={{ color: losses > 0 ? '#ff4444' : '#475569' }}>
                    {losses > 0 ? losses : (pendingTrades.length > 0 ? '…' : losses)}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-2">
                    {losses > 0 ? 'losing trades' : pendingTrades.length > 0 ? 'awaiting settlement' : 'losing trades'}
                  </p>
                </div>

                {/* Open Position */}
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Open Position</p>
                    {openTrades.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[#00f5ff] animate-pulse" />}
                  </div>
                  <p className="text-4xl font-black leading-none" style={{ color: openTrades.length > 0 ? '#00f5ff' : '#475569' }}>
                    {openTrades.length}
                  </p>
                  {openTrades[0] ? (
                    <p className="text-[12px] text-slate-500 mt-2 font-mono">
                      {openTrades[0].side} · {openTrades[0].contracts} × {openTrades[0].entryPrice}¢
                      {pendingTrades.some(t => t.key === openTrades[0].key) && (
                        <span className="ml-1 text-[#f59e0b]">· settling…</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-[12px] text-slate-600 mt-2">no open trades</p>
                  )}
                </div>
              </div>

              {/* Row C: Equity Curve */}
              <div className="rounded-2xl p-5" style={CARD}>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Equity Curve</p>
                  {equityCurve.length > 0 && (
                    <span className="text-xs font-black font-mono" style={{ color: eqColor }}>
                      {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} total
                    </span>
                  )}
                </div>
                {equityCurve.length < 2 ? (
                  <div className="flex items-center justify-center h-28 text-slate-700 text-sm">
                    Run trades to see equity curve
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={120}>
                    <AreaChart data={equityCurve} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={eqColor} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={eqColor} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="t" tick={{ fontSize: 10.8, fill: '#475569' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10.8, fill: '#475569' }} axisLine={false} tickLine={false}
                        tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                      <Tooltip
                        contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13.2 }}
                        labelStyle={{ color: 'var(--text-muted)' }}
                        formatter={(v: number) => [`${v >= 0 ? '+' : ''}$${v.toFixed(4)}`, 'Equity']}
                        labelFormatter={(l: number) => `Trade #${l}`} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="eq" stroke={eqColor} strokeWidth={2}
                        fill="url(#eqGrad)" dot={false} activeDot={{ r: 4, fill: eqColor }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Row D: Trade Logs */}
              <div className="rounded-2xl overflow-hidden" style={CARD}>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2.5">
                    <p className="text-sm font-bold text-white">Trade Logs</p>
                    {tradePairs.length > 0 && (
                      <span className="text-[12px] font-black px-2 py-0.5 rounded-full"
                        style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.12)' }}>
                        {tradePairs.length} trades
                      </span>
                    )}
                    {bot.status === 'RUNNING' && (
                      <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--accent)' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00f5ff] animate-pulse" />Live
                      </span>
                    )}
                  </div>
                  {closedTrades.length > 0 && (
                    <span className="text-xs font-mono font-bold" style={{ color: eqColor }}>{fmtPnl(totalPnl)}</span>
                  )}
                </div>
                {tradePairs.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-slate-600 text-sm">No trades yet — run the bot to see trade history</p>
                  </div>
                ) : (
                  <>
                    <div className="grid text-[12px] font-black text-slate-600 uppercase tracking-wider px-5 py-2.5 border-b border-white/[0.04]"
                      style={{ gridTemplateColumns: '1.4fr 0.6fr 0.7fr 0.8fr 0.8fr 0.9fr 0.7fr' }}>
                      <span>Time</span><span>Side</span><span>Qty</span>
                      <span>Entry</span><span>Exit</span><span className="text-right">P&L</span><span className="text-right">Result</span>
                    </div>
                    <div className="overflow-y-auto" style={{ maxHeight: '220px' }}>
                      {tradePairs.map(trade => {
                        const pc = trade.pnl == null ? '#475569' : trade.pnl > 0 ? '#22c55e' : trade.pnl < 0 ? '#ff4444' : '#94a3b8'
                        return (
                          <div key={trade.key} className="grid items-center px-5 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.02] text-xs"
                            style={{ gridTemplateColumns: '1.4fr 0.6fr 0.7fr 0.8fr 0.8fr 0.9fr 0.7fr' }}>
                            <span className="text-slate-500 tabular-nums text-[12px]">{formatTimeCT(trade.entryTime)} <span className="text-slate-700">CT</span></span>
                            <span className="font-black" style={{ color: trade.side === 'YES' ? '#00f5ff' : '#f59e0b' }}>{trade.side || '—'}</span>
                            <span className="text-slate-300 font-bold">{trade.contracts}</span>
                            <span className="text-slate-300 font-mono">{trade.entryPrice}</span>
                            <span className="font-mono" style={{ color: trade.exitPrice != null ? '#e2e8f0' : '#475569' }}>{trade.exitPrice ?? '—'}</span>
                            <span className="text-right font-black font-mono tabular-nums" style={{ color: pc }}>{fmtPnl(trade.pnl)}</span>
                            <div className="flex justify-end">
                              {trade.status === 'open'
                                ? <span className="text-[10.8px] font-black px-2 py-0.5 rounded-full" style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.25)' }}>OPEN</span>
                                : (trade.pnl ?? 0) > 0
                                  ? <span className="text-[10.8px] font-black px-2 py-0.5 rounded-full" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>WIN</span>
                                  : <span className="text-[10.8px] font-black px-2 py-0.5 rounded-full" style={{ color: '#ff4444', background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.2)' }}>{trade.closeReason || 'LOSS'}</span>
                              }
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Row E: AI Decision Metrics (for AI-assisted trading bots) */}
              {predMetrics && (predMetrics.total > 0 || predMetrics.avgConf > 0) && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-2xl p-5" style={CARD}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">AI Decisions</p>
                      {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] animate-pulse" />}
                    </div>
                    <p className="text-4xl font-black leading-none" style={{ color: '#a78bfa' }}>{predMetrics.total}</p>
                    <p className="text-[12px] text-slate-500 mt-2">trades placed by AI</p>
                  </div>
                  <div className="rounded-2xl p-5" style={CARD}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Avg Confidence</p>
                      {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] animate-pulse" />}
                    </div>
                    <p className="text-3xl font-black leading-none"
                      style={{ color: predMetrics.avgConf >= 70 ? '#22c55e' : predMetrics.avgConf >= 50 ? '#f59e0b' : predMetrics.avgConf === 0 ? '#475569' : '#ff4444' }}>
                      {predMetrics.avgConf === 0 ? '—' : `${predMetrics.avgConf}%`}
                    </p>
                    {predMetrics.avgConf > 0 && (
                      <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${predMetrics.avgConf}%`, background: 'linear-gradient(90deg,#a855f7,#7c3aed)' }} />
                      </div>
                    )}
                  </div>
                  <div className="rounded-2xl p-5" style={CARD}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Win Rate (AI)</p>
                      {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full bg-[#00f5ff] animate-pulse" />}
                    </div>
                    <p className="text-3xl font-black leading-none"
                      style={{ color: winRate == null ? '#475569' : winRate >= 60 ? '#22c55e' : winRate >= 45 ? '#f59e0b' : '#ff4444' }}>
                      {winRate == null ? '—' : `${winRate}%`}
                    </p>
                    {winRate != null && (
                      <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${winRate}%`, background: winRate >= 60 ? '#22c55e' : winRate >= 45 ? '#f59e0b' : '#ff4444' }} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>)}

            {/* ══════════════════════════════════════════════════════
                PREDICTION BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'prediction' && predMetrics && (<>

              {/* Row A: Accuracy | Total | Correct | Wrong */}
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Accuracy</p>
                  <p className="text-4xl font-black leading-none"
                    style={{ color: predMetrics.accuracy >= 70 ? '#22c55e' : predMetrics.accuracy >= 50 ? '#f59e0b' : predMetrics.accuracy === 0 ? '#475569' : '#ff4444' }}>
                    {predMetrics.total === 0 ? '—' : `${predMetrics.accuracy}%`}
                  </p>
                  {predMetrics.total > 0 && (
                    <div className="mt-3 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${predMetrics.accuracy}%`, background: predMetrics.accuracy >= 70 ? '#22c55e' : predMetrics.accuracy >= 50 ? '#f59e0b' : '#ff4444' }} />
                    </div>
                  )}
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Predictions</p>
                  <p className="text-4xl font-black leading-none" style={{ color: '#a78bfa' }}>{predMetrics.total}</p>
                  <p className="text-[12px] text-slate-500 mt-2">this session</p>
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Correct</p>
                  <p className="text-4xl font-black leading-none" style={{ color: predMetrics.correct > 0 ? '#22c55e' : '#475569' }}>{predMetrics.correct}</p>
                  <p className="text-[12px] text-slate-500 mt-2">accurate predictions</p>
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Wrong</p>
                  <p className="text-4xl font-black leading-none" style={{ color: predMetrics.wrong > 0 ? '#ff4444' : '#475569' }}>{predMetrics.wrong}</p>
                  <p className="text-[12px] text-slate-500 mt-2">missed predictions</p>
                </div>
              </div>

              {/* Row B: Confidence | Error Count | Total Runs */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Avg Confidence Score</p>
                  <p className="text-3xl font-black leading-none"
                    style={{ color: predMetrics.avgConf >= 75 ? '#22c55e' : predMetrics.avgConf >= 55 ? '#f59e0b' : predMetrics.avgConf === 0 ? '#475569' : '#ff4444' }}>
                    {predMetrics.avgConf === 0 ? '—' : `${predMetrics.avgConf}%`}
                  </p>
                  {predMetrics.avgConf > 0 && (
                    <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${predMetrics.avgConf}%`, background: 'linear-gradient(90deg,#a855f7,#7c3aed)' }} />
                    </div>
                  )}
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-3xl font-black leading-none" style={{ color: errorCount > 0 ? '#ff4444' : '#22c55e' }}>{errorCount}</p>
                  <p className="text-[12px] mt-2" style={{ color: errorCount > 0 ? '#f87171' : '#34d399' }}>
                    {errorCount === 0 ? 'Running clean' : 'errors in session'}
                  </p>
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-3xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-500 mt-2">lifetime executions</p>
                </div>
              </div>

              {/* Row C: Recent Predictions */}
              <div className="rounded-2xl overflow-hidden" style={CARD}>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                  <p className="text-sm font-bold text-white">Recent Predictions</p>
                  {bot.status === 'RUNNING' && (
                    <span className="flex items-center gap-1 text-[12px]" style={{ color: '#a855f7' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] animate-pulse" />Live
                    </span>
                  )}
                </div>
                {predMetrics.recent.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-slate-600 text-sm">No predictions yet — run the bot to see results</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto" style={{ maxHeight: '280px' }}>
                    {predMetrics.recent.map((r, i) => (
                      <div key={i} className="flex items-start gap-3 px-5 py-3 border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <div className="shrink-0 mt-0.5">
                          {r.result === 'correct'
                            ? <span className="w-5 h-5 rounded-full flex items-center justify-center text-[12px]" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>✓</span>
                            : r.result === 'wrong'
                              ? <span className="w-5 h-5 rounded-full flex items-center justify-center text-[12px]" style={{ background: 'rgba(255,68,68,0.15)', color: '#ff4444' }}>✗</span>
                              : <span className="w-5 h-5 rounded-full flex items-center justify-center text-[12px]" style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}>~</span>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-300 break-all leading-relaxed">{r.text}</p>
                          <p className="text-[12px] text-slate-600 mt-0.5">{formatTimeCT(r.time)} CT</p>
                        </div>
                        {r.conf != null && (
                          <span className="shrink-0 text-[12px] font-black px-2 py-0.5 rounded-full"
                            style={{ color: '#a855f7', background: 'rgba(168,85,247,0.1)' }}>
                            {r.conf}%
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>)}

            {/* ══════════════════════════════════════════════════════
                WEB SCRAPER DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'scraper' && scraperStats && (<>

              {/* Row A: Status | Items Scraped | Last Scraped */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Scraping Status</p>
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${bot.status === 'RUNNING' ? 'animate-pulse' : ''}`}
                      style={{ background: bot.status === 'RUNNING' ? '#f59e0b' : bot.status === 'ERROR' ? '#ff4444' : '#475569' }} />
                    <p className="text-lg font-black" style={{ color: bot.status === 'RUNNING' ? '#f59e0b' : bot.status === 'ERROR' ? '#ff4444' : '#475569' }}>
                      {bot.status === 'RUNNING' ? 'Scraping' : bot.status === 'ERROR' ? 'Error' : 'Idle'}
                    </p>
                  </div>
                  <p className="text-[12px] text-slate-600">{scraperStats.fetchCount} fetch attempts</p>
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Items Scraped Today</p>
                  <p className="text-4xl font-black leading-none" style={{ color: scraperStats.totalItems > 0 ? '#f59e0b' : '#475569' }}>
                    {scraperStats.totalItems}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-2">total items found</p>
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Last Scraped</p>
                  <p className="text-sm font-bold text-white leading-snug">
                    {scraperStats.lastTime ? formatTimeCT(scraperStats.lastTime) + ' CT' : '—'}
                  </p>
                  <p className="text-[12px] text-slate-600 mt-2">
                    {scraperStats.lastTime ? formatDateTimeCT(scraperStats.lastTime) : 'Not scraped yet'}
                  </p>
                </div>
              </div>

              {/* Row B: Success Rate | Error Count | Total Runs */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Success Rate</p>
                  <p className="text-3xl font-black leading-none"
                    style={{ color: scraperStats.successRate >= 90 ? '#22c55e' : scraperStats.successRate >= 60 ? '#f59e0b' : scraperStats.successRate === 0 ? '#475569' : '#ff4444' }}>
                    {scraperStats.fetchCount === 0 ? '—' : `${scraperStats.successRate}%`}
                  </p>
                  {scraperStats.fetchCount > 0 && (
                    <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${scraperStats.successRate}%`, background: 'linear-gradient(90deg,#f59e0b,#d97706)' }} />
                    </div>
                  )}
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-3xl font-black leading-none" style={{ color: errorCount > 0 ? '#ff4444' : '#22c55e' }}>{errorCount}</p>
                  <p className="text-[12px] mt-2" style={{ color: errorCount > 0 ? '#f87171' : '#34d399' }}>
                    {errorCount === 0 ? 'No errors' : 'scrape errors'}
                  </p>
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-3xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-500 mt-2">lifetime executions</p>
                </div>
              </div>

              {/* Row C: Last Scraped Data Preview */}
              <div className="rounded-2xl overflow-hidden" style={CARD}>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                  <p className="text-sm font-bold text-white">Last Scraped Data</p>
                  {bot.status === 'RUNNING' && (
                    <span className="flex items-center gap-1 text-[12px]" style={{ color: '#f59e0b' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-pulse" />Scraping
                    </span>
                  )}
                </div>
                {scraperStats.preview.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-slate-600 text-sm">No data yet — run the scraper to see preview</p>
                  </div>
                ) : (
                  <div className="p-5 space-y-2">
                    {scraperStats.preview.map((line, i) => (
                      <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl"
                        style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.12)' }}>
                        <span className="text-[12px] font-black px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                          style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>{i + 1}</span>
                        <p className="text-xs text-slate-300 font-mono break-all leading-relaxed">{line}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>)}

            {/* ══════════════════════════════════════════════════════
                NOTIFICATION BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'notification' && notifStats && (<>

              {/* Row A: Total Sent | Delivery Rate | Last Sent */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Notifications Sent</p>
                  <p className="text-4xl font-black leading-none" style={{ color: notifStats.sent > 0 ? '#22c55e' : '#475569' }}>
                    {notifStats.sent}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-2">
                    {notifStats.failed > 0 ? `${notifStats.failed} failed` : 'all delivered'}
                  </p>
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Delivery Success Rate</p>
                  <p className="text-3xl font-black leading-none"
                    style={{ color: notifStats.successRate >= 95 ? '#22c55e' : notifStats.successRate >= 70 ? '#f59e0b' : notifStats.successRate === 0 ? '#475569' : '#ff4444' }}>
                    {notifStats.sent + notifStats.failed === 0 ? '—' : `${notifStats.successRate}%`}
                  </p>
                  {notifStats.sent + notifStats.failed > 0 && (
                    <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${notifStats.successRate}%`, background: 'linear-gradient(90deg,#22c55e,#16a34a)' }} />
                    </div>
                  )}
                </div>
                <div className="rounded-2xl p-5" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Last Notification Sent</p>
                  <p className="text-sm font-bold text-white leading-snug">
                    {notifStats.lastTime ? formatTimeCT(notifStats.lastTime) + ' CT' : '—'}
                  </p>
                  <p className="text-[12px] text-slate-600 mt-2">
                    {notifStats.lastTime ? formatDateTimeCT(notifStats.lastTime) : 'None sent yet'}
                  </p>
                </div>
              </div>

              {/* Row B: Notification History */}
              <div className="rounded-2xl overflow-hidden" style={CARD}>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                  <p className="text-sm font-bold text-white">Notification History</p>
                  <span className="text-[12px] text-slate-500">last {Math.min(notifStats.history.length, 10)} events</span>
                </div>
                {notifStats.history.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-slate-600 text-sm">No notifications sent yet — run the bot</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto" style={{ maxHeight: '300px' }}>
                    {notifStats.history.map((n, i) => (
                      <div key={i} className="flex items-start gap-3 px-5 py-3 border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <div className="shrink-0 mt-0.5">
                          {n.ok
                            ? <span className="w-5 h-5 rounded-full flex items-center justify-center text-[12px]" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>✓</span>
                            : <span className="w-5 h-5 rounded-full flex items-center justify-center text-[12px]" style={{ background: 'rgba(255,68,68,0.15)', color: '#ff4444' }}>✗</span>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-300 break-all leading-relaxed">{n.msg}</p>
                          <p className="text-[12px] text-slate-600 mt-0.5">{formatTimeCT(n.time)} CT</p>
                        </div>
                        <span className="shrink-0 text-[10.8px] font-black px-2 py-0.5 rounded-full"
                          style={{ color: n.ok ? '#22c55e' : '#ff4444', background: n.ok ? 'rgba(34,197,94,0.1)' : 'rgba(255,68,68,0.1)' }}>
                          {n.ok ? 'SENT' : 'FAILED'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>)}

            {/* ══════════════════════════════════════════════════════
                TELEGRAM BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'telegram' && telegramStats && (<>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#3b82f699,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Messages Sent</p>
                  <p className="text-4xl font-black leading-none" style={{ color: telegramStats.sent > 0 ? '#3b82f6' : '#475569' }}>{telegramStats.sent}</p>
                  <p className="text-[12px] text-slate-600 mt-2">bot replies sent</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#22c55e99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Messages Received</p>
                  <p className="text-4xl font-black leading-none" style={{ color: telegramStats.received > 0 ? '#22c55e' : '#475569' }}>{telegramStats.received}</p>
                  <p className="text-[12px] text-slate-600 mt-2">user messages in</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#a78bfa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Commands Handled</p>
                  <p className="text-4xl font-black leading-none" style={{ color: telegramStats.commands > 0 ? '#a78bfa' : '#475569' }}>{telegramStats.commands}</p>
                  <p className="text-[12px] text-slate-600 mt-2">/commands executed</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#f59e0b99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Unique Users</p>
                  <p className="text-4xl font-black leading-none" style={{ color: telegramStats.uniqueUsers > 0 ? '#f59e0b' : '#475569' }}>{telegramStats.uniqueUsers}</p>
                  <p className="text-[12px] text-slate-600 mt-2">{telegramStats.uniqueChats} chat{telegramStats.uniqueChats !== 1 ? 's' : ''} active</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-3xl font-black leading-none" style={{ color: telegramStats.errors > 0 ? '#ff4444' : '#22c55e' }}>{telegramStats.errors}</p>
                  <p className="text-[12px] mt-1.5" style={{ color: telegramStats.errors > 0 ? '#f87171' : '#34d399' }}>
                    {telegramStats.errors === 0 ? 'Running clean' : 'errors detected'}
                  </p>
                </div>
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-3xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">lifetime sessions</p>
                </div>
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Last Activity</p>
                  <p className="text-sm font-bold text-white">{telegramStats.lastTime ? formatTimeCT(telegramStats.lastTime) + ' CT' : '—'}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">{telegramStats.lastTime ? formatDateTimeCT(telegramStats.lastTime) : 'No activity yet'}</p>
                </div>
              </div>

              {telegramStats.recentCmds.length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={CARD}>
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                    <p className="text-sm font-bold text-white">Recent Commands</p>
                    {bot.status === 'RUNNING' && <span className="flex items-center gap-1 text-[12px]" style={{ color: '#3b82f6' }}><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />Live</span>}
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
                    {telegramStats.recentCmds.map((c, i) => (
                      <div key={i} className="flex items-start gap-3 px-5 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10.8px] font-black" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>✈</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-300 break-all leading-relaxed">{c.msg}</p>
                          <p className="text-[12px] text-slate-600 mt-0.5">{formatTimeCT(c.time)} CT</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* ══════════════════════════════════════════════════════
                DISCORD BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'discord' && discordStats && (<>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#818cf899,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Commands Run</p>
                  <p className="text-4xl font-black leading-none" style={{ color: discordStats.commands > 0 ? '#818cf8' : '#475569' }}>{discordStats.commands}</p>
                  <p className="text-[12px] text-slate-600 mt-2">slash/prefix cmds</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#22c55e99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Messages Sent</p>
                  <p className="text-4xl font-black leading-none" style={{ color: discordStats.messagesSent > 0 ? '#22c55e' : '#475569' }}>{discordStats.messagesSent}</p>
                  <p className="text-[12px] text-slate-600 mt-2">bot messages out</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#60a5fa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Events Handled</p>
                  <p className="text-4xl font-black leading-none" style={{ color: discordStats.eventsHandled > 0 ? '#60a5fa' : '#475569' }}>{discordStats.eventsHandled}</p>
                  <p className="text-[12px] text-slate-600 mt-2">Discord events fired</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#f59e0b99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Servers (Guilds)</p>
                  <p className="text-4xl font-black leading-none" style={{ color: discordStats.guilds > 0 ? '#f59e0b' : '#475569' }}>{discordStats.guilds}</p>
                  <p className="text-[12px] text-slate-600 mt-2">guilds detected</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-3xl font-black leading-none" style={{ color: discordStats.errors > 0 ? '#ff4444' : '#22c55e' }}>{discordStats.errors}</p>
                  <p className="text-[12px] mt-1.5" style={{ color: discordStats.errors > 0 ? '#f87171' : '#34d399' }}>
                    {discordStats.errors === 0 ? 'Running clean' : 'errors in session'}
                  </p>
                </div>
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-3xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">lifetime sessions</p>
                </div>
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Last Activity</p>
                  <p className="text-sm font-bold text-white">{discordStats.lastTime ? formatTimeCT(discordStats.lastTime) + ' CT' : '—'}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">{discordStats.lastTime ? formatDateTimeCT(discordStats.lastTime) : 'No activity yet'}</p>
                </div>
              </div>

              {discordStats.recentCmds.length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={CARD}>
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                    <p className="text-sm font-bold text-white">Recent Commands</p>
                    {bot.status === 'RUNNING' && <span className="flex items-center gap-1 text-[12px]" style={{ color: '#818cf8' }}><span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />Live</span>}
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
                    {discordStats.recentCmds.map((c, i) => (
                      <div key={i} className="flex items-start gap-3 px-5 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10.8px] font-black" style={{ background: 'rgba(129,140,248,0.15)', color: '#818cf8' }}>⌘</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-300 break-all leading-relaxed">{c.msg}</p>
                          <p className="text-[12px] text-slate-600 mt-0.5">{formatTimeCT(c.time)} CT</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* ══════════════════════════════════════════════════════
                AI AGENT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'ai_agent' && aiAgentStats && (<>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#a855f799,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">API Calls Made</p>
                  <p className="text-4xl font-black leading-none" style={{ color: aiAgentStats.apiCalls > 0 ? '#a855f7' : '#475569' }}>{aiAgentStats.apiCalls}</p>
                  <p className="text-[12px] text-slate-600 mt-2">LLM requests sent</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#22c55e99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Responses</p>
                  <p className="text-4xl font-black leading-none" style={{ color: aiAgentStats.responses > 0 ? '#22c55e' : '#475569' }}>{aiAgentStats.responses}</p>
                  <p className="text-[12px] text-slate-600 mt-2">AI replies received</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#60a5fa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Tokens Used</p>
                  <p className="text-4xl font-black leading-none" style={{ color: aiAgentStats.totalTokens > 0 ? '#60a5fa' : '#475569' }}>
                    {aiAgentStats.totalTokens > 9999 ? `${(aiAgentStats.totalTokens / 1000).toFixed(1)}k` : aiAgentStats.totalTokens}
                  </p>
                  <p className="text-[12px] text-slate-600 mt-2">total token consumption</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#f59e0b99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Avg Latency</p>
                  <p className="text-4xl font-black leading-none"
                    style={{ color: aiAgentStats.avgLatencyMs === 0 ? '#475569' : aiAgentStats.avgLatencyMs < 2000 ? '#22c55e' : aiAgentStats.avgLatencyMs < 5000 ? '#f59e0b' : '#ff4444' }}>
                    {aiAgentStats.avgLatencyMs === 0 ? '—' : aiAgentStats.avgLatencyMs < 1000 ? `${aiAgentStats.avgLatencyMs}ms` : `${(aiAgentStats.avgLatencyMs / 1000).toFixed(1)}s`}
                  </p>
                  <p className="text-[12px] text-slate-600 mt-2">per API call</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-3xl font-black leading-none" style={{ color: aiAgentStats.errors > 0 ? '#ff4444' : '#22c55e' }}>{aiAgentStats.errors}</p>
                  <p className="text-[12px] mt-1.5" style={{ color: aiAgentStats.errors > 0 ? '#f87171' : '#34d399' }}>
                    {aiAgentStats.errors === 0 ? 'No API errors' : 'API errors detected'}
                  </p>
                </div>
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-3xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">lifetime sessions</p>
                </div>
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Last API Call</p>
                  <p className="text-sm font-bold text-white">{aiAgentStats.lastTime ? formatTimeCT(aiAgentStats.lastTime) + ' CT' : '—'}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">{aiAgentStats.lastTime ? formatDateTimeCT(aiAgentStats.lastTime) : 'No calls yet'}</p>
                </div>
              </div>

              {aiAgentStats.recentResponses.length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={CARD}>
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                    <p className="text-sm font-bold text-white">Recent AI Responses</p>
                    {bot.status === 'RUNNING' && <span className="flex items-center gap-1 text-[12px]" style={{ color: '#a855f7' }}><span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />Live</span>}
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
                    {aiAgentStats.recentResponses.map((r, i) => (
                      <div key={i} className="flex items-start gap-3 px-5 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10.8px] font-black" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>AI</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-300 break-all leading-relaxed">{r.msg}</p>
                          <p className="text-[12px] text-slate-600 mt-0.5">{formatTimeCT(r.time)} CT</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* ══════════════════════════════════════════════════════
                TWITTER/X BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'twitter' && twitterStats && (<>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#3b82f699,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Tweets Posted</p>
                  <p className="text-4xl font-black leading-none" style={{ color: twitterStats.tweets > 0 ? '#3b82f6' : '#475569' }}>{twitterStats.tweets}</p>
                  <p className="text-[12px] text-slate-600 mt-2">published tweets</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#22c55e99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Replies Sent</p>
                  <p className="text-4xl font-black leading-none" style={{ color: twitterStats.replies > 0 ? '#22c55e' : '#475569' }}>{twitterStats.replies}</p>
                  <p className="text-[12px] text-slate-600 mt-2">reply tweets</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#60a5fa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Retweets</p>
                  <p className="text-4xl font-black leading-none" style={{ color: twitterStats.retweets > 0 ? '#60a5fa' : '#475569' }}>{twitterStats.retweets}</p>
                  <p className="text-[12px] text-slate-600 mt-2">retweeted posts</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#ff444499,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-4xl font-black leading-none" style={{ color: twitterStats.errors > 0 ? '#ff4444' : '#22c55e' }}>{twitterStats.errors}</p>
                  <p className="text-[12px] mt-2" style={{ color: twitterStats.errors > 0 ? '#f87171' : '#34d399' }}>
                    {twitterStats.errors === 0 ? 'Running clean' : 'API errors'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-3xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">lifetime sessions</p>
                </div>
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Last Tweet</p>
                  <p className="text-sm font-bold text-white">{twitterStats.lastTime ? formatTimeCT(twitterStats.lastTime) + ' CT' : '—'}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">{twitterStats.lastTime ? formatDateTimeCT(twitterStats.lastTime) : 'No tweets posted'}</p>
                </div>
              </div>
            </>)}

            {/* ══════════════════════════════════════════════════════
                SLACK BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'slack' && slackStats && (<>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#f59e0b99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Messages Sent</p>
                  <p className="text-4xl font-black leading-none" style={{ color: slackStats.messagesSent > 0 ? '#f59e0b' : '#475569' }}>{slackStats.messagesSent}</p>
                  <p className="text-[12px] text-slate-600 mt-2">Slack messages out</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#22c55e99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Commands Handled</p>
                  <p className="text-4xl font-black leading-none" style={{ color: slackStats.commands > 0 ? '#22c55e' : '#475569' }}>{slackStats.commands}</p>
                  <p className="text-[12px] text-slate-600 mt-2">slash commands</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#60a5fa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Channels Active</p>
                  <p className="text-4xl font-black leading-none" style={{ color: slackStats.channels > 0 ? '#60a5fa' : '#475569' }}>{slackStats.channels}</p>
                  <p className="text-[12px] text-slate-600 mt-2">channels detected</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#ff444499,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-4xl font-black leading-none" style={{ color: slackStats.errors > 0 ? '#ff4444' : '#22c55e' }}>{slackStats.errors}</p>
                  <p className="text-[12px] mt-2" style={{ color: slackStats.errors > 0 ? '#f87171' : '#34d399' }}>
                    {slackStats.errors === 0 ? 'Running clean' : 'errors detected'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-3xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">lifetime sessions</p>
                </div>
                <div className="rounded-2xl p-4" style={CARD}>
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Last Message</p>
                  <p className="text-sm font-bold text-white">{slackStats.lastTime ? formatTimeCT(slackStats.lastTime) + ' CT' : '—'}</p>
                  <p className="text-[12px] text-slate-600 mt-1.5">{slackStats.lastTime ? formatDateTimeCT(slackStats.lastTime) : 'No messages sent'}</p>
                </div>
              </div>
            </>)}

            {/* ══════════════════════════════════════════════════════
                ALERT BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'alert' && alertStats && (<>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#f59e0b99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Alerts Fired</p>
                  <p className="text-4xl font-black leading-none" style={{ color: alertStats.alertsTriggered > 0 ? '#f59e0b' : '#475569' }}>{alertStats.alertsTriggered}</p>
                  <p className="text-[12px] text-slate-600 mt-2">conditions triggered</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#60a5fa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Checks Performed</p>
                  <p className="text-4xl font-black leading-none" style={{ color: alertStats.checksPerformed > 0 ? '#60a5fa' : '#475569' }}>{alertStats.checksPerformed}</p>
                  <p className="text-[12px] text-slate-600 mt-2">price checks done</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#ff444499,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-4xl font-black leading-none" style={{ color: alertStats.errors > 0 ? '#ff4444' : '#22c55e' }}>{alertStats.errors}</p>
                  <p className="text-[12px] mt-2" style={{ color: alertStats.errors > 0 ? '#f87171' : '#34d399' }}>
                    {alertStats.errors === 0 ? 'Running clean' : 'errors detected'}
                  </p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#22c55e99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-4xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-600 mt-2">lifetime sessions</p>
                </div>
              </div>

              <div className="rounded-2xl p-4" style={CARD}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Last Alert</p>
                  {bot.status === 'RUNNING' && <span className="flex items-center gap-1 text-[12px]" style={{ color: '#f59e0b' }}><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />Monitoring</span>}
                </div>
                <p className="text-sm font-bold text-white">{alertStats.lastAlertTime ? formatDateTimeCT(alertStats.lastAlertTime) : '—'}</p>
                {!alertStats.lastAlertTime && <p className="text-[12px] text-slate-600 mt-1">No alerts triggered yet</p>}
              </div>

              {alertStats.recentAlerts.length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={CARD}>
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                    <p className="text-sm font-bold text-white">Alert History</p>
                    <span className="text-[12px] text-slate-500">last {alertStats.recentAlerts.length} alerts</span>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '260px' }}>
                    {alertStats.recentAlerts.map((a, i) => (
                      <div key={i} className="flex items-start gap-3 px-5 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[12px]" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>🔔</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-300 break-all leading-relaxed">{a.msg}</p>
                          <p className="text-[12px] text-slate-600 mt-0.5">{formatTimeCT(a.time)} CT</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* ══════════════════════════════════════════════════════
                NEWS BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'news' && newsStats && (<>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#64748b99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Articles Fetched</p>
                  <p className="text-4xl font-black leading-none" style={{ color: newsStats.articlesFetched > 0 ? '#94a3b8' : '#475569' }}>{newsStats.articlesFetched}</p>
                  <p className="text-[12px] text-slate-600 mt-2">news articles</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#22c55e99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Sources</p>
                  <p className="text-4xl font-black leading-none" style={{ color: newsStats.sources > 0 ? '#22c55e' : '#475569' }}>{newsStats.sources}</p>
                  <p className="text-[12px] text-slate-600 mt-2">news sources used</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#ff444499,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-4xl font-black leading-none" style={{ color: newsStats.errors > 0 ? '#ff4444' : '#22c55e' }}>{newsStats.errors}</p>
                  <p className="text-[12px] mt-2" style={{ color: newsStats.errors > 0 ? '#f87171' : '#34d399' }}>
                    {newsStats.errors === 0 ? 'Running clean' : 'fetch errors'}
                  </p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#60a5fa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-4xl font-black text-white leading-none">{bot.run_count}</p>
                  <p className="text-[12px] text-slate-600 mt-2">lifetime sessions</p>
                </div>
              </div>

              <div className="rounded-2xl p-4" style={CARD}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Last Fetch</p>
                  {bot.status === 'RUNNING' && <span className="flex items-center gap-1 text-[12px]" style={{ color: '#94a3b8' }}><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#94a3b8' }} />Fetching</span>}
                </div>
                <p className="text-sm font-bold text-white">{newsStats.lastFetchTime ? formatDateTimeCT(newsStats.lastFetchTime) : '—'}</p>
                {!newsStats.lastFetchTime && <p className="text-[12px] text-slate-600 mt-1">No articles fetched yet</p>}
              </div>

              {newsStats.headlines.length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={CARD}>
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                    <p className="text-sm font-bold text-white">Recent Headlines</p>
                    <span className="text-[12px] font-black px-2 py-0.5 rounded-full" style={{ color: '#94a3b8', background: 'rgba(100,116,139,0.12)' }}>
                      {newsStats.headlines.length} entries
                    </span>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
                    {newsStats.headlines.map((h, i) => (
                      <div key={i} className="flex items-start gap-3 px-5 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <span className="shrink-0 text-[12px] font-black px-1.5 py-0.5 rounded mt-0.5"
                          style={{ background: 'rgba(100,116,139,0.15)', color: '#94a3b8' }}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-300 break-all leading-relaxed">{h.text}</p>
                          <p className="text-[12px] text-slate-600 mt-0.5">{formatTimeCT(h.time)} CT</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* ══════════════════════════════════════════════════════
                SCALPING BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'scalping' && (<>

              {/* Row A: Trades Today | Avg Trade Duration | Win Rate | Total Scalps */}
              <div className="grid grid-cols-4 gap-4">
                {(() => {
                  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
                  const todayTrades = tradePairs.filter(t => new Date(t.entryTime).getTime() >= startOfDay.getTime())
                  const settled     = closedTrades
                  const winsSc      = settled.filter(t => (t.pnl ?? 0) > 0).length
                  const winRateSc   = settled.length > 0 ? Math.round((winsSc / settled.length) * 100) : null
                  // Average hold time on closed trades — proxy for scalp duration
                  let avgSec: number | null = null
                  const durations = settled
                    .filter(t => t.exitTime)
                    .map(t => (new Date(t.exitTime as string).getTime() - new Date(t.entryTime).getTime()) / 1000)
                    .filter(s => s > 0 && s < 60 * 60)
                  if (durations.length > 0) avgSec = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
                  const fmtDur = (s: number | null) => {
                    if (s == null) return '—'
                    if (s < 60) return `${s}s`
                    const m = Math.floor(s / 60); const r = s % 60
                    return `${m}m ${r}s`
                  }
                  return (<>
                    <div className="rounded-2xl p-5" style={CARD}>
                      <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Trades Today</p>
                      <p className="text-4xl font-black leading-none" style={{ color: todayTrades.length > 0 ? '#ec4899' : '#475569' }}>{todayTrades.length}</p>
                      <p className="text-[12px] text-slate-500 mt-2">scalps executed today</p>
                    </div>
                    <div className="rounded-2xl p-5" style={CARD}>
                      <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Avg Trade Duration</p>
                      <p className="text-3xl font-black font-mono leading-none" style={{ color: avgSec != null ? '#ec4899' : '#475569' }}>{fmtDur(avgSec)}</p>
                      <p className="text-[12px] text-slate-500 mt-2">{durations.length > 0 ? `over ${durations.length} settled scalps` : 'awaiting settled trades'}</p>
                    </div>
                    <div className="rounded-2xl p-5" style={CARD}>
                      <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Win Rate</p>
                      <p className="text-4xl font-black leading-none"
                        style={{ color: winRateSc == null ? '#475569' : winRateSc >= 60 ? '#22c55e' : winRateSc >= 45 ? '#f59e0b' : '#ff4444' }}>
                        {winRateSc == null ? '—' : `${winRateSc}%`}
                      </p>
                      {winRateSc != null && (
                        <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${winRateSc}%`, background: winRateSc >= 60 ? '#22c55e' : winRateSc >= 45 ? '#f59e0b' : '#ff4444' }} />
                        </div>
                      )}
                      <p className="text-[12px] text-slate-600 mt-1">{winsSc}W / {settled.length - winsSc}L</p>
                    </div>
                    <div className="rounded-2xl p-5" style={CARD}>
                      <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Scalps</p>
                      <p className="text-4xl font-black text-white leading-none">{tradePairs.length}</p>
                      <p className="text-[12px] text-slate-500 mt-2">all-time executions</p>
                    </div>
                  </>)
                })()}
              </div>

              {/* Row B: Current Momentum | P&L Summary */}
              <div className="grid grid-cols-2 gap-4">
                {(() => {
                  const recent = closedTrades.slice(-10)
                  const recentPnl = recent.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
                  const momentumLabel = recent.length === 0 ? 'NEUTRAL'
                    : recentPnl > 0 ? 'BULLISH'
                    : recentPnl < 0 ? 'BEARISH' : 'NEUTRAL'
                  const momentumColor = momentumLabel === 'BULLISH' ? '#22c55e'
                    : momentumLabel === 'BEARISH' ? '#ff4444' : '#475569'
                  return (
                    <div className="rounded-2xl p-5" style={CARD}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Current Momentum</p>
                        {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: momentumColor }} />}
                      </div>
                      <p className="text-2xl font-black leading-none" style={{ color: momentumColor }}>{momentumLabel}</p>
                      <p className="text-[12px] text-slate-600 mt-2">
                        {recent.length === 0 ? 'no settled scalps yet' : `last ${recent.length} settled · ${recentPnl >= 0 ? '+' : ''}$${recentPnl.toFixed(2)}`}
                      </p>
                    </div>
                  )
                })()}
                {(() => {
                  const totalPnlSc = closedTrades.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
                  const winsArr   = closedTrades.filter(t => (t.pnl ?? 0) > 0)
                  const lossesArr = closedTrades.filter(t => (t.pnl ?? 0) < 0)
                  const totalWin  = winsArr.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
                  const totalLoss = lossesArr.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
                  return (
                    <div className="rounded-2xl p-5" style={CARD}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest">P&L Summary</p>
                        {bot.status === 'RUNNING' && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: totalPnlSc >= 0 ? '#22c55e' : '#ff4444' }} />}
                      </div>
                      <p className="text-3xl font-black font-mono leading-none tabular-nums"
                        style={{ color: closedTrades.length === 0 ? '#475569' : totalPnlSc >= 0 ? '#22c55e' : '#ff4444' }}>
                        {closedTrades.length === 0 ? '$0.00' : `${totalPnlSc >= 0 ? '+' : '-'}$${Math.abs(totalPnlSc).toFixed(2)}`}
                      </p>
                      <div className="flex justify-between mt-3 text-[12px]">
                        <span style={{ color: '#22c55e' }}>+${totalWin.toFixed(2)} wins</span>
                        <span style={{ color: '#ff4444' }}>${totalLoss.toFixed(2)} losses</span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Row C: Recent Scalps */}
              <div className="rounded-2xl overflow-hidden" style={CARD}>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                  <p className="text-sm font-bold text-white">Recent Scalps</p>
                  {bot.status === 'RUNNING' && (
                    <span className="flex items-center gap-1 text-[12px]" style={{ color: '#ec4899' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899] animate-pulse" />Live
                    </span>
                  )}
                </div>
                {tradePairs.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-slate-600 text-sm">No scalps recorded yet — run the bot to start trading</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto" style={{ maxHeight: '280px' }}>
                    {[...tradePairs].reverse().slice(0, 12).map(t => {
                      const pnlCol    = t.pnl == null ? '#94a3b8' : t.pnl > 0 ? '#22c55e' : t.pnl < 0 ? '#ff4444' : '#94a3b8'
                      const sideColor = (t.side === 'BUY' || t.side === 'LONG' || t.side === 'YES') ? '#22c55e' : '#ff4444'
                      return (
                        <div key={t.key} className="flex items-center gap-3 px-5 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.02]">
                          <span className="shrink-0 text-[12px] font-black w-12 text-center px-1.5 py-0.5 rounded" style={{ background: `${sideColor}1f`, color: sideColor }}>{t.side}</span>
                          <span className="flex-1 text-xs font-mono text-slate-300">x{t.contracts} @ {t.entryPrice}c</span>
                          <span className="text-[12px] font-mono text-slate-600">{formatTimeCT(t.entryTime)}</span>
                          <span className="shrink-0 text-xs font-black font-mono tabular-nums w-20 text-right" style={{ color: pnlCol }}>
                            {t.pnl == null ? '—' : `${t.pnl >= 0 ? '+' : '-'}$${Math.abs(t.pnl).toFixed(2)}`}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>)}

            {/* ══════════════════════════════════════════════════════
                GENERIC BOT DASHBOARD
            ══════════════════════════════════════════════════════ */}
            {botType === 'generic' && (<>

              {/* Row A: 4 key metrics */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#00f5ff99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Total Runs</p>
                  <p className="text-4xl font-black text-white leading-none">{bot.run_count}</p>
                  <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (bot.run_count / 50) * 100)}%`, background: 'var(--accent)' }} />
                  </div>
                  <p className="text-[12px] text-slate-600 mt-1.5">lifetime executions</p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
                    style={{ background: errorCount > 0 ? 'linear-gradient(90deg,#ff444499,transparent)' : 'linear-gradient(90deg,#22c55e99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Error Count</p>
                  <p className="text-4xl font-black leading-none" style={{ color: errorCount > 0 ? '#ff4444' : '#22c55e' }}>{errorCount}</p>
                  <p className="text-[12px] mt-2" style={{ color: errorCount > 0 ? '#f87171' : '#34d399' }}>
                    {errorCount === 0 ? 'Running clean' : `${errorCount} error${errorCount !== 1 ? 's' : ''} found`}
                  </p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#a78bfa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Log Entries</p>
                  <p className="text-4xl font-black text-white leading-none">{sortedAllLogs.length}</p>
                  <p className="text-[12px] text-slate-600 mt-2">
                    {sortedAllLogs.filter(l => l.level === 'WARNING').length} warning{sortedAllLogs.filter(l => l.level === 'WARNING').length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#60a5fa99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Last Run</p>
                  <p className="text-sm font-bold text-white leading-snug">
                    {bot.last_run_at ? formatTimeCT(bot.last_run_at) + ' CT' : '—'}
                  </p>
                  <p className="text-[12px] text-slate-600 mt-1.5">
                    {bot.last_run_at ? formatDateTimeCT(bot.last_run_at) : 'Never started'}
                  </p>
                </div>
              </div>

              {/* Row B: Bot info summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#34d39999,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Bot Status</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: st.bg, border: `1px solid ${st.color}33` }}>
                      <span className={`w-3 h-3 rounded-full${st.pulse ? ' animate-pulse' : ''}`}
                        style={{ background: st.color, boxShadow: st.glow }} />
                    </div>
                    <div>
                      <p className="text-lg font-black" style={{ color: st.color }}>{st.label}</p>
                      <p className="text-[12px] text-slate-600 mt-0.5">
                        {conns.length} API connection{conns.length !== 1 ? 's' : ''} configured
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl p-4 overflow-hidden relative" style={CARD}>
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#f59e0b99,transparent)' }} />
                  <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">Session Info</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-[12px] text-slate-600">Schedule</span>
                      <span className="text-[12px] font-bold text-slate-300">{bot.schedule_type === 'custom' ? `${bot.schedule_start} – ${bot.schedule_end}` : 'Always On'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[12px] text-slate-600">Auto-Restart</span>
                      <span className="text-[12px] font-bold" style={{ color: bot.auto_restart ? '#22c55e' : '#475569' }}>{bot.auto_restart ? '✓ On' : '✗ Off'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[12px] text-slate-600">Uptime</span>
                      <span className="text-[12px] font-bold text-white font-mono">{sessionStart ? formatDuration(sessionElapsed) : '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>)}


            {/* ══════════════════════════════════════════════════════
                UNIVERSAL — Bot Functions (defs detected in code)
            ══════════════════════════════════════════════════════ */}
            {(() => {
              const fns = extractFunctions(bot.code)
              if (fns.length === 0) return null
              return (
                <div className="rounded-2xl overflow-hidden" style={CARD}>
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2.5">
                      <p className="text-sm font-bold text-white">Bot Functions</p>
                      <span className="text-[12px] font-black px-2 py-0.5 rounded-full"
                        style={{ color: 'var(--accent)', background: 'rgba(0,245,255,0.1)' }}>
                        {fns.length}
                      </span>
                    </div>
                    <span className="text-[12px] text-slate-600 font-mono">detected in code</span>
                  </div>
                  <div className="p-3 grid grid-cols-2 gap-1.5">
                    {fns.map((fn, i) => (
                      <div key={i} className="px-3 py-2.5 rounded-xl transition-colors"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10.8px] font-mono" style={{ color: '#00f5ff88' }}>def</span>
                          <span className="text-xs font-bold font-mono text-white truncate">{fn.name}</span>
                        </div>
                        {fn.docstring && (
                          <p className="text-[10.8px] text-slate-500 truncate leading-relaxed">{fn.docstring}</p>
                        )}
                        <p className="text-[10.8px] font-mono text-slate-700 mt-0.5">
                          line {fn.line}
                          {fn.args
                            ? ` · ${fn.args.split(',').filter(Boolean).length} arg${fn.args.split(',').filter(Boolean).length !== 1 ? 's' : ''}`
                            : ' · no args'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* ══════════════════════════════════════════════════════
                UNIVERSAL — Live Telemetry (parsed from log output)
            ══════════════════════════════════════════════════════ */}
            {(() => {
              const metrics = parseLiveTelemetry(sortedAllLogs)
              if (metrics.length === 0) return null
              return (
                <div className="rounded-2xl p-5" style={CARD}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-white">Live Telemetry</p>
                      {bot.status === 'RUNNING' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      )}
                    </div>
                    <span className="text-[12px] text-slate-600 font-mono">auto-parsed · {metrics.length} signal{metrics.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {metrics.map(m => (
                      <div key={m.key} className="rounded-xl px-3 py-2.5"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <p className="text-[10.8px] font-black text-slate-600 uppercase tracking-widest truncate">{m.key}</p>
                        <p className="text-sm font-black font-mono text-white mt-1 tabular-nums truncate">
                          {m.prefix}{m.value}{m.suffix}
                        </p>
                        <p className="text-[10.8px] text-slate-700 mt-0.5 font-mono">
                          {formatTimeCT(m.ts)} CT
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

          </div>{/* end right panel */}
        </div>{/* end split layout */}
        </div>{/* end center 100% */}
      </div>{/* end row */}

      {/* ════════════════════════════════════════════════════════════
          BOT SETTINGS MODAL
      ════════════════════════════════════════════════════════════ */}
      {settingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget) setSettingsModal(false) }}>
          <div className="absolute inset-0 bg-black/80" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative w-full max-w-xl rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            style={{ background: 'rgba(6,9,20,0.98)', border: '1px solid var(--border)', backdropFilter: 'blur(30px)', maxHeight: '90vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-white/[0.07] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#fbbf24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Bot Settings</h2>
                  <p className="text-xs text-slate-500">{bot.name}</p>
                </div>
              </div>
              <button onClick={() => setSettingsModal(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                style={{ border: '1px solid var(--border)' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-7 py-6 space-y-8">

              {/* ── Code Parameters section ── */}
              {botParams.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                    style={{ background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.15)' }}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#00f5ff" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </div>
                  <p className="text-sm font-bold text-slate-300 mb-1">No code parameters found</p>
                  <p className="text-xs text-slate-600 max-w-xs leading-relaxed">
                    Use <code className="text-slate-400">os.getenv("VAR", "default")</code> or top-level <code className="text-slate-400">VAR = value</code> in your bot code — they will appear here automatically.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Code Parameters</span>
                    <span className="text-[12px] text-slate-700 font-mono">· {botParams.length} detected</span>
                  </div>
                  <div className="space-y-5">
                    {groupParams(botParams).map(group => {
                      const meta = SECTION_META[group.section] ?? SECTION_META['General']
                      return (
                        <div key={group.section} className="rounded-2xl overflow-hidden"
                          style={{ border: `1px solid ${meta.color}22`, background: meta.bg }}>
                          {/* Group header */}
                          <div className="flex items-center gap-2 px-4 py-2.5 border-b"
                            style={{ borderColor: `${meta.color}18` }}>
                            <span className="text-sm">{meta.icon}</span>
                            <span className="text-xs font-black uppercase tracking-widest"
                              style={{ color: meta.color }}>{group.section}</span>
                            <span className="text-[12px] text-slate-700 font-mono ml-auto">{group.params.length} var{group.params.length !== 1 ? 's' : ''}</span>
                          </div>
                          {/* Group params */}
                          <div className="px-4 py-3 space-y-3">
                            {group.params.map(p => {
                              const idx = botParams.findIndex(x => x.name === p.name)
                              const update = (val: string) => {
                                const next = [...botParams]
                                next[idx] = { ...botParams[idx], value: val }
                                setBotParams(next)
                              }
                              return (
                                <div key={p.name} className="flex items-center gap-3">
                                  {/* Label */}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-slate-300 truncate">{p.label}</p>
                                    <p className="text-[12px] font-mono text-slate-600 truncate">{p.name}</p>
                                  </div>
                                  {/* Input — varies by type */}
                                  {p.type === 'boolean' ? (
                                    /* Toggle */
                                    <button
                                      onClick={() => update(p.value === 'True' ? 'False' : 'True')}
                                      className="relative shrink-0 w-11 h-6 rounded-full transition-colors"
                                      style={{
                                        background: p.value === 'True' ? meta.color : 'rgba(255,255,255,0.08)',
                                        border: `1px solid ${p.value === 'True' ? meta.color : 'rgba(255,255,255,0.12)'}`,
                                      }}>
                                      <span className="absolute top-0.5 transition-all rounded-full w-5 h-5 shadow"
                                        style={{
                                          left: p.value === 'True' ? 'calc(100% - 22px)' : '1px',
                                          background: p.value === 'True' ? '#05070f' : '#475569',
                                        }} />
                                    </button>
                                  ) : (p.type === 'integer' || p.type === 'float') ? (
                                    /* Stepper */
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => {
                                          const step = getStep(p.type, p.value)
                                          const n = parseFloat(p.value) || 0
                                          update(p.type === 'integer' ? String(Math.round(n - step)) : parseFloat((n - step).toFixed(6)).toString())
                                        }}
                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition-colors font-bold text-sm"
                                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }}>−</button>
                                      <input
                                        type="number"
                                        value={p.value}
                                        step={getStep(p.type, p.value)}
                                        onChange={e => update(e.target.value)}
                                        className="w-20 text-center rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none tabular-nums"
                                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }}
                                        onFocus={e => (e.target.style.borderColor = meta.color + '88')}
                                        onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                                      <button
                                        onClick={() => {
                                          const step = getStep(p.type, p.value)
                                          const n = parseFloat(p.value) || 0
                                          update(p.type === 'integer' ? String(Math.round(n + step)) : parseFloat((n + step).toFixed(6)).toString())
                                        }}
                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition-colors font-bold text-sm"
                                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }}>+</button>
                                    </div>
                                  ) : (
                                    /* Text / URL */
                                    <input
                                      type={p.type === 'url' ? 'url' : 'text'}
                                      value={p.value}
                                      onChange={e => update(e.target.value)}
                                      placeholder={p.type === 'url' ? 'https://...' : p.label}
                                      className="w-48 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none transition-colors shrink-0"
                                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }}
                                      onFocus={e => (e.target.style.borderColor = meta.color + '88')}
                                      onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-[12px] text-slate-700 mt-3">Values are written into the bot code and take effect on the next run.</p>
                </div>
              )}

              {/* ── Platform Settings ── */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[12px] font-black text-slate-500 uppercase tracking-widest">Platform Settings</span>
                </div>

                {/* Schedule */}
                <div className="rounded-2xl overflow-hidden mb-4"
                  style={{ border: '1px solid rgba(99,102,241,0.22)', background: 'rgba(99,102,241,0.06)' }}>
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'rgba(99,102,241,0.15)' }}>
                    <span className="text-sm">⏱️</span>
                    <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#6366f1' }}>Run Schedule</span>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <div className="flex gap-2">
                      {(['always', 'custom'] as const).map(t => (
                        <button key={t} onClick={() => setScheduleType(t)}
                          className="flex-1 py-2 rounded-xl text-xs font-bold transition-all capitalize"
                          style={scheduleType === t
                            ? { background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.4)' }
                            : { background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                          {t === 'always' ? '🔄 Always On' : '🕐 Custom Hours'}
                        </button>
                      ))}
                    </div>
                    {scheduleType === 'custom' && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <p className="text-[12px] text-slate-600 mb-1">Start</p>
                          <input type="time" value={scheduleStart} onChange={e => setScheduleStart(e.target.value)}
                            className="w-full rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', colorScheme: 'dark' }} />
                        </div>
                        <div className="text-slate-600 text-xs mt-4">→</div>
                        <div className="flex-1">
                          <p className="text-[12px] text-slate-600 mb-1">End</p>
                          <input type="time" value={scheduleEnd} onChange={e => setScheduleEnd(e.target.value)}
                            className="w-full rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', colorScheme: 'dark' }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Risk Management */}
                <div className="rounded-2xl overflow-hidden mb-4"
                  style={{ border: '1px solid rgba(245,158,11,0.22)', background: 'rgba(245,158,11,0.05)' }}>
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'rgba(245,158,11,0.15)' }}>
                    <span className="text-sm">🛡️</span>
                    <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#f59e0b' }}>Risk Management</span>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    {[
                      { label: 'Max Amount / Trade ($)', val: maxAmount,    set: setMaxAmount,    hint: 'Leave blank for no limit' },
                      { label: 'Max Contracts / Trade', val: maxContracts,  set: setMaxContracts, hint: 'Leave blank for no limit' },
                      { label: 'Max Daily Loss ($)',     val: maxLoss,       set: setMaxLoss,      hint: 'Leave blank for no limit' },
                    ].map(row => (
                      <div key={row.label} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-300">{row.label}</p>
                          <p className="text-[12px] text-slate-600">{row.hint}</p>
                        </div>
                        <input
                          type="number" min="0" value={row.val}
                          onChange={e => row.set(e.target.value)}
                          placeholder="—"
                          className="w-28 rounded-xl px-3 py-1.5 text-xs text-white text-right placeholder-slate-600 focus:outline-none shrink-0"
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }}
                          onFocus={e => (e.target.style.borderColor = 'rgba(245,158,11,0.5)')}
                          onBlur={e  => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Auto Restart */}
                <div className="rounded-2xl overflow-hidden"
                  style={{ border: '1px solid rgba(248,113,113,0.22)', background: 'rgba(248,113,113,0.05)' }}>
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'rgba(248,113,113,0.15)' }}>
                    <span className="text-sm">⚡</span>
                    <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#f87171' }}>Behaviour</span>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-slate-300">Auto-restart on crash</p>
                        <p className="text-[12px] text-slate-600">Automatically restart bot if it exits with an error</p>
                      </div>
                      <button
                        onClick={() => setAutoRestart(v => !v)}
                        className="relative shrink-0 w-11 h-6 rounded-full transition-colors"
                        style={{
                          background: autoRestart ? '#f87171' : 'rgba(255,255,255,0.08)',
                          border: `1px solid ${autoRestart ? '#f87171' : 'rgba(255,255,255,0.12)'}`,
                        }}>
                        <span className="absolute top-0.5 transition-all rounded-full w-5 h-5 shadow"
                          style={{
                            left: autoRestart ? 'calc(100% - 22px)' : '1px',
                            background: autoRestart ? '#05070f' : '#475569',
                          }} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-7 py-5 border-t border-white/[0.06] shrink-0">
              {settingsErr && (
                <p className="text-xs text-red-400 mb-3 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">{settingsErr}</p>
              )}
              <div className="flex justify-end gap-3">
              <button onClick={() => { setSettingsModal(false); setSettingsErr('') }}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 transition-colors hover:text-white">
                Cancel
              </button>
              <button onClick={saveSettings} disabled={settingsSaving || settingsSaved}
                className="px-7 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                style={{ background: settingsSaved ? 'rgba(34,197,94,0.15)' : '#fbbf24', color: settingsSaved ? '#22c55e' : '#05070f', boxShadow: settingsSaving || settingsSaved ? 'none' : '0 0 18px rgba(245,158,11,0.3)' }}>
                {settingsSaving ? (
                  <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving…</>
                ) : settingsSaved ? (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg> Saved!</>
                ) : 'Save Settings'}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          EDIT CODE MODAL
      ════════════════════════════════════════════════════════════ */}
      {codeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget) setCodeModal(false) }}>
          <div className="absolute inset-0 bg-black/80" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            style={{ background: 'rgba(6,9,20,0.98)', border: '1px solid var(--border)', backdropFilter: 'blur(30px)', maxHeight: '90vh' }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-white/[0.07] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}>
                  <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: '#818cf8' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Edit Code</h2>
                  <p className="text-xs text-slate-500">{bot.name}</p>
                </div>
              </div>
              <button onClick={() => setCodeModal(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                style={{ border: '1px solid var(--border)' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Name + desc fields */}
            <div className="px-7 py-4 border-b border-white/[0.05] shrink-0 flex gap-4">
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Bot name"
                className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                onFocus={e => (e.target.style.borderColor='var(--accent)')}
                onBlur={e => (e.target.style.borderColor='rgba(255,255,255,0.1)')} />
              <input value={desc} onChange={e => setDesc(e.target.value)}
                placeholder="Description (optional)"
                className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                onFocus={e => (e.target.style.borderColor='var(--accent)')}
                onBlur={e => (e.target.style.borderColor='rgba(255,255,255,0.1)')} />
            </div>

            {/* Code editor */}
            <textarea value={code} onChange={e => setCode(e.target.value)} spellCheck={false}
              className="flex-1 p-6 text-xs font-mono resize-none focus:outline-none leading-relaxed"
              style={{ background: 'rgba(0,0,0,0.6)', color: 'var(--accent)', minHeight: '400px' }} />

            {/* Save button */}
            <div className="px-7 py-5 border-t border-white/[0.06] shrink-0">
              {saveCodeErr && (
                <p className="text-xs text-red-400 mb-3 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">{saveCodeErr}</p>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={() => { setCodeModal(false); setSaveCodeErr('') }}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 transition-colors hover:text-white">
                  Cancel
                </button>
                <button onClick={async () => { await saveCode() }} disabled={saving}
                  className="px-7 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: 'var(--bg)', boxShadow: '0 0 18px rgba(0,245,255,0.25)' }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          API KEYS MODAL
      ════════════════════════════════════════════════════════════ */}
      {keyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget) setKeyModal(false) }}>
          <div className="absolute inset-0 bg-black/80" style={{ backdropFilter:'blur(8px)' }} />
          <div className="relative w-full max-w-lg rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            style={{ background: 'var(--card)', border:'1px solid var(--border)', backdropFilter:'blur(30px)', maxHeight:'88vh' }}>

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-white/[0.07] shrink-0">
              <div className="flex items-center gap-3">
                {keyView === 'form' && (
                  <button onClick={() => setKeyView('list')}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                    style={{ border:'1px solid var(--border)' }}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background:'rgba(0,245,255,0.1)', border:'1px solid var(--border)' }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#00f5ff" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    {keyView === 'list' ? 'API Keys' : editingConn ? 'Edit API Key' : 'Add API Key'}
                  </h2>
                  <p className="text-xs text-slate-500">{bot.name}</p>
                </div>
              </div>
              <button onClick={() => setKeyModal(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                style={{ border:'1px solid var(--border)' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* ══════════════════════════════════════
                LIST VIEW
            ══════════════════════════════════════ */}
            {keyView === 'list' && (() => {
              const missing = unconfiguredApis(detectedApis, conns.map(c => c.name))
              return (
              <div className="flex-1 overflow-y-auto">

                {keyErr && (
                  <p className="text-xs text-red-400 mx-6 mt-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">{keyErr}</p>
                )}

                {/* ── Smart detection section ── */}
                {detectedApis.length > 0 && (
                  <div className="px-6 pt-5 pb-3">
                    {/* Section header */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center"
                        style={{ background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.25)' }}>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#00f5ff" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                        </svg>
                      </div>
                      <span className="text-[12px] font-black uppercase tracking-widest text-slate-400">Detected in your code</span>
                      <span className="ml-auto text-[12px] font-mono"
                        style={{ color: missing.length > 0 ? '#ef4444' : '#22c55e' }}>
                        {missing.length > 0 ? `${missing.length} key${missing.length !== 1 ? 's' : ''} needed` : '✓ All configured'}
                      </span>
                    </div>

                    {/* Detected API cards */}
                    <div className="space-y-2">
                      {detectedApis.map(api => {
                        const configured = conns.some(c => c.name.toLowerCase() === api.name.toLowerCase())
                        return (
                          <div key={api.name}
                            className="flex items-center gap-3 px-3.5 py-3 rounded-2xl transition-colors"
                            style={{
                              background: configured ? 'rgba(34,197,94,0.05)' : `${api.color}0d`,
                              border: `1px solid ${configured ? 'rgba(34,197,94,0.2)' : api.color + '28'}`,
                            }}>
                            {/* Icon */}
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
                              style={{ background: `${api.color}15`, border: `1px solid ${api.color}30` }}>
                              {api.icon}
                            </div>
                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-white truncate">{api.name}</p>
                              <p className="text-[12px] truncate mt-0.5" style={{ color: `${api.color}99` }}>
                                {api.description}
                              </p>
                            </div>
                            {/* Status / Action */}
                            {configured ? (
                              <span className="shrink-0 flex items-center gap-1 text-[12px] font-black text-emerald-400 px-2.5 py-1 rounded-lg"
                                style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                                </svg>
                                Set
                              </span>
                            ) : (
                              <button onClick={() => openAddForm(api)}
                                className="shrink-0 flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl transition-all hover:opacity-90"
                                style={{ background: `${api.color}18`, color: api.color, border: `1px solid ${api.color}40` }}>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                                </svg>
                                Add Key
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ── Divider + manual add ── */}
                <div className="px-6 py-3 border-t border-b border-white/[0.05]">
                  <button onClick={() => openAddForm()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold w-full justify-center transition-all hover:opacity-90"
                    style={{ background:'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add Custom API Key
                  </button>
                </div>

                {/* ── Existing connections list ── */}
                {conns.length === 0 ? (
                  detectedApis.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-14 px-7 text-center">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                        style={{ background:'rgba(255,255,255,0.03)', border:'1px dashed rgba(255,255,255,0.1)' }}>
                        <svg className="w-6 h-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                      </div>
                      <p className="text-slate-400 font-bold text-sm">No API keys yet</p>
                      <p className="text-slate-600 text-xs mt-1 max-w-xs">Add <code className="text-slate-500">os.getenv("SERVICE_API_KEY")</code> to your bot code and keys will be auto-detected here.</p>
                    </div>
                  )
                ) : (
                  <div>
                    <p className="text-[12px] font-black uppercase tracking-widest text-slate-600 px-6 pt-4 pb-2">Configured Keys</p>
                    <div className="divide-y divide-white/[0.04]">
                      {conns.map(c => (
                        <div key={c.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-white/[0.02] transition-colors">
                          {/* Icon */}
                          {(() => {
                            const det = detectedApis.find(d => d.name.toLowerCase() === c.name.toLowerCase())
                            return det ? (
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
                                style={{ background: `${det.color}15`, border: `1px solid ${det.color}30` }}>
                                {det.icon}
                              </div>
                            ) : (
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                                style={{ background:'var(--accent-dim)', border:'1px solid var(--border)' }}>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#00f5ff" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round"
                                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                </svg>
                              </div>
                            )
                          })()}
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white truncate">{c.name}</p>
                            {c.base_url && (
                              <p className="text-[12px] text-slate-500 truncate mt-0.5 font-mono">{c.base_url}</p>
                            )}
                            {c.api_key && (
                              <p className="text-[12px] font-mono text-slate-600 mt-0.5">
                                Key: {c.api_key.slice(0, 6)}{'•'.repeat(8)}
                              </p>
                            )}
                          </div>
                          {/* Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => openEditForm(c)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                              style={{ background:'rgba(99,102,241,0.1)', color:'#818cf8', border:'1px solid rgba(99,102,241,0.25)' }}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round"
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              Edit
                            </button>
                            <button onClick={() => removeKey(c.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                              style={{ background:'rgba(255,68,68,0.08)', color:'#ff4444', border:'1px solid rgba(255,68,68,0.2)' }}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )})()}

            {/* ══════════════════════════════════════
                ADD / EDIT FORM VIEW
            ══════════════════════════════════════ */}
            {keyView === 'form' && (() => {
              const matchedDet = detectedApis.find(d => d.name === kName)
              return (
              <div className="flex-1 overflow-y-auto px-7 py-6 space-y-4">

                {/* Detected API banner */}
                {matchedDet && !editingConn && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                    style={{ background: `${matchedDet.color}10`, border: `1px solid ${matchedDet.color}30` }}>
                    <span className="text-xl">{matchedDet.icon}</span>
                    <div>
                      <p className="text-xs font-bold" style={{ color: matchedDet.color }}>{matchedDet.name}</p>
                      <p className="text-[12px] text-slate-500">{matchedDet.description} · detected in your bot code</p>
                    </div>
                  </div>
                )}

                {/* Connection Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Connection Name <span style={{ color:'#ff4444' }}>*</span>
                  </label>
                  <input value={kName} onChange={e => setKName(e.target.value)}
                    placeholder="e.g. Kalshi API"
                    className="w-full rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none"
                    style={{ background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)' }}
                    onFocus={e=>(e.target.style.borderColor='rgba(0,245,255,0.5)')}
                    onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.1)')} />
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Base URL</label>
                  <input value={kUrl} onChange={e => setKUrl(e.target.value)}
                    className="w-full rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none"
                    style={{ background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)' }}
                    onFocus={e=>(e.target.style.borderColor='rgba(0,245,255,0.5)')}
                    onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.1)')} />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    API Key
                    {editingConn?.api_key && (
                      <span className="ml-2 font-mono text-[12px] text-slate-600 normal-case">
                        current: {editingConn.api_key.slice(0,6)}••••••••
                      </span>
                    )}
                  </label>
                  <input value={kKey} onChange={e => setKKey(e.target.value)}
                    className="w-full rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none"
                    style={{ background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)' }}
                    onFocus={e=>(e.target.style.borderColor='rgba(0,245,255,0.5)')}
                    onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.1)')} />
                  {editingConn?.api_key && !kKey && (
                    <p className="text-[12px] text-slate-600 mt-1">Leave blank to keep existing key unchanged</p>
                  )}
                </div>

                {/* API Secret */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    API Secret
                    {editingConn && (
                      <span className="ml-2 font-mono text-[12px] text-slate-600 normal-case">leave blank to keep unchanged</span>
                    )}
                  </label>
                  <div className="relative">
                    <input type={kShowSec?'text':'password'} value={kSecret} onChange={e => setKSecret(e.target.value)}
                      className="w-full rounded-xl px-4 py-3.5 pr-12 text-sm text-white focus:outline-none"
                      style={{ background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)' }}
                      onFocus={e=>(e.target.style.borderColor='rgba(0,245,255,0.5)')}
                      onBlur={e=>(e.target.style.borderColor='rgba(255,255,255,0.1)')} />
                    <button type="button" onClick={() => setKShowSec(s=>!s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        {kShowSec
                          ? <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          : <><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                        }
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Env var hint */}
                {kName && (
                  <p className="text-xs font-mono" style={{ color:'rgba(0,245,255,0.5)' }}>
                    Env: <span style={{ color:'rgba(0,245,255,0.8)' }}>{kName.replace(/[^A-Z0-9]+/gi,'_').toUpperCase()}_KEY</span>
                  </p>
                )}

                {/* Error */}
                {keyErr && (
                  <p className="text-xs text-red-400 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 mt-1">{keyErr}</p>
                )}

                {/* Save button */}
                <button onClick={saveKey} disabled={!kName.trim() || kSaving}
                  className="w-full py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-40 mt-2"
                  style={{ background: matchedDet ? matchedDet.color : '#00f5ff', color: 'var(--bg)', boxShadow:`0 0 20px ${matchedDet ? matchedDet.color + '40' : 'rgba(0,245,255,0.2)'}` }}>
                  {kSaving ? 'Saving…' : editingConn ? 'Update Key' : `Add ${kName || 'Key'}`}
                </button>
              </div>
            )
            })()}

          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          API REVIEW MODAL  — shown when saving code that references APIs
      ════════════════════════════════════════════════════════════ */}
      {apiReviewModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget) setApiReviewModal(false) }}>
          <div className="absolute inset-0 bg-black/85" style={{ backdropFilter: 'blur(12px)' }} />
          <div className="relative w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            style={{ background: 'rgba(6,9,20,0.99)', border: '1px solid var(--border)', backdropFilter: 'blur(30px)', maxHeight: '90vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-white/[0.07] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
                  style={{ background: 'rgba(0,245,255,0.1)', border: '1px solid var(--border)' }}>
                  🔍
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">APIs Detected — Review Before Saving</h2>
                  <p className="text-xs text-slate-500">
                    {reviewApis.length} API{reviewApis.length !== 1 ? 's' : ''} found in your code · Fill in credentials or leave blank to skip
                  </p>
                </div>
              </div>
              <button onClick={() => setApiReviewModal(false)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                style={{ border: '1px solid var(--border)' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* API card list — one card per detected API, fully dynamic */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
              {reviewApis.map((entry, idx) => (
                <div key={entry.id} className="rounded-2xl overflow-hidden"
                  style={{ border: `1px solid ${entry.color}28`, background: `${entry.color}05` }}>

                  {/* ── Card header: icon + name + badges ─────────────────── */}
                  <div className="flex items-start gap-3 px-5 pt-4 pb-3">
                    {/* Icon */}
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 mt-0.5"
                      style={{ background: `${entry.color}12`, border: `1px solid ${entry.color}25` }}>
                      {entry.icon}
                    </div>

                    {/* Name + variable tag */}
                    <div className="flex-1 min-w-0">
                      {/* Editable API name */}
                      <input
                        value={entry.name}
                        onChange={e => {
                          const val = e.target.value
                          setReviewApis(prev => prev.map((r, i) => i === idx ? { ...r, name: val } : r))
                        }}
                        className="bg-transparent text-sm font-bold text-white focus:outline-none w-full leading-tight"
                        style={{ caretColor: entry.color }}
                      />
                      {/* Variable name tag — read-only, exact from code */}
                      {entry.variableName && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10.8px] font-bold uppercase tracking-wider text-slate-600">Variable</span>
                          <code className="text-[12px] font-mono px-2 py-0.5 rounded-md select-all"
                            style={{ background: 'rgba(255,255,255,0.05)', color: `${entry.color}cc`, border: `1px solid ${entry.color}20` }}>
                            {entry.variableName}
                          </code>
                        </div>
                      )}
                    </div>

                    {/* Status badges */}
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {entry.alreadyConfigured && (
                        <span className="text-[10.8px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.22)' }}>
                          ✓ Saved
                        </span>
                      )}
                      {entry.isPublic && (
                        <span className="text-[10.8px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: 'rgba(148,163,184,0.08)', color: 'var(--text-muted)', border: '1px solid rgba(148,163,184,0.18)' }}>
                          Public
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Card fields ────────────────────────────────────────── */}
                  <div className="px-5 pb-4 space-y-3">
                    {/* Base URL */}
                    <div>
                      <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                        Base URL
                      </label>
                      <input
                        value={entry.baseUrl}
                        onChange={e => {
                          const val = e.target.value
                          setReviewApis(prev => prev.map((r, i) => i === idx ? { ...r, baseUrl: val } : r))
                        }}
                        className="w-full rounded-xl px-3.5 py-2.5 text-xs text-slate-300 focus:outline-none font-mono"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                        onFocus={e => (e.target.style.borderColor = `${entry.color}50`)}
                        onBlur={e =>  (e.target.style.borderColor = 'rgba(255,255,255,0.07)')}
                      />
                    </div>

                    {/* Key + Secret — only for APIs that need credentials */}
                    {!entry.isPublic && (
                      <div className={`grid gap-3 ${entry.needsSecret ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {/* API Key */}
                        <div>
                          <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                            API Key
                          </label>
                          <input
                            type="password"
                            autoComplete="off"
                            value={entry.apiKey}
                            onChange={e => {
                              const val = e.target.value
                              setReviewApis(prev => prev.map((r, i) => i === idx ? { ...r, apiKey: val } : r))
                            }}
                            className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                            onFocus={e => (e.target.style.borderColor = `${entry.color}50`)}
                            onBlur={e =>  (e.target.style.borderColor = 'rgba(255,255,255,0.07)')}
                          />
                        </div>
                        {/* API Secret — only when needsSecret */}
                        {entry.needsSecret && (
                          <div>
                            <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                              API Secret
                            </label>
                            <input
                              type="password"
                              autoComplete="off"
                              value={entry.apiSecret}
                              onChange={e => {
                                const val = e.target.value
                                setReviewApis(prev => prev.map((r, i) => i === idx ? { ...r, apiSecret: val } : r))
                              }}
                              className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none"
                              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                              onFocus={e => (e.target.style.borderColor = `${entry.color}50`)}
                              onBlur={e =>  (e.target.style.borderColor = 'rgba(255,255,255,0.07)')}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-7 py-5 border-t border-white/[0.06] shrink-0">
              {saveCodeErr && (
                <p className="text-xs text-red-400 mb-3 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">{saveCodeErr}</p>
              )}
              <div className="flex items-center justify-between gap-3">
                <button onClick={skipApiReview} disabled={reviewSaving}
                  className="text-sm font-medium text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40 underline underline-offset-2">
                  Skip — Save Code Only
                </button>
                <div className="flex gap-3">
                  <button onClick={() => setApiReviewModal(false)} disabled={reviewSaving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 transition-colors hover:text-white">
                    Cancel
                  </button>
                  <button onClick={confirmApiReview} disabled={reviewSaving}
                    className="px-7 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-40"
                    style={{ background: 'var(--accent)', color: 'var(--bg)', boxShadow: '0 0 18px rgba(0,245,255,0.25)' }}>
                    {reviewSaving ? 'Saving…' : 'Save Connections & Code'}
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── AI Fix modal — opens from the "Fix with AI" button above. The
            modal owns the API call (POST /api/bots/{id}/ai-fix), shows
            the proposed diff, and writes the accepted code back via the
            standard PUT /api/bots/{id} flow. ──────────────────────────── */}
      {aiFixOpen && bot && (
        <AiFixModal
          botId={bot.id}
          botCode={code}
          errorLogs={aiFixLogs}
          onApply={(fixedCode) => {
            // Refresh local editor state so subsequent clicks of "Edit Code"
            // see the patched version (the modal already PUT-saved server-side).
            setCode(fixedCode)
            loadBot()
          }}
          onClose={() => setAiFixOpen(false)}
        />
      )}

      {/* Global keyframes for the Fix-with-AI button (subtle attention-grab). */}
      <style jsx global>{`
        @keyframes ai-fix-glow {
          0%, 100% {
            box-shadow:
              0 0 24px rgba(255, 100, 60, 0.40),
              0 6px 18px rgba(255, 68, 68, 0.18);
          }
          50% {
            box-shadow:
              0 0 38px rgba(255, 100, 60, 0.65),
              0 6px 22px rgba(255, 68, 68, 0.28);
          }
        }
        .ai-fix-cta {
          animation: ai-fix-glow 2.4s ease-in-out infinite;
        }
        .ai-fix-cta:hover { animation-play-state: paused; }

        @keyframes ai-fix-badge-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.12); }
        }
        .ai-fix-badge {
          animation: ai-fix-badge-pulse 1.6s ease-in-out infinite;
        }
      `}</style>

    </div>
  )
}
