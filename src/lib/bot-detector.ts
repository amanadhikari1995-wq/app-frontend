/**
 * bot-detector.ts — Comprehensive bot type & sub-label detection
 *
 * 16 specific bot types detected in priority order:
 *   Platform-first:  telegram, discord, twitter, slack
 *   Trading-specific: arbitrage, dca, grid, market_maker, trading
 *   AI / Data:        ai_agent, prediction, scraper, news
 *   Alerting:         alert, notification
 *   Fallback:         generic
 */

export type BotType =
  | 'telegram'
  | 'discord'
  | 'twitter'
  | 'slack'
  | 'trading'
  | 'arbitrage'
  | 'dca'
  | 'grid'
  | 'scalping'
  | 'market_maker'
  | 'ai_agent'
  | 'prediction'
  | 'scraper'
  | 'news'
  | 'alert'
  | 'notification'
  | 'generic'

export interface BotTypeMeta {
  label: string
  icon:  string
  color: string
  bg:    string
}

export const BOT_TYPE_META: Record<BotType, BotTypeMeta> = {
  telegram:     { label: 'Telegram Bot',        icon: '✈️',  color: '#3b82f6',           bg: 'rgba(59,130,246,0.1)'    },
  discord:      { label: 'Discord Bot',         icon: '🎮',  color: '#818cf8',           bg: 'rgba(129,140,248,0.1)'   },
  twitter:      { label: 'Twitter/X Bot',       icon: '🐦',  color: '#3b82f6',           bg: 'rgba(59,130,246,0.1)'    },
  slack:        { label: 'Slack Bot',           icon: '💬',  color: '#f59e0b',           bg: 'rgba(245,158,11,0.1)'    },
  trading:      { label: 'Trading Bot',         icon: '📈',  color: 'var(--accent)',     bg: 'var(--accent-dim)'       },
  arbitrage:    { label: 'Arbitrage Bot',       icon: '⚖️',  color: '#00f5ff',           bg: 'rgba(0,245,255,0.1)'     },
  dca:          { label: 'DCA Bot',             icon: '💰',  color: '#22c55e',           bg: 'rgba(34,197,94,0.1)'     },
  grid:         { label: 'Grid Trading Bot',    icon: '📊',  color: '#f59e0b',           bg: 'rgba(245,158,11,0.1)'    },
  scalping:     { label: 'Scalping Bot',        icon: '⚡',  color: '#ec4899',           bg: 'rgba(236,72,153,0.1)'    },
  market_maker: { label: 'Market Maker Bot',    icon: '🏦',  color: '#60a5fa',           bg: 'rgba(96,165,250,0.1)'    },
  ai_agent:     { label: 'AI Agent',            icon: '🤖',  color: '#a855f7',           bg: 'rgba(168,85,247,0.1)'    },
  prediction:   { label: 'Prediction Bot',      icon: '🧠',  color: '#a855f7',           bg: 'rgba(168,85,247,0.08)'   },
  scraper:      { label: 'Web Scraper',         icon: '🕷️',  color: '#f59e0b',           bg: 'rgba(245,158,11,0.08)'   },
  news:         { label: 'News Bot',            icon: '📰',  color: '#64748b',           bg: 'rgba(100,116,139,0.1)'   },
  alert:        { label: 'Price Alert Bot',     icon: '🔔',  color: '#f59e0b',           bg: 'rgba(245,158,11,0.08)'   },
  notification: { label: 'Notification Bot',   icon: '📣',  color: '#22c55e',           bg: 'rgba(34,197,94,0.08)'    },
  generic:      { label: 'Custom Bot',          icon: '⚙️',  color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.08)'  },
}

// ── Signal helpers ────────────────────────────────────────────────────────────

