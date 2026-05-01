'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { botsApi, tradesApi, connectionsApi, trainerApi, analyzeApi, type AnalyzeResponse } from '@/lib/api'
import { formatTimeCT, formatTradeDateCT, timeAgo } from '@/lib/time'
import Navbar from '@/components/Navbar'
import AiFixModal from '@/components/AiFixModal'
import {
  BotParam, extractParams, applyParams, groupParams, getStep, SECTION_META,
} from '@/lib/bot-params'
import { detectRequiredApis, detectAllApis, unconfiguredApis, type DetectedApi } from '@/lib/api-detector'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import BotTypeOverview from '@/components/BotTypeOverview'

const BG = 'var(--bg)'
const CARD  = { background: 'var(--card)', backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: 'var(--shadow-card)' } as React.CSSProperties
const MODAL = { background: 'rgba(4,6,18,0.96)', border: '1px solid var(--border-bright, rgba(255,255,255,0.12))', backdropFilter: 'blur(48px) saturate(200%)', WebkitBackdropFilter: 'blur(48px) saturate(200%)', boxShadow: 'var(--shadow-elevated)' } as React.CSSProperties

interface Bot   {
  id: number; name: string; description: string | null; status: string
  run_count: number; last_run_at: string | null; code: string; bot_secret: string
  // settings
  schedule_type: string; schedule_start: string | null; schedule_end: string | null
  max_amount_per_trade: number | null; max_contracts_per_trade: number | null; max_daily_loss: number | null
  auto_restart: boolean
}
interface Log   { id: number; level: string; message: string; created_at: string }
interface Conn  { id: number; name: string; base_url: string | null; api_key: string | null }
interface Trade { id: number; symbol: string; side: string; entry_price: number | null; exit_price: number | null; quantity: number | null; pnl: number | null; note: string | null; created_at: string }
interface Stats { total_trades: number; winning_trades: number; losing_trades: number; win_rate: number; total_pnl: number; total_winning: number; total_losing: number }

