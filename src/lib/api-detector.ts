/**
 * api-detector.ts  —  Comprehensive credential & API detection engine
 *
 * Six complementary passes — nothing gets missed:
 *
 *   Pass 1 — Known SDK imports       (import ccxt, import anthropic, …)
 *   Pass 2 — Credential variables    (ALL_CAPS VAR_KEY / VAR_SECRET / VAR_TOKEN)
 *   Pass 3 — os.getenv inline        (os.getenv("VAR_KEY") not assigned to a var)
 *   Pass 4 — Known API URL strings   (https://api.binance.com → Binance, …)
 *   Pass 5 — WebSocket URLs          (wss://stream.binance.com → Binance WS, …)
 *   Pass 6 — Client constructor calls (anthropic.Anthropic(, openai.OpenAI(, …)
 */

// ── Public interface ──────────────────────────────────────────────────────────

export interface DetectedApi {
  name:           string
  baseUrl?:       string
  icon:           string
  color:          string
  needsSecret:    boolean
  description:    string
  matchedPattern: string
  variableName:   string
}

// ── Internal metadata shape ───────────────────────────────────────────────────

interface LibraryEntry {
  name:        string
  baseUrl?:    string
  icon:        string
  color:       string
  needsSecret: boolean
  description: string
  aliases?:    string[]
}

// ── Public-only library skip list ─────────────────────────────────────────────
// Pure utility / data-analysis libraries that carry no credentials.
const PUBLIC_ONLY_SKIP = new Set([
  'pandas', 'numpy', 'scipy', 'sklearn', 'statsmodels',
  'matplotlib', 'seaborn', 'plotly',
  'bs4', 'beautifulsoup4', 'lxml', 'html5lib',
  'json', 'csv', 'pickle', 'sqlite3',
  'datetime', 'time', 'os', 'sys', 're', 'math',
  'collections', 'itertools', 'functools', 'typing',
  'threading', 'asyncio', 'concurrent',
  'pprint', 'logging', 'traceback', 'warnings',
  'ta', 'ta_lib', 'talib', 'pandas_ta',
  'hmac', 'hashlib', 'base64', 'urllib', 'http',
  'dotenv',  // config loader, not an API itself
  // NOTE: websocket is intentionally NOT here — detected via URL pass
])

