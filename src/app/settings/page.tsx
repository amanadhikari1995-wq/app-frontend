'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar, { WatchdogIcon } from '@/components/Navbar'
import { removeToken, removeFullSession } from '@/lib/auth'
import { gotoLogin } from '@/lib/app-nav'
import { relayClient } from '@/lib/relay-client'

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab   = 'account' | 'appearance' | 'notifications' | 'security' | 'guide'
type Theme = 'dark' | 'light' | 'blue' | 'purple' | 'matrix' | 'synthwave' | 'glacier'

// ── Theme definitions ─────────────────────────────────────────────────────────
const THEMES: {
  id: Theme; label: string; desc: string; emoji: string
  bg: string; card: string; accent: string; accent2: string; tag: string
}[] = [
  {
    id: 'dark', label: 'Deep Space', desc: 'Default cyber-navy', emoji: '🌌',
    bg: '#05070f', card: '#0f1626', accent: '#00f5ff', accent2: '#0284c7',
    tag: 'DEFAULT',
  },
  {
    id: 'blue', label: 'Ocean', desc: 'Deep ocean blue', emoji: '🌊',
    bg: '#020c1b', card: '#0d1b2e', accent: '#3b82f6', accent2: '#1d4ed8',
    tag: '',
  },
  {
    id: 'purple', label: 'Cosmic', desc: 'Cosmic purple nebula', emoji: '🔮',
    bg: '#0c0514', card: '#150a24', accent: '#a855f7', accent2: '#7c3aed',
    tag: '',
  },
  {
    id: 'matrix', label: 'Matrix', desc: 'Hacker terminal green', emoji: '💻',
    bg: '#000802', card: '#001006', accent: '#00ff41', accent2: '#00cc33',
    tag: 'NEW',
  },
  {
    id: 'synthwave', label: 'Synthwave', desc: 'Neon retrowave glow', emoji: '🌆',
    bg: '#0d0020', card: '#160030', accent: '#ff0080', accent2: '#9000ff',
    tag: 'NEW',
  },
  {
    id: 'glacier', label: 'Glacier', desc: 'Arctic ice glass', emoji: '❄️',
    bg: '#020c18', card: '#041825', accent: '#38bdf8', accent2: '#0ea5e9',
    tag: 'NEW',
  },
  {
    id: 'light', label: 'Light', desc: 'Clean and bright', emoji: '☀️',
    bg: '#f0f6ff', card: '#ffffff', accent: '#0284c7', accent2: '#0369a1',
    tag: '',
  },
]

// ── Apply theme to DOM + dispatch event ───────────────────────────────────────
function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('watchdog-theme', theme)
  window.dispatchEvent(new Event('watchdog-theme-change'))
}

// ── Sidebar tab config ────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'account',       label: 'Account',       icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  { id: 'appearance',    label: 'Appearance',     icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01' },
  { id: 'notifications', label: 'Notifications',  icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { id: 'security',      label: 'Security',       icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { id: 'guide',         label: 'Help Center',    icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
]

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange}
      className="relative w-14 h-7 rounded-full transition-all duration-200 shrink-0"
      style={{ background: on ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }}>
      <span className="absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
        style={{ left: on ? '30px' : '4px' }} />
    </button>
  )
}