const STATUS: Record<string, { label: string; color: string; bg: string; glow: string; pulse: boolean }> = {
  RUNNING: { label: 'Running', color: 'var(--accent)', bg: 'rgba(0,245,255,0.12)',  glow: '0 0 18px rgba(0,245,255,0.5)',  pulse: true  },
  IDLE:    { label: 'Idle',    color: 'var(--text-muted)', bg: 'rgba(71,85,105,0.14)',  glow: 'none',                          pulse: false },
  ERROR:   { label: 'Error',   color: '#ff4444', bg: 'rgba(255,68,68,0.12)',  glow: '0 0 18px rgba(255,68,68,0.5)',  pulse: false },
  STOPPED: { label: 'Stopped', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', glow: 'none',                         pulse: false },
}
const LOG_COLOR: Record<string, string> = { INFO: '#3b82f6', WARNING: '#f59e0b', ERROR: '#ef4444' }

function fmt(n: number | null | undefined, prefix = '') {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const str = abs >= 1000 ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : abs.toFixed(2)
  return `${n < 0 ? '-' : ''}${prefix}${str}`
}
function pnlColor(n: number | null) {
  if (n == null) return '#94a3b8'
  return n > 0 ? '#00f5ff' : n < 0 ? '#ff4444' : '#94a3b8'
}

// ── Templates ─────────────────────────────────────────────────────────────────
const BLANK = `# ============================================================
# WATCHDOG BOT — BLANK TEMPLATE
# ============================================================
import os, time, signal
from datetime import datetime, timezone

# ── WatchdogSDK ──────────────────────────────────────────────
class WatchdogSDK:
    def __init__(self):
        self.api_url    = os.environ.get("WATCHDOG_API_URL", "http://localhost:8000")
        self.bot_secret = os.environ.get("WATCHDOG_BOT_SECRET", "")
        self.bot_id     = os.environ.get("WATCHDOG_BOT_ID", "unknown")
        self.max_amount = self._f("WATCHDOG_MAX_AMOUNT_PER_TRADE")
        self.max_contracts = self._i("WATCHDOG_MAX_CONTRACTS_PER_TRADE")
        self.max_daily_loss = self._f("WATCHDOG_MAX_DAILY_LOSS")
        self._daily_loss = 0.0

    def _f(self, k): v = os.environ.get(k); return float(v) if v else None
    def _i(self, k): v = os.environ.get(k); return int(v)   if v else None

    def check_risk(self, amount=0.0, contracts=0):
        if self.max_amount and amount > self.max_amount:
            print(f"[WARNING] Trade \${amount:.2f} exceeds limit"); return False
        if self.max_contracts and contracts > self.max_contracts:
            print(f"[WARNING] {contracts} contracts exceeds limit"); return False
        if self.max_daily_loss and self._daily_loss >= self.max_daily_loss:
            print("[WARNING] Daily loss limit reached"); return False
        return True

    def log_price(self, symbol, price, change=None, volume=None):
        msg = f"[PRICE] {symbol}  \${price:,.4f}"
        if change: msg += f"  {change}"
        if volume: msg += f"  Vol:{volume}"
        print(msg)

    def log_ai(self, text):            print(f"[AI] {text}")
    def log_signal(self, direction, symbol=None, confidence=None, reason=None):
        msg = f"[SIGNAL] {direction}"
        if symbol:     msg += f"  {symbol}"
        if confidence: msg += f"  Confidence:{confidence*100:.0f}%"
        if reason:     msg += f"  | {reason}"
        print(msg)

    def log_buy(self, symbol, qty=None, price=None, reason=None):
        msg = f"[BUY] {symbol}"
        if qty:    msg += f"  qty={qty}"
        if price:  msg += f"  @ \${price:,.4f}"
        if reason: msg += f"  | {reason}"
        print(msg)

    def log_sell(self, symbol, qty=None, price=None, pnl=None):
        msg = f"[SELL] {symbol}"
        if qty:  msg += f"  qty={qty}"
        if price: msg += f"  @ \${price:,.4f}"
        if pnl is not None: msg += f"  PnL:{'+'if pnl>=0 else''}\${pnl:.2f}"
        print(msg)

    def log_exit(self, symbol, reason, pnl=None):
        msg = f"[EXIT] {symbol}  {reason}"
        if pnl is not None: msg += f"  PnL:{'+'if pnl>=0 else''}\${pnl:.2f}"
        print(msg)

    def log_pnl(self, pnl, realized=None, unrealized=None):
        msg = f"[PNL] {'+'if pnl>=0 else''}\${pnl:.2f}"
        if realized:   msg += f"  Realized:\${realized:.2f}"
        if unrealized: msg += f"  Unrealized:\${unrealized:.2f}"
        print(msg)

    def record_trade(self, symbol, side, qty=None, entry_price=None, exit_price=None, pnl=None, note=None):
        import urllib.request, json as _j
        payload = _j.dumps({"symbol":symbol,"side":side,"quantity":qty,
            "entry_price":entry_price,"exit_price":exit_price,"pnl":pnl,"note":note}).encode()
        req = urllib.request.Request(f"{self.api_url}/api/trades/record", data=payload,
            headers={"Content-Type":"application/json","X-Bot-Secret":self.bot_secret}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=5)
            if pnl is not None: self.log_pnl(pnl)
        except Exception as e:
            print(f"[WARNING] Trade record failed: {e}")

# ── Your Bot ──────────────────────────────────────────────────
class MyBot:
    def __init__(self):
        self.watchdog = WatchdogSDK()
        self.running  = True
        self.tick     = 0
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT,  self._shutdown)

    def _shutdown(self, *_): self.running = False

    def setup(self):
        print("[BOT] Setup complete.")

    def on_tick(self):
        self.tick += 1
        now = datetime.now(timezone.utc).strftime("%H:%M:%S")
        print(f"[BOT] Tick #{self.tick} — {now}")
        # TODO: add your logic here

    def run(self):
        print("[BOT] Starting...")
        self.setup()
        while self.running:
            try: self.on_tick()
            except Exception as e: print(f"[ERROR] {e}")
            time.sleep(1)

if __name__ == "__main__":
    MyBot().run()
`

const BOT_TYPES = [
  { id: 'trading',    name: 'Trading Bot',           color: '#00f5ff',
    desc: 'Execute automated buy & sell orders based on market signals and indicators',
    paths: ['M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941'] },
  { id: 'arbitrage',  name: 'Arbitrage Bot',          color: '#6366f1',
    desc: 'Detect and exploit price discrepancies across exchanges in real time',
    paths: ['M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5'] },
  { id: 'prediction', name: 'Prediction Market Bot',  color: '#a855f7',
    desc: 'Trade YES/NO contracts on prediction markets like Kalshi and Polymarket',
    paths: ['M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z', 'M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z'] },
  { id: 'grid',       name: 'Grid Bot',               color: '#06b6d4',
    desc: 'Buy and sell at preset grid intervals within a defined price range',
    paths: [
      'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z',
      'M3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z',
      'M13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z',
      'M13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
    ] },
  { id: 'dca',        name: 'DCA Bot',                color: '#22c55e',
    desc: 'Dollar-cost average into positions automatically on a recurring schedule',
    paths: ['M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5'] },
  { id: 'scalping',   name: 'Scalping Bot',           color: '#ec4899',
    desc: 'Capture micro-profits with rapid in-and-out trades on small price swings',
    paths: ['M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z'] },
  { id: 'telegram',   name: 'Telegram Bot',           color: '#3b82f6',
    desc: 'Send trade alerts and receive commands through a Telegram chat',
    paths: ['M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5'] },
  { id: 'custom',     name: 'Custom Bot',             color: '#f59e0b',
    desc: 'Full flexibility — build anything with Python and the WatchDog SDK',
    paths: ['M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5'] },
]

const BOT_TEMPLATES = [
  { id: 'trading', name: 'Trading Bot', desc: 'Price alerts & automated buy/sell triggers', icon: '📈',
    code: `# ============================================================
# WATCHDOG TRADING BOT — SAMPLE TEMPLATE
# ============================================================
# HOW TO USE:
#   Copy this entire code and give it to any AI (ChatGPT, Grok,
#   Claude etc.) along with your trading strategy prompt.
#   The AI will rewrite this template into a fully working bot
#   that runs perfectly on the WatchDog platform.
# ============================================================

import os, time, signal, random
from datetime import datetime, timezone

# ── WatchdogSDK ──────────────────────────────────────────────
# DO NOT MODIFY THIS CLASS — it handles all platform logging,
# trade recording, and risk management automatically.
class WatchdogSDK:
    def __init__(self):
        self.api_url        = os.environ.get("WATCHDOG_API_URL", "http://localhost:8000")
        self.bot_secret     = os.environ.get("WATCHDOG_BOT_SECRET", "")
        self.bot_id         = os.environ.get("WATCHDOG_BOT_ID", "unknown")
        self.max_amount     = self._f("WATCHDOG_MAX_AMOUNT_PER_TRADE")
        self.max_contracts  = self._i("WATCHDOG_MAX_CONTRACTS_PER_TRADE")
        self.max_daily_loss = self._f("WATCHDOG_MAX_DAILY_LOSS")
        self._daily_loss    = 0.0

    def _f(self, k):
        v = os.environ.get(k)
        return float(v) if v else None

    def _i(self, k):
        v = os.environ.get(k)
        return int(v) if v else None

    def check_risk(self, amount=0.0, contracts=0):
        """Returns True if trade is within risk limits, False otherwise."""
        if self.max_amount and amount > self.max_amount:
            print(f"[WARNING] Trade amount \${amount:.2f} exceeds max limit \${self.max_amount:.2f}")
            return False
        if self.max_contracts and contracts > self.max_contracts:
            print(f"[WARNING] {contracts} contracts exceeds max limit {self.max_contracts}")
            return False
        if self.max_daily_loss and self._daily_loss >= self.max_daily_loss:
            print(f"[WARNING] Daily loss limit \${self.max_daily_loss:.2f} reached — trading paused")
            return False
        return True

    def log_price(self, symbol, price, change=None, volume=None):
        """Log the current market price. Shows in Live Logs."""
        msg = f"[PRICE] {symbol}  \${price:,.4f}"
        if change:  msg += f"  {change}"
        if volume:  msg += f"  Vol:{volume}"
        print(msg)

    def log_ai(self, text):
        """Log AI analysis output. Shows in Live Logs."""
        print(f"[AI] {text}")

    def log_signal(self, direction, symbol=None, confidence=None, reason=None):
        """Log a trade signal (LONG/SHORT/NEUTRAL). Shows in Live Logs."""
        msg = f"[SIGNAL] {direction}"
        if symbol:     msg += f"  {symbol}"
        if confidence: msg += f"  Confidence:{confidence * 100:.0f}%"
        if reason:     msg += f"  | {reason}"
        print(msg)

    def log_buy(self, symbol, qty=None, price=None, reason=None):
        """Log a buy/entry order. Shows in Live Logs."""
        msg = f"[BUY] {symbol}"
        if qty:    msg += f"  qty={qty}"
        if price:  msg += f"  @ \${price:,.4f}"
        if reason: msg += f"  | {reason}"
        print(msg)

    def log_sell(self, symbol, qty=None, price=None, pnl=None):
        """Log a sell/exit order. Shows in Live Logs."""
        msg = f"[SELL] {symbol}"
        if qty:   msg += f"  qty={qty}"
        if price: msg += f"  @ \${price:,.4f}"
        if pnl is not None:
            msg += f"  PnL:{'+'if pnl >= 0 else ''}\${pnl:.2f}"
        print(msg)

    def log_exit(self, symbol, reason, pnl=None):
        """Log a position exit with reason. Shows in Live Logs."""
        msg = f"[EXIT] {symbol}  {reason}"
        if pnl is not None:
            msg += f"  PnL:{'+'if pnl >= 0 else ''}\${pnl:.2f}"
        print(msg)

    def log_pnl(self, pnl, realized=None, unrealized=None):
        """Log current P&L. Shows in Live Logs."""
        msg = f"[PNL] {'+'if pnl >= 0 else ''}\${pnl:.2f}"
        if realized:   msg += f"  Realized:\${realized:.2f}"
        if unrealized: msg += f"  Unrealized:\${unrealized:.2f}"
        print(msg)

    def record_trade(self, symbol, side, qty=None, entry_price=None,
                     exit_price=None, pnl=None, note=None):
        """
        IMPORTANT: Call this after every completed trade.
        This saves the trade to WatchDog database and shows it
        in the Trade Logs section of your bot dashboard.
        """
        import urllib.request, json as _j
        payload = _j.dumps({
            "symbol": symbol, "side": side, "quantity": qty,
            "entry_price": entry_price, "exit_price": exit_price,
            "pnl": pnl, "note": note
        }).encode()
        req = urllib.request.Request(
            f"{self.api_url}/api/trades/record",
            data=payload,
            headers={"Content-Type": "application/json", "X-Bot-Secret": self.bot_secret},
            method="POST"
        )
        try:
            urllib.request.urlopen(req, timeout=5)
            if pnl is not None:
                self._daily_loss += abs(pnl) if pnl < 0 else 0
                self.log_pnl(pnl)
        except Exception as e:
            print(f"[WARNING] Trade record failed: {e}")


# ── Your Trading Bot ──────────────────────────────────────────
# REPLACE THIS SECTION with your actual trading logic.
# Keep the WatchdogSDK calls so logs & trades appear on dashboard.
class TradingBot:
    def __init__(self):
        self.watchdog    = WatchdogSDK()
        self.running     = True
        self.tick        = 0
        self.position    = None   # holds entry price when in a trade
        self.symbol      = os.getenv("SYMBOL", "BTC-USDT")
        signal.signal(signal.SIGTERM, self._shutdown)
        signal.signal(signal.SIGINT,  self._shutdown)

    def _shutdown(self, *_):
        print("[BOT] Shutdown signal received. Closing gracefully...")
        self.running = False

    # ── STEP 1: Fetch live market price ──────────────────────
    def get_price(self):
        # TODO: Replace with your real exchange API call
        # Example (Binance):
        #   import requests
        #   data = requests.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT").json()
        #   return float(data["price"])
        base = 67000.0
        return round(base + random.uniform(-500, 500), 2)

    # ── STEP 2: Analyze market conditions ────────────────────
    def analyze(self, price):
        # TODO: Replace with your real strategy logic
        # Examples:
        #   - Call an AI API (Claude, GPT-4) with price + news data
        #   - Compute RSI, MACD, Bollinger Bands
        #   - Use a ML model prediction
        # Must return: (analysis_text: str, confidence: float 0.0-1.0)
        options = [
            ("Bullish momentum — RSI oversold, MACD crossover detected", 0.82),
            ("Neutral market — consolidating, waiting for breakout",      0.45),
            ("Bearish signal — volume declining, resistance at key level", 0.78),
        ]
        return random.choice(options)

    # ── STEP 3: Main tick logic (runs every loop) ─────────────
    def on_tick(self):
        self.tick += 1
        now   = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        price = self.get_price()

        # Log the current price
        base_price = 67000.0
        change_pct = ((price - base_price) / base_price) * 100
        change_str = f"+{change_pct:.2f}%" if change_pct >= 0 else f"{change_pct:.2f}%"
        self.watchdog.log_price(self.symbol, price, change=change_str)

        # Run analysis every 5 ticks
        if self.tick % 5 == 0:
            analysis, confidence = self.analyze(price)
            self.watchdog.log_ai(f"{analysis} (tick={self.tick}, time={now})")

            # Generate a trade signal if confidence is high
            if confidence >= 0.75:
                direction = "LONG" if "Bullish" in analysis else "SHORT"
                self.watchdog.log_signal(
                    direction, symbol=self.symbol,
                    confidence=confidence, reason="Strategy signal"
                )

                # Enter trade if no open position and risk check passes
                if self.position is None:
                    trade_amount = price * 0.01  # 1% of price as notional
                    if self.watchdog.check_risk(amount=trade_amount):
                        self.position = {"entry": price, "direction": direction, "qty": 0.01}
                        self.watchdog.log_buy(
                            self.symbol, qty=0.01, price=price,
                            reason=f"AI {confidence * 100:.0f}% confidence"
                        )

        # Exit position after 15 ticks (replace with your exit logic)
        if self.position and self.tick % 15 == 0:
            entry = self.position["entry"]
            qty   = self.position["qty"]
            pnl   = round((price - entry) * qty, 4)
            self.watchdog.log_sell(self.symbol, qty=qty, price=price, pnl=pnl)
            # IMPORTANT: always call record_trade() to save to dashboard
            self.watchdog.record_trade(
                self.symbol, self.position["direction"],
                qty=qty, entry_price=entry, exit_price=price, pnl=pnl,
                note=f"Auto-exit at tick {self.tick}"
            )
            self.position = None

    # ── STEP 4: Main loop ────────────────────────────────────
    def run(self):
        print(f"[BOT] Trading Bot started — Symbol: {self.symbol}")
        print(f"[BOT] Max amount per trade: {self.watchdog.max_amount or 'unlimited'}")
        print(f"[BOT] Max daily loss: {self.watchdog.max_daily_loss or 'unlimited'}")
        while self.running:
            try:
                self.on_tick()
            except Exception as e:
                print(f"[ERROR] Tick failed: {e}")
            time.sleep(3)  # TODO: adjust tick interval as needed
        print("[BOT] Bot stopped.")


if __name__ == "__main__":
    TradingBot().run()
` },
  { id: 'scraper', name: 'Web Scraper', desc: 'Extract and process data from websites', icon: '🕷️',
    code: `# Web Scraper Template
import os, json, urllib.request

TARGET_URL  = os.getenv("TARGET_URL", "https://httpbin.org/json")
OUTPUT_FILE = "scraped_data.json"

def fetch(url):
    print(f"[BOT] Fetching: {url}")
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read().decode())

def run():
    print("[BOT] Web Scraper starting...")
    data = fetch(TARGET_URL)
    with open(OUTPUT_FILE, "w") as f:
        json.dump([{"raw": data}], f, indent=2)
    print(f"[BOT] Saved → {OUTPUT_FILE}")

if __name__ == "__main__":
    run()
` },
  { id: 'automation', name: 'Automation Bot', desc: 'Scheduled tasks and workflow automation', icon: '⚙️',
    code: `# Automation Bot Template
import os, time, datetime

TASK_INTERVAL = int(os.getenv("INTERVAL_SECONDS", "5"))
MAX_RUNS      = int(os.getenv("MAX_RUNS", "3"))

def do_task(n):
    print(f"[BOT] Task #{n} at {datetime.datetime.now().strftime('%H:%M:%S')}")

def run():
    print(f"[BOT] Automation started ({MAX_RUNS} runs, {TASK_INTERVAL}s interval)")
    for i in range(1, MAX_RUNS + 1):
        do_task(i)
        if i < MAX_RUNS: time.sleep(TASK_INTERVAL)
    print("[BOT] All tasks completed.")

if __name__ == "__main__":
    run()
` },
  { id: 'notification', name: 'Notification Bot', desc: 'Send alerts via webhook, email or Slack', icon: '🔔',
    code: `# Notification Bot Template
import os, json, urllib.request

WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")
MESSAGE     = os.getenv("MESSAGE", "Watchdog bot notification triggered!")

def send_webhook(url, message):
    payload = json.dumps({"text": message}).encode()
    req = urllib.request.Request(url, data=payload,
          headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        print(f"[BOT] Webhook sent — {r.status}")

def run():
    print("[BOT] Notification Bot starting...")
    if not WEBHOOK_URL:
        print("[WARN] WEBHOOK_URL not set"); return
    send_webhook(WEBHOOK_URL, MESSAGE)
    print("[BOT] Done.")

if __name__ == "__main__":
    run()
` },
]

// API connection quick-templates (same set as old api-connections page)
const API_TEMPLATES = [
  { id: 'coinbase', label: 'Coinbase',  icon: '🟡', name: 'Coinbase API', base_url: 'https://api.exchange.coinbase.com',
    hint: 'Public endpoints work without a key — just save the name to get live BTC/USD price fed into AI.' },
  { id: 'kalshi',   label: 'Kalshi',    icon: '🟢', name: 'Kalshi API',   base_url: 'https://api.elections.kalshi.com/trade-api/v2',
    hint: 'Kalshi trading API — key required to place orders.' },
  { id: 'claude',   label: 'Claude AI', icon: '🤖', name: 'Claude AI',    base_url: '',
    hint: 'Anthropic Claude — used for AI decision-making.' },
]

// ── Paid Strategies ───────────────────────────────────────────────────────────
interface PaidStrategy {
  id: string; name: string; desc: string; price: string; category: string
  icon: string; color: string; whopUrl: string; accessCodes: string[]; code: string
}

const PAID_STRATEGIES: PaidStrategy[] = [
  {
    id: 'alpha-momentum', name: 'Alpha Momentum Scalper', price: '$49/mo',
    desc: 'AI-powered momentum trading with dynamic stop-loss and take-profit. Backtested on 3+ years of crypto data.',
    category: 'Crypto', icon: '⚡', color: 'var(--accent)',
    whopUrl: 'https://whop.com/watchdog',
    accessCodes: ['ALPHA-DEMO-2024'],
    code: `# Alpha Momentum Scalper — Protected Strategy\n# Strategy code is protected and encrypted.\nimport os, time, signal\nfrom datetime import datetime, timezone\n\nclass WatchdogSDK:\n    def __init__(self):\n        self.api_url    = os.environ.get("WATCHDOG_API_URL", "http://localhost:8000")\n        self.bot_secret = os.environ.get("WATCHDOG_BOT_SECRET", "")\n    def log_price(self, s, p, change=None): print(f"[PRICE] {s}  \${p:,.4f}" + (f"  {change}" if change else ""))\n    def log_buy(self, s, qty=None, price=None, reason=None):\n        m = f"[BUY] {s}"\n        if qty: m += f"  qty={qty}"\n        if price: m += f"  @ \${price:,.4f}"\n        if reason: m += f"  | {reason}"\n        print(m)\n    def log_sell(self, s, qty=None, price=None, pnl=None):\n        m = f"[SELL] {s}"\n        if qty: m += f"  qty={qty}"\n        if price: m += f"  @ \${price:,.4f}"\n        if pnl is not None: m += f"  PnL:{'+'if pnl>=0 else ''}\${pnl:.2f}"\n        print(m)\n    def record_trade(self, symbol, side, qty=None, entry_price=None, exit_price=None, pnl=None, note=None):\n        import urllib.request, json as _j\n        p = _j.dumps({"symbol":symbol,"side":side,"quantity":qty,"entry_price":entry_price,"exit_price":exit_price,"pnl":pnl,"note":note}).encode()\n        req = urllib.request.Request(f"{self.api_url}/api/trades/record", data=p, headers={"Content-Type":"application/json","X-Bot-Secret":self.bot_secret}, method="POST")\n        try: urllib.request.urlopen(req, timeout=5)\n        except Exception as e: print(f"[WARNING] {e}")\n\nclass AlphaMomentumBot:\n    def __init__(self):\n        self.w = WatchdogSDK()\n        self.running = True\n        self.symbol = os.getenv("SYMBOL", "BTC-USDT")\n        self.tick = 0\n        self.position = None\n        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "running", False))\n    def run(self):\n        print(f"[BOT] Alpha Momentum Scalper — {self.symbol}")\n        import random\n        while self.running:\n            self.tick += 1\n            price = 67000 + random.uniform(-300, 300)\n            self.w.log_price(self.symbol, price)\n            if self.tick % 5 == 0:\n                if self.position is None and random.random() > 0.6:\n                    self.position = price\n                    self.w.log_buy(self.symbol, qty=0.01, price=price, reason="Momentum signal")\n                elif self.position:\n                    pnl = round((price - self.position) * 0.01, 4)\n                    self.w.log_sell(self.symbol, qty=0.01, price=price, pnl=pnl)\n                    self.w.record_trade(self.symbol, "LONG", qty=0.01, entry_price=self.position, exit_price=price, pnl=pnl)\n                    self.position = None\n            time.sleep(2)\n\nif __name__ == "__main__": AlphaMomentumBot().run()\n`,
  },
  {
    id: 'neural-breakout', name: 'Neural Breakout Bot', price: '$79/mo',
    desc: 'Deep learning breakout detection with multi-timeframe confirmation and automated risk management.',
    category: 'Forex & Crypto', icon: '🧠', color: '#a855f7',
    whopUrl: 'https://whop.com/watchdog',
    accessCodes: ['NEURAL-DEMO-001'],
    code: `# Neural Breakout Bot — Protected Strategy\nimport os, time, signal, random\n\nclass WatchdogSDK:\n    def __init__(self):\n        self.api_url = os.environ.get("WATCHDOG_API_URL","http://localhost:8000")\n        self.bot_secret = os.environ.get("WATCHDOG_BOT_SECRET","")\n    def log_price(self, s, p, change=None): print(f"[PRICE] {s}  \${p:,.4f}" + (f"  {change}" if change else ""))\n    def log_ai(self, t): print(f"[AI] {t}")\n    def log_signal(self, d, symbol=None, confidence=None, reason=None):\n        m = f"[SIGNAL] {d}"\n        if symbol: m += f"  {symbol}"\n        if confidence: m += f"  Confidence:{confidence*100:.0f}%"\n        if reason: m += f"  | {reason}"\n        print(m)\n    def log_buy(self, s, qty=None, price=None, reason=None):\n        m = f"[BUY] {s}"\n        if qty: m += f"  qty={qty}"\n        if price: m += f"  @ \${price:,.4f}"\n        if reason: m += f"  | {reason}"\n        print(m)\n    def log_sell(self, s, qty=None, price=None, pnl=None):\n        m = f"[SELL] {s}"\n        if pnl is not None: m += f"  PnL:{'+'if pnl>=0 else ''}\${pnl:.2f}"\n        print(m)\n    def record_trade(self, symbol, side, qty=None, entry_price=None, exit_price=None, pnl=None, note=None):\n        import urllib.request, json as _j\n        p = _j.dumps({"symbol":symbol,"side":side,"quantity":qty,"entry_price":entry_price,"exit_price":exit_price,"pnl":pnl,"note":note}).encode()\n        req = urllib.request.Request(f"{self.api_url}/api/trades/record", data=p, headers={"Content-Type":"application/json","X-Bot-Secret":self.bot_secret}, method="POST")\n        try: urllib.request.urlopen(req, timeout=5)\n        except Exception as e: print(f"[WARNING] {e}")\n\nclass NeuralBreakoutBot:\n    def __init__(self):\n        self.w = WatchdogSDK()\n        self.symbol = os.getenv("SYMBOL","ETH-USDT")\n        self.running = True\n        self.tick = 0\n        self.position = None\n        signal.signal(signal.SIGTERM, lambda *_: setattr(self,"running",False))\n    def run(self):\n        print(f"[BOT] Neural Breakout Bot — {self.symbol}")\n        while self.running:\n            self.tick += 1\n            price = 3500 + random.uniform(-50, 50)\n            self.w.log_price(self.symbol, price)\n            if self.tick % 7 == 0:\n                conf = random.uniform(0.6, 0.95)\n                self.w.log_ai(f"Breakout analysis confidence={conf*100:.1f}%")\n                self.w.log_signal("LONG" if conf > 0.75 else "NEUTRAL", symbol=self.symbol, confidence=conf)\n                if conf > 0.75 and not self.position:\n                    self.position = price\n                    self.w.log_buy(self.symbol, qty=0.05, price=price, reason=f"Neural signal {conf*100:.0f}%")\n            if self.position and self.tick % 15 == 0:\n                pnl = round((price - self.position) * 0.05, 4)\n                self.w.log_sell(self.symbol, qty=0.05, price=price, pnl=pnl)\n                self.w.record_trade(self.symbol,"LONG",qty=0.05,entry_price=self.position,exit_price=price,pnl=pnl)\n                self.position = None\n            time.sleep(3)\n\nif __name__ == "__main__": NeuralBreakoutBot().run()\n`,
  },
  {
    id: 'smart-grid', name: 'Smart Grid Strategy', price: '$39/mo',
    desc: 'Automated grid trading with dynamic range adjustment based on volatility analysis.',
    category: 'All Markets', icon: '⚙️', color: '#f59e0b',
    whopUrl: 'https://whop.com/watchdog',
    accessCodes: ['GRID-ACCESS-2024'],
    code: `# Smart Grid Strategy — Protected Strategy\nimport os, time, signal, random\n\nclass WatchdogSDK:\n    def __init__(self):\n        self.api_url = os.environ.get("WATCHDOG_API_URL","http://localhost:8000")\n        self.bot_secret = os.environ.get("WATCHDOG_BOT_SECRET","")\n    def log_price(self, s, p, change=None): print(f"[PRICE] {s}  \${p:,.4f}")\n    def log_buy(self, s, qty=None, price=None, reason=None): print(f"[BUY] {s}  qty={qty}  @ \${price:,.2f}  | {reason}")\n    def log_sell(self, s, qty=None, price=None, pnl=None): print(f"[SELL] {s}  PnL:{'+'if pnl and pnl>=0 else ''}\${pnl:.2f}" if pnl is not None else f"[SELL] {s}")\n    def record_trade(self, symbol, side, qty=None, entry_price=None, exit_price=None, pnl=None, note=None):\n        import urllib.request, json as _j\n        p = _j.dumps({"symbol":symbol,"side":side,"quantity":qty,"entry_price":entry_price,"exit_price":exit_price,"pnl":pnl,"note":note}).encode()\n        req = urllib.request.Request(f"{self.api_url}/api/trades/record", data=p, headers={"Content-Type":"application/json","X-Bot-Secret":self.bot_secret}, method="POST")\n        try: urllib.request.urlopen(req, timeout=5)\n        except Exception as e: print(f"[WARNING] {e}")\n\nclass SmartGridBot:\n    def __init__(self):\n        self.w = WatchdogSDK()\n        self.symbol = os.getenv("SYMBOL","BTC-USDT")\n        self.grid_size = float(os.getenv("GRID_SIZE","100"))\n        self.running = True\n        self.tick = 0\n        self.levels: list = []\n        signal.signal(signal.SIGTERM, lambda *_: setattr(self,"running",False))\n    def run(self):\n        print(f"[BOT] Smart Grid — {self.symbol}  grid_size={self.grid_size}")\n        base = 67000.0\n        self.levels = [base + i*self.grid_size for i in range(-3,4)]\n        while self.running:\n            self.tick += 1\n            price = base + random.uniform(-400, 400)\n            self.w.log_price(self.symbol, price)\n            for lvl in self.levels:\n                if abs(price - lvl) < self.grid_size * 0.1:\n                    pnl = round(random.uniform(-20, 35), 2)\n                    if pnl > 0:\n                        self.w.log_buy(self.symbol, qty=0.01, price=lvl, reason=f"Grid level {lvl:.0f}")\n                    else:\n                        self.w.log_sell(self.symbol, qty=0.01, price=lvl, pnl=pnl)\n                        self.w.record_trade(self.symbol,"LONG",qty=0.01,entry_price=lvl-self.grid_size,exit_price=lvl,pnl=pnl)\n            time.sleep(2)\n\nif __name__ == "__main__": SmartGridBot().run()\n`,
  },
  {
    id: 'trend-rider', name: 'Trend Rider Pro', price: '$59/mo',
    desc: 'EMA-based trend following with ATR stop-loss and automated position sizing.',
    category: 'Stocks & Futures', icon: '📈', color: '#22c55e',
    whopUrl: 'https://whop.com/watchdog',
    accessCodes: ['TREND-PRO-DEMO'],
    code: `# Trend Rider Pro — Protected Strategy\nimport os, time, signal, random\n\nclass WatchdogSDK:\n    def __init__(self):\n        self.api_url = os.environ.get("WATCHDOG_API_URL","http://localhost:8000")\n        self.bot_secret = os.environ.get("WATCHDOG_BOT_SECRET","")\n    def log_price(self, s, p, change=None): print(f"[PRICE] {s}  \${p:,.4f}")\n    def log_ai(self, t): print(f"[AI] {t}")\n    def log_signal(self, d, symbol=None, confidence=None, reason=None): print(f"[SIGNAL] {d}  {symbol}  | {reason}")\n    def log_buy(self, s, qty=None, price=None, reason=None): print(f"[BUY] {s}  qty={qty}  @ \${price:,.2f}  | {reason}")\n    def log_sell(self, s, qty=None, price=None, pnl=None): print(f"[SELL] {s}  PnL:{'+'if pnl and pnl>=0 else ''}\${pnl:.2f}" if pnl is not None else f"[SELL] {s}")\n    def record_trade(self, symbol, side, qty=None, entry_price=None, exit_price=None, pnl=None, note=None):\n        import urllib.request, json as _j\n        p = _j.dumps({"symbol":symbol,"side":side,"quantity":qty,"entry_price":entry_price,"exit_price":exit_price,"pnl":pnl,"note":note}).encode()\n        req = urllib.request.Request(f"{self.api_url}/api/trades/record", data=p, headers={"Content-Type":"application/json","X-Bot-Secret":self.bot_secret}, method="POST")\n        try: urllib.request.urlopen(req, timeout=5)\n        except Exception as e: print(f"[WARNING] {e}")\n\nclass TrendRiderBot:\n    def __init__(self):\n        self.w = WatchdogSDK()\n        self.symbol = os.getenv("SYMBOL","SPY")\n        self.running = True\n        self.tick = 0\n        self.position = None\n        signal.signal(signal.SIGTERM, lambda *_: setattr(self,"running",False))\n    def run(self):\n        print(f"[BOT] Trend Rider Pro — {self.symbol}")\n        while self.running:\n            self.tick += 1\n            price = 500 + random.uniform(-5, 5)\n            self.w.log_price(self.symbol, price)\n            if self.tick % 8 == 0:\n                trend = random.choice(["Uptrend","Downtrend","Sideways"])\n                self.w.log_ai(f"EMA analysis: {trend}  ATR=2.3")\n                if trend == "Uptrend" and not self.position:\n                    self.w.log_signal("LONG", symbol=self.symbol, confidence=0.80, reason="EMA cross")\n                    self.position = price\n                    self.w.log_buy(self.symbol, qty=10, price=price, reason="Trend confirmed")\n            if self.position and self.tick % 20 == 0:\n                pnl = round((price - self.position) * 10, 2)\n                self.w.log_sell(self.symbol, qty=10, price=price, pnl=pnl)\n                self.w.record_trade(self.symbol,"LONG",qty=10,entry_price=self.position,exit_price=price,pnl=pnl)\n                self.position = None\n            time.sleep(3)\n\nif __name__ == "__main__": TrendRiderBot().run()\n`,
  },
]

// localStorage helpers for locked bots
function getLockedBotIds(): number[] {
  try { return JSON.parse(localStorage.getItem('watchdog-locked-bots') || '[]') } catch { return [] }
}
function addLockedBotId(id: number) {
  try {
    const ids = getLockedBotIds()
    if (!ids.includes(id)) localStorage.setItem('watchdog-locked-bots', JSON.stringify([...ids, id]))
  } catch {}
}
function getBotTypes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('watchdog-bot-types') || '{}') } catch { return {} }
}
function saveBotType(id: number, type: string) {
  try {
    const m = getBotTypes(); m[String(id)] = type
    localStorage.setItem('watchdog-bot-types', JSON.stringify(m))
  } catch {}
}