// ── Known SDK → rich metadata ─────────────────────────────────────────────────
// needsSecret = true  → requires ANY credential (API key, token, secret, etc.)
// needsSecret = false → truly public, zero credentials needed
const LIBRARY_MAP: Record<string, LibraryEntry> = {

  // ── Prediction markets ──────────────────────────────────────────────────────
  kalshi_python: {
    name: 'Kalshi API', baseUrl: 'https://trading-api.kalshi.com',
    icon: '🎯', color: '#00f5ff', needsSecret: true,
    description: 'Kalshi prediction market — API key UUID + RSA private key PEM',
    aliases: ['kalshi', 'kalshi_client'],
  },
  polymarket: {
    name: 'Polymarket API', baseUrl: 'https://clob.polymarket.com',
    icon: '📈', color: '#6366f1', needsSecret: true,
    description: 'Polymarket prediction market CLOB',
  },

  // ── Stocks / traditional finance ────────────────────────────────────────────
  alpaca_trade_api: {
    name: 'Alpaca API', baseUrl: 'https://api.alpaca.markets',
    icon: '🦙', color: '#f59e0b', needsSecret: true,
    description: 'Alpaca commission-free stock & crypto trading — API Key + Secret Key required',
    aliases: ['alpaca'],
  },
  robin_stocks: {
    name: 'Robinhood API', icon: '🏹', color: '#22c55e',
    needsSecret: false, description: 'Robinhood brokerage (username + password, no API key)',
    aliases: ['robinhood'],
  },
  ib_insync: {
    name: 'Interactive Brokers', baseUrl: 'https://api.ibkr.com',
    icon: '🏦', color: '#60a5fa', needsSecret: false,
    description: 'Interactive Brokers TWS / Gateway API (local connection, no API key)',
    aliases: ['ibapi', 'ibapi_', 'ib_insync'],
  },
  polygon: {
    name: 'Polygon.io API', baseUrl: 'https://api.polygon.io',
    icon: '🔷', color: '#7c3aed', needsSecret: true,
    description: 'Real-time & historical US market data — API Key required',
    aliases: ['polygon_api_client'],
  },
  quandl: {
    name: 'Nasdaq Data Link', baseUrl: 'https://data.nasdaq.com',
    icon: '📊', color: '#f59e0b', needsSecret: true,
    description: 'Nasdaq / Quandl financial datasets — API Key required',
    aliases: ['nasdaqdatalink'],
  },
  alpha_vantage: {
    name: 'Alpha Vantage API', baseUrl: 'https://www.alphavantage.co',
    icon: '📉', color: '#22c55e', needsSecret: true,
    description: 'Stocks, forex & crypto data API — API Key required',
    aliases: ['alphavantage', 'from_alpha_vantage'],
  },

  // ── Crypto — spot & derivatives ─────────────────────────────────────────────
  python_binance: {
    name: 'Binance API', baseUrl: 'https://api.binance.com',
    icon: '🟡', color: '#f59e0b', needsSecret: true,
    description: 'Binance spot & futures exchange — API Key + Secret Key required',
    aliases: ['binance', 'binance_futures', 'binance_f'],
  },
  pybit: {
    name: 'Bybit API', baseUrl: 'https://api.bybit.com',
    icon: '🔶', color: '#f97316', needsSecret: true,
    description: 'Bybit derivatives & spot — API Key + Secret Key required',
    aliases: ['pybit'],
  },
  krakenex: {
    name: 'Kraken API', baseUrl: 'https://api.kraken.com',
    icon: '🐙', color: '#7c3aed', needsSecret: true,
    description: 'Kraken crypto exchange — API Key + Private Key required',
    aliases: ['krakenAPI', 'pykrakenapi', 'kraken'],
  },
  coinbase_advanced_trader: {
    name: 'Coinbase API', baseUrl: 'https://api.coinbase.com',
    icon: '🔵', color: '#3b82f6', needsSecret: true,
    description: 'Coinbase Advanced Trade — API Key + Secret required',
    aliases: ['coinbase', 'coinbasepro', 'cbpro', 'coinbase_advanced_trade'],
  },
  okx: {
    name: 'OKX API', baseUrl: 'https://www.okx.com',
    icon: '⭕', color: '#06b6d4', needsSecret: true,
    description: 'OKX spot/futures/options — API Key + Secret + Passphrase required',
    aliases: ['python_okx', 'okex'],
  },
  gate_api: {
    name: 'Gate.io API', baseUrl: 'https://api.gateio.ws',
    icon: '🚪', color: '#8b5cf6', needsSecret: true,
    description: 'Gate.io crypto exchange — API Key + Secret required',
    aliases: ['gate_api', 'gate'],
  },
  kucoin: {
    name: 'KuCoin API', baseUrl: 'https://api.kucoin.com',
    icon: '🟢', color: '#22c55e', needsSecret: true,
    description: 'KuCoin exchange — API Key + Secret + Passphrase required',
    aliases: ['python_kucoin', 'kucoin_python'],
  },
  deribit: {
    name: 'Deribit API', baseUrl: 'https://www.deribit.com/api/v2',
    icon: '🎰', color: '#f43f5e', needsSecret: true,
    description: 'Deribit options & futures — Client ID + Client Secret required',
  },
  bitget: {
    name: 'Bitget API', baseUrl: 'https://api.bitget.com',
    icon: '💎', color: '#0ea5e9', needsSecret: true,
    description: 'Bitget exchange — API Key + Secret + Passphrase required',
    aliases: ['bitget_python_sdk', 'bitget_api'],
  },
  bitmex: {
    name: 'BitMEX API', baseUrl: 'https://www.bitmex.com/api/v1',
    icon: '⚡', color: '#ef4444', needsSecret: true,
    description: 'BitMEX derivatives — API Key + API Secret required',
    aliases: ['bitmex_python', 'bitmex_websocket'],
  },
  huobi_universal_sdk: {
    name: 'Huobi/HTX API', baseUrl: 'https://api.huobi.pro',
    icon: '🔥', color: '#ef4444', needsSecret: true,
    description: 'Huobi (HTX) crypto exchange — Access Key + Secret Key required',
    aliases: ['huobi', 'htx', 'huobipy'],
  },
  phemex: {
    name: 'Phemex API', baseUrl: 'https://api.phemex.com',
    icon: '🌊', color: '#06b6d4', needsSecret: true,
    description: 'Phemex crypto futures exchange — API Key + Secret Key required',
  },
  bitfinex: {
    name: 'Bitfinex API', baseUrl: 'https://api-pub.bitfinex.com',
    icon: '🟣', color: '#a855f7', needsSecret: true,
    description: 'Bitfinex exchange — API Key + API Secret required',
    aliases: ['bfxapi', 'bitfinex_v2'],
  },
  mexc: {
    name: 'MEXC API', baseUrl: 'https://api.mexc.com',
    icon: '💠', color: '#2dd4bf', needsSecret: true,
    description: 'MEXC global exchange — API Key + Secret Key required',
    aliases: ['mexc_sdk'],
  },

  // ── Crypto market data ──────────────────────────────────────────────────────
  pycoingecko: {
    name: 'CoinGecko API', baseUrl: 'https://api.coingecko.com',
    icon: '🦎', color: '#22c55e', needsSecret: false,
    description: 'CoinGecko public crypto price data — no key required (Pro key optional)',
    aliases: ['coingecko', 'CoinGeckoAPI'],
  },
  coinmarketcap: {
    name: 'CoinMarketCap API', baseUrl: 'https://pro-api.coinmarketcap.com',
    icon: '🪙', color: '#f59e0b', needsSecret: true,
    description: 'CoinMarketCap crypto data — API Key required for Pro endpoints',
    aliases: ['python_coinmarketcap', 'coinmarketcapapi'],
  },
  yfinance: {
    name: 'Yahoo Finance', baseUrl: 'https://query1.finance.yahoo.com',
    icon: '📊', color: '#6b21a8', needsSecret: false,
    description: 'Yahoo Finance public market data — no key required',
    aliases: ['yahoo_fin', 'yahoo_finance'],
  },
  tradingview_ta: {
    name: 'TradingView Screener', baseUrl: 'https://scanner.tradingview.com',
    icon: '📉', color: '#1e88e5', needsSecret: false,
    description: 'TradingView public screener — no key required',
  },
  finnhub: {
    name: 'Finnhub API', baseUrl: 'https://finnhub.io/api',
    icon: '📡', color: '#22c55e', needsSecret: true,
    description: 'Finnhub real-time market data — API Key required',
  },

  // ── AI / LLM ────────────────────────────────────────────────────────────────
  openai: {
    name: 'OpenAI API', baseUrl: 'https://api.openai.com',
    icon: '🤖', color: '#22c55e', needsSecret: true,
    description: 'OpenAI GPT, embeddings & DALL-E — API Key required',
  },
  anthropic: {
    name: 'Anthropic API', baseUrl: 'https://api.anthropic.com',
    icon: '🧠', color: '#f59e0b', needsSecret: true,
    description: 'Anthropic Claude models — API Key required',
  },
  google_generativeai: {
    name: 'Google Gemini API', baseUrl: 'https://generativelanguage.googleapis.com',
    icon: '✨', color: '#4ade80', needsSecret: true,
    description: 'Google Gemini / PaLM models — API Key required',
    aliases: ['generativeai', 'google_genai', 'vertexai', 'google_generativeai'],
  },
  cohere: {
    name: 'Cohere API', baseUrl: 'https://api.cohere.com',
    icon: '🌊', color: '#818cf8', needsSecret: true,
    description: 'Cohere NLP models — API Key required',
  },
  groq: {
    name: 'Groq API', baseUrl: 'https://api.groq.com',
    icon: '⚡', color: '#f43f5e', needsSecret: true,
    description: 'Groq ultra-fast LLM inference — API Key required',
  },
  mistralai: {
    name: 'Mistral AI API', baseUrl: 'https://api.mistral.ai',
    icon: '💫', color: '#818cf8', needsSecret: true,
    description: 'Mistral AI language models — API Key required',
    aliases: ['mistral', 'mistral_ai'],
  },
  deepseek: {
    name: 'DeepSeek API', baseUrl: 'https://api.deepseek.com',
    icon: '🔍', color: '#06b6d4', needsSecret: true,
    description: 'DeepSeek language models — API Key required',
  },
  together: {
    name: 'Together AI API', baseUrl: 'https://api.together.xyz',
    icon: '🤝', color: '#a855f7', needsSecret: true,
    description: 'Together AI open-source model hosting — API Key required',
    aliases: ['together_ai'],
  },
  replicate: {
    name: 'Replicate API', baseUrl: 'https://api.replicate.com',
    icon: '🔄', color: '#3b82f6', needsSecret: true,
    description: 'Replicate AI model hosting — API Token required',
  },
  huggingface_hub: {
    name: 'Hugging Face API', baseUrl: 'https://api-inference.huggingface.co',
    icon: '🤗', color: '#f59e0b', needsSecret: true,
    description: 'Hugging Face Inference API — API Token required',
    aliases: ['huggingface', 'transformers', 'datasets'],
  },

  // ── Messaging / notifications ────────────────────────────────────────────────
  telegram: {
    name: 'Telegram Bot API', baseUrl: 'https://api.telegram.org',
    icon: '✈️', color: '#3b82f6', needsSecret: true,
    description: 'Telegram Bot — Bot Token required',
    aliases: ['telebot', 'python_telegram_bot', 'telegram_bot', 'pyrogram', 'telethon'],
  },
  twilio: {
    name: 'Twilio API', baseUrl: 'https://api.twilio.com',
    icon: '📱', color: '#f43f5e', needsSecret: true,
    description: 'Twilio SMS & voice — Account SID + Auth Token required',
  },
  sendgrid: {
    name: 'SendGrid API', baseUrl: 'https://api.sendgrid.com',
    icon: '📧', color: '#22c55e', needsSecret: true,
    description: 'SendGrid transactional email — API Key required',
    aliases: ['sendgrid_python'],
  },
  slack_sdk: {
    name: 'Slack API', baseUrl: 'https://slack.com/api',
    icon: '💬', color: '#f59e0b', needsSecret: true,
    description: 'Slack bot / webhook — Bot Token or Webhook URL required',
    aliases: ['slack', 'slackclient', 'slack_bolt'],
  },
  discord: {
    name: 'Discord API', baseUrl: 'https://discord.com/api',
    icon: '🎮', color: '#818cf8', needsSecret: true,
    description: 'Discord bot / webhook — Bot Token required',
    aliases: ['discord_webhook', 'discordpy', 'interactions', 'nextcord', 'disnake'],
  },

  // ── Social ───────────────────────────────────────────────────────────────────
  tweepy: {
    name: 'Twitter/X API', baseUrl: 'https://api.twitter.com',
    icon: '🐦', color: '#3b82f6', needsSecret: true,
    description: 'Twitter/X Bot & data — API Key + Secret + Access Token required',
    aliases: ['twitter'],
  },

  // ── Payments ─────────────────────────────────────────────────────────────────
  stripe: {
    name: 'Stripe API', baseUrl: 'https://api.stripe.com',
    icon: '💳', color: '#818cf8', needsSecret: true,
    description: 'Stripe payments — Secret Key required',
  },

  // ── News & data ───────────────────────────────────────────────────────────────
  newsapi: {
    name: 'NewsAPI', baseUrl: 'https://newsapi.org',
    icon: '📰', color: '#f59e0b', needsSecret: true,
    description: 'NewsAPI news articles — API Key required',
    aliases: ['newsapi_python'],
  },

  // ── Web / automation ─────────────────────────────────────────────────────────
  github: {
    name: 'GitHub API', baseUrl: 'https://api.github.com',
    icon: '🐙', color: '#94a3b8', needsSecret: true,
    description: 'GitHub REST API — Personal Access Token required',
    aliases: ['pygithub', 'github3'],
  },
  requests: {
    name: 'HTTP Requests (requests)', icon: '🌐', color: '#64748b',
    needsSecret: false,
    description: 'Python requests library — used for custom HTTP calls',
    aliases: ['httpx', 'aiohttp', 'urllib3'],
  },

  // ── Weather ───────────────────────────────────────────────────────────────────
  pyowm: {
    name: 'OpenWeatherMap API', baseUrl: 'https://api.openweathermap.org',
    icon: '🌤️', color: '#f59e0b', needsSecret: true,
    description: 'OpenWeatherMap weather & forecast data — API Key required',
    aliases: ['openweathermap', 'openweather'],
  },

  // ── Social / community ────────────────────────────────────────────────────────
  praw: {
    name: 'Reddit API', baseUrl: 'https://oauth.reddit.com',
    icon: '🤖', color: '#f97316', needsSecret: true,
    description: 'Reddit PRAW — Client ID + Client Secret + credentials required',
    aliases: ['reddit'],
  },

  // ── Productivity ──────────────────────────────────────────────────────────────
  notion_client: {
    name: 'Notion API', baseUrl: 'https://api.notion.com',
    icon: '📝', color: '#94a3b8', needsSecret: true,
    description: 'Notion workspace API — Integration Token required',
    aliases: ['notion'],
  },
  airtable: {
    name: 'Airtable API', baseUrl: 'https://api.airtable.com',
    icon: '📋', color: '#22c55e', needsSecret: true,
    description: 'Airtable database API — Personal Access Token required',
    aliases: ['pyairtable'],
  },

  // ── Music / entertainment ─────────────────────────────────────────────────────
  spotipy: {
    name: 'Spotify API', baseUrl: 'https://api.spotify.com',
    icon: '🎵', color: '#22c55e', needsSecret: true,
    description: 'Spotify music API — Client ID + Client Secret required',
    aliases: ['spotify'],
  },

  // ── Blockchain / on-chain data ────────────────────────────────────────────────
  etherscan_python: {
    name: 'Etherscan API', baseUrl: 'https://api.etherscan.io',
    icon: '⛓️', color: '#3b82f6', needsSecret: true,
    description: 'Etherscan Ethereum blockchain explorer — API Key required',
    aliases: ['etherscan'],
  },

  // ── Additional market data ────────────────────────────────────────────────────
  cryptocompare: {
    name: 'CryptoCompare API', baseUrl: 'https://min-api.cryptocompare.com',
    icon: '📊', color: '#22c55e', needsSecret: false,
    description: 'CryptoCompare crypto market data — free tier, API Key for higher limits',
  },
  fredapi: {
    name: 'FRED API', baseUrl: 'https://api.stlouisfed.org',
    icon: '🏛️', color: '#3b82f6', needsSecret: true,
    description: 'Federal Reserve economic data (FRED) — API Key required',
    aliases: ['fred'],
  },
  lunarcrush: {
    name: 'LunarCrush API', baseUrl: 'https://lunarcrush.com/api4',
    icon: '🌙', color: '#818cf8', needsSecret: true,
    description: 'LunarCrush social crypto analytics — API Key required',
  },
}