// ── Setting row ───────────────────────────────────────────────────────────────
function SettingRow({ icon, title, desc, right }: {
  icon: string; title: string; desc: string; right: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between px-6 py-5 rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-5 min-w-0">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-dim)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
            strokeWidth={1.8} style={{ color: 'var(--accent)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold text-white leading-tight">{title}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{desc}</p>
        </div>
      </div>
      <div className="shrink-0 ml-6">{right}</div>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-white">{title}</h2>
      <p className="text-sm mt-1.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>
    </div>
  )
}

// ── Guide accordion ───────────────────────────────────────────────────────────
type GuideSection = {
  id: string
  icon: string
  color: string
  title: string
  badge?: string
  items: { q: string; a: React.ReactNode }[]
}

const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'quickstart',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    color: '#00f5ff',
    title: 'Quick Start — New Users Begin Here',
    badge: 'START HERE',
    items: [
      {
        q: 'Step 1 — Log in to WATCH-DOG',
        a: <>Open the app and sign in with your email and password. If you don't have an account yet, click <strong>Sign Up</strong> on the login screen. Your data is stored locally — nothing is sent to external servers.</>,
      },
      {
        q: 'Step 2 — Create your first bot',
        a: <><strong>My Bots → + New Bot.</strong> Give your bot a name, optionally a description, and paste your Python code into the editor. Click <strong>Create Bot</strong>. Your bot is now saved and ready to run.</>,
      },
      {
        q: 'Step 3 — Connect an API (if your bot needs one)',
        a: <>Go to your bot's detail page and open <strong>Bot Settings → API Connections</strong>. Click <strong>+ New Connection</strong>, choose a template (Coinbase, Kalshi, Claude AI) or create a custom one, enter your keys, and save. The platform injects credentials automatically — no hardcoding needed.</>,
      },
      {
        q: 'Step 4 — Start your bot',
        a: <>On your bot's dashboard, click the <strong>Start</strong> button. The status changes to <strong>RUNNING</strong> (cyan glow). Logs appear in real time in the left panel. You can stop the bot at any time with the <strong>Stop</strong> button.</>,
      },
      {
        q: 'Step 5 — Monitor from the Dashboard',
        a: <>Go to <strong>Home (Dashboard)</strong> to see all your bots in one place — status, runs, trades, system resources, and a live log feed across all active bots. Every metric updates automatically.</>,
      },
      {
        q: 'Step 6 — Switch between Demo and Live mode',
        a: <>The <strong>Demo / Live</strong> toggle in the top-right corner of the navbar controls your trading mode. <strong>Demo</strong> is safe for testing — no real money. Switch to <strong>Live</strong> only when you're confident in your bot's performance.</>,
      },
    ],
  },
  {
    id: 'dashboard',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    color: '#3b82f6',
    title: 'Dashboard',
    items: [
      {
        q: 'What does the Dashboard show?',
        a: <>The Dashboard is your command center. It shows: <strong>Total Bots, Active Bots, API Connections, Total Runs, and Trades</strong> at the top. Below that: a live cross-bot log feed, bot status cards, status distribution chart, runs-per-bot chart, financial news, system resources (CPU/RAM), AI token usage, and a live clock.</>,
      },
      {
        q: 'Why aren\'t my bots showing on the Dashboard?',
        a: <ul className="list-disc pl-4 space-y-1"><li>Make sure you've created at least one bot under <strong>My Bots</strong>.</li><li>The bot grid refreshes automatically every few seconds — wait a moment.</li><li>If still missing, do a hard refresh: <strong>Ctrl + Shift + R</strong>.</li></ul>,
      },
      {
        q: 'The Live Activity Feed is empty — why?',
        a: <ul className="list-disc pl-4 space-y-1"><li>No bots are currently running. Start a bot to see logs appear.</li><li>If a bot is running but no logs appear, check the bot's code — it may not be printing output.</li><li>Add <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>print("message")</code> in your Python code to generate log entries.</li></ul>,
      },
      {
        q: 'CPU or RAM is showing very high usage',
        a: <ul className="list-disc pl-4 space-y-1"><li>A bot may have an infinite loop with no sleep — add <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>time.sleep(1)</code> between iterations.</li><li>Stop non-essential bots to free resources.</li><li>Restart the backend server if usage stays high after stopping all bots.</li></ul>,
      },
      {
        q: 'Financial News isn\'t loading',
        a: <ul className="list-disc pl-4 space-y-1"><li>Check your internet connection — the news widget fetches live RSS feeds.</li><li>If offline, the widget shows nothing. This is expected behavior.</li><li>The feed auto-refreshes every 5 minutes. Wait or reload the page.</li></ul>,
      },
    ],
  },
  {
    id: 'bots',
    icon: 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
    color: '#a855f7',
    title: 'Bots & Bot Management',
    items: [
      {
        q: 'How do I create a bot?',
        a: <>Navigate to <strong>My Bots → + New Bot</strong>. Enter a name, an optional description, and paste your Python bot code. The platform automatically detects your bot type (Trading, Telegram, Discord, AI Agent, etc.) and adapts the dashboard accordingly.</>,
      },
      {
        q: 'How do I start / stop a bot?',
        a: <ul className="list-disc pl-4 space-y-1"><li><strong>Start:</strong> Click your bot card → click the green <strong>Start</strong> button. Status changes to RUNNING.</li><li><strong>Stop:</strong> Click the red <strong>Stop</strong> button. Status changes to STOPPED.</li><li>Bots with <strong>Auto-restart</strong> enabled will restart automatically on crash.</li></ul>,
      },
      {
        q: 'My bot stopped unexpectedly — what do I do?',
        a: <ul className="list-disc pl-4 space-y-1"><li>Check the <strong>Logs</strong> panel on the bot dashboard — look for red ERROR entries near the bottom.</li><li>The most common causes: unhandled Python exception, missing import, or API key error.</li><li>Fix the issue in your code, then click <strong>Start</strong> again.</li><li>Enable <strong>Auto-restart</strong> in Bot Settings to recover from crashes automatically.</li></ul>,
      },
      {
        q: 'A bot is stuck in RUNNING status but isn\'t actually running',
        a: <ul className="list-disc pl-4 space-y-1"><li>This can happen if the backend was restarted while a bot was running.</li><li>WATCH-DOG automatically resets stale RUNNING statuses to IDLE on every backend start.</li><li>Restart the backend server: close and reopen the app, then restart via the terminal.</li><li>If it persists, click <strong>Stop</strong> manually on the bot page.</li></ul>,
      },
      {
        q: 'How do I reconnect a bot after it disconnects?',
        a: <ul className="list-disc pl-4 space-y-1"><li>Simply click <strong>Start</strong> again on the bot dashboard.</li><li>If the bot uses a WebSocket or live data feed, your Python code should handle reconnection logic internally.</li><li>For API bots, verify the API connection is still active under <strong>Bot Settings → API Connections</strong>.</li></ul>,
      },
      {
        q: 'How many bots can I run at the same time?',
        a: <>WATCH-DOG supports <strong>unlimited simultaneous bots</strong> — the only limit is your computer's CPU and RAM. Each bot runs as a fully isolated Python subprocess, so one bot crashing or hanging never affects any other bot.</>,
      },
      {
        q: 'How do I edit a bot\'s code?',
        a: <>Click the bot card → click <strong>Edit</strong> (pencil icon) on the bot detail page. Update the code in the editor and click <strong>Save</strong>. Note: you must stop the bot before saving code changes.</>,
      },
      {
        q: 'What is the Bot Secret?',
        a: <>Every bot is automatically assigned a unique UUID secret token. Bot code can use this token (<code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>os.environ["WATCHDOG_BOT_SECRET"]</code>) to authenticate API calls back to the WATCH-DOG platform — for example, to record trades programmatically.</>,
      },
    ],
  },
  {
    id: 'api',
    icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    color: '#f59e0b',
    title: 'API Connections',
    items: [
      {
        q: 'How do API connections work?',
        a: <>You store API credentials (key, secret, base URL) in the app once. WATCH-DOG automatically converts the connection name into environment variable names and injects them into your bot at startup. Example: a connection named <strong>"Kalshi API"</strong> becomes <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>KALSHI_API_KEY</code> and <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>KALSHI_API_SECRET</code> inside your Python code.</>,
      },
      {
        q: 'My bot says the API key is missing or invalid',
        a: <ul className="list-disc pl-4 space-y-1"><li>Go to <strong>My Bots → your bot → Bot Settings → API Connections</strong>.</li><li>Confirm the connection is assigned to this specific bot and is toggled <strong>Active</strong>.</li><li>Double-check the key and secret for typos — copy-paste directly from your exchange's API settings page.</li><li>Stop and restart the bot after saving changes so the new env vars are injected.</li></ul>,
      },
      {
        q: 'How do I add a new API connection?',
        a: <ul className="list-disc pl-4 space-y-1"><li>Open your bot → <strong>Bot Settings → API Connections → + New Connection</strong>.</li><li>Choose a built-in template (Coinbase, Kalshi, Claude AI) or click <strong>Custom</strong>.</li><li>Enter the connection name, base URL (if needed), API key, and API secret.</li><li>Save — the connection is immediately available to the bot on next start.</li></ul>,
      },
      {
        q: 'How do I fix a broken API connection?',
        a: <ul className="list-disc pl-4 space-y-1"><li>Go to the connection and click <strong>Edit</strong> — verify all fields are correct.</li><li>Toggle the connection <strong>off then on</strong> to force a refresh.</li><li>If the key has expired, generate a new one on the provider's website and update it here.</li><li>Restart the bot after any changes.</li></ul>,
      },
      {
        q: 'Can I use the same API connection on multiple bots?',
        a: <>No — each connection is assigned to a specific bot for security isolation. However, you can create multiple connections with the same credentials and assign one to each bot that needs it.</>,
      },
    ],
  },
  {
    id: 'ailab',
    icon: 'M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z',
    color: '#ec4899',
    title: 'AI Lab',
    items: [
      {
        q: 'What is AI Lab and what does it do?',
        a: <>AI Lab is WATCH-DOG's built-in machine learning workspace. You create AI models, connect them to your trading bots, and train them on historical trade data. The trained model produces a performance analysis report with recommendations — win rate, P&L, Sharpe ratio, drawdown, profit factor, and more.</>,
      },
      {
        q: 'How do I train my first AI model?',
        a: <ol className="list-decimal pl-4 space-y-1"><li>Go to <strong>AI Lab → + Create Model</strong>.</li><li>Enter a model name and optional description.</li><li>Click <strong>Connect Bots</strong> and select the bots whose trade history you want to train on.</li><li>Optionally upload additional training files (CSV, JSON, XLSX, PDF).</li><li>Click <strong>Train Now</strong>. Training runs automatically and results appear when complete.</li></ol>,
      },
      {
        q: 'What do the training results mean?',
        a: <ul className="list-disc pl-4 space-y-1"><li><strong>Win Rate:</strong> Percentage of profitable trades.</li><li><strong>Profit Factor:</strong> Total winning ÷ total losing. Above 1.5 is good.</li><li><strong>Sharpe Ratio:</strong> Risk-adjusted return. Above 1.0 is acceptable, above 2.0 is excellent.</li><li><strong>Max Drawdown:</strong> Largest peak-to-trough loss. Lower is safer.</li><li><strong>Recommendations:</strong> Specific suggestions to improve your strategy.</li></ul>,
      },
      {
        q: 'Training failed or is stuck in "TRAINING…" status',
        a: <ul className="list-disc pl-4 space-y-1"><li>Make sure your connected bots have actual trade history. Training with zero data will fail.</li><li>Check the training run table for an error message (red ERROR row).</li><li>If stuck, refresh the page — the model status will update.</li><li>Try uploading a manual CSV file with trade data as an alternative data source.</li></ul>,
      },
      {
        q: 'What is Live Sync?',
        a: <>When Live Sync is enabled on a model, every new trade recorded by connected bots is automatically added to the model's dataset in real time. This keeps your model's training data always up to date without manual re-uploads.</>,
      },
      {
        q: 'What file formats can I upload for training?',
        a: <>CSV, JSON, JSONL, TXT, PDF, and XLSX files are all supported. Maximum file size varies by type. For best results, use CSV or JSON files with labeled columns (e.g., <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>entry_price, exit_price, pnl, side</code>).</>,
      },
    ],
  },
  {
    id: 'logs',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    color: '#22c55e',
    title: 'Logs & Monitoring',
    items: [
      {
        q: 'How do I read bot logs?',
        a: <>Logs are color-coded by level: <strong style={{color:'#3b82f6'}}>INFO</strong> (normal activity), <strong style={{color:'#f59e0b'}}>WARNING</strong> (potential issue), <strong style={{color:'#ef4444'}}>ERROR</strong> (something went wrong). Go to <strong>Logs</strong> in the navbar to see all logs, or view per-bot logs on the individual bot dashboard. Filter by bot and log level using the dropdowns at the top.</>,
      },
      {
        q: 'Logs are not appearing for my bot',
        a: <ul className="list-disc pl-4 space-y-1"><li>Confirm the bot is in RUNNING status.</li><li>Check that your Python code uses <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>print()</code> — WATCH-DOG captures stdout/stderr as logs.</li><li>Make sure <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>PYTHONUNBUFFERED=1</code> is set — it's set automatically, but confirm your code isn't disabling it.</li></ul>,
      },
      {
        q: 'How do I find what caused my bot to crash?',
        a: <ul className="list-disc pl-4 space-y-1"><li>Go to your bot's dashboard and scroll to the bottom of the Logs panel.</li><li>Filter by <strong>ERROR</strong> level to isolate crash logs.</li><li>Look for Python tracebacks — the last ERROR entry before the bot stopped usually contains the full exception.</li></ul>,
      },
      {
        q: 'The log view stopped updating / is frozen',
        a: <ul className="list-disc pl-4 space-y-1"><li>Scroll to the very bottom of the log panel — auto-scroll pauses when you scroll up.</li><li>If the feed is genuinely frozen, refresh the page (<strong>Ctrl + R</strong>).</li><li>Check the backend is still running — if it crashed, restart it.</li></ul>,
      },
    ],
  },
  {
    id: 'chat',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    color: '#06b6d4',
    title: 'Community Chat',
    items: [
      {
        q: 'How do I access the Chat?',
        a: <>Click the <strong>floating chat button</strong> at the bottom-right corner of any page. It's always visible. The chat opens on the <strong>/chat</strong> page where you can join the group channel or send direct messages.</>,
      },
      {
        q: 'How do I set up my profile?',
        a: <>The first time you open Chat, a profile setup screen appears asking for your display name. Enter a name and click <strong>Enter Chat</strong>. You can upload a profile photo at any time from the left sidebar — click your avatar circle and select a photo.</>,
      },
      {
        q: 'Messages aren\'t sending / not appearing',
        a: <ul className="list-disc pl-4 space-y-1"><li>Check the connection indicator in the chat header — it shows green when connected, red when offline.</li><li>If disconnected, the app automatically tries to reconnect every 3 seconds. Wait a moment.</li><li>Make sure the <strong>backend server is running</strong> — chat requires the FastAPI backend on port 8000.</li><li>Try refreshing the page to force a new WebSocket connection.</li></ul>,
      },
      {
        q: 'How do I send a direct message (DM)?',
        a: <>In the left sidebar under <strong>Direct Messages</strong>, click <strong>+ New DM</strong> and select a user from the online users list. The DM conversation opens on the right. Only you and the recipient can see DMs.</>,
      },
      {
        q: 'How do I share an image or file in chat?',
        a: <>Click the <strong>paperclip icon</strong> next to the message input box. Select your file (images: JPG, PNG, GIF, WebP; files: PDF, CSV, MP4, TXT — max 20 MB). The file uploads and appears inline in the chat. Images are clickable for a fullscreen view.</>,
      },
    ],
  },
  {
    id: 'errors',
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    color: '#ef4444',
    title: 'Common Errors & Solutions',
    items: [
      {
        q: '"ModuleNotFoundError" in bot logs',
        a: <ul className="list-disc pl-4 space-y-1"><li>Your bot uses a Python library that isn't installed.</li><li>Open a terminal and run: <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>pip install &lt;module-name&gt;</code></li><li>Then restart the bot. WATCH-DOG uses the same Python environment as your terminal.</li></ul>,
      },
      {
        q: '"ConnectionRefusedError" or "API request failed"',
        a: <ul className="list-disc pl-4 space-y-1"><li>The external API your bot is calling is unreachable.</li><li>Check your internet connection.</li><li>Verify the API base URL in your API connection settings is correct.</li><li>Confirm your API key hasn't expired — generate a new one if needed.</li></ul>,
      },
      {
        q: '"Bot status is ERROR" — what does this mean?',
        a: <ul className="list-disc pl-4 space-y-1"><li>The bot's Python process exited with a non-zero exit code (i.e., an unhandled exception).</li><li>Open the bot's Logs panel and scroll to the bottom — find the traceback.</li><li>Fix the Python error in the code editor and click <strong>Start</strong> to try again.</li></ul>,
      },
      {
        q: '"Cannot connect to backend" or blank Dashboard',
        a: <ul className="list-disc pl-4 space-y-1"><li>The FastAPI backend is not running.</li><li>Open a terminal in <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>WATCH-DOG/app/backend</code> and run: <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>uvicorn app.main:app --reload</code></li><li>Then refresh the frontend page.</li></ul>,
      },
      {
        q: '"401 Unauthorized" in API responses',
        a: <ul className="list-disc pl-4 space-y-1"><li>Your API key or session token has expired.</li><li>Log out and log back in to refresh your session.</li><li>For bot API connections, update the key in <strong>Bot Settings → API Connections</strong>.</li></ul>,
      },
      {
        q: 'App shows a blank white screen',
        a: <ul className="list-disc pl-4 space-y-1"><li>Open browser developer tools (<strong>F12 → Console</strong>) and check for errors.</li><li>Hard refresh the page: <strong>Ctrl + Shift + R</strong>.</li><li>Clear site data: <strong>F12 → Application → Clear Site Data</strong>.</li><li>If using the desktop app, close and reopen it.</li></ul>,
      },
    ],
  },
  {
    id: 'troubleshoot',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    color: '#f59e0b',
    title: 'Troubleshooting & Recovery',
    items: [
      {
        q: 'The app crashed — how do I restart it?',
        a: <ol className="list-decimal pl-4 space-y-1"><li>Close the app completely.</li><li>Open a terminal in <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>WATCH-DOG/app/backend</code> and run <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>uvicorn app.main:app --reload</code>.</li><li>In a separate terminal in <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>WATCH-DOG/app/frontend</code> run <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>npm run dev</code>.</li><li>Open your browser to <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>http://localhost:3000</code>.</li></ol>,
      },
      {
        q: 'How do I clear the app cache?',
        a: <ul className="list-disc pl-4 space-y-1"><li><strong>Browser cache:</strong> Press <strong>Ctrl + Shift + R</strong> to hard-reload, or open DevTools → Application → Storage → Clear Site Data.</li><li><strong>Next.js build cache:</strong> Delete the <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>WATCH-DOG/app/frontend/.next</code> folder, then restart the frontend.</li><li><strong>localStorage:</strong> DevTools → Application → Local Storage → right-click → Clear to reset all saved preferences (themes, chat profile, trade mode).</li></ul>,
      },
      {
        q: 'How do I fully reinstall the app?',
        a: <ol className="list-decimal pl-4 space-y-1"><li>Stop both servers (backend and frontend).</li><li>Delete <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>frontend/node_modules</code> and <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>frontend/.next</code>.</li><li>Delete <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>backend/venv</code> (if using a virtual environment).</li><li>Run <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>npm install</code> in the frontend folder.</li><li>Run <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>pip install -r requirements.txt</code> in the backend folder.</li><li>Restart both servers. Your database and bot data remain intact.</li></ol>,
      },
      {
        q: 'All my bots are gone after a restart',
        a: <ul className="list-disc pl-4 space-y-1"><li>Check that the database file (<code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>watchdog.db</code>) still exists in the backend directory — it should never be deleted.</li><li>Make sure the backend is connecting to the same database file (check the DATABASE_URL in your <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>.env</code> file).</li><li>If the database was accidentally deleted, bots cannot be recovered — going forward, back up the <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>watchdog.db</code> file regularly.</li></ul>,
      },
      {
        q: 'Frontend is running but shows outdated content',
        a: <ul className="list-disc pl-4 space-y-1"><li>Hard refresh: <strong>Ctrl + Shift + R</strong>.</li><li>Stop the frontend server, delete the <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>.next</code> folder, and run <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>npm run dev</code> again.</li></ul>,
      },
      {
        q: 'Port 3000 or 8000 is already in use',
        a: <ul className="list-disc pl-4 space-y-1"><li>A previous server process is still running.</li><li>On Windows, open Task Manager → find <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>node.exe</code> or <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>python.exe</code> → End Task.</li><li>Or run in terminal: <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>npx kill-port 3000</code> / <code className="px-1 py-0.5 rounded text-xs" style={{background:'rgba(255,255,255,0.08)'}}>npx kill-port 8000</code>.</li></ul>,
      },
    ],
  },
]