const BOT_TYPE_HEADERS: Record<string, string> = {
  trading:    'Trading Bot',
  arbitrage:  'Arbitrage Bot',
  prediction: 'Prediction Market Bot',
  grid:       'Grid Trading Bot',
  dca:        'DCA Bot',
  scalping:   'Scalping Bot',
  telegram:   'Telegram Bot',
  custom:     'Custom Bot',
}

type ModalStep   = 'pick' | 'write' | 'templates' | 'strategies' | 'api'
type PanelTab    = 'overview' | 'trades' | 'logs' | 'settings'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BotsPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  // Bot list
  const [bots,    setBots]    = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [botActionErr, setBotActionErr] = useState('')

  // Create modal
  const [modal,    setModal]    = useState(false)
  const [step,     setStep]     = useState<ModalStep>('pick')
  const [mName,    setMName]    = useState('')
  const [mDesc,    setMDesc]    = useState('')
  const [mCode,    setMCode]    = useState(BLANK)
  const [mCodeLocked, setMCodeLocked] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [saveOk,   setSaveOk]   = useState(false)
  const [saveErr,  setSaveErr]  = useState('')
  const [dragOver, setDragOver] = useState(false)

  // Bot type selector (pre-creation screen)
  const [showTypeSelector, setShowTypeSelector] = useState(false)
  const [selectedBotType,  setSelectedBotType]  = useState<string | null>(null)
  const [botTypeMap,       setBotTypeMap]        = useState<Record<string, string>>({})
  useEffect(() => { setBotTypeMap(getBotTypes()) }, [])

  // Buy Strategy
  const [selectedStrategy, setSelectedStrategy] = useState<PaidStrategy | null>(null)
  const [accessModal,      setAccessModal]      = useState(false)
  const [accessInput,      setAccessInput]      = useState('')
  const [accessErr,        setAccessErr]        = useState('')

  // API connections step state
  const [apiBot,      setApiBot]      = useState<Bot | null>(null)
  const [apiConns,    setApiConns]    = useState<Conn[]>([])
  const [apiFormOpen, setApiFormOpen] = useState(false)
  const [apiName,     setApiName]     = useState('')
  const [apiBaseUrl,  setApiBaseUrl]  = useState('')
  const [apiKey,      setApiKey]      = useState('')
  const [apiSecret,   setApiSecret]   = useState('')
  const [apiShowSec,  setApiShowSec]  = useState(false)
  const [apiSaving,      setApiSaving]      = useState(false)
  const [apiSaveOk,      setApiSaveOk]      = useState(false)
  const [apiSaveErr,     setApiSaveErr]     = useState('')
  const [apiPostCreate,  setApiPostCreate]  = useState(false)  // true = arrived from creating a bot

  // ── Code-scan state (used by createBot before save) ─────────────────────
  // Mirrors the scan UX from the bot detail page's saveCode flow.
  const [scanningApis, setScanningApis] = useState(false)
  const [scanStep,     setScanStep]     = useState(0)
  // Detected APIs queued from the scan — populated into the post-create
  // API form so the user doesn't have to retype names/URLs the scanner found.
  const [detectedApiQueue, setDetectedApiQueue] = useState<DetectedApi[]>([])

  // Detail panel
  const [panel,      setPanel]      = useState<Bot | null>(null)
  const [panelTab,   setPanelTab]   = useState<PanelTab>('overview')
  const [panelLogs,  setPanelLogs]  = useState<Log[]>([])
  const [panelConns, setPanelConns] = useState<Conn[]>([])
  const [trades,     setTrades]     = useState<Trade[]>([])
  const [tradeStats, setTradeStats] = useState<Stats | null>(null)
  const [panelLoading, setPanelLoading] = useState(false)

  // Settings form state (mirrors Bot settings fields)
  const [sName,          setSName]          = useState('')
  const [sDesc,          setSDesc]          = useState('')
  const [sSchedule,      setSSchedule]      = useState<'always' | 'custom'>('always')
  const [sStart,         setSStart]         = useState('09:00')
  const [sEnd,           setSEnd]           = useState('17:00')
  const [sMaxAmount,     setSMaxAmount]     = useState('')
  const [sMaxContracts,  setSMaxContracts]  = useState('')
  const [sMaxLoss,       setSMaxLoss]       = useState('')
  const [sAutoRestart,   setSAutoRestart]   = useState(false)
  const [panelCodeParams,setPanelCodeParams]= useState<BotParam[]>([])
  const [sSaving,        setSSaving]        = useState(false)
  const [sSaved,         setSSaved]         = useState(false)
  const [sSaveErr,       setSSaveErr]       = useState('')

  // AI Fix modal
  const [aiFixOpen,      setAiFixOpen]      = useState(false)
  const [aiFixLogs,      setAiFixLogs]      = useState<string[]>([])

  // ── Load bots (polls every 3 s; also syncs open panel's bot reference) ──────
  const loadBots = useCallback(async () => {
    try {
      const r = await botsApi.getAll()
      const fresh: Bot[] = r.data
      setBots(fresh)
      // Keep the open panel's bot object in sync (status, run_count, etc.)
      setPanel(prev => {
        if (!prev) return prev
        const updated = fresh.find(b => b.id === prev.id)
        return updated ?? prev
      })
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    loadBots()
    const t = setInterval(loadBots, 3000)
    return () => clearInterval(t)
  }, [router, loadBots])
  useOnlineStatus(loadBots)  // immediate reload on reconnect

  // ── Load panel data when a bot is selected ─────────────────────────────────
  const loadPanel = useCallback(async (bot: Bot) => {
    setPanelLoading(true)
    try {
      const [l, c, t, s] = await Promise.all([
        botsApi.getLogs(bot.id, 200),
        connectionsApi.getByBot(bot.id),
        tradesApi.getByBot(bot.id),
        tradesApi.getStats(bot.id),
      ])
      setPanelLogs(l.data)
      setPanelConns(c.data)
      setTrades(t.data)
      setTradeStats(s.data)
    } catch {}
    setPanelLoading(false)
  }, [])

  // ── Live log streaming while a panel is open ──────────────────────────────
  // Uses since_id so each poll only fetches NEW lines (zero flicker, instant).
  // Interval: 1.5 s when RUNNING, 4 s otherwise.
  const panelIdRef   = useRef<number | null>(null)
  const sinceIdRef   = useRef<number>(0)

  useEffect(() => {
    panelIdRef.current = panel?.id ?? null
    // Reset since_id whenever the panel changes (fresh bot opened)
    sinceIdRef.current = 0
  }, [panel?.id])

  useEffect(() => {
    if (!panel) return

    let cancelled = false

    const pollLogs = async () => {
      if (cancelled || panelIdRef.current !== panel.id) return
      try {
        if (sinceIdRef.current === 0) {
          // First load: fetch latest 200 (desc) so we have history
          const r = await botsApi.getLogs(panel.id, 200, 0)
          if (!cancelled && r.data.length > 0) {
            setPanelLogs(r.data)
            sinceIdRef.current = Math.max(...(r.data as Log[]).map((l: Log) => l.id))
          }
        } else {
          // Incremental fetch: only new lines since last poll (asc order)
          const r = await botsApi.getLogs(panel.id, 500, sinceIdRef.current)
          if (!cancelled && r.data.length > 0) {
            const newLines: Log[] = r.data
            sinceIdRef.current = Math.max(...newLines.map((l: Log) => l.id))
            // Prepend to existing (panel displays desc)
            setPanelLogs(prev => [...newLines, ...prev].slice(0, 500))
          }
        }
      } catch { /* ignore transient errors */ }
    }

    // Poll immediately, then on interval
    pollLogs()
    const isRunning = () => panelIdRef.current !== null &&
      bots.find(b => b.id === panelIdRef.current)?.status === 'RUNNING'

    const tick = setInterval(() => {
      pollLogs()
    }, isRunning() ? 1500 : 4000)

    return () => { cancelled = true; clearInterval(tick) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel?.id])

  // Shorten interval to 1.5 s when bot starts running
  // (achieved by re-mounting the above effect when status flips to RUNNING)
  const panelStatus = bots.find(b => b.id === panel?.id)?.status
  const prevPanelStatus = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!panel) return
    if (prevPanelStatus.current !== panelStatus) {
      prevPanelStatus.current = panelStatus
      // Force log re-poll immediately on status change (e.g. RUNNING → IDLE)
      if (panelStatus) {
        botsApi.getLogs(panel.id, 500, sinceIdRef.current)
          .then(r => {
            if (r.data.length > 0) {
              const newLines: Log[] = r.data
              sinceIdRef.current = Math.max(...newLines.map((l: Log) => l.id))
              setPanelLogs(prev => [...newLines, ...prev].slice(0, 500))
            }
          }).catch(() => {})
      }
    }
  }, [panelStatus, panel])

  // ── API connections step helpers ──────────────────────────────────────────
  const loadApiConns = useCallback(async (botId: number) => {
    try { const r = await connectionsApi.getByBot(botId); setApiConns(r.data) } catch {}
  }, [])

  const selectApiBot = (bot: Bot) => {
    setApiBot(bot)
    loadApiConns(bot.id)
    setApiFormOpen(false)
    setApiSaveOk(false); setApiSaveErr('')
  }

  const applyApiTemplate = (t: typeof API_TEMPLATES[0]) => {
    setApiName(t.name); setApiBaseUrl(t.base_url); setApiKey(''); setApiSecret('')
    setApiSaveOk(false); setApiSaveErr(''); setApiFormOpen(true)
  }

  const saveApiConn = async () => {
    if (!apiBot || !apiName.trim()) return
    setApiSaving(true); setApiSaveOk(false); setApiSaveErr('')
    try {
      await connectionsApi.create({
        bot_id: apiBot.id,
        name: apiName.trim(),
        base_url: apiBaseUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
        api_secret: apiSecret.trim() || undefined,
      })
      setApiSaveOk(true)
      loadApiConns(apiBot.id)
      setTimeout(() => setApiSaveOk(false), 3000)

      // If we still have detected APIs queued from the create-bot scan,
      // advance to the next one and keep the form open so the user can
      // configure them in sequence. Only when the queue is drained do we
      // close the form (matching the old behavior).
      if (detectedApiQueue.length > 0) {
        const [next, ...rest] = detectedApiQueue
        setDetectedApiQueue(rest)
        setApiName(next.name || '')
        setApiBaseUrl(next.baseUrl || '')
        setApiKey('')
        setApiSecret('')
        // form stays open
      } else {
        setApiName(''); setApiKey(''); setApiSecret(''); setApiBaseUrl('')
        setApiFormOpen(false)
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setApiSaveErr(msg || 'Failed to save. Make sure the backend is running.')
    }
    setApiSaving(false)
  }

  const removeApiConn = async (id: number) => {
    if (!apiBot || !confirm('Remove this API key?')) return
    try { await connectionsApi.delete(id); loadApiConns(apiBot.id) } catch {}
  }

  const seedSettings = (bot: Bot) => {
    setSName(bot.name)
    setSDesc(bot.description || '')
    setSSchedule((bot.schedule_type as 'always' | 'custom') || 'always')
    setSStart(bot.schedule_start || '09:00')
    setSEnd(bot.schedule_end || '17:00')
    setSMaxAmount(bot.max_amount_per_trade != null ? String(bot.max_amount_per_trade) : '')
    setSMaxContracts(bot.max_contracts_per_trade != null ? String(bot.max_contracts_per_trade) : '')
    setSMaxLoss(bot.max_daily_loss != null ? String(bot.max_daily_loss) : '')
    setSAutoRestart(bot.auto_restart || false)
    setPanelCodeParams(extractParams(bot.code))
    setSSaved(false)
  }

  const openPanel = (bot: Bot) => {
    // Reset streaming state before switching bots
    sinceIdRef.current = 0
    setPanelLogs([])
    setPanel(bot)
    setPanelTab('overview')
    seedSettings(bot)
    // Load connections, trades, stats (logs are handled by the live-stream effect)
    setPanelLoading(true)
    Promise.all([
      connectionsApi.getByBot(bot.id),
      tradesApi.getByBot(bot.id),
      tradesApi.getStats(bot.id),
    ]).then(([c, t, s]) => {
      setPanelConns(c.data)
      setTrades(t.data)
      setTradeStats(s.data)
    }).catch(() => {}).finally(() => setPanelLoading(false))
  }

  const closePanel = () => {
    sinceIdRef.current = 0
    setPanelLogs([])
    setPanel(null)
  }

  // Open AI Fix modal — pre-populate with ERROR/WARNING lines from panel logs
  const openAiFix = () => {
    const errLines = panelLogs
      .filter(l => l.level === 'ERROR' || l.level === 'WARNING')
      .slice(-60)
      .map(l => `${l.created_at} | ${l.level.padEnd(7)} | ${l.message}`)
    setAiFixLogs(errLines)
    setAiFixOpen(true)
  }

  const saveSettings = async () => {
    if (!panel) return
    setSSaving(true); setSSaveErr('')
    const updatedCode = applyParams(panel.code, panelCodeParams)
    try {
      await botsApi.update(panel.id, {
        name: sName.trim() || panel.name,
        description: sDesc.trim() || undefined,
        code: updatedCode,
        schedule_type: sSchedule,
        schedule_start: sSchedule === 'custom' ? sStart : undefined,
        schedule_end:   sSchedule === 'custom' ? sEnd   : undefined,
        max_amount_per_trade:    sMaxAmount    ? parseFloat(sMaxAmount)    : undefined,
        max_contracts_per_trade: sMaxContracts ? parseInt(sMaxContracts)   : undefined,
        max_daily_loss:          sMaxLoss      ? parseFloat(sMaxLoss)      : undefined,
        auto_restart: sAutoRestart,
      })
      setSSaved(true)
      setTimeout(() => setSSaved(false), 3000)
      loadBots()
    } catch { setSSaveErr('Save failed — check that the backend is running.') }
    setSSaving(false)
  }

  // Refresh panel data when bots list updates (status changes)
  useEffect(() => {
    if (panel) {
      const fresh = bots.find(b => b.id === panel.id)
      if (fresh) { setPanel(fresh); }
    }
  }, [bots]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bot actions ────────────────────────────────────────────────────────────
  const runBot  = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); setBotActionErr('')
    try { await botsApi.run(id);  loadBots() }
    catch { setBotActionErr('Failed to start bot — check that the backend is running.') }
  }
  const stopBot = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); setBotActionErr('')
    try { await botsApi.stop(id); loadBots() }
    catch { setBotActionErr('Failed to stop bot.') }
  }
  const delBot  = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this bot? This cannot be undone.')) return
    setBotActionErr('')
    try { await botsApi.delete(id); if (panel?.id === id) closePanel(); loadBots() }
    catch { setBotActionErr('Failed to delete bot — check that the backend is running.') }
  }

  // ── Create modal ───────────────────────────────────────────────────────────
  const openModal  = () => {
    setStep('pick'); setMName(''); setMDesc(''); setMCode(BLANK)
    setSaveOk(false); setSaveErr('')
    // Reset API step
    setApiBot(null); setApiConns([]); setApiFormOpen(false)
    setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiSecret('')
    setApiSaveOk(false); setApiSaveErr('')
    setApiPostCreate(false)
    setModal(true)
  }
  const closeModal = () => {
    setModal(false)
    setMCodeLocked(false)
    setSelectedStrategy(null)
    setAccessModal(false)
    setAccessInput('')
    setAccessErr('')
  }

  const validateAccessCode = () => {
    if (!selectedStrategy) return
    const code = accessInput.trim().toUpperCase()
    if (selectedStrategy.accessCodes.includes(code)) {
      // Valid — load the strategy code locked
      setMCode(selectedStrategy.code)
      setMName(selectedStrategy.name)
      setMDesc(selectedStrategy.desc)
      setMCodeLocked(true)
      setAccessModal(false)
      setStep('write')
    } else {
      setAccessErr('Invalid access code. Please check and try again.')
    }
  }

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.py')) return
    const r = new FileReader()
    r.onload = e => {
      setMCode(e.target?.result as string)
      if (!mName) setMName(file.name.replace('.py', ''))
      setSaveErr(''); setSaveOk(false); setStep('write')
    }
    r.readAsText(file)
  }
  const useTemplate = (tpl: typeof BOT_TEMPLATES[0]) => {
    setMCode(tpl.code); if (!mName) setMName(tpl.name); setMDesc(tpl.desc)
    setSaveErr(''); setSaveOk(false); setStep('write')
  }
  const createBot = async () => {
    if (!mName.trim()) { setSaveErr('Bot name is required.'); return }
    if (!mCode.trim()) { setSaveErr('Please add some code before saving.'); return }
    setSaving(true); setSaveErr(''); setSaveOk(false)

    // ── 1. Deep scan animation — same UX as Edit Code → Save ──────────────
    // (Was missing from the new-bot creation flow. Without this, the user
    // got no feedback that anything was happening, and detected APIs were
    // never surfaced.)
    setScanningApis(true)
    setScanStep(0)
    const STEP_DELAYS = [900, 1800, 2700, 3600, 4500]
    const stepTimers = STEP_DELAYS.map((ms, i) => setTimeout(() => setScanStep(i + 1), ms))
    await new Promise<void>(resolve => setTimeout(resolve, 5000))
    stepTimers.forEach(clearTimeout)
    setScanningApis(false)
    setScanStep(0)

    // ── 2. Run actual API detection — prefer AI result, fallback to local ──
    let aiApis: AnalyzeResponse['detected_apis'] | null = null
    try {
      const ar = await analyzeApi.analyze(mCode)
      aiApis = ar.data.detected_apis
    } catch { /* AI backend unavailable — fall back to local regex detector */ }
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
      : detectAllApis(mCode)

    try {
      const res = await botsApi.create({ name: mName.trim(), description: mDesc || undefined, code: mCode })
      if (mCodeLocked && res?.data?.id) addLockedBotId(res.data.id)
      if (res?.data?.id && selectedBotType) {
        saveBotType(res.data.id, selectedBotType)
        setBotTypeMap(getBotTypes())
      }
      // Auto-create training_data folder structure for this bot
      if (res?.data?.id) {
        try { await trainerApi.initBot(res.data.id, mName.trim()) } catch { /* non-critical */ }
      }
      setSaveOk(true)
      await loadBots()
      // Automatically open Add API Connection screen for the newly created bot.
      // Pre-fill the form with the FIRST detected API so the user sees that the
      // scan worked. Remaining detected APIs go into the queue and are picked up
      // automatically as the user saves each one (see saveApi for the advance).
      if (res?.data) {
        const newBot = res.data as Bot
        const [first, ...rest] = detected
        setDetectedApiQueue(rest)
        setTimeout(() => {
          setSaveOk(false)
          setApiBot(newBot)
          setApiConns([])
          setApiFormOpen(true)
          // Pre-fill if scan found something, otherwise blank like before
          setApiName(first?.name || '')
          setApiBaseUrl(first?.baseUrl || '')
          setApiKey('')
          setApiSecret('')
          setApiSaveOk(false); setApiSaveErr('')
          setApiPostCreate(true)
          setStep('api')
        }, 700)
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSaveErr(msg || 'Failed to save bot. Make sure the backend is running.')
    }
    setSaving(false)
  }

  // ── Post-create API helpers ────────────────────────────────────────────────
  const addAnotherApi = async () => {
    if (!apiBot || !apiName.trim()) return
    setApiSaving(true); setApiSaveErr('')
    try {
      await connectionsApi.create({
        bot_id: apiBot.id,
        name: apiName.trim(),
        base_url: apiBaseUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
        api_secret: apiSecret.trim() || undefined,
      })
      await loadApiConns(apiBot.id)
      // Clear form for next entry
      setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiSecret('')
      setApiSaveErr('')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setApiSaveErr(msg || 'Failed to save. Make sure the backend is running.')
    }
    setApiSaving(false)
  }

  const saveAndExit = async () => {
    // If the form has a name filled in, save it before exiting
    if (apiBot && apiName.trim()) {
      setApiSaving(true); setApiSaveErr('')
      try {
        await connectionsApi.create({
          bot_id: apiBot.id,
          name: apiName.trim(),
          base_url: apiBaseUrl.trim() || undefined,
          api_key: apiKey.trim() || undefined,
          api_secret: apiSecret.trim() || undefined,
        })
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        setApiSaveErr(msg || 'Failed to save. Make sure the backend is running.')
        setApiSaving(false)
        return
      }
      setApiSaving(false)
    }
    closeModal()
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}>
      <div className="w-9 h-9 border-2 border-[#00f5ff] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const panelBotType = panel ? (botTypeMap[String(panel.id)] ?? '') : ''

  // Scan animation step labels — same wording as the bot detail page so the
  // user gets a consistent experience whether creating or editing a bot.
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

      {/* ── Deep-scan overlay (shown while createBot is scanning code) ──
          Same UX as Edit Code → Save in the bot detail page. */}
      {scanningApis && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(4,6,18,0.85)', backdropFilter: 'blur(12px)' }}
        >
          <div className="flex flex-col items-center gap-6" style={{ maxWidth: 480, padding: 24 }}>
            <div className="flex items-center gap-3">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: '#a78bfa',
                    boxShadow: '0 0 16px rgba(167,139,250,0.6)',
                    animation: `wd-bounce 1.1s ease-in-out ${i * 0.18}s infinite`,
                  }}
                />
              ))}
            </div>
            <div className="text-center">
              <div
                style={{
                  fontSize: 22, fontWeight: 900, color: '#fff',
                  letterSpacing: '-0.02em',
                  fontFamily: 'Poppins, Inter, system-ui, sans-serif',
                  marginBottom: 6,
                }}
              >
                Deep scanning for API credentials…
              </div>
              <div
                style={{
                  fontSize: 13, color: 'rgba(255,255,255,0.55)',
                  letterSpacing: '0.04em',
                  minHeight: 20,
                }}
              >
                {SCAN_STEPS[Math.min(scanStep, SCAN_STEPS.length - 1)]}
              </div>
            </div>
          </div>
          <style>{`
            @keyframes wd-bounce {
              0%, 80%, 100% { transform: translateY(0) scale(0.85); opacity: 0.45 }
              40%           { transform: translateY(-10px) scale(1);  opacity: 1 }
            }
          `}</style>
        </div>
      )}

      <div className="flex" style={{minHeight:'100vh'}}>
        <main className="min-w-0 pl-0 pr-8 py-10" style={{width:'100%'}}>
        {/* Action error banner */}
        {botActionErr && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-6 text-sm font-semibold"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
            {botActionErr}
            {panel && (
              <button onClick={openAiFix}
                className="flex items-center gap-1.5 ml-3 text-xs font-bold px-3 py-1 rounded-lg transition-all hover:scale-105"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid rgba(0,245,255,0.25)' }}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
                Fix with Cloud AI
              </button>
            )}
            <button onClick={() => setBotActionErr('')} className="ml-auto text-red-400/60 hover:text-red-400">✕</button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold text-white">My Bots</h1>
            <p className="text-slate-500 mt-1.5">
              {bots.length} bot{bots.length !== 1 ? 's' : ''} · {bots.filter(b => b.status === 'RUNNING').length} running
            </p>
          </div>
          <button onClick={() => setShowTypeSelector(true)}
            className="flex items-center gap-2.5 font-bold px-6 py-3.5 rounded-2xl text-sm transition-all hover:scale-[1.03]"
            style={{ background: 'var(--accent)', color: BG, boxShadow: '0 0 28px var(--accent)' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Bot
          </button>
        </div>

        {/* Bot grid */}
        {bots.length === 0 ? (
          <div className="rounded-3xl p-20 text-center" style={{ ...CARD, border: '1px dashed rgba(255,255,255,0.1)' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'rgba(255,255,255,0.04)' }}>
              <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            </div>
            <p className="text-slate-300 font-semibold text-lg">No bots yet</p>
            <p className="text-slate-600 mt-1">Create your first bot to get started</p>
            <button onClick={() => setShowTypeSelector(true)} className="mt-6 text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              style={{ color: 'var(--accent)', border: '1px solid var(--accent)', background: 'var(--accent-dim)' }}>
              + Create a bot
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {bots.map(bot => {
              const st      = STATUS[bot.status] || STATUS.IDLE
              const isOpen  = panel?.id === bot.id
              return (
                <div key={bot.id}
                  onClick={() => openPanel(bot)}
                  className="rounded-3xl p-6 cursor-pointer group transition-all duration-200 hover:scale-[1.015]"
                  style={{
                    ...CARD,
                    border: isOpen
                      ? `1.5px solid ${st.color}55`
                      : '1px solid rgba(255,255,255,0.07)',
                    boxShadow: isOpen ? st.glow : undefined,
                  }}>

                  {/* Top row */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-bold text-white text-lg leading-tight truncate
                          group-hover:text-[#00f5ff] transition-colors duration-200">
                          {bot.name}
                        </h3>
                        {/* Click hint */}
                        <svg className="w-3.5 h-3.5 text-slate-700 group-hover:text-[#00f5ff] transition-colors shrink-0"
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      {bot.description && (
                        <p className="text-slate-500 text-xs truncate">{bot.description}</p>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full shrink-0"
                      style={{ color: st.color, background: st.bg, boxShadow: st.glow }}>
                      <span className={`w-1.5 h-1.5 rounded-full${st.pulse ? ' animate-pulse' : ''}`}
                        style={{ background: st.color }} />
                      {st.label}
                    </span>
                  </div>

                  {/* Stats bar */}
                  <div className="flex items-center gap-5 mb-5 py-3 px-4 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.025)' }}>
                    <div>
                      <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider">Runs</p>
                      <p className="text-white font-bold text-lg mt-0.5">{bot.run_count}</p>
                    </div>
                    <div className="w-px h-7 bg-white/10" />
                    <div>
                      <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider">Last Run</p>
                      <p className="text-slate-300 font-medium text-sm mt-0.5">{timeAgo(bot.last_run_at)}</p>
                    </div>
                    <div className="ml-auto text-xs text-slate-600 group-hover:text-slate-400 transition-colors">
                      Click to view details
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {bot.status === 'RUNNING' ? (
                      <button onClick={e => stopBot(bot.id, e)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                        style={{ background: 'rgba(255,68,68,0.12)', color: '#ff4444', border: '1px solid rgba(255,68,68,0.25)' }}>
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                        Stop
                      </button>
                    ) : (
                      <button onClick={e => runBot(bot.id, e)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                        style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid rgba(0,245,255,0.25)' }}>
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        Run
                      </button>
                    )}
                    <button onClick={e => { e.stopPropagation(); router.push(`/bots/detail?id=${bot.id}&edit=1`) }}
                      className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                      style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid var(--border)' }}>
                      Edit
                    </button>
                    <button onClick={e => delBot(bot.id, e)}
                      className="ml-auto p-2 rounded-xl transition-all text-slate-700 hover:text-red-400"
                      style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
      </div>

      {/* ── Detail side panel ─────────────────────────────────────────────────── */}
      {panel && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/50" style={{ backdropFilter: 'blur(4px)' }}
            onClick={closePanel} />

          {/* Panel */}
          <div className="fixed right-0 top-0 h-full z-50 flex flex-col overflow-hidden"
            style={{
              width: '600px',
              background: 'rgba(6,9,20,0.97)',
              borderLeft: '1px solid rgba(255,255,255,0.09)',
              backdropFilter: 'blur(30px)',
            }}>

            {/* Panel header */}
            {(() => {
              const st = STATUS[panel.status] || STATUS.IDLE
              return (
                <div className="flex items-start justify-between p-7 pb-5 border-b border-white/[0.06]">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-xl font-bold text-white truncate">
                        {panelBotType && BOT_TYPE_HEADERS[panelBotType] ? BOT_TYPE_HEADERS[panelBotType] : panel.name}
                      </h2>
                      <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full shrink-0"
                        style={{ color: st.color, background: st.bg, boxShadow: st.glow }}>
                        <span className={`w-1.5 h-1.5 rounded-full${st.pulse ? ' animate-pulse' : ''}`}
                          style={{ background: st.color }} />
                        {st.label}
                      </span>
                    </div>
                    {panelBotType && BOT_TYPE_HEADERS[panelBotType] ? (
                      <p className="text-slate-500 text-sm">{panel.name}</p>
                    ) : panel.description ? (
                      <p className="text-slate-500 text-sm">{panel.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {panel.status === 'RUNNING' ? (
                      <button onClick={e => stopBot(panel.id, e)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
                        style={{ background: 'rgba(255,68,68,0.12)', color: '#ff4444', border: '1px solid rgba(255,68,68,0.25)' }}>
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                        Stop
                      </button>
                    ) : (
                      <button onClick={e => runBot(panel.id, e)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
                        style={{ background: 'var(--accent)', color: BG, boxShadow: '0 0 14px var(--accent)' }}>
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        Run
                      </button>
                    )}

                    {/* ── Fix with AI (only when there are ERROR-level logs) ───────
                        Same conditional rule + visual treatment as the per-bot
                        detail page. Bot is healthy → button is invisible.
                        First ERROR appears → button materializes with a glowing
                        red→amber gradient + sparkle + count badge. */}
                    {(() => {
                      const errCount = panelLogs.reduce((n, l) => n + (l.level === 'ERROR' ? 1 : 0), 0)
                      if (errCount === 0) return null
                      return (
                        <button
                          onClick={openAiFix}
                          title={`${errCount} error${errCount === 1 ? '' : 's'} in recent logs — let Claude analyse and patch`}
                          className="ai-fix-cta flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-transform"
                          style={{
                            background: 'linear-gradient(135deg, #ff4444 0%, #ff8a3d 55%, #fbbf24 100%)',
                            color:      '#0a0e14',
                            border:     '1px solid rgba(255, 138, 61, 0.55)',
                            boxShadow:  '0 0 22px rgba(255, 100, 60, 0.45), 0 4px 14px rgba(255,68,68,0.18)',
                          }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px) scale(1.04)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(0)   scale(1)'}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2zm6.5 11l.9 3.1 3.1.9-3.1.9-.9 3.1-.9-3.1L15.4 17l3.1-.9.9-3.1z" />
                          </svg>
                          <span>Fix with AI</span>
                          <span
                            className="ai-fix-badge"
                            aria-hidden="true"
                            style={{
                              minWidth: 20, height: 20, padding: '0 6px',
                              borderRadius: 999, background: '#0a0e14', color: '#ffffff',
                              fontSize: 10, fontWeight: 800,
                              display: 'grid', placeItems: 'center',
                            }}
                          >
                            {errCount > 99 ? '99+' : errCount}
                          </span>
                        </button>
                      )
                    })()}

                    <button onClick={closePanel}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                      style={{ border: '1px solid var(--border)' }}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Tabs */}
            <div className="flex items-center gap-1 px-7 pt-5 pb-0">
              {([
                { key: 'overview',  label: 'Overview' },
                { key: 'trades',    label: `Trades${tradeStats && tradeStats.total_trades > 0 ? ` (${tradeStats.total_trades})` : ''}` },
                { key: 'logs',      label: `Logs${panelLogs.length > 0 ? ` (${panelLogs.length})` : ''}` },
                { key: 'settings',  label: 'Settings' },
              ] as { key: PanelTab; label: string }[]).map(t => (
                <button key={t.key} onClick={() => setPanelTab(t.key)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={panelTab === t.key
                    ? { background: 'rgba(0,245,255,0.1)', color: 'var(--accent)', border: '1px solid var(--border)' }
                    : { color: 'var(--text-muted)', border: '1px solid transparent' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto px-7 py-6">
              {panelLoading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-7 h-7 border-2 border-[#00f5ff] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* ── OVERVIEW TAB ── */}
                  {panelTab === 'overview' && (
                    <div className="space-y-5">
                      {/* Dynamic type-specific sections */}
                      <BotTypeOverview
                        botType={panelBotType}
                        panel={panel}
                        panelLogs={panelLogs}
                        panelConns={panelConns}
                        trades={trades}
                        tradeStats={tradeStats}
                      />

                      {/* API keys list */}
                      {panelConns.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">API Keys</p>
                          <div className="space-y-2">
                            {panelConns.map(c => (
                              <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                                style={{ background: 'rgba(0,245,255,0.04)', border: '1px solid rgba(0,245,255,0.12)' }}>
                                <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
                                </svg>
                                <span className="text-sm text-slate-300 font-medium">{c.name}</span>
                                <code className="ml-auto text-[12px] font-mono px-2 py-0.5 rounded"
                                  style={{ color: 'rgba(0,245,255,0.6)', background: 'var(--accent-dim)' }}>
                                  {c.name.replace(/[^A-Z0-9]+/gi,'_').toUpperCase()}_KEY
                                </code>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Bot secret hint */}
                      <div className="rounded-xl p-4" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)' }}>
                        <p className="text-xs font-bold text-indigo-400 mb-1">Record trades from this bot</p>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Use <code className="text-indigo-300 bg-indigo-900/30 px-1 rounded">os.getenv("WATCHDOG_BOT_SECRET")</code>{' '}
                          with header <code className="text-indigo-300 bg-indigo-900/30 px-1 rounded">X-Bot-Secret</code> to POST trades to{' '}
                          <code className="text-indigo-300 bg-indigo-900/30 px-1 rounded">/api/trades/record</code>.
                          See the Trading Bot template for a working example.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ── TRADES TAB ── */}
                  {panelTab === 'trades' && (
                    <div className="space-y-5">
                      {!tradeStats || tradeStats.total_trades === 0 ? (
                        <div className="rounded-2xl p-12 text-center"
                          style={{ ...CARD, border: '1px dashed rgba(255,255,255,0.08)' }}>
                          <p className="text-slate-400 font-semibold">No trade data yet</p>
                          <p className="text-slate-600 text-xs mt-2 leading-relaxed max-w-xs mx-auto">
                            Use the Trading Bot template and call{' '}
                            <code className="text-indigo-300">/api/trades/record</code> from your bot code to populate this panel.
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* ── 4 trade stat cards ── */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl p-4" style={CARD}>
                              <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-1">Total Trades</p>
                              <p className="text-3xl font-black text-white">{tradeStats.total_trades}</p>
                            </div>
                            <div className="rounded-2xl p-4" style={CARD}>
                              <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-1">Win Rate</p>
                              <p className="text-3xl font-black"
                                style={{ color: tradeStats.win_rate >= 50 ? '#00f5ff' : '#ff4444' }}>
                                {tradeStats.win_rate}%
                              </p>
                            </div>
                            <div className="rounded-2xl p-4" style={CARD}>
                              <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-1">Total P&L</p>
                              <p className="text-2xl font-black" style={{ color: pnlColor(tradeStats.total_pnl) }}>
                                {tradeStats.total_pnl >= 0 ? '+' : ''}{fmt(tradeStats.total_pnl, '$')}
                              </p>
                            </div>
                            <div className="rounded-2xl p-4" style={CARD}>
                              <p className="text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-1">Total Winning</p>
                              <p className="text-2xl font-black" style={{ color: 'var(--accent)' }}>
                                {fmt(tradeStats.total_winning, '$')}
                              </p>
                            </div>
                          </div>

                          {/* ── Win / Loss bar ── */}
                          <div className="rounded-2xl p-5" style={CARD}>
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Win vs Loss</span>
                              <div className="flex items-center gap-4 text-xs font-bold">
                                <span style={{ color: 'var(--accent)' }}>✓ {tradeStats.winning_trades} wins</span>
                                <span style={{ color: '#ff4444' }}>✗ {tradeStats.losing_trades} losses</span>
                              </div>
                            </div>
                            <div className="h-3 rounded-full overflow-hidden flex"
                              style={{ background: 'rgba(255,255,255,0.06)' }}>
                              {tradeStats.total_trades > 0 && (
                                <>
                                  <div className="h-full rounded-l-full transition-all"
                                    style={{
                                      width: `${(tradeStats.winning_trades / tradeStats.total_trades) * 100}%`,
                                      background: 'linear-gradient(90deg, #00f5ff, #00bcd4)',
                                      boxShadow: '0 0 8px rgba(0,245,255,0.5)',
                                    }} />
                                  <div className="h-full rounded-r-full"
                                    style={{
                                      width: `${(tradeStats.losing_trades / tradeStats.total_trades) * 100}%`,
                                      background: '#ff4444',
                                    }} />
                                </>
                              )}
                            </div>
                            <div className="flex justify-between text-xs text-slate-600 mt-2">
                              <span>Won: {fmt(tradeStats.total_winning, '$')}</span>
                              <span>Lost: {fmt(tradeStats.total_losing, '$')}</span>
                            </div>
                          </div>

                          {/* ── Trade history table ── */}
                          <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                              Trade History ({trades.length})
                            </p>
                            <div className="rounded-2xl overflow-hidden" style={CARD}>
                              {/* Table header */}
                              <div className="grid text-[12px] font-black text-slate-600 uppercase tracking-wider px-4 py-3 border-b border-white/[0.05]"
                                style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
                                <span>Date</span>
                                <span>Symbol</span>
                                <span>Side</span>
                                <span>Entry</span>
                                <span>Exit</span>
                                <span className="text-right">P&L</span>
                              </div>
                              <div className="max-h-[340px] overflow-y-auto">
                                {trades.map(t => (
                                  <div key={t.id}
                                    className="grid items-center px-4 py-3 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors text-xs"
                                    style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
                                    <span className="text-slate-500 tabular-nums">
                                      {formatTradeDateCT(t.created_at)} CT
                                    </span>
                                    <span className="text-slate-300 font-mono font-bold">{t.symbol}</span>
                                    <span className="font-bold" style={{ color: t.side === 'BUY' || t.side === 'LONG' ? '#00f5ff' : '#f59e0b' }}>
                                      {t.side}
                                    </span>
                                    <span className="text-slate-400 font-mono">{fmt(t.entry_price, '$')}</span>
                                    <span className="text-slate-400 font-mono">{fmt(t.exit_price, '$')}</span>
                                    <span className="text-right font-black font-mono tabular-nums"
                                      style={{ color: pnlColor(t.pnl) }}>
                                      {t.pnl != null ? (t.pnl >= 0 ? '+' : '') + fmt(t.pnl, '$') : '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── SETTINGS TAB ── */}
                  {panelTab === 'settings' && (
                    <div className="space-y-6 pb-4">

                      {/* ── Code Parameters ── */}
                      <section>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(0,245,255,0.1)', border: '1px solid rgba(0,245,255,0.2)' }}>
                            <svg className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                            </svg>
                          </div>
                          <h3 className="text-sm font-bold text-white">Code Parameters</h3>
                          {panelCodeParams.length > 0 && (
                            <span className="text-[12px] text-slate-600 font-mono ml-1">· {panelCodeParams.length} detected</span>
                          )}
                        </div>

                        {panelCodeParams.length === 0 ? (
                          <div className="rounded-2xl px-4 py-5 text-center"
                            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <p className="text-xs text-slate-500 mb-1">No parameters detected in bot code.</p>
                            <p className="text-[12px] text-slate-700">Use <code className="text-slate-500">os.getenv("VAR","default")</code> or top-level <code className="text-slate-500">VAR = value</code> assignments.</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {groupParams(panelCodeParams).map(group => {
                              const meta = SECTION_META[group.section] ?? SECTION_META['General']
                              return (
                                <div key={group.section} className="rounded-2xl overflow-hidden"
                                  style={{ border: `1px solid ${meta.color}22`, background: meta.bg }}>
                                  <div className="flex items-center gap-2 px-4 py-2 border-b"
                                    style={{ borderColor: `${meta.color}18` }}>
                                    <span className="text-sm">{meta.icon}</span>
                                    <span className="text-[13.2px] font-black uppercase tracking-widest"
                                      style={{ color: meta.color }}>{group.section}</span>
                                  </div>
                                  <div className="px-4 py-2.5 space-y-2.5">
                                    {group.params.map(p => {
                                      const idx = panelCodeParams.findIndex(x => x.name === p.name)
                                      const update = (val: string) => {
                                        const next = [...panelCodeParams]
                                        next[idx] = { ...panelCodeParams[idx], value: val }
                                        setPanelCodeParams(next)
                                      }
                                      return (
                                        <div key={p.name} className="flex items-center gap-3">
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-slate-300 truncate">{p.label}</p>
                                            <p className="text-[12px] font-mono text-slate-600 truncate">{p.name}</p>
                                          </div>
                                          {p.type === 'boolean' ? (
                                            <button
                                              onClick={() => update(p.value === 'True' ? 'False' : 'True')}
                                              className="relative shrink-0 w-10 h-5 rounded-full transition-colors"
                                              style={{
                                                background: p.value === 'True' ? meta.color : 'rgba(255,255,255,0.08)',
                                                border: `1px solid ${p.value === 'True' ? meta.color : 'rgba(255,255,255,0.12)'}`,
                                              }}>
                                              <span className="absolute top-0.5 transition-all rounded-full w-4 h-4 shadow"
                                                style={{
                                                  left: p.value === 'True' ? 'calc(100% - 18px)' : '1px',
                                                  background: p.value === 'True' ? '#05070f' : '#475569',
                                                }} />
                                            </button>
                                          ) : (p.type === 'integer' || p.type === 'float') ? (
                                            <div className="flex items-center gap-1 shrink-0">
                                              <button
                                                onClick={() => {
                                                  const step = getStep(p.type, p.value)
                                                  const n = parseFloat(p.value) || 0
                                                  update(p.type === 'integer' ? String(Math.round(n - step)) : parseFloat((n - step).toFixed(6)).toString())
                                                }}
                                                className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-white text-sm font-bold transition-colors"
                                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }}>−</button>
                                              <input
                                                type="number"
                                                value={p.value}
                                                step={getStep(p.type, p.value)}
                                                onChange={e => update(e.target.value)}
                                                className="w-16 text-center rounded-lg px-1 py-1 text-xs text-white focus:outline-none tabular-nums"
                                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }} />
                                              <button
                                                onClick={() => {
                                                  const step = getStep(p.type, p.value)
                                                  const n = parseFloat(p.value) || 0
                                                  update(p.type === 'integer' ? String(Math.round(n + step)) : parseFloat((n + step).toFixed(6)).toString())
                                                }}
                                                className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-white text-sm font-bold transition-colors"
                                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }}>+</button>
                                            </div>
                                          ) : (
                                            <input
                                              type={p.type === 'url' ? 'url' : 'text'}
                                              value={p.value}
                                              onChange={e => update(e.target.value)}
                                              placeholder={p.label}
                                              className="w-36 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none transition-colors shrink-0"
                                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }} />
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </section>

                      {/* ── Run Schedule ── */}
                      <section>
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(0,245,255,0.1)', border: '1px solid rgba(0,245,255,0.2)' }}>
                            <svg className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                          </div>
                          <h3 className="text-sm font-bold text-white">Run Schedule</h3>
                        </div>

                        <div className="space-y-2">
                          {/* All Day option */}
                          <button onClick={() => setSSchedule('always')}
                            className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all"
                            style={{
                              background: sSchedule === 'always' ? 'var(--accent-dim)' : 'rgba(255,255,255,0.02)',
                              border: sSchedule === 'always' ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
                            }}>
                            <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                              style={{ borderColor: sSchedule === 'always' ? '#00f5ff' : '#334155' }}>
                              {sSchedule === 'always' && (
                                <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--accent)' }} />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-bold" style={{ color: sSchedule === 'always' ? '#00f5ff' : '#e2e8f0' }}>
                                All Day
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">Run continuously 24/7 without time restrictions</p>
                            </div>
                            <span className="ml-auto text-xs font-mono px-2 py-1 rounded-lg"
                              style={{ color: 'var(--accent)', background: 'var(--accent-dim)' }}>
                              24/7
                            </span>
                          </button>

                          {/* Custom Time option */}
                          <button onClick={() => setSSchedule('custom')}
                            className="w-full flex items-start gap-4 p-4 rounded-2xl text-left transition-all"
                            style={{
                              background: sSchedule === 'custom' ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                              border: sSchedule === 'custom' ? '1.5px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.08)',
                            }}>
                            <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors"
                              style={{ borderColor: sSchedule === 'custom' ? '#6366f1' : '#334155' }}>
                              {sSchedule === 'custom' && (
                                <div className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
                              )}
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-bold mb-0.5" style={{ color: sSchedule === 'custom' ? '#818cf8' : '#e2e8f0' }}>
                                Custom Time
                              </p>
                              <p className="text-xs text-slate-500 mb-3">Define specific operating hours</p>
                              {sSchedule === 'custom' && (
                                <div className="grid grid-cols-2 gap-3" onClick={e => e.stopPropagation()}>
                                  <div>
                                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Start Time</label>
                                    <input type="time" value={sStart} onChange={e => setSStart(e.target.value)}
                                      className="w-full rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none transition-colors"
                                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.35)', colorScheme: 'dark' }} />
                                  </div>
                                  <div>
                                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">End Time</label>
                                    <input type="time" value={sEnd} onChange={e => setSEnd(e.target.value)}
                                      className="w-full rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none transition-colors"
                                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(99,102,241,0.35)', colorScheme: 'dark' }} />
                                  </div>
                                </div>
                              )}
                            </div>
                          </button>
                        </div>
                      </section>

                      {/* ── Risk Management ── */}
                      <section>
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                            <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                            </svg>
                          </div>
                          <h3 className="text-sm font-bold text-white">Risk Management</h3>
                        </div>

                        <div className="rounded-2xl p-5 space-y-4" style={CARD}>
                          <p className="text-xs text-slate-500 -mt-1">
                            These values are injected as env vars your bot code can read via <code className="text-indigo-300 bg-indigo-900/20 px-1 rounded">os.getenv()</code>.
                          </p>

                          {[
                            { label: 'Max Amount per Trade', sub: 'WATCHDOG_MAX_AMOUNT_PER_TRADE', val: sMaxAmount, set: setSMaxAmount, prefix: '$', placeholder: '1000.00', unit: 'USD' },
                            { label: 'Max Contracts per Trade', sub: 'WATCHDOG_MAX_CONTRACTS_PER_TRADE', val: sMaxContracts, set: setSMaxContracts, prefix: '#', placeholder: '10', unit: 'contracts' },
                            { label: 'Max Daily Loss Limit', sub: 'WATCHDOG_MAX_DAILY_LOSS', val: sMaxLoss, set: setSMaxLoss, prefix: '$', placeholder: '500.00', unit: 'USD' },
                          ].map(f => (
                            <div key={f.label}>
                              <div className="flex items-baseline justify-between mb-1.5">
                                <label className="text-xs font-bold text-slate-300">{f.label}</label>
                                <code className="text-[10.8px] text-slate-600 font-mono">{f.sub}</code>
                              </div>
                              <div className="flex items-center gap-0 rounded-xl overflow-hidden"
                                style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                                <span className="px-3 py-3 text-sm font-bold text-slate-500 border-r border-white/[0.08] shrink-0 select-none">
                                  {f.prefix}
                                </span>
                                <input
                                  type="number" min="0" step="any"
                                  value={f.val}
                                  onChange={e => f.set(e.target.value)}
                                  placeholder={f.placeholder}
                                  className="flex-1 bg-transparent px-3 py-3 text-sm text-white placeholder-slate-700 focus:outline-none"
                                />
                                <span className="px-3 py-3 text-xs text-slate-600 shrink-0 select-none">{f.unit}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      {/* ── General Settings ── */}
                      <section>
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(100,116,139,0.15)', border: '1px solid rgba(100,116,139,0.25)' }}>
                            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                            </svg>
                          </div>
                          <h3 className="text-sm font-bold text-white">General Settings</h3>
                        </div>

                        <div className="rounded-2xl p-5 space-y-4" style={CARD}>
                          {/* Bot Name */}
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Bot Name</label>
                            <input value={sName} onChange={e => setSName(e.target.value)}
                              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                          </div>

                          {/* Bot Description */}
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Description</label>
                            <textarea value={sDesc} onChange={e => setSDesc(e.target.value)} rows={2}
                              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors resize-none"
                              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                              placeholder="What does this bot do?"
                              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                          </div>

                          {/* Auto Restart toggle */}
                          <div className="flex items-center justify-between py-1">
                            <div>
                              <p className="text-sm font-bold text-white">Auto Restart if Crashed</p>
                              <p className="text-xs text-slate-500 mt-0.5">Automatically restart after an unexpected crash</p>
                            </div>
                            <button
                              onClick={() => setSAutoRestart(v => !v)}
                              className="relative w-12 h-6 rounded-full transition-all duration-200 shrink-0"
                              style={{ background: sAutoRestart ? '#00f5ff' : 'rgba(255,255,255,0.1)' }}>
                              <span
                                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
                                style={{ left: sAutoRestart ? '26px' : '2px' }} />
                            </button>
                          </div>
                        </div>
                      </section>

                      {/* ── Save error ── */}
                      {sSaveErr && (
                        <p className="text-xs text-red-400 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">{sSaveErr}</p>
                      )}

                      {/* ── Save button ── */}
                      <button onClick={saveSettings} disabled={sSaving}
                        className="w-full py-3.5 rounded-2xl font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        style={{
                          background: sSaved ? 'rgba(0,245,255,0.15)' : '#00f5ff',
                          color: sSaved ? '#00f5ff' : BG,
                          border: sSaved ? '1px solid var(--accent)' : 'none',
                          boxShadow: sSaving || sSaved ? 'none' : '0 0 22px rgba(0,245,255,0.35)',
                        }}>
                        {sSaving ? (
                          <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving...</>
                        ) : sSaved ? (
                          <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg> Settings Saved</>
                        ) : (
                          'Save Settings'
                        )}
                      </button>

                      {/* ── Fix with Cloud AI — only when there are ERROR-level logs ── */}
                      {panelLogs.some(l => l.level === 'ERROR') && (
                        <button onClick={openAiFix}
                          className="w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 hover:scale-[1.01]"
                          style={{
                            background: 'var(--accent-dim)',
                            color: 'var(--accent)',
                            border: '1px solid rgba(0,245,255,0.2)',
                          }}>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                          </svg>
                          Fix with Cloud AI
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── LOGS TAB ── */}
                  {panelTab === 'logs' && (
                    <div className="rounded-2xl overflow-hidden" style={CARD}>
                      {/* Logs tab header with Debug button */}
                      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05]">
                        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                          {panelLogs.length} log{panelLogs.length !== 1 ? 's' : ''}
                        </span>
                        {/* Only show when there are ERROR logs, matching the global rule. */}
                        {panelLogs.some(l => l.level === 'ERROR') && (
                          <button onClick={openAiFix}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition-all hover:scale-105"
                            style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid rgba(0,245,255,0.2)' }}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                            </svg>
                            Debug with Cloud AI
                          </button>
                        )}
                      </div>
                      <div className="h-[490px] overflow-y-auto p-5 font-mono text-xs space-y-2">
                        {panelLogs.length === 0 ? (
                          <p className="text-slate-600 text-center pt-20 font-sans text-sm">No logs yet. Run the bot.</p>
                        ) : (
                          [...panelLogs].reverse().map(log => (
                            <div key={log.id} className="flex gap-3">
                              <span className="text-slate-600 shrink-0 tabular-nums">
                                {formatTimeCT(log.created_at)}
                              </span>
                              <span className="shrink-0 font-black" style={{ color: LOG_COLOR[log.level] || '#94a3b8' }}>
                                [{log.level}]
                              </span>
                              <span className="text-slate-300 break-all">{log.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Bot Type Selector ─────────────────────────────────────────────────── */}
      {showTypeSelector && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-start overflow-y-auto"
          style={{ background: 'rgba(4,6,18,0.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', paddingTop: 56, paddingBottom: 40 }}>
          {/* Close */}
          <button
            onClick={() => setShowTypeSelector(false)}
            className="absolute top-6 right-6 w-12 h-12 rounded-2xl flex items-center justify-center transition-all hover:scale-110"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1.5px solid rgba(255,255,255,0.22)',
              color: '#fff',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(255,80,80,0.25)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,80,80,0.5)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.22)'
            }}
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>

          {/* Heading row with inline Back button */}
          <div className="flex items-center justify-center gap-6 mb-12">
            <button
              onClick={() => setShowTypeSelector(false)}
              className="flex items-center gap-2 px-5 h-12 rounded-2xl transition-all hover:scale-105 shrink-0"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1.5px solid rgba(255,255,255,0.18)',
                color: '#cbd5e1',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '-0.01em',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.14)'
                ;(e.currentTarget as HTMLElement).style.color = '#fff'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
                ;(e.currentTarget as HTMLElement).style.color = '#cbd5e1'
              }}
              aria-label="Back to My Bots"
            >
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M5 12l7 7M5 12l7-7"/>
              </svg>
              My Bots
            </button>
            <div className="text-center">
              <h1 className="text-4xl font-bold text-white mb-3">Choose Bot Type</h1>
              <p className="text-slate-400 text-lg">Select the type of bot you want to build</p>
            </div>
          </div>

          {/* 8 type cards — 4 on each row */}
          <div style={{ maxWidth: 980, width: '100%', padding: '0 24px' }}>
            <div className="grid grid-cols-4 gap-5">
              {BOT_TYPES.map(t => (
                <button key={t.id}
                  onClick={() => { setSelectedBotType(t.id); setShowTypeSelector(false); openModal() }}
                  className="group rounded-3xl p-7 text-left transition-all duration-200 hover:scale-[1.04]"
                  style={{ background: 'rgba(255,255,255,0.025)', border: '1.5px solid rgba(255,255,255,0.07)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = t.color + '55'
                    e.currentTarget.style.boxShadow = `0 0 32px ${t.color}20, 0 8px 32px rgba(0,0,0,0.5)`
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                    e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)'
                  }}>
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                    style={{ background: t.color + '18', border: `1px solid ${t.color}35` }}>
                    <svg className="w-7 h-7" style={{ color: t.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                      {t.paths.map((d, i) => <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
                    </svg>
                  </div>
                  <p className="font-bold text-white text-base mb-2 group-hover:text-[var(--accent)] transition-colors">{t.name}</p>
                  <p className="text-slate-500 text-xs leading-relaxed">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Create New Bot Modal ──────────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          {/* pointer-events:none is critical — without it, the backdrop intercepts
              clicks/key events on inputs in some Chromium versions. The close-on-
              outside-click is handled by the outer container, not the backdrop. */}
          <div className="absolute inset-0 bg-black/80 pointer-events-none"
               style={{ backdropFilter: 'blur(8px)' }} />
          <div className={`relative w-full ${step === 'api' ? 'max-w-3xl' : 'max-w-2xl'} rounded-3xl shadow-2xl`}
               style={{ ...MODAL, zIndex: 1 }}>

            <div className="flex items-start justify-between p-8 pb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {step === 'write'      ? 'New Bot'
                  : step === 'templates' ? 'Choose a Template'
                  : step === 'strategies'? 'Buy a Strategy'
                  : step === 'api' && apiPostCreate ? 'Add API Connections'
                  : step === 'api'       ? 'API Connections'
                  : 'Create New Bot'}
                </h2>
                <p className="text-slate-500 mt-1">
                  {step === 'write'      ? 'Name your bot and add your Python code'
                  : step === 'templates' ? 'Select a template to get started'
                  : step === 'strategies'? 'Professional strategies built for WatchDog'
                  : step === 'api' && apiPostCreate ? 'Connect your APIs — or skip and add them later'
                  : step === 'api'       ? 'Assign API keys to your bots'
                  : 'Choose how you want to add your bot'}
                </p>
              </div>
              <button onClick={closeModal}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                style={{ border: '1px solid var(--border)' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* ── PICK ── */}
            {step === 'pick' && (
              <div className="px-8 pb-8">
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { label: 'Import Code',   desc: 'Drag & drop your .py file or click to browse', color: 'var(--accent)', icon: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5', action: () => fileRef.current?.click() },
                    { label: 'Write Code',    desc: 'Start from a blank template in the code editor', color: '#6366f1', icon: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z', action: () => setStep('write') },
                    { label: 'Buy Strategy',  desc: 'Premium strategies ready to run on WatchDog', color: '#f59e0b', icon: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z', action: () => setStep('strategies') },
                  ].map(opt => (
                    <button key={opt.label} onClick={opt.action}
                      className="group rounded-2xl p-5 text-left transition-all"
                      style={{ border: `1.5px solid rgba(255,255,255,0.1)`, background: 'rgba(255,255,255,0.02)' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = opt.color + '55')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}>
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                        style={{ background: opt.color + '12', border: `1px solid ${opt.color}30` }}>
                        <svg className="w-6 h-6" style={{ color: opt.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={opt.icon}/>
                        </svg>
                      </div>
                      <p className="font-bold text-white text-sm mb-1.5">{opt.label}</p>
                      <p className="text-slate-500 text-xs leading-relaxed">{opt.desc}</p>
                    </button>
                  ))}
                  <input ref={fileRef} type="file" accept=".py" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                </div>
                {/* Drag zone */}
                <div onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                  className="rounded-xl py-4 text-center transition-all"
                  style={{ border: `1.5px dashed ${dragOver ? '#00f5ff' : 'rgba(255,255,255,0.08)'}`, background: dragOver ? 'rgba(0,245,255,0.04)' : 'transparent' }}>
                  <p className="text-slate-600 text-xs">Or drag & drop a <span className="text-slate-400">.py file</span> anywhere here</p>
                </div>

                {/* ── Divider ── */}
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <span className="text-xs text-slate-600 font-medium">or</span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                </div>

                {/* ── Add API Connection ── */}
                <button
                  onClick={() => { setApiBot(null); setApiConns([]); setApiFormOpen(false); setStep('api') }}
                  className="w-full rounded-2xl p-4 text-left transition-all flex items-center gap-4 group"
                  style={{ border: '1.5px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(34,197,94,0.45)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
                    <svg className="w-6 h-6" style={{ color: '#22c55e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm">Add API Connection</p>
                    <p className="text-slate-500 text-xs mt-0.5">Assign API keys (Coinbase, Kalshi, Claude AI) to your bots</p>
                  </div>
                  <svg className="w-5 h-5 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}

            {/* ── TEMPLATES ── */}
            {step === 'templates' && (
              <div className="px-8 pb-8">
                <p className="text-slate-500 text-sm mb-4">Select a template to get started</p>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  {BOT_TEMPLATES.map(tpl => (
                    <button key={tpl.id} onClick={() => useTemplate(tpl)}
                      className="rounded-2xl p-4 text-left transition-all hover:border-[rgba(0,245,255,0.35)]"
                      style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-2xl">{tpl.icon}</span>
                        <span className="font-bold text-white text-sm">{tpl.name}</span>
                      </div>
                      <p className="text-slate-500 text-xs">{tpl.desc}</p>
                    </button>
                  ))}
                </div>
                <button onClick={() => setStep('pick')} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">← Back</button>
              </div>
            )}

            {/* ── STRATEGIES ── */}
            {step === 'strategies' && (
              <div className="px-8 pb-8">
                <div className="space-y-3 mb-5">
                  {PAID_STRATEGIES.map(s => (
                    <div key={s.id}
                      className="rounded-2xl p-4 transition-all"
                      style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                      <div className="flex items-center gap-4">
                        {/* Icon + info */}
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                          style={{ background: s.color + '14', border: `1px solid ${s.color}30` }}>
                          {s.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-white text-sm">{s.name}</p>
                            <span className="text-[12px] font-black px-2 py-0.5 rounded-full"
                              style={{ color: s.color, background: s.color + '18', border: `1px solid ${s.color}35` }}>
                              {s.category}
                            </span>
                          </div>
                          <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{s.desc}</p>
                        </div>
                        {/* Price + buttons */}
                        <div className="shrink-0 flex flex-col items-end gap-2">
                          <p className="text-lg font-black" style={{ color: s.color }}>{s.price}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => window.open(s.whopUrl, '_blank')}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                              style={{ background: s.color, color: 'var(--bg)', boxShadow: `0 0 14px ${s.color}55` }}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                              </svg>
                              Buy Now
                            </button>
                            <button
                              onClick={() => { setSelectedStrategy(s); setAccessInput(''); setAccessErr(''); setAccessModal(true) }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                              style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.12)' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = s.color + '55'; e.currentTarget.style.color = s.color }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#94a3b8' }}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                              </svg>
                              Have Access Code?
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setStep('pick')} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">← Back</button>
              </div>
            )}

            {/* ── ACCESS CODE MODAL (inline overlay) ── */}
            {accessModal && selectedStrategy && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl"
                style={{ background: 'rgba(4,6,18,0.96)', backdropFilter: 'blur(48px) saturate(200%)', WebkitBackdropFilter: 'blur(48px) saturate(200%)' }}>
                <div className="w-full max-w-sm px-8 py-8">
                  {/* Strategy badge */}
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                      style={{ background: selectedStrategy.color + '14', border: `1px solid ${selectedStrategy.color}30` }}>
                      {selectedStrategy.icon}
                    </div>
                    <div>
                      <p className="font-bold text-white text-sm">{selectedStrategy.name}</p>
                      <p className="text-xs text-slate-500">Enter your access code to unlock</p>
                    </div>
                  </div>

                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Access Code</label>
                  <input
                    value={accessInput}
                    onChange={e => { setAccessInput(e.target.value.toUpperCase()); setAccessErr('') }}
                    onKeyDown={e => { if (e.key === 'Enter') validateAccessCode() }}
                    placeholder="e.g. ALPHA-XXXX-2024"
                    autoFocus
                    className="w-full rounded-xl px-4 py-3.5 text-sm font-mono text-white placeholder-slate-600 focus:outline-none mb-2"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: `1.5px solid ${accessErr ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.12)'}`,
                    }}
                    onFocus={e => !accessErr && (e.target.style.borderColor = selectedStrategy.color + '66')}
                    onBlur={e  => !accessErr && (e.target.style.borderColor = 'rgba(255,255,255,0.12)')} />
                  {accessErr && (
                    <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      {accessErr}
                    </p>
                  )}

                  <button
                    onClick={validateAccessCode}
                    disabled={!accessInput.trim()}
                    className="w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 mb-3 flex items-center justify-center gap-2"
                    style={{ background: selectedStrategy.color, color: 'var(--bg)', boxShadow: `0 0 18px ${selectedStrategy.color}44` }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    Unlock Strategy
                  </button>
                  <button onClick={() => { setAccessModal(false); setAccessErr('') }}
                    className="w-full py-2 text-sm text-slate-500 hover:text-slate-300 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── WRITE ── */}
            {step === 'write' && (
              <div className="px-8 pb-8">
                <div className="space-y-3 mb-4">
                  <input
                    type="text"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    value={mName}
                    onChange={e => { setMName(e.target.value); setSaveErr('') }}
                    placeholder="Bot name *"
                    className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                    style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${saveErr && !mName.trim() ? 'rgba(255,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`, position: 'relative', zIndex: 2 }}
                    onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.5)')}
                    onBlur={e => (e.target.style.borderColor = saveErr && !mName.trim() ? 'rgba(255,68,68,0.5)' : 'rgba(255,255,255,0.1)')}
                  />
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={mDesc}
                    onChange={e => setMDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', position: 'relative', zIndex: 2 }}
                    onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.5)')}
                    onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
                  />
                </div>

                {mCodeLocked ? (
                  /* ── Locked strategy view ── */
                  <div className="w-full h-52 rounded-xl flex flex-col items-center justify-center gap-3"
                    style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid var(--border)' }}>
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}>
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="#fbbf24" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                    </div>
                    <p className="font-bold text-white text-sm">Strategy Code Locked</p>
                    <p className="text-xs text-slate-500 text-center px-6">
                      This is a premium strategy. The code is protected and will run securely on the platform — you don&apos;t need to see it to use it.
                    </p>
                    <span className="text-[12px] font-black px-3 py-1 rounded-full"
                      style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}>
                      ✓ Access Code Verified
                    </span>
                  </div>
                ) : (
                  <textarea value={mCode} onChange={e => { setMCode(e.target.value); setSaveErr('') }}
                    spellCheck={false}
                    className="w-full h-52 rounded-xl p-4 text-xs font-mono resize-none focus:outline-none leading-relaxed"
                    style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid var(--border)', color: 'var(--accent)' }} />
                )}

                {/* AI Note box — only for non-locked bots */}
                {!mCodeLocked && (
                  <div className="mt-3 flex items-start gap-3 px-4 py-3.5 rounded-xl"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }}>
                    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="#ef4444" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    </svg>
                    <p className="text-sm leading-relaxed" style={{ color: '#fca5a5' }}>
                      <span className="font-bold" style={{ color: '#ef4444' }}>Note: </span>
                      Copy this entire code and give it to any AI (ChatGPT, Grok, Claude etc.) with your prompt. The AI will write a complete trading bot in this exact same format that will run perfectly on this platform.
                    </p>
                  </div>
                )}

                {/* Error banner */}
                {saveErr && (
                  <div className="mt-3 flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm"
                    style={{ background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.25)', color: '#ff6b6b' }}>
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    {saveErr}
                  </div>
                )}

                {/* Success banner */}
                {saveOk && (
                  <div className="mt-3 flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm"
                    style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
                    <div className="w-4 h-4 shrink-0 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Bot saved! Opening API connection setup…
                  </div>
                )}

                <div className="flex items-center gap-3 mt-4">
                  <button onClick={() => { setStep(mCodeLocked ? 'strategies' : 'pick'); setMCodeLocked(false); setSaveErr('') }}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-white transition-colors"
                    style={{ border: '1px solid var(--border)' }}>
                    Back
                  </button>
                  <button
                    onClick={createBot}
                    disabled={saving || saveOk}
                    className="flex-1 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{
                      background: saveOk ? 'rgba(0,245,255,0.15)' : '#00f5ff',
                      color: saveOk ? '#00f5ff' : BG,
                      border: saveOk ? '1px solid var(--accent)' : 'none',
                      boxShadow: saving || saveOk ? 'none' : '0 0 22px rgba(0,245,255,0.35)',
                    }}>
                    {saving ? (
                      <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving...</>
                    ) : saveOk ? (
                      <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg> Saved! Setting up API…</>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                        </svg>
                        Save
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
            {/* ════════════════════════════════════════
                API CONNECTIONS STEP
            ════════════════════════════════════════ */}
            {step === 'api' && (
              <div className="px-8 pb-8 overflow-y-auto" style={{ maxHeight: '72vh' }}>

                {apiPostCreate ? (() => {
                  const wizardDetected = apiBot ? detectRequiredApis(apiBot.code) : []
                  const wizardMissing  = unconfiguredApis(wizardDetected, apiConns.map(c => c.name))
                  return (
                  /* ────────────────────────────────────────
                     POST-CREATE FLOW: bot already saved,
                     show smart-detected APIs + form
                  ──────────────────────────────────────── */
                  <>
                    {/* Success header */}
                    <div className="flex items-center gap-3 mb-5 px-4 py-3.5 rounded-xl"
                      style={{ background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.2)' }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: 'var(--accent-dim)' }}>
                        <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                          &ldquo;{apiBot?.name}&rdquo; saved successfully!
                        </p>
                        <p className="text-xs text-slate-500">
                          {wizardDetected.length > 0
                            ? `${wizardMissing.length} API key${wizardMissing.length !== 1 ? 's' : ''} detected in your code — paste them below`
                            : 'Add API connections for this bot — or skip for now'}
                        </p>
                      </div>
                    </div>

                    {/* ── Smart-detected APIs ── */}
                    {wizardDetected.length > 0 && (
                      <div className="mb-5">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-5 h-5 rounded-md flex items-center justify-center"
                            style={{ background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.25)' }}>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#00f5ff" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                            </svg>
                          </div>
                          <span className="text-[12px] font-black uppercase tracking-widest text-slate-400">Detected in your code</span>
                          <span className="ml-auto text-[12px] font-mono"
                            style={{ color: wizardMissing.length > 0 ? '#ef4444' : '#22c55e' }}>
                            {wizardMissing.length > 0 ? `${wizardMissing.length} still needed` : '✓ All configured'}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {wizardDetected.map(api => {
                            const configured = apiConns.some(c => c.name.toLowerCase() === api.name.toLowerCase())
                            return (
                              <div key={api.name}
                                className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl transition-all"
                                style={{
                                  background: configured ? 'rgba(34,197,94,0.05)' : `${api.color}0d`,
                                  border: `1px solid ${configured ? 'rgba(34,197,94,0.2)' : api.color + '28'}`,
                                }}>
                                <span className="text-lg shrink-0">{api.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-white truncate">{api.name}</p>
                                  <p className="text-[12px] truncate" style={{ color: `${api.color}80` }}>{api.description}</p>
                                </div>
                                {configured ? (
                                  <span className="shrink-0 text-[12px] font-black text-emerald-400 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                                    </svg>
                                    Done
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => { setApiName(api.name); setApiBaseUrl(api.baseUrl ?? ''); setApiKey(''); setApiSecret('') }}
                                    className="shrink-0 text-xs font-bold px-3 py-1 rounded-lg transition-all"
                                    style={{
                                      background: apiName === api.name ? `${api.color}25` : `${api.color}12`,
                                      color: api.color,
                                      border: `1px solid ${api.color}${apiName === api.name ? '60' : '30'}`,
                                    }}>
                                    {apiName === api.name ? '✓ Selected' : 'Fill'}
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Form */}
                    <div className="rounded-2xl p-5 mb-4 space-y-3"
                      style={{ background: 'rgba(0,245,255,0.03)', border: '1px solid var(--border)' }}>

                      {/* Matched API banner */}
                      {(() => {
                        const sel = wizardDetected.find(d => d.name === apiName)
                        return sel ? (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                            style={{ background: `${sel.color}12`, border: `1px solid ${sel.color}30` }}>
                            <span className="text-base">{sel.icon}</span>
                            <p className="text-xs font-bold" style={{ color: sel.color }}>{sel.name}</p>
                            <p className="text-[12px] text-slate-500 ml-1">{sel.needsSecret ? 'Needs API Key + Secret' : 'Needs API Key'}</p>
                          </div>
                        ) : null
                      })()}

                      {[
                        { label: 'API Name *', val: apiName,    set: setApiName,    ph: 'e.g. Kalshi API',           mono: false },
                        { label: 'Base URL',   val: apiBaseUrl, set: setApiBaseUrl, ph: 'https://api.example.com',   mono: true  },
                        { label: 'API Key',    val: apiKey,     set: setApiKey,     ph: '',                          mono: false },
                      ].map(f => (
                        <div key={f.label}>
                          <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                            {f.label}
                          </label>
                          <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                            className={`w-full rounded-xl px-3.5 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors${f.mono ? ' font-mono' : ''}`}
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                            onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.45)')}
                            onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                          {f.label.startsWith('API Name') && apiName && (
                            <p className="text-[12px] mt-1 font-mono" style={{ color: 'rgba(0,245,255,0.55)' }}>
                              Env var: <code>{apiName.replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_KEY</code>
                            </p>
                          )}
                        </div>
                      ))}

                      {/* Secret Key with toggle */}
                      <div>
                        <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                          API Secret Key
                        </label>
                        <div className="relative">
                          <input type={apiShowSec ? 'text' : 'password'} value={apiSecret}
                            onChange={e => setApiSecret(e.target.value)}
                            placeholder=""
                            className="w-full rounded-xl px-3.5 py-3 pr-11 text-sm text-white focus:outline-none transition-colors"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                            onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.45)')}
                            onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                          <button type="button" onClick={() => setApiShowSec(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              {apiShowSec
                                ? <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                : <><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                              }
                            </svg>
                          </button>
                        </div>
                      </div>

                      {apiSaveErr && (
                        <div className="rounded-xl px-3.5 py-2.5 text-xs font-medium"
                          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                          {apiSaveErr}
                        </div>
                      )}
                    </div>

                    {/* Already-added keys */}
                    {apiConns.length > 0 && (
                      <div className="space-y-2 mb-4">
                        <p className="text-[12px] font-black text-slate-600 uppercase tracking-widest mb-2">
                          Added APIs ({apiConns.length})
                        </p>
                        {apiConns.map(c => {
                          const det = wizardDetected.find(d => d.name.toLowerCase() === c.name.toLowerCase())
                          return (
                          <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                            style={{ background: det ? `${det.color}08` : 'rgba(0,245,255,0.03)', border: det ? `1px solid ${det.color}22` : '1px solid rgba(0,245,255,0.12)' }}>
                            <span className="text-base shrink-0">{det?.icon ?? '🔑'}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-white truncate">{c.name}</p>
                              {c.api_key && (
                                <span className="text-[12px] text-slate-500 font-mono">{c.api_key.slice(0, 6)}••••</span>
                              )}
                            </div>
                            <svg className="w-4 h-4 shrink-0" style={{ color: '#22c55e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                            </svg>
                          </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Two-button row */}
                    <div className="flex gap-3">
                      <button
                        onClick={addAnotherApi}
                        disabled={!apiName.trim() || apiSaving}
                        className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                        style={{ background: 'rgba(0,245,255,0.1)', color: 'var(--accent)', border: '1.5px solid var(--accent)' }}>
                        {apiSaving ? (
                          <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving…</>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            Save &amp; Add Another
                          </>
                        )}
                      </button>
                      <button
                        onClick={saveAndExit}
                        disabled={apiSaving}
                        className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                        style={{ background: 'var(--accent)', color: 'var(--bg)', boxShadow: '0 0 20px var(--accent)' }}>
                        {apiSaving ? (
                          <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Saving…</>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                            </svg>
                            {apiName.trim() ? 'Save Key & Exit' : 'Done'}
                          </>
                        )}
                      </button>
                    </div>

                    <button onClick={closeModal}
                      className="w-full mt-3 text-sm text-slate-600 hover:text-slate-400 transition-colors py-2 text-center">
                      Skip for now — add API keys later
                    </button>
                  </>
                  )
                })() : (
                  /* ────────────────────────────────────────
                     ORIGINAL FLOW: manual navigation
                     (bot selector + existing key list)
                  ──────────────────────────────────────── */
                  <>
                    {bots.length === 0 ? (
                      /* No bots yet */
                      <div className="rounded-2xl p-10 text-center"
                        style={{ border: '1px dashed rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.01)' }}>
                        <p className="text-slate-400 font-semibold text-sm">No bots yet</p>
                        <p className="text-slate-600 text-xs mt-1">Create a bot first, then come back to add API keys.</p>
                        <button onClick={() => setStep('pick')}
                          className="mt-4 text-sm font-bold px-4 py-2 rounded-xl transition-all"
                          style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.2)' }}>
                          ← Create a bot
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* ── Step 1: Select a bot ── */}
                        <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-3">
                          Step 1 — Select a bot
                        </p>
                        <div className="grid grid-cols-3 gap-2 mb-6">
                          {bots.map(bot => {
                            const active = apiBot?.id === bot.id
                            const st = STATUS[bot.status] || STATUS.IDLE
                            return (
                              <button key={bot.id} onClick={() => selectApiBot(bot)}
                                className="rounded-2xl p-3.5 text-left transition-all hover:scale-[1.02]"
                                style={{
                                  background: active ? 'var(--accent-dim)' : 'rgba(255,255,255,0.02)',
                                  border: active ? '1.5px solid rgba(0,245,255,0.35)' : '1px solid rgba(255,255,255,0.08)',
                                  boxShadow: active ? '0 0 16px var(--accent-dim)' : 'none',
                                }}>
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0"
                                    style={{ background: active ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.05)', color: active ? '#00f5ff' : '#475569' }}>
                                    {bot.name[0].toUpperCase()}
                                  </div>
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: st.color }} />
                                </div>
                                <p className="text-xs font-bold truncate" style={{ color: active ? '#00f5ff' : '#e2e8f0' }}>
                                  {bot.name}
                                </p>
                                <p className="text-[12px] mt-0.5" style={{ color: active ? 'rgba(0,245,255,0.55)' : '#475569' }}>
                                  {bot.status}
                                </p>
                              </button>
                            )
                          })}
                        </div>

                        {/* ── Step 2: Configure keys ── */}
                        {apiBot && (
                          <>
                            <div className="flex items-center justify-between mb-4">
                              <div>
                                <p className="text-[12px] font-black text-slate-500 uppercase tracking-widest mb-0.5">
                                  Step 2 — Keys for
                                </p>
                                <h3 className="text-base font-bold" style={{ color: 'var(--accent)' }}>
                                  {apiBot.name}
                                  <span className="text-slate-600 font-normal text-sm ml-2">
                                    {apiConns.length} key{apiConns.length !== 1 ? 's' : ''}
                                  </span>
                                </h3>
                              </div>
                              {!apiFormOpen && (
                                <button
                                  onClick={() => { setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiSecret(''); setApiSaveErr(''); setApiFormOpen(true) }}
                                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
                                  style={{ background: 'var(--accent)', color: 'var(--bg)', boxShadow: '0 0 14px var(--accent)' }}>
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                  </svg>
                                  Add Key
                                </button>
                              )}
                            </div>

                            {/* Quick templates */}
                            <div className="flex flex-wrap gap-2 mb-4">
                              {API_TEMPLATES.map(t => (
                                <button key={t.id} onClick={() => applyApiTemplate(t)}
                                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                                  style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}
                                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}>
                                  <span className="text-sm leading-none">{t.icon}</span>
                                  <span className="text-white">{t.label}</span>
                                  <span className="text-[12px] font-mono" style={{ color: 'rgba(0,245,255,0.55)' }}>+ Add</span>
                                </button>
                              ))}
                              <button
                                onClick={() => { setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiSecret(''); setApiSaveErr(''); setApiFormOpen(true) }}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
                                style={{ border: '1px dashed rgba(255,255,255,0.12)' }}>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                Custom
                              </button>
                            </div>

                            {/* Env-var info banner */}
                            <div className="rounded-xl px-4 py-3 mb-4 flex items-start gap-2.5"
                              style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)' }}>
                              <svg className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <p className="text-xs text-slate-400 leading-relaxed">
                                Keys inject as env vars when the bot runs — e.g.{' '}
                                <code className="text-indigo-300 bg-indigo-900/30 px-1 rounded">&quot;Kalshi API&quot;</code>
                                {' '}→{' '}
                                <code className="text-indigo-300 bg-indigo-900/30 px-1 rounded">KALSHI_API_KEY</code>
                              </p>
                            </div>

                            {/* Add key inline form */}
                            {apiFormOpen && (
                              <div className="rounded-2xl p-5 mb-4 space-y-3"
                                style={{ background: 'rgba(0,245,255,0.03)', border: '1px solid var(--border)' }}>
                                <p className="text-sm font-bold text-white">
                                  {apiName || 'New API Connection'}
                                </p>

                                {apiName === 'Coinbase API' && (
                                  <div className="rounded-xl px-3 py-2.5 flex items-start gap-2"
                                    style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }}>
                                    <span className="text-base leading-none shrink-0">🟡</span>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                      Public endpoints work <strong className="text-white">without a key</strong> — save with name only to get live BTC/USD price fed into AI.
                                    </p>
                                  </div>
                                )}

                                {[
                                  { label: 'Connection Name *', val: apiName,    set: setApiName,    ph: 'e.g. Kalshi API',         mono: false },
                                  { label: 'Base URL',          val: apiBaseUrl, set: setApiBaseUrl, ph: 'https://api.example.com', mono: true  },
                                  { label: 'API Key',           val: apiKey,     set: setApiKey,     ph: '',                        mono: false },
                                ].map(f => (
                                  <div key={f.label}>
                                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                                      {f.label}
                                    </label>
                                    <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                                      className={`w-full rounded-xl px-3.5 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors${f.mono ? ' font-mono' : ''}`}
                                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                                      onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.45)')}
                                      onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                                    {f.label.startsWith('Connection') && apiName && (
                                      <p className="text-[12px] mt-1" style={{ color: 'rgba(0,245,255,0.55)' }}>
                                        Env var: <code>{apiName.replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_KEY</code>
                                      </p>
                                    )}
                                  </div>
                                ))}

                                {/* Secret with toggle */}
                                <div>
                                  <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                                    API Secret Key
                                  </label>
                                  <div className="relative">
                                    <input type={apiShowSec ? 'text' : 'password'} value={apiSecret} onChange={e => setApiSecret(e.target.value)}
                                      placeholder=""
                                      className="w-full rounded-xl px-3.5 py-3 pr-11 text-sm text-white focus:outline-none transition-colors"
                                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                                      onFocus={e => (e.target.style.borderColor = 'rgba(0,245,255,0.45)')}
                                      onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
                                    <button type="button" onClick={() => setApiShowSec(v => !v)}
                                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        {apiShowSec
                                          ? <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                          : <><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                                        }
                                      </svg>
                                    </button>
                                  </div>
                                </div>

                                {apiSaveErr && (
                                  <div className="rounded-xl px-3.5 py-2.5 text-xs font-medium"
                                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                                    {apiSaveErr}
                                  </div>
                                )}
                                {apiSaveOk && (
                                  <div className="rounded-xl px-3.5 py-2.5 text-xs font-medium"
                                    style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#86efac' }}>
                                    ✓ Saved! Add another or close.
                                  </div>
                                )}

                                <div className="flex gap-2 pt-1">
                                  <button onClick={() => { setApiFormOpen(false); setApiSaveErr('') }}
                                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                                    style={{ border: '1px solid var(--border)' }}>
                                    Cancel
                                  </button>
                                  <button onClick={saveApiConn} disabled={!apiName.trim() || apiSaving}
                                    className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                                    style={{ background: 'var(--accent)', color: 'var(--bg)', boxShadow: '0 0 14px rgba(0,245,255,0.25)' }}>
                                    {apiSaving ? 'Saving…' : 'Save Connection'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Existing keys list */}
                            {apiConns.length > 0 && (
                              <div className="space-y-2 mb-4">
                                <p className="text-[12px] font-black text-slate-600 uppercase tracking-widest mb-2">
                                  Saved Keys
                                </p>
                                {apiConns.map(c => (
                                  <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                                    <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round"
                                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                    </svg>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold text-white truncate">{c.name}</p>
                                      <div className="flex items-center gap-3 mt-0.5">
                                        <code className="text-[12px] font-mono" style={{ color: 'rgba(0,245,255,0.6)' }}>
                                          {c.name.replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_KEY
                                        </code>
                                        {c.base_url && (
                                          <span className="text-[12px] text-slate-600 truncate max-w-[160px]">{c.base_url}</span>
                                        )}
                                        {c.api_key && (
                                          <span className="text-[12px] text-slate-500 font-mono">{c.api_key.slice(0, 6)}••••</span>
                                        )}
                                      </div>
                                    </div>
                                    <button onClick={() => removeApiConn(c.id)}
                                      className="p-1.5 rounded-lg text-slate-700 hover:text-red-400 transition-colors shrink-0"
                                      style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round"
                                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {apiConns.length === 0 && !apiFormOpen && (
                              <div className="rounded-2xl py-8 text-center mb-4"
                                style={{ border: '1px dashed rgba(255,255,255,0.07)' }}>
                                <p className="text-slate-500 text-xs">No keys for {apiBot.name} yet.</p>
                                <button onClick={() => { setApiName(''); setApiBaseUrl(''); setApiKey(''); setApiSecret(''); setApiSaveErr(''); setApiFormOpen(true) }}
                                  className="mt-2 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                                  + Add first key
                                </button>
                              </div>
                            )}
                          </>
                        )}

                        {!apiBot && (
                          <div className="rounded-2xl py-8 text-center"
                            style={{ border: '1px dashed rgba(255,255,255,0.06)' }}>
                            <p className="text-slate-600 text-xs">Select a bot above to manage its API keys</p>
                          </div>
                        )}
                      </>
                    )}

                    {/* Back */}
                    <button onClick={() => { setStep('pick'); setApiBot(null); setApiFormOpen(false) }}
                      className="mt-5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
                      ← Back
                    </button>
                  </>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── AI Fix Modal ─────────────────────────────────────────────────────── */}
      {aiFixOpen && panel && (
        <AiFixModal
          botId={panel.id}
          botCode={panel.code}
          errorLogs={aiFixLogs}
          onApply={(fixedCode) => {
            // Optimistically update the in-memory panel code so subsequent
            // interactions see the latest version without a full reload.
            setPanel(prev => prev ? { ...prev, code: fixedCode } : prev)
          }}
          onClose={() => setAiFixOpen(false)}
        />
      )}

      {/* Keyframes for the prominent "Fix with AI" CTA in the panel header.
          Same animation set as the per-bot detail page so the button feels
          identical in both places. */}
      <style jsx global>{`
        @keyframes ai-fix-glow {
          0%, 100% {
            box-shadow:
              0 0 22px rgba(255, 100, 60, 0.40),
              0 4px 14px rgba(255, 68, 68, 0.18);
          }
          50% {
            box-shadow:
              0 0 34px rgba(255, 100, 60, 0.65),
              0 4px 18px rgba(255, 68, 68, 0.28);
          }
        }
        .ai-fix-cta { animation: ai-fix-glow 2.4s ease-in-out infinite; }
        .ai-fix-cta:hover { animation-play-state: paused; }

        @keyframes ai-fix-badge-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.12); }
        }
        .ai-fix-badge { animation: ai-fix-badge-pulse 1.6s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