// Fast lookup by name & alias
const LIBRARY_LOOKUP = new Map<string, LibraryEntry>()
for (const [key, entry] of Object.entries(LIBRARY_MAP)) {
  LIBRARY_LOOKUP.set(key.toLowerCase(), entry)
  for (const alias of entry.aliases ?? []) {
    LIBRARY_LOOKUP.set(alias.toLowerCase(), entry)
  }
}

// ── Credential suffix list — ordered longest-first ────────────────────────────
const CRED_SUFFIXES: string[] = [
  '_PRIVATE_KEY_PATH', '_PRIVATE_KEY_FILE', '_PRIVATE_KEY',
  '_API_SECRET', '_SECRET_KEY', '_API_KEY',
  '_ACCESS_TOKEN', '_AUTH_TOKEN', '_BOT_TOKEN',
  '_PASSPHRASE', '_CLIENT_SECRET', '_CLIENT_ID',
  '_TOKEN', '_SECRET', '_KEY',
]

const _SUFFIX_ALT = CRED_SUFFIXES.join('|')

// Credential variable regex: ALL-CAPS assignment with known suffix
const CRED_VAR_RE = new RegExp(
  `^([A-Z][A-Z0-9_]*?)(${_SUFFIX_ALT})\\s*(?::[^=\\n]+)?\\s*=`,
  'gm',
)

