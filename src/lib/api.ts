import axios from 'axios'
import { getToken } from './auth'
import { getApiUrl, getTransportMode } from './runtime-config'
import { relayAdapter } from './relay-adapter'
import { relayClient } from './relay-client'

// 20s timeout — without this, a hung local backend lets requests stack up
// indefinitely during a long session. axios will reject with ECONNABORTED.
// baseURL is intentionally NOT set on the instance — it's resolved per-request
// in the interceptor below so window.__CONFIG__ overrides take effect at
// request time (Electron preload sets this from runtime-config.json).
const api = axios.create({ timeout: 30000 })

// ── Attach Bearer token + resolve baseURL on every request ──────────────────
//
// The transport mode is also resolved per-request so the same axios
// instance can switch between local HTTP (Electron) and the relay
// tunnel (web dashboard) without recreating itself.
api.interceptors.request.use((config) => {
  const mode = getTransportMode()
  if (mode === 'relay') {
    // Open the WebSocket lazily on first API call — keeps idle pages cheap.
    relayClient.connect()
    config.adapter = relayAdapter
    // baseURL/auth are not used by the adapter (the desktop side already
    // adds the local backend's bearer); set them anyway for completeness.
    config.baseURL = ''
  } else {
    config.baseURL = getApiUrl()
  }
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Per user request, 401 responses do NOT auto-logout. The user stays
// signed in until they click the Logout button explicitly. Individual
// API calls will surface their own errors to the UI; they don't kick
// the session.

export default api

// ── Bots ──────────────────────────────────────────────────────────────────────
export const botsApi = {
  getAll: () => api.get('/api/bots/'),
  create: (data: { name: string; description?: string; code: string }) =>
    api.post('/api/bots/', data),
  get: (id: number) => api.get(`/api/bots/${id}`),
  update: (id: number, data: {
    name?: string; description?: string; code?: string
    schedule_type?: string; schedule_start?: string; schedule_end?: string
    max_amount_per_trade?: number; max_contracts_per_trade?: number; max_daily_loss?: number
    auto_restart?: boolean
  }) => api.put(`/api/bots/${id}`, data),
  delete: (id: number) => api.delete(`/api/bots/${id}`),
  run: (id: number, demoMode = false) => api.post(`/api/bots/${id}/run`, { demo_mode: demoMode }),
  stop: (id: number) => api.post(`/api/bots/${id}/stop`),
  getLogs: (id: number, limit = 200, since_id = 0) =>
    api.get(`/api/bots/${id}/logs`, { params: { limit, ...(since_id > 0 ? { since_id } : {}) } }),
  clearLogs: (id: number) => api.delete(`/api/bots/${id}/logs`),
  aiFix: (id: number, data: { error_logs: string[]; extra_context?: string }) =>
    api.post(`/api/bots/${id}/ai-fix`, data),
}

// ── API Connections (per-bot) ─────────────────────────────────────────────────
export const connectionsApi = {
  getByBot: (botId: number) =>
    api.get('/api/connections/', { params: { bot_id: botId } }),
  getAll: () => api.get('/api/connections/'),
  create: (data: { bot_id: number; name: string; base_url?: string; api_key?: string; api_secret?: string }) =>
    api.post('/api/connections/', data),
  update: (id: number, data: { bot_id: number; name: string; base_url?: string; api_key?: string; api_secret?: string }) =>
    api.put(`/api/connections/${id}`, data),
  delete: (id: number) => api.delete(`/api/connections/${id}`),
}

// ── Trades ────────────────────────────────────────────────────────────────────
export const tradesApi = {
  getByBot:  (botId: number, limit = 500) => api.get('/api/trades/',       { params: { bot_id: botId, limit } }),
  getStats:  (botId: number)              => api.get('/api/trades/stats',   { params: { bot_id: botId } }),
  delete:    (tradeId: number)            => api.delete(`/api/trades/${tradeId}`),
  clearBot:  (botId: number)              => api.delete(`/api/trades/bot/${botId}`),
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboardApi = {
  stats: () => api.get('/api/dashboard/stats'),
  // Lightweight log-stream: since_id=0 → latest 500 (desc), since_id>0 → new lines only (asc)
  logs: (since_id = 0, limit = 500) =>
    api.get('/api/dashboard/logs', { params: { since_id, limit } }),
}

// ── News ──────────────────────────────────────────────────────────────────────
export const newsApi = {
  get: () => api.get('/api/news/'),
}

// ── Photos ────────────────────────────────────────────────────────────────────
export const photosApi = {
  getAll:  ()                              => api.get('/api/photos/'),
  upload:  (fd: FormData)                  => api.post('/api/photos/', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update:  (id: number, fd: FormData)      => api.put(`/api/photos/${id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  delete:  (id: number)                    => api.delete(`/api/photos/${id}`),
  imgUrl:  (id: number)                    => `${getApiUrl()}/api/photos/${id}/image`,
}

// ── Notes ─────────────────────────────────────────────────────────────────────
export const notesApi = {
  getAll:  ()                                              => api.get('/api/notes/'),
  create:  (data: { title: string; content: string })      => api.post('/api/notes/', data),
  update:  (id: number, data: { title: string; content: string }) => api.put(`/api/notes/${id}`, data),
  delete:  (id: number)                                    => api.delete(`/api/notes/${id}`),
}

// ── User Files ────────────────────────────────────────────────────────────────
export const filesApi = {
  getAll:      ()              => api.get('/api/files/'),
  upload:      (fd: FormData)  => api.post('/api/files/', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  delete:      (id: number)    => api.delete(`/api/files/${id}`),
  downloadUrl: (id: number)    => `${getApiUrl()}/api/files/${id}/download`,
}

// ── Finance ───────────────────────────────────────────────────────────────────
export const financeApi = {
  getAll:   ()                                                          => api.get('/api/finance/'),
  summary:  ()                                                          => api.get('/api/finance/summary'),
  create:   (data: { entry_type: string; amount: number; category: string; description?: string; date: string }) => api.post('/api/finance/', data),
  update:   (id: number, data: { entry_type: string; amount: number; category: string; description?: string; date: string }) => api.put(`/api/finance/${id}`, data),
  delete:   (id: number)                                                => api.delete(`/api/finance/${id}`),
}

// ── Authentication ────────────────────────────────────────────────────────────
export const authApi = {
  /** Email + password login. Returns { access_token, user, is_subscribed }. */
  login: (email: string, password: string) =>
    api.post('/api/auth/login', { email, password }),

  /** Validate the stored JWT and return the current user object. */
  me: () => api.get('/api/auth/me'),

  /** Check subscription status for the authenticated user. */
  subscription: () => api.get('/api/auth/subscription'),
}

// ── System Stats ──────────────────────────────────────────────────────────────
export const systemApi = {
  stats: () => api.get('/api/system/stats'),
}

// ── AI Models (new AI Lab) ────────────────────────────────────────────────────
export const aiModelsApi = {
  getAll:     ()                                           => api.get('/api/ai-models/'),
  create:     (data: { name: string; description?: string }) => api.post('/api/ai-models/', data),
  get:        (id: number)                                 => api.get(`/api/ai-models/${id}`),
  update:     (id: number, data: Record<string, unknown>)  => api.put(`/api/ai-models/${id}`, data),
  delete:     (id: number)                                 => api.delete(`/api/ai-models/${id}`),
  train:      (id: number)                                 => api.post(`/api/ai-models/${id}/train`),
  runs:       (id: number)                                 => api.get(`/api/ai-models/${id}/runs`),
  deleteRun:  (id: number, runId: number)                  => api.delete(`/api/ai-models/${id}/runs/${runId}`),
  uploadFile: (id: number, fd: FormData)                   =>
    api.post(`/api/ai-models/${id}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deleteFile: (id: number, fileId: number)                 => api.delete(`/api/ai-models/${id}/files/${fileId}`),
}

// ── AI Trainer (legacy bot-folder based) ──────────────────────────────────────
export const trainerApi = {
  overview:        ()                           => api.get('/api/trainer/overview'),
  patterns:        (botId: number)              => api.get(`/api/trainer/patterns/${botId}`),
  sessions:        (botId: number, limit = 50)  => api.get(`/api/trainer/sessions/${botId}`, { params: { limit } }),
  strategies:      ()                           => api.get('/api/trainer/strategies'),
  getStrategy:     (name: string)               => api.get(`/api/trainer/strategy/${name}`),
  deleteStrategy:  (name: string)               => api.delete(`/api/trainer/strategy/${name}`),
  folderStructure: (botId: number)              => api.get(`/api/trainer/folder-structure/${botId}`),
  initBot: (botId: number, botName: string) => {
    const fd = new FormData()
    fd.append('bot_id', String(botId))
    fd.append('bot_name', botName)
    return api.post('/api/trainer/init-bot', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  fetchUrl: (data: { url: string; bot_id: number; bot_name: string; data_type?: string }) =>
    api.post('/api/trainer/fetch-url', data),
  uploadFile: (formData: FormData) =>
    api.post('/api/trainer/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadStrategy: (formData: FormData) =>
    api.post('/api/trainer/strategy/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
}


// ── AI Code Analysis (LangGraph multi-agent) ──────────────────────────────────
export interface AnalyzeResponse {
  bot_type:       string
  bot_sublabel:   string
  bot_confidence: number
  bot_reasoning:  string
  detected_apis:  {
    name:           string
    baseUrl:        string
    icon:           string
    color:          string
    needsSecret:    boolean
    description:    string
    matchedPattern: string
    variableName:   string
  }[]
  powered_by: string
}

export const analyzeApi = {
  analyze: (code: string) => api.post<AnalyzeResponse>('/api/analyze/', { code }),
}