function hasTelegram(c: string): boolean {
  return /import\s+telebot|from\s+telebot|import\s+telegram\b|from\s+telegram\b|from\s+pyrogram|import\s+pyrogram|from\s+telethon|import\s+telethon|telebot\.TeleBot\s*\(|telegram\.Bot\s*\(|Bot\s*\(\s*token\s*=|@(?:bot|dp|router|dispatcher)\.(?:message_handler|message|callback|command|start|text|photo|on_message)|application\s*=\s*Application\.builder|Updater\s*\(|CommandHandler\s*\(|MessageHandler\s*\(|CallbackQueryHandler\s*\(|InlineKeyboardMarkup|ReplyKeyboardMarkup/i.test(c)
}

function hasDiscord(c: string): boolean {
  return /import\s+discord|from\s+discord|discord\s*\.\s*(?:Client|Bot|Intents|ext|app_commands)|@(?:bot|client|tree)\.(?:command|event|slash_command|tree)|commands\.Bot\s*\(|commands\.Cog|@commands\.command|discord\.Intents|on_ready|on_message|bot\.run\s*\(/i.test(c)
}

function hasTwitter(c: string): boolean {
  return /import\s+tweepy|from\s+tweepy|tweepy\s*\.\s*(?:Client|API|OAuth1|OAuth2|Stream)|twitter_api|tw\.API|create_tweet|update_status\s*\(/i.test(c)
}

function hasSlack(c: string): boolean {
  return /from\s+slack|import\s+slack|WebClient\s*\(\s*token|slack_bolt|from\s+slack_sdk|import\s+slack_sdk|@app\.(?:command|event|message)|App\s*\(\s*token\s*=.*signing_secret/i.test(c)
}

function hasExchange(c: string): boolean {
  return /import\s+ccxt|from\s+ccxt|ccxt\s*\.\s*\w+\s*\(|ccxt\s*\[["']/i.test(c)
    || /from\s+binance|import\s+binance|BinanceClient|BinanceSocketManager|python.?binance/i.test(c)
    || /from\s+pybit|import\s+pybit|from\s+pybit\.unified_trading/i.test(c)
    || /from\s+okx|import\s+okx|OkxClient/i.test(c)
    || /TradingClient\s*\(|from\s+alpaca|import\s+alpaca/i.test(c)
    || /KalshiClient|from\s+kalshi|import\s+kalshi/i.test(c)
}

function hasTradingActions(c: string): boolean {
  return /create_order|create_market_order|create_limit_order|cancel_order\b|place_order|place_order_async/i.test(c)
    || /fetch_balance|fetch_positions|fetch_open_orders|fetch_closed_orders|fetch_my_trades/i.test(c)
    || /set_leverage|set_margin_type|change_leverage|set_isolated_margin/i.test(c)
    || /open_long|open_short|close_long|close_short|long_position|short_position/i.test(c)
    || /market_buy|market_sell|limit_buy|limit_sell|buy_market|sell_market/i.test(c)
}

function hasCryptoContext(c: string): boolean {
  return /BTCUSDT|ETHUSDT|SOLUSDT|BNBUSDT|XRPUSDT|BTC\/USDT|ETH\/USDT|SOL\/USDT|BTC\/USD|ETH\/USD/i.test(c)
    || /\bRSI\b.*\(|\bMACD\b.*\(|\bEMA\b.*\(|\bSMA\b.*\(|\bBollinger\b|\bATR\b.*\(|\bADX\b.*\(/i.test(c)
    || /take_profit|stop_loss|entry_price|exit_price|position_size|order_size|trailing_stop/i.test(c)
}

// ── Primary detection ─────────────────────────────────────────────────────────

export function detectBotType(code: string): BotType {
  const c = code

  // ── Platform bots (highest priority — interface determines the bot type) ──

  if (hasDiscord(c)) return 'discord'
  if (hasTelegram(c)) return 'telegram'
  if (hasTwitter(c))  return 'twitter'
  if (hasSlack(c))    return 'slack'

  // ── Specialized trading strategies (before generic trading) ──────────────

  // Arbitrage: cross-exchange price differences
  if (/\barbitrage\b|arb_opportunity|arb_profit|price_difference.*exchange|spread_profit|cross.?exchange|triangular.?arb|tri_arb/i.test(c)
    && (hasExchange(c) || hasTradingActions(c) || hasCryptoContext(c))) return 'arbitrage'

  // DCA: periodic accumulation
  if (/dollar.?cost.?averag|\bdca\b|dca_bot|dca_amount|periodic_buy|interval_buy|accumulate.?position|recurring_buy|regular_invest|buy_interval|buy_every/i.test(c)) return 'dca'

  // Grid trading: price levels with buy/sell orders
  if (/grid_bot|grid_trading|grid_levels?|price_grid|grid_buy|grid_sell|lower_price.*upper_price|grid_step|num_grids|grid_profit|grid_spacing|grid_order/i.test(c)) return 'grid'

  // Scalping: rapid in/out trades on small price movements
  if (/\bscalp(?:ing)?\b|scalper|scalp_bot|quick_trade|fast_trade|micro_profit|tick_trade|rapid_trade|small_profit_target|short_hold|seconds_timeframe/i.test(c)
    && (hasExchange(c) || hasTradingActions(c) || hasCryptoContext(c))) return 'scalping'

  // Market making: passive bid/ask quoting
  if (/market.?maker|market.?making|\bbid_ask\b|ask_price.*bid_price|spread_margin|liquidity_provider|passive_order|quote_both_sides|best_bid.*best_ask|maker_order|taker_order/i.test(c)) return 'market_maker'

  // General trading
  if (hasExchange(c) || hasTradingActions(c)
    || /kalshi|polymarket|prediction.?market|place_order.*market|KXBTC/i.test(c)
    || (hasCryptoContext(c) && c.length > 300)) return 'trading'

  // ── AI / LLM Agent (without trading) ─────────────────────────────────────

  const hasLLMImport = /import\s+openai|from\s+openai|import\s+anthropic|from\s+anthropic|import\s+groq|from\s+groq|import\s+mistralai|from\s+mistralai/i.test(c)
  const hasLLMUsage  = /system_message|user_message|chat_history|conversation_history|messages\s*=\s*\[|role.*content|chat_completion|generate_response|llm_response|ai_response|chatbot|\.chat\.completions|\.messages\.create/i.test(c)
  if (hasLLMImport && hasLLMUsage) return 'ai_agent'

  // ── Data / content bots ───────────────────────────────────────────────────

  // News / sentiment
  if (/newsapi|news_api|feedparser|rss_feed|sentiment_analysis|vader|textblob|nlp_analysis|article\.text|newspaper3k|get_articles|fetch_headlines|news_sentiment/i.test(c)) return 'news'

  // Scraper
  if (/BeautifulSoup|scrapy\b|selenium|playwright|WebScraper|ScraperBot|\.find_all\s*\(|driver\.get\s*\(|\bscrape\b|\bscraper\b|\bscraping\b/i.test(c)) return 'scraper'

  // Prediction / ML
  if (/\.predict\s*\(|\.fit\s*\(|Prediction|PredictionBot|accuracy_score|confidence_score|RandomForest|XGBoost|neural_network|torch\.|tensorflow/i.test(c)) return 'prediction'

  // ── Alerting / notification ───────────────────────────────────────────────

  // Price alerts (more specific than generic notification)
  if (/price_alert|send_alert|price_threshold|notify_when|monitor_price|alert_price|price.*above.*notify|price.*below.*notify|check_price.*send/i.test(c)) return 'alert'

  // Notification
  if (/webhook|WEBHOOK_URL|NotificationBot|send_webhook|smtplib|send_email|email_notification|\bnotify\s*\(|send_notification/i.test(c)) return 'notification'

  return 'generic'
}

// ── Sub-label: human-readable specific name ───────────────────────────────────

export function detectBotSubLabel(code: string, type: BotType): string {
  const c = code

  switch (type) {

    case 'telegram': {
      const hasTrade = hasExchange(c) || hasTradingActions(c) || hasCryptoContext(c)
      if (hasTrade) {
        if (/binance/i.test(c)) return 'Telegram Binance Trading Bot'
        if (/bybit|pybit/i.test(c)) return 'Telegram Bybit Trading Bot'
        if (/okx/i.test(c)) return 'Telegram OKX Trading Bot'
        if (/ccxt/i.test(c)) return 'Telegram Crypto Trading Bot'
        return 'Telegram Trading Bot'
      }
      if (/openai|anthropic|groq|claude|gpt|llm/i.test(c)) return 'Telegram AI Chatbot'
      if (/coingecko|coinmarketcap|binance|price.*crypto|crypto.*price/i.test(c)) return 'Telegram Crypto Price Bot'
      if (/weather|forecast|temperature/i.test(c)) return 'Telegram Weather Bot'
      if (/newsapi|headlines|rss|article/i.test(c)) return 'Telegram News Bot'
      if (/remind|schedule|alarm|timer|cron/i.test(c)) return 'Telegram Reminder Bot'
      if (/alert|notify|monitor/i.test(c)) return 'Telegram Alert Bot'
      return 'Telegram Bot'
    }

    case 'discord': {
      const hasTrade = hasExchange(c) || hasTradingActions(c)
      if (hasTrade) return 'Discord Trading Bot'
      if (/openai|anthropic|groq|claude|gpt/i.test(c)) return 'Discord AI Bot'
      if (/music|youtube|play\s*\(|queue|song|audio/i.test(c)) return 'Discord Music Bot'
      if (/\bban\b|\bkick\b|\bmute\b|\bwarn\b|moderat|auto.?mod|role_assign/i.test(c)) return 'Discord Moderation Bot'
      if (/crypto|price|coingecko|binance/i.test(c)) return 'Discord Crypto Bot'
      return 'Discord Bot'
    }

    case 'twitter': {
      if (/crypto|bitcoin|btc|price|coingecko/i.test(c)) return 'Crypto Twitter Bot'
      if (/sentiment|news|headline/i.test(c)) return 'News Twitter Bot'
      if (/openai|anthropic|gpt|claude/i.test(c)) return 'AI Twitter Bot'
      return 'Twitter/X Bot'
    }

    case 'slack': {
      if (hasExchange(c) || hasTradingActions(c)) return 'Slack Trading Bot'
      if (/openai|anthropic|gpt/i.test(c)) return 'Slack AI Bot'
      if (/alert|notify|monitor/i.test(c)) return 'Slack Alert Bot'
      return 'Slack Bot'
    }

    case 'trading': {
      // Binance
      if (/ccxt\s*\.\s*binance|from\s+binance|python.?binance|BinanceClient/i.test(c)) {
        if (/fapi|futures|perpetual/i.test(c)) {
          if (/BTC|bitcoin/i.test(c)) return 'Binance BTC Futures Bot'
          if (/ETH|ethereum/i.test(c)) return 'Binance ETH Futures Bot'
          return 'Binance Futures Bot'
        }
        return 'Binance Spot Trading Bot'
      }
      // Bybit
      if (/ccxt\s*\.\s*bybit|from\s+pybit|import\s+pybit/i.test(c)) {
        if (/futures|perpetual|linear/i.test(c)) return 'Bybit Futures Bot'
        return 'Bybit Trading Bot'
      }
      // Other exchanges
      if (/ccxt\s*\.\s*okx|from\s+okx|OkxClient/i.test(c))       return 'OKX Trading Bot'
      if (/ccxt\s*\.\s*kucoin|from\s+kucoin/i.test(c))            return 'KuCoin Trading Bot'
      if (/ccxt\s*\.\s*kraken|krakenAPI|krakenex/i.test(c))       return 'Kraken Trading Bot'
      if (/ccxt\s*\.\s*coinbase|from\s+coinbase/i.test(c))        return 'Coinbase Trading Bot'
      if (/ccxt\s*\.\s*gate|from\s+gate_api/i.test(c))            return 'Gate.io Trading Bot'
      if (/ccxt\s*\.\s*bitget|from\s+bitget/i.test(c))            return 'Bitget Trading Bot'
      if (/ccxt\s*\.\s*mexc/i.test(c))                            return 'MEXC Trading Bot'
      if (/ccxt\s*\.\s*huobi|ccxt\s*\.\s*htx/i.test(c))          return 'Huobi/HTX Trading Bot'
      if (/ccxt\s*\.\s*bitmex/i.test(c))                          return 'BitMEX Trading Bot'
      // Platform-based
      if (/TradingClient|from\s+alpaca/i.test(c))                 return 'Alpaca Stock Trading Bot'
      if (/kalshi|KalshiClient/i.test(c))                         return 'Kalshi Prediction Market Bot'
      if (/polymarket/i.test(c))                                   return 'Polymarket Bot'
      // Generic ccxt
      if (/import\s+ccxt|from\s+ccxt/i.test(c))                   return 'Crypto Trading Bot'
      // TA-based
      if (/MACD|RSI|EMA|SMA|Bollinger/i.test(c))                  return 'Technical Analysis Trading Bot'
      if (/futures|perpetual/i.test(c))                           return 'Futures Trading Bot'
      return 'Trading Bot'
    }

    case 'arbitrage':    return 'Cross-Exchange Arbitrage Bot'
    case 'dca':          return 'DCA (Dollar Cost Averaging) Bot'
    case 'grid':         return 'Grid Trading Bot'
    case 'scalping':     return 'Scalping Bot'
    case 'market_maker': return 'Market Making Bot'

    case 'ai_agent': {
      if (/openai|gpt/i.test(c))       return 'OpenAI GPT Agent'
      if (/anthropic|claude/i.test(c)) return 'Claude AI Agent'
      if (/groq/i.test(c))             return 'Groq AI Agent'
      if (/mistral/i.test(c))          return 'Mistral AI Agent'
      if (/gemini|google.*genai/i.test(c)) return 'Gemini AI Agent'
      return 'AI Agent'
    }

    case 'prediction': {
      if (/RandomForest|XGBoost|GradientBoosting/i.test(c)) return 'ML Prediction Bot'
      if (/torch\.|tensorflow|keras/i.test(c))              return 'Deep Learning Bot'
      if (/price.*predict|predict.*price/i.test(c))         return 'Price Prediction Bot'
      return 'Prediction Bot'
    }

    case 'scraper': {
      if (/selenium|playwright/i.test(c))   return 'Browser Automation Bot'
      if (/scrapy/i.test(c))                return 'Scrapy Spider Bot'
      if (/BeautifulSoup/i.test(c))         return 'Web Scraper Bot'
      return 'Web Scraper'
    }

    case 'news': {
      if (/sentiment|vader|textblob/i.test(c)) return 'News Sentiment Bot'
      if (/rss|feedparser/i.test(c))           return 'RSS Feed Bot'
      return 'News Aggregator Bot'
    }

    case 'alert':        return 'Price Alert Bot'
    case 'notification': return 'Notification Bot'
    default:             return 'Custom Bot'
  }
}