// os.getenv / os.environ inline
const CRED_ENV_RE = new RegExp(
  `os\\.(?:getenv|environ\\.get|environ)\\s*[\\[(]["']([A-Z][A-Z0-9_]*?(?:${_SUFFIX_ALT}))["']`,
  'gm',
)

// ── Known-service URL patterns ────────────────────────────────────────────────
interface UrlEntry { pattern: RegExp; entry: LibraryEntry; wss?: boolean }

const URL_PATTERN_MAP: UrlEntry[] = [
  // Kalshi
  { pattern: /trading-api\.kalshi\.com/i,        entry: LIBRARY_MAP['kalshi_python'] },
  { pattern: /api\.kalshi\.co/i,                 entry: LIBRARY_MAP['kalshi_python'] },
  // Polymarket
  { pattern: /clob\.polymarket\.com/i,            entry: LIBRARY_MAP['polymarket'] },
  // Alpaca
  { pattern: /api\.alpaca\.markets/i,             entry: LIBRARY_MAP['alpaca_trade_api'] },
  // AI providers
  { pattern: /api\.anthropic\.com/i,              entry: LIBRARY_MAP['anthropic'] },
  { pattern: /api\.openai\.com/i,                 entry: LIBRARY_MAP['openai'] },
  { pattern: /generativelanguage\.googleapis/i,   entry: LIBRARY_MAP['google_generativeai'] },
  { pattern: /api\.cohere\.(?:com|ai)/i,          entry: LIBRARY_MAP['cohere'] },
  { pattern: /api\.groq\.com/i,                   entry: LIBRARY_MAP['groq'] },
  { pattern: /api\.mistral\.ai/i,                 entry: LIBRARY_MAP['mistralai'] },
  { pattern: /api\.deepseek\.com/i,               entry: LIBRARY_MAP['deepseek'] },
  { pattern: /api\.together\.xyz/i,               entry: LIBRARY_MAP['together'] },
  { pattern: /api\.replicate\.com/i,              entry: LIBRARY_MAP['replicate'] },
  { pattern: /api-inference\.huggingface\.co/i,   entry: LIBRARY_MAP['huggingface_hub'] },
  // Binance (REST + Futures)
  { pattern: /(?:api|fapi|dapi)\.binance\.(?:com|us)/i, entry: LIBRARY_MAP['python_binance'] },
  // Binance WebSocket streams
  { pattern: /(?:stream|fstream|dstream)\.binance\.com/i, entry: LIBRARY_MAP['python_binance'], wss: true },
  // Bybit
  { pattern: /api\.bybit\.com/i,                  entry: LIBRARY_MAP['pybit'] },
  { pattern: /stream\.bybit\.com/i,               entry: LIBRARY_MAP['pybit'], wss: true },
  // Kraken
  { pattern: /api\.kraken\.com/i,                 entry: LIBRARY_MAP['krakenex'] },
  { pattern: /ws\.kraken\.com/i,                  entry: LIBRARY_MAP['krakenex'], wss: true },
  // Coinbase
  { pattern: /api(?:-public)?\.coinbase\.com/i,   entry: LIBRARY_MAP['coinbase_advanced_trader'] },
  // OKX
  { pattern: /www\.okx\.com/i,                    entry: LIBRARY_MAP['okx'] },
  { pattern: /ws\.okx\.com/i,                     entry: LIBRARY_MAP['okx'], wss: true },
  // KuCoin
  { pattern: /api\.kucoin\.com/i,                 entry: LIBRARY_MAP['kucoin'] },
  // Gate.io
  { pattern: /api\.gateio\.ws/i,                  entry: LIBRARY_MAP['gate_api'] },
  // Deribit
  { pattern: /www\.deribit\.com/i,                entry: LIBRARY_MAP['deribit'] },
  // Bitget
  { pattern: /api\.bitget\.com/i,                 entry: LIBRARY_MAP['bitget'] },
  // BitMEX
  { pattern: /www\.bitmex\.com/i,                 entry: LIBRARY_MAP['bitmex'] },
  // Huobi/HTX
  { pattern: /api\.huobi\.pro/i,                  entry: LIBRARY_MAP['huobi_universal_sdk'] },
  { pattern: /api\.htx\.com/i,                    entry: LIBRARY_MAP['huobi_universal_sdk'] },
  // Phemex
  { pattern: /api\.phemex\.com/i,                 entry: LIBRARY_MAP['phemex'] },
  // Bitfinex
  { pattern: /api(?:-pub)?\.bitfinex\.com/i,      entry: LIBRARY_MAP['bitfinex'] },
  // MEXC
  { pattern: /api\.mexc\.com/i,                   entry: LIBRARY_MAP['mexc'] },
  // Market data
  { pattern: /api\.coingecko\.com/i,              entry: LIBRARY_MAP['pycoingecko'] },
  { pattern: /pro-api\.coinmarketcap\.com/i,      entry: LIBRARY_MAP['coinmarketcap'] },
  { pattern: /api\.coinmarketcap\.com/i,          entry: LIBRARY_MAP['coinmarketcap'] },
  { pattern: /api\.polygon\.io/i,                 entry: LIBRARY_MAP['polygon'] },
  { pattern: /finnhub\.io\/api/i,                 entry: LIBRARY_MAP['finnhub'] },
  { pattern: /newsapi\.org/i,                     entry: LIBRARY_MAP['newsapi'] },
  // Messaging
  { pattern: /api\.telegram\.org/i,               entry: LIBRARY_MAP['telegram'] },
  { pattern: /api\.twilio\.com/i,                 entry: LIBRARY_MAP['twilio'] },
  { pattern: /api\.sendgrid\.com/i,               entry: LIBRARY_MAP['sendgrid'] },
  { pattern: /hooks\.slack\.com/i,                entry: LIBRARY_MAP['slack_sdk'] },
  { pattern: /discord\.com\/api/i,                entry: LIBRARY_MAP['discord'] },
  // GitHub
  { pattern: /api\.github\.com/i,                 entry: LIBRARY_MAP['github'] },
  // Stripe
  { pattern: /api\.stripe\.com/i,                 entry: LIBRARY_MAP['stripe'] },
  // Weather
  { pattern: /api\.openweathermap\.org/i,          entry: LIBRARY_MAP['pyowm'] },
  { pattern: /openweathermap\.org\/data/i,         entry: LIBRARY_MAP['pyowm'] },
  // Reddit
  { pattern: /oauth\.reddit\.com/i,                entry: LIBRARY_MAP['praw'] },
  { pattern: /www\.reddit\.com\/api/i,             entry: LIBRARY_MAP['praw'] },
  // Notion
  { pattern: /api\.notion\.com/i,                  entry: LIBRARY_MAP['notion_client'] },
  // Airtable
  { pattern: /api\.airtable\.com/i,                entry: LIBRARY_MAP['airtable'] },
  // Spotify
  { pattern: /api\.spotify\.com/i,                 entry: LIBRARY_MAP['spotipy'] },
  { pattern: /accounts\.spotify\.com/i,            entry: LIBRARY_MAP['spotipy'] },
  // Blockchain
  { pattern: /api\.etherscan\.io/i,                entry: LIBRARY_MAP['etherscan_python'] },
  // Additional market data
  { pattern: /min-api\.cryptocompare\.com/i,       entry: LIBRARY_MAP['cryptocompare'] },
  { pattern: /api\.stlouisfed\.org/i,              entry: LIBRARY_MAP['fredapi'] },
  { pattern: /lunarcrush\.com\/api/i,              entry: LIBRARY_MAP['lunarcrush'] },
]