function GuideAccordion() {
  const [openSection, setOpenSection] = useState<string | null>('quickstart')
  const [openItem,    setOpenItem]    = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {GUIDE_SECTIONS.map(section => {
        const sectionOpen = openSection === section.id
        return (
          <div key={section.id} className="rounded-2xl overflow-hidden"
            style={{ border: `1px solid ${sectionOpen ? section.color + '44' : 'rgba(255,255,255,0.07)'}`,
                     background: sectionOpen ? `${section.color}08` : 'rgba(255,255,255,0.02)',
                     transition: 'all 0.2s ease' }}>

            {/* Section header */}
            <button
              onClick={() => { setOpenSection(sectionOpen ? null : section.id); setOpenItem(null) }}
              className="w-full flex items-center gap-4 px-5 py-4 text-left"
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${section.color}18`, border: `1px solid ${section.color}33` }}>
                <svg className="w-4.5 h-4.5 w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24"
                  stroke={section.color} strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={section.icon} />
                </svg>
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-3">
                <span className="text-sm font-bold text-white">{section.title}</span>
                {section.badge && (
                  <span className="text-[10.8px] font-black px-2 py-0.5 rounded-full tracking-widest shrink-0"
                    style={{ background: `${section.color}25`, color: section.color, border: `1px solid ${section.color}44` }}>
                    {section.badge}
                  </span>
                )}
              </div>
              <svg className="w-4 h-4 shrink-0 transition-transform duration-200"
                style={{ color: 'var(--text-muted)', transform: sectionOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Section items */}
            {sectionOpen && (
              <div className="px-5 pb-4 space-y-2">
                {section.items.map((item, i) => {
                  const key = `${section.id}-${i}`
                  const itemOpen = openItem === key
                  return (
                    <div key={key} className="rounded-xl overflow-hidden"
                      style={{ border: `1px solid ${itemOpen ? section.color + '33' : 'rgba(255,255,255,0.05)'}`,
                               background: itemOpen ? `${section.color}06` : 'rgba(255,255,255,0.015)' }}>
                      <button
                        onClick={() => setOpenItem(itemOpen ? null : key)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                      >
                        <span className="text-sm font-semibold text-white leading-snug">{item.q}</span>
                        <svg className="w-3.5 h-3.5 shrink-0 transition-transform duration-200"
                          style={{ color: section.color, transform: itemOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                      {itemOpen && (
                        <div className="px-4 pb-4 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                          {item.a}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const router = useRouter()
  const [tab,   setTab]   = useState<Tab>('account')
  const [theme, setTheme] = useState<Theme>('dark')

  const [notif, setNotif] = useState({
    botError: true, weeklyReport: false, botCompleted: true, tradeExecution: false,
  })
  const [sec, setSec] = useState({
    twoFactor: false, openAccess: true, botPermission: true, sessionTimeout: false,
  })

  useEffect(() => {
    const saved = localStorage.getItem('watchdog-theme') as Theme | null
    if (saved && THEMES.find(t => t.id === saved)) {
      setTheme(saved)
      applyTheme(saved)
    }
  }, [])

  const handleTheme = (t: Theme) => { setTheme(t); applyTheme(t) }

  const handleLogout = () => {
    relayClient.disconnect()  // close relay WS so a new login opens a fresh connection with the new user's token
    removeToken()             // explicit user-initiated logout
    removeFullSession()       // clear stored full session too
    const eAPI = (window as unknown as { electronAPI?: { clearSession?: () => Promise<unknown> } }).electronAPI
    eAPI?.clearSession?.().catch(() => {})  // delete session.json + kill cloud connector
    gotoLogin()               // file://-aware redirect
  }

  const CARD: React.CSSProperties = {
    background: 'var(--card)',
    backdropFilter: 'blur(40px) saturate(180%)',
    WebkitBackdropFilter: 'blur(40px) saturate(180%)',
    boxShadow: 'var(--shadow-card)',
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Navbar />

      <div style={{ minHeight: 'calc(100vh - 96px)', padding: '48px 0 64px' }}>

        {/* ── 50% centered container ── */}
        <main style={{ width: '50%', margin: '0 auto', minWidth: 640 }}>

          {/* Page header */}
          <div className="mb-10">
            <h1 className="text-3xl font-black text-white tracking-tight">Settings</h1>
            <p className="mt-2 text-base" style={{ color: 'var(--text-muted)' }}>
              Manage your account and platform preferences
            </p>
          </div>

          <div className="flex gap-7 items-start">

            {/* ── Sidebar ── */}
            <div className="shrink-0 flex flex-col gap-4" style={{ width: 210 }}>
              <div className="rounded-2xl overflow-hidden p-2" style={CARD}>
                {TABS.map(t => {
                  const active = tab === t.id
                  return (
                    <button key={t.id} onClick={() => setTab(t.id)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all text-left"
                      style={active ? {
                        background: 'var(--accent-dim)',
                        color: 'var(--accent)',
                        border: '1px solid var(--border)',
                      } : {
                        color: 'var(--text-muted)',
                        border: '1px solid transparent',
                      }}>
                      <svg className="w-4.5 h-4.5 w-[18px] h-[18px] shrink-0" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
                      </svg>
                      {t.label}
                    </button>
                  )
                })}
              </div>

              {/* Platform badge */}
              <div className="rounded-2xl p-5 text-center" style={CARD}>
                <p className="text-[12px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                  Platform
                </p>
                <p className="text-lg font-black text-white mt-1.5">v3.5.0</p>
                <p className="text-[12px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>WATCH-DOG</p>
              </div>

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all duration-200 active:scale-95"
                style={{
                  background: 'rgba(239,68,68,0.07)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: '#ef4444',
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.14)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.4)'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.07)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(239,68,68,0.2)'
                }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
                </svg>
                Log Out
              </button>
            </div>

            {/* ── Content panel ── */}
            <div className="flex-1 min-w-0">

              {/* ══ ACCOUNT ══════════════════════════════════════════════════ */}
              {tab === 'account' && (
                <div className="rounded-2xl p-8" style={CARD}>
                  <SectionHead title="Account" desc="Your platform identity and access level" />

                  {/* Avatar row — matches sidebar logo + brand exactly */}
                  <div className="flex items-center gap-6 p-6 rounded-2xl mb-6"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    {/* Animated brand mark — same animation as the sidebar */}
                    <div className="shrink-0">
                      <WatchdogIcon size={92} />
                    </div>
                    <div>
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
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        letterSpacing: '0.06em',
                        lineHeight: 1.5,
                        marginTop: 6,
                        textTransform: 'uppercase' as const,
                      }}>
                        Universal AI Bot Platform
                      </div>
                      <span className="inline-flex items-center gap-2 mt-3 text-xs font-black px-3 py-1 rounded-full"
                        style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--border)' }}>
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
                        Active
                      </span>
                    </div>
                  </div>

                  {/* Info rows */}
                  <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                    {[
                      { label: 'Authentication', value: 'Email + Password' },
                      { label: 'Bot Execution',  value: 'Python subprocess isolation' },
                      { label: 'Data Storage',   value: 'Local SQLite + filesystem' },
                      { label: 'Subscription',   value: 'Managed via website' },
                    ].map((r, i, arr) => (
                      <div key={r.label}
                        className="flex items-center justify-between px-6 py-4 text-sm"
                        style={{
                          background: 'rgba(255,255,255,0.015)',
                          borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        }}>
                        <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                        <span className="font-semibold text-white">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ══ APPEARANCE ═══════════════════════════════════════════════ */}
              {tab === 'appearance' && (
                <div className="rounded-2xl p-8" style={CARD}>
                  <SectionHead
                    title="Appearance"
                    desc="Choose a theme — applies instantly across the entire app"
                  />

                  {/* Theme grid */}
                  <div className="grid grid-cols-2 gap-4">
                    {THEMES.map(t => {
                      const active = theme === t.id
                      const isLight = t.id === 'light'
                      return (
                        <button key={t.id} onClick={() => handleTheme(t.id)}
                          className="relative text-left rounded-2xl overflow-hidden transition-all duration-200 hover:scale-[1.02] active:scale-[0.99]"
                          style={{
                            border: active ? `2px solid ${t.accent}` : '1px solid rgba(255,255,255,0.07)',
                            boxShadow: active ? `0 0 28px ${t.accent}44, inset 0 0 40px ${t.accent}08` : 'none',
                            outline: 'none',
                          }}>

                          {/* Gradient preview fill */}
                          <div className="relative h-32 w-full overflow-hidden"
                            style={{ background: t.bg }}>
                            {/* Grid pattern overlay */}
                            <div className="absolute inset-0 opacity-[0.08]"
                              style={{
                                backgroundImage: `linear-gradient(${t.accent}44 1px, transparent 1px), linear-gradient(90deg, ${t.accent}44 1px, transparent 1px)`,
                                backgroundSize: '24px 24px',
                              }} />
                            {/* Glow blob */}
                            <div className="absolute inset-0"
                              style={{
                                background: `radial-gradient(ellipse 70% 60% at 50% 50%, ${t.accent}22 0%, transparent 70%)`,
                              }} />
                            {/* Glassmorphic card preview */}
                            <div className="absolute bottom-2 left-2 right-2 rounded-xl px-3 py-2 flex items-center gap-2"
                              style={{
                                background: `${t.card}cc`,
                                border: `1px solid ${t.accent}30`,
                                backdropFilter: 'blur(8px)',
                              }}>
                              <div className="w-2 h-2 rounded-full shrink-0 animate-pulse"
                                style={{ background: t.accent }} />
                              <div className="flex-1 space-y-1">
                                <div className="h-1 rounded-full w-3/4" style={{ background: `${t.accent}60` }} />
                                <div className="h-1 rounded-full w-1/2 bg-white/10" />
                              </div>
                            </div>
                            {/* Active checkmark */}
                            {active && (
                              <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                                style={{ background: t.accent, boxShadow: `0 0 10px ${t.accent}` }}>
                                <svg className="w-3 h-3" fill="white" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              </div>
                            )}
                            {/* NEW badge */}
                            {t.tag === 'NEW' && !active && (
                              <div className="absolute top-2 right-2 text-[10.8px] font-black px-1.5 py-0.5 rounded-full"
                                style={{ background: t.accent, color: t.bg }}>
                                NEW
                              </div>
                            )}
                          </div>

                          {/* Label row */}
                          <div className="px-3 py-2.5 flex items-center justify-between"
                            style={{ background: isLight ? '#f8faff' : t.card }}>
                            <div>
                              <p className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                                {t.emoji} {t.label}
                              </p>
                              <p className="text-[12px] mt-0.5"
                                style={{ color: isLight ? '#64748b' : `${t.accent}99` }}>
                                {t.desc}
                              </p>
                            </div>
                            {/* Accent dot */}
                            <div className="w-3 h-3 rounded-full shrink-0"
                              style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})`, boxShadow: `0 0 8px ${t.accent}88` }} />
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* Font row */}
                  <div className="mt-7 pt-7" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-sm font-semibold text-white mb-3">Font</p>
                    <div className="flex items-center justify-between px-5 py-4 rounded-2xl"
                      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <span className="text-base font-medium text-white">Poppins</span>
                      <span className="text-xs px-3 py-1 rounded-lg font-mono"
                        style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)' }}>
                        System default
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ══ NOTIFICATIONS ════════════════════════════════════════════ */}
              {tab === 'notifications' && (
                <div className="rounded-2xl p-8" style={CARD}>
                  <SectionHead title="Notifications" desc="Control which alerts and reports you receive" />
                  <div className="space-y-3">
                    <SettingRow
                      icon="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      title="Bot Error Alert"
                      desc="Instant alert when a bot encounters a critical error"
                      right={<Toggle on={notif.botError} onChange={() => setNotif(p => ({ ...p, botError: !p.botError }))} />}
                    />
                    <SettingRow
                      icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      title="Weekly Performance Report"
                      desc="Summary of bot activity, trades, and P&L every week"
                      right={<Toggle on={notif.weeklyReport} onChange={() => setNotif(p => ({ ...p, weeklyReport: !p.weeklyReport }))} />}
                    />
                    <SettingRow
                      icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      title="Bot Completed Alert"
                      desc="Notify when a bot finishes a run or task successfully"
                      right={<Toggle on={notif.botCompleted} onChange={() => setNotif(p => ({ ...p, botCompleted: !p.botCompleted }))} />}
                    />
                    <SettingRow
                      icon="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                      title="Trade Execution Alert"
                      desc="Alert on every buy or sell trade executed by a bot"
                      right={<Toggle on={notif.tradeExecution} onChange={() => setNotif(p => ({ ...p, tradeExecution: !p.tradeExecution }))} />}
                    />
                  </div>
                  <div className="mt-6 p-5 rounded-2xl flex items-start gap-4"
                    style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.16)' }}>
                    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24"
                      stroke="currentColor" strokeWidth={2} style={{ color: '#818cf8' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Delivery requires a connected channel (email, webhook). Integrations coming soon.
                    </p>
                  </div>
                </div>
              )}

              {/* ══ GUIDE / HELP CENTER ══════════════════════════════════════ */}
              {tab === 'guide' && (
                <div className="rounded-2xl p-8" style={CARD}>
                  <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-xl font-bold text-white">Help Center</h2>
                      <span className="text-[12px] font-black px-2.5 py-1 rounded-full tracking-widest"
                        style={{ background: 'rgba(0,245,255,0.12)', color: 'var(--accent)', border: '1px solid rgba(0,245,255,0.25)' }}>
                        BUILT-IN MANUAL
                      </span>
                    </div>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Step-by-step guides, troubleshooting, and answers to common questions. Click any section to expand.
                    </p>
                  </div>

                  {/* Search hint */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-6"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      strokeWidth={2} style={{ color: 'var(--text-muted)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Tip — Click a <strong className="text-white">section heading</strong> to open it, then click any <strong className="text-white">question</strong> to see the answer.
                    </p>
                  </div>

                  <GuideAccordion />

                  {/* Footer note */}
                  <div className="mt-8 pt-6 flex items-center gap-3 text-xs"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.07)', color: 'var(--text-muted)' }}>
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Still stuck? Use the <strong className="text-white mx-1">Community Chat</strong> (bottom-right button) to ask other WATCH-DOG users for help in real time.
                  </div>
                </div>
              )}

              {/* ══ SECURITY ═════════════════════════════════════════════════ */}
              {tab === 'security' && (
                <div className="rounded-2xl p-8" style={CARD}>
                  <SectionHead title="Security" desc="Access control and execution permissions" />
                  <div className="space-y-3">
                    <SettingRow
                      icon="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      title="Two-Factor Authentication"
                      desc="Require a second factor on login"
                      right={<Toggle on={sec.twoFactor} onChange={() => setSec(p => ({ ...p, twoFactor: !p.twoFactor }))} />}
                    />
                    <SettingRow
                      icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      title="Login History"
                      desc="Track and review recent access events"
                      right={
                        <button className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                          style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--border)' }}>
                          View Logs
                        </button>
                      }
                    />
                    <SettingRow
                      icon="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                      title="Session Timeout"
                      desc="Auto-lock after a period of inactivity"
                      right={<Toggle on={sec.sessionTimeout} onChange={() => setSec(p => ({ ...p, sessionTimeout: !p.sessionTimeout }))} />}
                    />
                    <SettingRow
                      icon="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      title="Bot Execution Permission"
                      desc="Allow bots to run in isolated Python subprocesses"
                      right={<Toggle on={sec.botPermission} onChange={() => setSec(p => ({ ...p, botPermission: !p.botPermission }))} />}
                    />
                  </div>
                  <div className="mt-6 p-5 rounded-2xl flex items-start gap-4"
                    style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.14)' }}>
                    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24"
                      stroke="currentColor" strokeWidth={2} style={{ color: '#ef4444' }}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      2FA and session management activate when full authentication is enabled.
                    </p>
                  </div>
                </div>
              )}

            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