// ── Skip list: env-var prefixes that are WatchDog-internal / too generic ──────
const ENV_SKIP_PREFIXES = new Set([
  'WATCHDOG', 'DATABASE', 'REDIS', 'PASSWORD', 'AUTH',
  'JWT', 'SESSION', 'COOKIE', 'HOST', 'PORT', 'DEBUG', 'LOG',
  'PYTHON', 'PATH', 'HOME', 'USER', 'TEMP', 'TMP', 'APP',
  'API',     // too generic alone ("API_KEY" doesn't identify a service)
  'KEY',     // too generic
  'SECRET',  // too generic alone
  'PRIVATE', // too generic alone
  'ACCESS',  // too generic alone
  'BEARER',  // too generic alone
])

// ── Pass 6: Direct constructor call patterns ──────────────────────────────────
interface ConstructorEntry { pattern: RegExp; entry: LibraryEntry; label: string }

const CONSTRUCTOR_PATTERNS: ConstructorEntry[] = [
  // Anthropic
  { pattern: /anthropic\s*\.\s*Anthropic\s*\(/i,      entry: LIBRARY_MAP['anthropic'],             label: 'anthropic.Anthropic()' },
  // OpenAI
  { pattern: /openai\s*\.\s*OpenAI\s*\(/i,            entry: LIBRARY_MAP['openai'],                label: 'openai.OpenAI()' },
  { pattern: /openai\s*\.\s*AsyncOpenAI\s*\(/i,       entry: LIBRARY_MAP['openai'],                label: 'openai.AsyncOpenAI()' },
  { pattern: /ChatCompletion\s*\.\s*create\s*\(/i,    entry: LIBRARY_MAP['openai'],                label: 'ChatCompletion.create()' },
  // Groq
  { pattern: /groq\s*\.\s*Groq\s*\(/i,               entry: LIBRARY_MAP['groq'],                  label: 'groq.Groq()' },
  // Cohere
  { pattern: /cohere\s*\.\s*Client\s*\(/i,            entry: LIBRARY_MAP['cohere'],                label: 'cohere.Client()' },
  { pattern: /cohere\s*\.\s*AsyncClient\s*\(/i,       entry: LIBRARY_MAP['cohere'],                label: 'cohere.AsyncClient()' },
  // Google Gemini
  { pattern: /genai\s*\.\s*configure\s*\(/i,          entry: LIBRARY_MAP['google_generativeai'],   label: 'genai.configure()' },
  { pattern: /genai\s*\.\s*GenerativeModel\s*\(/i,    entry: LIBRARY_MAP['google_generativeai'],   label: 'genai.GenerativeModel()' },
  { pattern: /vertexai\s*\.\s*init\s*\(/i,            entry: LIBRARY_MAP['google_generativeai'],   label: 'vertexai.init()' },
  // Mistral
  { pattern: /[Mm]istral(?:ai|AI)?\s*\.\s*(?:Mistral|Client)\s*\(/,  entry: LIBRARY_MAP['mistralai'], label: 'Mistral()' },
  // Together AI
  { pattern: /together\s*\.\s*Together\s*\(/i,        entry: LIBRARY_MAP['together'],              label: 'together.Together()' },
  // Replicate
  { pattern: /replicate\s*\.\s*run\s*\(/i,            entry: LIBRARY_MAP['replicate'],             label: 'replicate.run()' },
  { pattern: /replicate\s*\.\s*Client\s*\(/i,         entry: LIBRARY_MAP['replicate'],             label: 'replicate.Client()' },
  // Hugging Face
  { pattern: /InferenceClient\s*\(/i,                 entry: LIBRARY_MAP['huggingface_hub'],       label: 'InferenceClient()' },
  { pattern: /InferenceApi\s*\(/i,                    entry: LIBRARY_MAP['huggingface_hub'],       label: 'InferenceApi()' },
  // Telegram
  { pattern: /(?:telebot|telegram)\s*\.\s*(?:Bot|TeleBot|Application|Updater)\s*\(/i, entry: LIBRARY_MAP['telegram'], label: 'telegram.Bot()' },
  { pattern: /Bot\s*\(\s*token\s*=/i,                 entry: LIBRARY_MAP['telegram'],              label: 'Bot(token=...)' },
  // Discord
  { pattern: /discord\s*\.\s*(?:Client|Bot|Intents)\s*\(/i,          entry: LIBRARY_MAP['discord'], label: 'discord.Client()' },
  { pattern: /commands\s*\.\s*Bot\s*\(/i,             entry: LIBRARY_MAP['discord'],               label: 'commands.Bot()' },
  // Twilio
  { pattern: /twilio\s*\.\s*rest\s*\.\s*Client\s*\(/i, entry: LIBRARY_MAP['twilio'],              label: 'twilio.rest.Client()' },
  { pattern: /Client\s*\(\s*account_sid/i,            entry: LIBRARY_MAP['twilio'],                label: 'twilio.Client(account_sid)' },
  // Slack
  { pattern: /WebClient\s*\(\s*token\s*=/i,           entry: LIBRARY_MAP['slack_sdk'],             label: 'WebClient(token=...)' },
  { pattern: /slack_sdk\s*\.\s*WebClient\s*\(/i,      entry: LIBRARY_MAP['slack_sdk'],             label: 'slack_sdk.WebClient()' },
  // Stripe
  { pattern: /stripe\s*\.\s*api_key\s*=/i,            entry: LIBRARY_MAP['stripe'],                label: 'stripe.api_key = ...' },
  // Tweepy
  { pattern: /tweepy\s*\.\s*(?:Client|API|OAuth)\s*\(/i, entry: LIBRARY_MAP['tweepy'],            label: 'tweepy.Client()' },
  // Alpaca
  { pattern: /TradingClient\s*\(/i,                   entry: LIBRARY_MAP['alpaca_trade_api'],      label: 'TradingClient()' },
  { pattern: /REST\s*\(\s*key_id\s*=/i,               entry: LIBRARY_MAP['alpaca_trade_api'],      label: 'REST(key_id=...)' },
  // CoinGecko
  { pattern: /CoinGeckoAPI\s*\(\s*\)/i,               entry: LIBRARY_MAP['pycoingecko'],           label: 'CoinGeckoAPI()' },
  // GitHub
  { pattern: /Github\s*\(\s*(?:login=|token=|["'])/i, entry: LIBRARY_MAP['github'],               label: 'Github()' },
  // OpenWeatherMap
  { pattern: /pyowm\s*\.\s*OWM\s*\(/i,               entry: LIBRARY_MAP['pyowm'],                label: 'pyowm.OWM()' },
  { pattern: /OWM\s*\(\s*(?:api_key|["'])/i,         entry: LIBRARY_MAP['pyowm'],                label: 'OWM(api_key=...)' },
  // Reddit
  { pattern: /praw\s*\.\s*Reddit\s*\(/i,             entry: LIBRARY_MAP['praw'],                 label: 'praw.Reddit()' },
  // Notion
  { pattern: /Client\s*\(\s*auth\s*=.*notion/i,      entry: LIBRARY_MAP['notion_client'],        label: 'notion Client(auth=...)' },
  { pattern: /notion.*Client\s*\(\s*auth\s*=/i,      entry: LIBRARY_MAP['notion_client'],        label: 'notion Client(auth=...)' },
  // Airtable
  { pattern: /airtable\s*\.\s*(?:Table|Api|Base)\s*\(/i, entry: LIBRARY_MAP['airtable'],         label: 'airtable.Table()' },
  // Spotify
  { pattern: /spotipy\s*\.\s*Spotify\s*\(/i,         entry: LIBRARY_MAP['spotipy'],              label: 'spotipy.Spotify()' },
  { pattern: /SpotifyOAuth\s*\(/i,                   entry: LIBRARY_MAP['spotipy'],              label: 'SpotifyOAuth()' },
  // Etherscan
  { pattern: /Etherscan\s*\(\s*(?:api_key|token)/i,  entry: LIBRARY_MAP['etherscan_python'],     label: 'Etherscan(api_key=...)' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTitleCase(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

// Well-known prefix → friendly API name
const PREFIX_NAMES: Record<string, string> = {
  KALSHI: 'Kalshi API', ALPACA: 'Alpaca API',
  OPENAI: 'OpenAI API', ANTHROPIC: 'Anthropic API', CLAUDE: 'Anthropic API',
  TELEGRAM: 'Telegram Bot API', BOT: 'Telegram Bot API',
  BINANCE: 'Binance API', BYBIT: 'Bybit API',
  KRAKEN: 'Kraken API', COINBASE: 'Coinbase API',
  OKX: 'OKX API', KUCOIN: 'KuCoin API',
  GATE: 'Gate.io API', DERIBIT: 'Deribit API',
  BITGET: 'Bitget API', BITMEX: 'BitMEX API', BITFINEX: 'Bitfinex API',
  MEXC: 'MEXC API', HUOBI: 'Huobi/HTX API', HTX: 'Huobi/HTX API',
  PHEMEX: 'Phemex API', FTX: 'FTX API',
  POLYGON: 'Polygon.io API', ALPHAVANTAGE: 'Alpha Vantage API',
  COINGECKO: 'CoinGecko API', CMC: 'CoinMarketCap API', COINMARKETCAP: 'CoinMarketCap API',
  GROQ: 'Groq API', MISTRAL: 'Mistral AI API', DEEPSEEK: 'DeepSeek API',
  STRIPE: 'Stripe API', TWILIO: 'Twilio API', SENDGRID: 'SendGrid API',
  SLACK: 'Slack API', DISCORD: 'Discord API',
  TWITTER: 'Twitter/X API', TWEEPY: 'Twitter/X API',
  NEWSAPI: 'NewsAPI', FINNHUB: 'Finnhub API',
  COHERE: 'Cohere API', GEMINI: 'Google Gemini API',
  GOOGLE: 'Google API', ROBIN: 'Robinhood API',
  ROBINHOOD: 'Robinhood API', POLYMARKET: 'Polymarket API',
  IB: 'Interactive Brokers', IBKR: 'Interactive Brokers',
  GPT: 'OpenAI API', REPLICATE: 'Replicate API', TOGETHER: 'Together AI API',
  HUGGINGFACE: 'Hugging Face API', HF: 'Hugging Face API',
  GITHUB: 'GitHub API',
  OPENWEATHER: 'OpenWeatherMap API', OWM: 'OpenWeatherMap API', WEATHER: 'OpenWeatherMap API',
  REDDIT: 'Reddit API', PRAW: 'Reddit API',
  NOTION: 'Notion API',
  AIRTABLE: 'Airtable API',
  SPOTIFY: 'Spotify API', SPOTIPY: 'Spotify API',
  ETHERSCAN: 'Etherscan API',
  CRYPTOCOMPARE: 'CryptoCompare API',
  FRED: 'FRED API', STLOUISFED: 'FRED API',
  LUNARCRUSH: 'LunarCrush API',
}

function makeApiName(prefix: string): string {
  const upper = prefix.toUpperCase().replace(/_$/, '')
  return PREFIX_NAMES[upper] ?? `${toTitleCase(prefix)} API`
}

function getLibMeta(rootName: string): Pick<LibraryEntry, 'icon' | 'color' | 'needsSecret' | 'baseUrl' | 'description'> {
  return LIBRARY_LOOKUP.get(rootName.toLowerCase()) ?? {
    icon: '🔑', color: '#94a3b8', needsSecret: true, description: 'External API requiring credentials',
  }
}

function stripCredSuffix(varName: string): string | null {
  for (const s of CRED_SUFFIXES) {
    if (varName.toUpperCase().endsWith(s)) return varName.slice(0, varName.length - s.length)
  }
  return null
}

function findAssociatedUrl(code: string, prefix: string): string | undefined {
  const urlRe = new RegExp(`${prefix}(?:_BASE)?_URL\\s*=\\s*["'\`](https?://[^"'\`\\s]+)["'\`]`, 'i')
  const m = urlRe.exec(code)
  return m ? m[1] : undefined
}

// ── Pass 1: Library import detection ─────────────────────────────────────────

function detectFromImports(
  code: string,
): Map<string, { api: DetectedApi; pos: number }> {
  const found = new Map<string, { api: DetectedApi; pos: number }>()
  const importRe = /^(?:import|from)\s+([\w.]+)/gm
  let m: RegExpExecArray | null

  while ((m = importRe.exec(code)) !== null) {
    const raw   = m[1].split('.')[0]
    const lower = raw.toLowerCase()
    const pos   = m.index

    if (PUBLIC_ONLY_SKIP.has(lower)) continue

    // ── ccxt: detect ALL exchanges used in the code ────────────────────────
    if (lower === 'ccxt') {
      const ccxtRe = /ccxt\.([a-z_]+)\s*\(/gi
      let cx: RegExpExecArray | null
      const CCXT_URLS: Record<string, string> = {
        binance:      'https://api.binance.com',
        binanceusdm:  'https://fapi.binance.com',
        binancecoinm: 'https://dapi.binance.com',
        bybit:        'https://api.bybit.com',
        okx:          'https://www.okx.com',
        kucoin:       'https://api.kucoin.com',
        kraken:       'https://api.kraken.com',
        coinbasepro:  'https://api.coinbase.com',
        gateio:       'https://api.gateio.ws',
        bitmex:       'https://www.bitmex.com/api/v1',
        deribit:      'https://www.deribit.com/api/v2',
        bitget:       'https://api.bitget.com',
        huobi:        'https://api.huobi.pro',
        htx:          'https://api.htx.com',
        phemex:       'https://api.phemex.com',
        bitfinex:     'https://api-pub.bitfinex.com',
        mexc:         'https://api.mexc.com',
        bitmart:      'https://api-cloud.bitmart.com',
      }
      while ((cx = ccxtRe.exec(code)) !== null) {
        const exchange = cx[1].toLowerCase()
        const key = `ccxt:${exchange}`
        if (found.has(key)) continue
        const exchName = exchange === 'binanceusdm' ? 'Binance Futures (USD-M)'
          : exchange === 'binancecoinm' ? 'Binance Futures (COIN-M)'
          : toTitleCase(exchange)

        const needsAuth = /'apiKey'|"apiKey"|\.apiKey\s*=|api_key\s*=|exchange\.set_sandbox/i.test(code)

        found.set(key, {
          pos: cx.index,
          api: {
            name:           `${exchName} API (ccxt)`,
            baseUrl:        CCXT_URLS[exchange],
            icon:           exchange.includes('binance') ? '🟡' : '🔷',
            color:          exchange.includes('binance') ? '#f59e0b' : '#00f5ff',
            needsSecret:    needsAuth,
            description:    `${exchName} via ccxt library — API Key + Secret Key required`,
            matchedPattern: `ccxt.${exchange}()`,
            variableName:   '',
          },
        })
      }
      // Also mark ccxt itself detected (no exchange constructor found yet)
      if (!found.has('ccxt:generic') && !/ccxt\.[a-z_]+\s*\(/i.test(code)) {
        found.set('ccxt:generic', {
          pos,
          api: {
            name: 'ccxt Exchange API', icon: '🔷', color: '#00f5ff',
            needsSecret: true,
            description: 'ccxt unified crypto trading library — API Key + Secret Key required',
            matchedPattern: 'import ccxt',
            variableName: '',
          },
        })
      }
      continue
    }

    // ── websocket/websockets — handled by URL pass ─────────────────────────
    if (lower === 'websocket' || lower === 'websockets') continue

    const entry = LIBRARY_LOOKUP.get(lower)
    if (!entry) continue

    // Skip pure data-only libraries that have zero credential requirements
    // (robin_stocks and ib_insync use local auth, not API keys)
    const trulyPublic = ['robin_stocks', 'ib_insync', 'yfinance', 'tradingview_ta', 'pycoingecko']
    if (!entry.needsSecret && trulyPublic.includes(lower)) {
      // Still add them — they're useful to show in the "all APIs" view
    }

    const key = entry.name
    if (found.has(key)) continue

    found.set(key, {
      pos,
      api: {
        name:           entry.name,
        baseUrl:        entry.baseUrl,
        icon:           entry.icon,
        color:          entry.color,
        needsSecret:    entry.needsSecret,
        description:    entry.description,
        matchedPattern: `import ${raw}`,
        variableName:   '',
      },
    })
  }

  return found
}

// ── Pass 2+3: ALL-CAPS credential variable scan ───────────────────────────────

function detectFromCredentialVars(
  code: string,
  alreadyFound: Set<string>,
): Map<string, { api: DetectedApi; pos: number }> {
  const found = new Map<string, { api: DetectedApi; pos: number }>()

  const processVar = (prefix: string, suffix: string, varName: string, pos: number) => {
    if (!prefix) return
    const rootPrefix = prefix.split('_')[0].toUpperCase()
    if (ENV_SKIP_PREFIXES.has(rootPrefix)) return

    const apiName = makeApiName(prefix)
    if (alreadyFound.has(apiName) || found.has(apiName)) return

    const isSecret = /SECRET|PRIVATE|TOKEN|PASSPHRASE|CLIENT_SECRET/.test(suffix)
    const meta     = getLibMeta(prefix.split('_')[0])
    const urlFromCode = findAssociatedUrl(code, prefix)

    found.set(apiName, {
      pos,
      api: {
        name:           apiName,
        baseUrl:        urlFromCode ?? meta.baseUrl,
        icon:           meta.icon,
        color:          meta.color,
        needsSecret:    isSecret || meta.needsSecret,
        description:    meta.description,
        matchedPattern: varName,
        variableName:   varName,
      },
    })
  }

  let m: RegExpExecArray | null

  // 2a: Variable assignment (VAR_KEY = ...)
  const varRe = new RegExp(CRED_VAR_RE.source, 'gm')
  while ((m = varRe.exec(code)) !== null) {
    processVar(m[1], m[2], `${m[1]}${m[2]}`, m.index)
  }

  // 2b: os.getenv inline
  const envRe = new RegExp(CRED_ENV_RE.source, 'gm')
  while ((m = envRe.exec(code)) !== null) {
    const varName = m[1]
    const prefix  = stripCredSuffix(varName)
    if (!prefix) continue
    const suffix = varName.slice(prefix.length)
    processVar(prefix, suffix, varName, m.index)
  }

  return found
}

// ── Pass 4: Known-service URL pattern detection ───────────────────────────────

function detectFromUrlPatterns(
  code: string,
  alreadyFound: Set<string>,
): Map<string, { api: DetectedApi; pos: number }> {
  const found = new Map<string, { api: DetectedApi; pos: number }>()

  for (const { pattern, entry, wss } of URL_PATTERN_MAP) {
    if (!entry) continue
    const apiName = entry.name
    if (alreadyFound.has(apiName) || found.has(apiName)) continue
    const m = pattern.exec(code)
    if (!m) continue
    found.set(apiName, {
      pos: m.index,
      api: {
        name:           entry.name,
        baseUrl:        entry.baseUrl,
        icon:           entry.icon,
        color:          entry.color,
        needsSecret:    entry.needsSecret,
        description:    wss
          ? `${entry.description} (WebSocket stream detected)`
          : entry.description,
        matchedPattern: wss ? `WebSocket: ${m[0]}` : `URL: ${m[0]}`,
        variableName:   '',
      },
    })
  }

  return found
}

// ── Pass 5: WebSocket URL detection ──────────────────────────────────────────

function detectFromWebsocketUrls(
  code: string,
  alreadyFound: Set<string>,
): Map<string, { api: DetectedApi; pos: number }> {
  const found = new Map<string, { api: DetectedApi; pos: number }>()
  const wsRe  = /["'`](wss?:\/\/[^"'`\s]+)["'`]/gi
  let m: RegExpExecArray | null

  while ((m = wsRe.exec(code)) !== null) {
    const url = m[1]
    for (const { pattern, entry } of URL_PATTERN_MAP) {
      if (!entry) continue
      const apiName = entry.name
      if (alreadyFound.has(apiName) || found.has(apiName)) continue
      if (!pattern.test(url)) continue
      found.set(apiName, {
        pos: m.index,
        api: {
          name:           entry.name,
          baseUrl:        entry.baseUrl,
          icon:           entry.icon,
          color:          entry.color,
          needsSecret:    entry.needsSecret,
          description:    `${entry.description} (WebSocket stream)`,
          matchedPattern: `WebSocket: ${url.slice(0, 60)}`,
          variableName:   '',
        },
      })
    }
  }

  return found
}

// ── Pass 6: Direct constructor / instantiation patterns ──────────────────────
// Catches `anthropic.Anthropic(`, `openai.OpenAI(`, `groq.Groq(`, etc.
// These are the clearest possible signal that an API is being used.

function detectFromConstructors(
  code: string,
  alreadyFound: Set<string>,
): Map<string, { api: DetectedApi; pos: number }> {
  const found = new Map<string, { api: DetectedApi; pos: number }>()

  for (const { pattern, entry, label } of CONSTRUCTOR_PATTERNS) {
    if (!entry) continue
    const apiName = entry.name
    if (alreadyFound.has(apiName) || found.has(apiName)) continue
    const m = pattern.exec(code)
    if (!m) continue
    found.set(apiName, {
      pos: m.index,
      api: {
        name:           entry.name,
        baseUrl:        entry.baseUrl,
        icon:           entry.icon,
        color:          entry.color,
        needsSecret:    entry.needsSecret,
        description:    entry.description,
        matchedPattern: label,
        variableName:   '',
      },
    })
  }

  return found
}

// ── Shared merge logic ────────────────────────────────────────────────────────

function mergeAndSort(
  ...maps: Map<string, { api: DetectedApi; pos: number }>[]
): DetectedApi[] {
  const all: { api: DetectedApi; pos: number }[] = []
  for (const map of maps) Array.from(map.values()).forEach(v => all.push(v))

  const seen   = new Set<string>()
  const unique = all.filter(v => {
    if (seen.has(v.api.name)) return false
    seen.add(v.api.name)
    return true
  })

  unique.sort((a, b) => a.pos - b.pos)
  return unique.map(v => v.api)
}

function _nameSet(map: Map<string, { api: DetectedApi; pos: number }>): Set<string> {
  return new Set(Array.from(map.values()).map(v => v.api.name))
}

function _merge(...sets: Set<string>[]): Set<string> {
  const out = new Set<string>()
  for (const s of sets) Array.from(s).forEach(v => out.add(v))
  return out
}

// ── Primary exports ───────────────────────────────────────────────────────────

/**
 * Scan Python bot code and return APIs that REQUIRE private credentials.
 * (Used by the red-badge missing-key indicator.)
 */
export function detectRequiredApis(code: string): DetectedApi[] {
  return detectAllApis(code).filter(a => a.needsSecret)
}

/**
 * Scan Python bot code and return ALL detected APIs — private and public.
 * Runs all 6 passes. Used everywhere a complete picture is needed.
 */
export function detectAllApis(code: string): DetectedApi[] {
  if (!code?.trim()) return []

  const importMap = detectFromImports(code)
  const importSet = _nameSet(importMap)

  const credMap = detectFromCredentialVars(code, importSet)
  const credSet = _merge(importSet, _nameSet(credMap))

  const urlMap  = detectFromUrlPatterns(code, credSet)
  const urlSet  = _merge(credSet, _nameSet(urlMap))

  const wsMap   = detectFromWebsocketUrls(code, urlSet)
  const wsSet   = _merge(urlSet, _nameSet(wsMap))

  const ctorMap = detectFromConstructors(code, wsSet)

  return mergeAndSort(importMap, credMap, urlMap, wsMap, ctorMap)
}

/**
 * Returns only APIs from the detected list that haven't been configured yet.
 */
export function unconfiguredApis(
  detected: DetectedApi[],
  existingNames: string[],
): DetectedApi[] {
  const lower = existingNames.map(n => n.toLowerCase())
  return detected.filter(api => !lower.includes(api.name.toLowerCase()))
}
