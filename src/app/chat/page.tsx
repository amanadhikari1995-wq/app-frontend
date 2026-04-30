'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Navbar from '@/components/Navbar'

// ─── Constants ────────────────────────────────────────────────────────────────
const API  = 'http://localhost:8000'
const WS   = 'ws://localhost:8000'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatUser {
  id: string; username: string; avatar?: string; online: boolean
}
interface ChatMessage {
  id: string; sender_id: string; sender_name: string; sender_avatar?: string
  recipient_id?: string | null; content: string; message_type: string
  file_url?: string | null; file_original?: string | null; created_at: string
  channel?: string   // sub-channel within Community (general | strategy | problem | fun)
}
type Room = 'group' | string   // 'group' or a userId for DM
type CommunityChannel = 'general' | 'strategy' | 'problem' | 'fun'

const COMMUNITY_GROUPS: { id: CommunityChannel; label: string; emoji: string }[] = [
  { id: 'general',  label: 'General Chat',      emoji: '💬' },
  { id: 'strategy', label: 'Strategy Sharing',  emoji: '📈' },
  { id: 'problem',  label: 'Problem Solving',   emoji: '🛠️' },
  { id: 'fun',      label: 'Fun Chat',          emoji: '🎉' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getOrCreateUserId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('wdog-chat-uid')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('wdog-chat-uid', id) }
  return id
}
function fmtTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
function fmtDate(iso: string) {
  try {
    const d = new Date(iso)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return 'Today'
    const yest = new Date(today); yest.setDate(today.getDate() - 1)
    if (d.toDateString() === yest.toDateString()) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return '' }
}
function avatarInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}
const AVATAR_COLORS = [
  '#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4','#f97316','#6366f1',
]
function avatarColor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ user, size = 36 }: { user: { id: string; username: string; avatar?: string }; size?: number }) {
  const [broken, setBroken] = useState(false)
  const src = user.avatar && !broken ? `${API}${user.avatar}` : null
  return (
    <div className="shrink-0 rounded-full flex items-center justify-center overflow-hidden font-black"
      style={{ width: size, height: size, background: src ? 'transparent' : avatarColor(user.id), fontSize: size * 0.38 }}>
      {src
        ? <img src={src} alt={user.username} className="w-full h-full object-cover" onError={() => setBroken(true)} />
        : <span className="text-white">{avatarInitials(user.username)}</span>
      }
    </div>
  )
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
      style={{ background: online ? '#22c55e' : '#475569', borderColor: 'var(--card)' }} />
  )
}

function ImageMessage({ url, original }: { url: string; original?: string | null }) {
  const [open, setOpen] = useState(false)
  const fullUrl = url.startsWith('http') ? url : `${API}${url}`
  return (
    <>
      <img src={fullUrl} alt={original || 'image'} className="rounded-xl max-w-[280px] max-h-[280px] object-cover cursor-pointer mt-1 hover:opacity-90 transition-opacity"
        onClick={() => setOpen(true)} onError={e => (e.currentTarget.style.display = 'none')} />
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <img src={fullUrl} alt={original || 'image'} className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain" />
          <button className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl">✕</button>
        </div>
      )}
    </>
  )
}

function MessageBubble({ msg, isMine }: { msg: ChatMessage; isMine: boolean }) {
  const isImage = msg.message_type === 'image'
  const user = { id: msg.sender_id, username: msg.sender_name, avatar: msg.sender_avatar || undefined }

  return (
    <div className={`flex items-end gap-2.5 group ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="shrink-0 relative">
        <Avatar user={user} size={32} />
      </div>
      <div className={`flex flex-col max-w-[70%] ${isMine ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-2 mb-1 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-[13.2px] font-bold" style={{ color: avatarColor(msg.sender_id) }}>
            {isMine ? 'You' : msg.sender_name}
          </span>
          <span className="text-[12px] text-slate-600">{fmtTime(msg.created_at)}</span>
        </div>
        {isImage && msg.file_url ? (
          <ImageMessage url={msg.file_url} original={msg.file_original} />
        ) : msg.file_url ? (
          <a href={`${API}${msg.file_url}`} download={msg.file_original || 'file'}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all hover:opacity-80"
            style={{ background: isMine ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--accent)' }}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
            {msg.file_original || 'Download file'}
          </a>
        ) : (
          <div className="px-4 py-2.5 rounded-2xl text-sm leading-relaxed select-text break-words"
            style={isMine ? {
              background: 'linear-gradient(135deg, rgba(0,245,255,0.18), rgba(0,180,216,0.12))',
              border: '1px solid rgba(0,245,255,0.25)',
              color: '#e2e8f0',
              borderBottomRightRadius: 4,
            } : {
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#cbd5e1',
              borderBottomLeftRadius: 4,
            }}>
            {msg.content}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ChatPage() {
  // ── Profile ─────────────────────────────────────────────────────────────────
  const [userId]        = useState<string>(getOrCreateUserId)
  const [username, setUsername] = useState('')
  const [avatar,   setAvatar]   = useState<string | undefined>()
  const [profileReady, setProfileReady] = useState(false)
  const [setupName, setSetupName] = useState('')
  const [setupErr,  setSetupErr]  = useState('')

  // ── Chat state ───────────────────────────────────────────────────────────────
  const [room,         setRoom]         = useState<Room>('group')
  const [channel,      setChannel]      = useState<CommunityChannel>('general')
  const [groupMsgs,    setGroupMsgs]    = useState<ChatMessage[]>([])
  const [dmMsgs,       setDmMsgs]       = useState<Record<string, ChatMessage[]>>({})
  const [onlineUsers,  setOnlineUsers]  = useState<ChatUser[]>([])
  const [dmPartners,   setDmPartners]   = useState<{ user_id: string; username: string; last_message: string; last_time: string | null }[]>([])
  const [typing,       setTyping]       = useState<Set<string>>(new Set())
  const [input,        setInput]        = useState('')
  const [connected,    setConnected]    = useState(false)
  const [uploading,    setUploading]    = useState(false)

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const wsRef          = useRef<WebSocket | null>(null)
  const reconnectAttempts = useRef(0)
  const typingTimers   = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const bottomRef      = useRef<HTMLDivElement>(null)
  const fileRef        = useRef<HTMLInputElement>(null)
  const avatarFileRef  = useRef<HTMLInputElement>(null)
  const typingTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const roomRef        = useRef<Room>('group')
  roomRef.current      = room

  // ── Init profile from localStorage ─────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('wdog-chat-profile')
    if (saved) {
      try {
        const p = JSON.parse(saved)
        setUsername(p.username || '')
        setAvatar(p.avatar || undefined)
        if (p.username) setProfileReady(true)
      } catch { /* ignore */ }
    }
  }, [])

  // ── Scroll to bottom on new messages ────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [groupMsgs, dmMsgs, room])

  // ── WebSocket connection ─────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!profileReady || !userId || !username) return
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

    const params = new URLSearchParams({ username })
    if (avatar) params.set('avatar', avatar)
    const ws = new WebSocket(`${WS}/api/chat/ws/${userId}?${params}`)

    ws.onopen = () => {
      setConnected(true)
      reconnectAttempts.current = 0   // reset backoff on successful connection
    }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        handleWsEvent(data)
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      setConnected(false)
      // Exponential backoff capped at 30s — prevents hammering the server when
      // it's down. Without this, a 25-min outage = 500 reconnect attempts.
      const attempt = reconnectAttempts.current++
      const delay = Math.min(3000 * Math.pow(2, attempt), 30000)
      reconnectTimer.current = setTimeout(connect, delay)
    }

    ws.onerror = () => ws.close()
    wsRef.current = ws
  }, [profileReady, userId, username, avatar]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!profileReady) return
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      // Drain any pending typing timers so they don't fire setState after unmount
      typingTimers.current.forEach(clearTimeout)
      typingTimers.current.clear()
      // Stop the WS without triggering onclose-driven reconnect
      const ws = wsRef.current
      if (ws) {
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
    }
  }, [connect, profileReady])

  // ── WS event handler ─────────────────────────────────────────────────────────
  const handleWsEvent = useCallback((data: Record<string, unknown>) => {
    const t = data.type as string
    if (t === 'init' || t === 'user_online' || t === 'user_offline') {
      const users = (data.online_users as ChatUser[] | undefined) || []
      setOnlineUsers(users.filter(u => u.id !== userId))
    }
    if (t === 'group_message') {
      const msg = data.message as ChatMessage
      // Cap to last 500 messages — without this, a chatty room over a long
      // session grows unbounded and React reconciliation gets sluggish.
      setGroupMsgs(prev => {
        const next = [...prev, msg]
        return next.length > 500 ? next.slice(-500) : next
      })
    }
    if (t === 'dm') {
      const msg = data.message as ChatMessage
      const otherId = msg.sender_id === userId ? msg.recipient_id! : msg.sender_id
      setDmMsgs(prev => {
        const list = [...(prev[otherId] || []), msg]
        return { ...prev, [otherId]: list.length > 200 ? list.slice(-200) : list }
      })
      // Also refresh DM partner list
      setDmPartners(prev => {
        const existing = prev.find(p => p.user_id === otherId)
        const entry = {
          user_id: otherId,
          username: msg.sender_id !== userId ? msg.sender_name : (existing?.username || otherId),
          last_message: msg.content || '📎',
          last_time: msg.created_at,
        }
        return [entry, ...prev.filter(p => p.user_id !== otherId)]
      })
    }
    if (t === 'typing') {
      const uid = data.user_id as string
      const uname = data.username as string
      setTyping(prev => new Set(Array.from(prev).concat(uname)))
      // Clear any prior pending clear-timer for this user so we don't queue
      // hundreds of timeouts when typing events arrive faster than 3s.
      const prior = typingTimers.current.get(uname)
      if (prior) clearTimeout(prior)
      const t = setTimeout(() => {
        setTyping(prev => { const n = new Set(prev); n.delete(uname); return n })
        typingTimers.current.delete(uname)
      }, 3000)
      typingTimers.current.set(uname, t)
      void uid // suppress unused warning
    }
  }, [userId])

  // ── Load history when room changes ──────────────────────────────────────────
  useEffect(() => {
    if (!profileReady) return
    const ac = new AbortController()
    if (room === 'group') {
      fetch(`${API}/api/chat/messages/group`, { signal: ac.signal })
        .then(r => r.json()).then(setGroupMsgs).catch(() => {})
    } else {
      fetch(`${API}/api/chat/messages/dm/${room}?me=${userId}`, { signal: ac.signal })
        .then(r => r.json()).then((msgs: ChatMessage[]) => setDmMsgs(prev => ({ ...prev, [room]: msgs }))).catch(() => {})
    }
    return () => ac.abort()
  }, [room, profileReady, userId])

  // ── Load DM partners list ───────────────────────────────────────────────────
  useEffect(() => {
    if (!profileReady) return
    const ac = new AbortController()
    fetch(`${API}/api/chat/conversations/${userId}`, { signal: ac.signal })
      .then(r => r.json()).then(setDmPartners).catch(() => {})
    return () => ac.abort()
  }, [profileReady, userId])

  // ── Send helpers ──────────────────────────────────────────────────────────────
  const wsSend = (data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }

  const sendMessage = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    const base = { sender_name: username, sender_avatar: avatar || null }
    if (room === 'group') {
      wsSend({ type: 'group_message', ...base, content: text, message_type: 'text', channel })
    } else {
      wsSend({ type: 'dm', ...base, recipient_id: room, content: text, message_type: 'text' })
    }
  }

  const sendTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current)
    if (room === 'group') {
      wsSend({ type: 'typing', room: 'group' })
    } else {
      wsSend({ type: 'typing', room: 'dm', recipient_id: room })
    }
    typingTimer.current = setTimeout(() => {}, 2000)
  }

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`${API}/api/chat/upload`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      const base = { sender_name: username, sender_avatar: avatar || null }
      const payload = {
        ...base,
        content:       data.original_name,
        message_type:  data.is_image ? 'image' : 'file',
        file_name:     data.file_name,
        file_original: data.original_name,
        file_url:      data.file_url,
      }
      if (room === 'group') wsSend({ type: 'group_message', ...payload, channel })
      else wsSend({ type: 'dm', ...payload, recipient_id: room })
    } catch { /* ignore */ } finally {
      setUploading(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    const fd = new FormData(); fd.append('user_id', userId); fd.append('file', file)
    const res = await fetch(`${API}/api/chat/avatar`, { method: 'POST', body: fd })
    if (!res.ok) return
    const data = await res.json()
    setAvatar(data.avatar_url)
    const updated = { username, avatar: data.avatar_url }
    localStorage.setItem('wdog-chat-profile', JSON.stringify(updated))
  }

  const handleConfirmProfile = () => {
    const name = setupName.trim()
    if (name.length < 2) { setSetupErr('Name must be at least 2 characters'); return }
    setUsername(name)
    localStorage.setItem('wdog-chat-profile', JSON.stringify({ username: name, avatar }))
    setProfileReady(true)
  }

  // ── Active messages list ──────────────────────────────────────────────────────
  const messages: ChatMessage[] = room === 'group'
    ? groupMsgs.filter(m => (m.channel || 'general') === channel)
    : (dmMsgs[room] || [])

  // ── DM partner username lookup ────────────────────────────────────────────────
  const dmPartnerName = (uid: string) => {
    const onlineUser = onlineUsers.find(u => u.id === uid)
    if (onlineUser) return onlineUser.username
    const partner = dmPartners.find(p => p.user_id === uid)
    return partner?.username || uid.slice(0, 8)
  }

  // ── Profile setup screen ─────────────────────────────────────────────────────
  if (!profileReady) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
        <Navbar />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 96px)' }}>
          <div className="w-full max-w-sm rounded-3xl p-8 relative"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)', boxShadow: 'var(--shadow-card)' }}>
            {/* Accent top */}
            <div className="absolute top-0 left-8 right-8 h-px" style={{ background: 'linear-gradient(90deg,transparent,var(--accent),transparent)' }} />

            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.2)' }}>
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
            </div>

            <h2 className="text-xl font-black text-white text-center mb-1">Join the Community</h2>
            <p className="text-xs text-slate-500 text-center mb-8">Set your display name to start chatting with other WATCH-DOG users.</p>

            <label className="block text-[12px] font-black text-slate-500 uppercase tracking-widest mb-2">Your Display Name</label>
            <input
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white outline-none mb-1 transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)' }}
              placeholder="e.g. TradingWolf, BotMaster…"
              value={setupName}
              onChange={e => { setSetupName(e.target.value); setSetupErr('') }}
              onKeyDown={e => e.key === 'Enter' && handleConfirmProfile()}
            />
            {setupErr && <p className="text-[13.2px] text-red-400 mb-3">{setupErr}</p>}

            <button
              onClick={handleConfirmProfile}
              className="w-full py-3 rounded-xl font-black text-sm mt-4 transition-all hover:opacity-90 active:scale-[0.99]"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
              Enter Chat →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main chat layout ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <Navbar />

      {/* Hidden file inputs */}
      <input ref={fileRef} type="file" accept="image/*,video/mp4,.pdf,.txt,.csv" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
      <input ref={avatarFileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = '' }} />

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 96px)' }}>

        {/* ══════════════════════════════════════════════
            LEFT SIDEBAR
        ══════════════════════════════════════════════ */}
        <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: 260, background: 'var(--card)', borderRight: '1px solid var(--border)' }}>

          {/* ── Profile section ─────────────────────────────────────────────── */}
          <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-3">
              <div className="relative cursor-pointer" onClick={() => avatarFileRef.current?.click()}
                title="Click to change avatar">
                <Avatar user={{ id: userId, username, avatar }} size={40} />
                <div className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.55)' }}>
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 bg-emerald-400" style={{ borderColor: 'var(--card)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-white truncate">{username}</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? '#22c55e' : '#ef4444' }} />
                  <p className="text-[12px] font-semibold" style={{ color: connected ? '#22c55e' : '#ef4444' }}>
                    {connected ? 'Online' : 'Connecting…'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Community ────────────────────────────────────────────────────── */}
          <div className="px-3 pt-4 pb-1">
            <p className="text-[10.8px] font-black text-slate-600 uppercase tracking-[0.15em] px-1 mb-2">Community</p>
            <div className="space-y-1">
              {COMMUNITY_GROUPS.map(g => {
                const active = room === 'group' && channel === g.id
                return (
                  <button
                    key={g.id}
                    onClick={() => { setRoom('group'); setChannel(g.id) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-bold transition-all"
                    style={active ? {
                      background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid rgba(0,245,255,0.2)'
                    } : {
                      color: '#94a3b8', border: '1px solid transparent'
                    }}>
                    <span className="shrink-0" style={{ fontSize: 16, lineHeight: 1 }}>{g.emoji}</span>
                    <span className="truncate"># {g.label}</span>
                    {g.id === 'general' && (
                      <span className="ml-auto text-[12px] font-black px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(0,245,255,0.12)', color: 'var(--accent)' }}>
                        {onlineUsers.length + 1}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Online Users ─────────────────────────────────────────────────── */}
          <div className="px-3 pt-4 pb-1">
            <p className="text-[10.8px] font-black text-slate-600 uppercase tracking-[0.15em] px-1 mb-2">
              Online — {onlineUsers.length + 1}
            </p>
            <div className="space-y-0.5 overflow-y-auto" style={{ maxHeight: 180 }}>
              {/* Self */}
              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl">
                <div className="relative">
                  <Avatar user={{ id: userId, username, avatar }} size={28} />
                  <OnlineDot online />
                </div>
                <span className="text-xs font-bold text-slate-300 truncate">{username}</span>
                <span className="ml-auto text-[10.8px] text-slate-600">(you)</span>
              </div>
              {onlineUsers.map(u => (
                <button key={u.id} onClick={() => setRoom(u.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl transition-all hover:bg-white/[0.04] text-left"
                  style={room === u.id ? { background: 'rgba(255,255,255,0.06)' } : {}}>
                  <div className="relative shrink-0">
                    <Avatar user={u} size={28} />
                    <OnlineDot online={u.online} />
                  </div>
                  <span className="text-xs font-bold text-slate-300 truncate">{u.username}</span>
                </button>
              ))}
              {onlineUsers.length === 0 && (
                <p className="text-[12px] text-slate-700 px-3 py-1">No other users online</p>
              )}
            </div>
          </div>

          {/* ── Direct Messages ──────────────────────────────────────────────── */}
          <div className="px-3 pt-4 pb-2 flex-1 overflow-hidden flex flex-col">
            <p className="text-[10.8px] font-black text-slate-600 uppercase tracking-[0.15em] px-1 mb-2">Direct Messages</p>
            <div className="space-y-0.5 overflow-y-auto flex-1">
              {dmPartners.length === 0 && (
                <p className="text-[12px] text-slate-700 px-3 py-1">Click a user to DM them</p>
              )}
              {dmPartners.map(p => (
                <button key={p.user_id} onClick={() => setRoom(p.user_id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all hover:bg-white/[0.04] text-left"
                  style={room === p.user_id ? { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.06)' } : {}}>
                  <div className="relative shrink-0">
                    <Avatar user={{ id: p.user_id, username: p.username }} size={28} />
                    <OnlineDot online={!!onlineUsers.find(u => u.id === p.user_id)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-300 truncate">{p.username}</p>
                    <p className="text-[12px] text-slate-600 truncate">{p.last_message}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════
            MAIN MESSAGE AREA
        ══════════════════════════════════════════════ */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* ── Chat header ──────────────────────────────────────────────────── */}
          <div className="shrink-0 flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }}>
            <div className="flex items-center gap-3">
              {room === 'group' ? (
                <>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-dim)', border: '1px solid rgba(0,245,255,0.2)' }}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white"># {COMMUNITY_GROUPS.find(g => g.id === channel)?.label ?? 'Community'}</h2>
                    <p className="text-[13.2px] text-slate-500">{onlineUsers.length + 1} online · Community group</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative">
                    <Avatar user={{ id: room, username: dmPartnerName(room), avatar: onlineUsers.find(u => u.id === room)?.avatar }} size={36} />
                    <OnlineDot online={!!onlineUsers.find(u => u.id === room)} />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white">{dmPartnerName(room)}</h2>
                    <p className="text-[13.2px] text-slate-500">
                      {onlineUsers.find(u => u.id === room) ? '● Online' : '● Offline'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Connection indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: connected ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${connected ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'animate-pulse' : ''}`}
                style={{ background: connected ? '#22c55e' : '#ef4444' }} />
              <span className="text-[13.2px] font-bold" style={{ color: connected ? '#22c55e' : '#ef4444' }}>
                {connected ? 'Live' : 'Reconnecting…'}
              </span>
            </div>
          </div>

          {/* ── Messages area ─────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <p className="text-slate-500 text-sm font-bold mb-1">
                  {room === 'group' ? 'No messages yet' : `Start a conversation`}
                </p>
                <p className="text-slate-700 text-xs">
                  {room === 'group'
                    ? `Be the first to post in #${COMMUNITY_GROUPS.find(g => g.id === channel)?.label ?? 'Community'}!`
                    : `Say something to ${dmPartnerName(room)}`}
                </p>
              </div>
            )}

            {/* Date separators + messages */}
            {messages.reduce<React.ReactNode[]>((acc, msg, i) => {
              const prev = messages[i - 1]
              const thisDate = fmtDate(msg.created_at)
              const prevDate = prev ? fmtDate(prev.created_at) : null
              if (thisDate !== prevDate) {
                acc.push(
                  <div key={`sep-${i}`} className="flex items-center gap-3 my-2">
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
                    <span className="text-[12px] font-bold text-slate-600 px-2">{thisDate}</span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
                  </div>
                )
              }
              acc.push(<MessageBubble key={msg.id} msg={msg} isMine={msg.sender_id === userId} />)
              return acc
            }, [])}

            {/* Typing indicator */}
            {typing.size > 0 && (
              <div className="flex items-center gap-2 text-[13.2px] text-slate-500 italic">
                <div className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                {Array.from(typing).join(', ')} {typing.size === 1 ? 'is' : 'are'} typing…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Input area ───────────────────────────────────────────────────── */}
          <div className="shrink-0 px-6 py-4" style={{ borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
            <div className="flex items-end gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
              {/* Attach file */}
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
                title="Attach image or file">
                {uploading
                  ? <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                }
              </button>

              {/* Text input */}
              <textarea
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 resize-none outline-none leading-relaxed"
                style={{ maxHeight: 120, minHeight: 24 }}
                placeholder={room === 'group' ? `Message #${COMMUNITY_GROUPS.find(g => g.id === channel)?.label ?? 'Community'}…` : `Message ${dmPartnerName(room)}…`}
                value={input}
                rows={1}
                onChange={e => {
                  setInput(e.target.value)
                  // auto-grow
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                  sendTyping()
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                }}
              />

              {/* Send button */}
              <button onClick={sendMessage} disabled={!input.trim() || !connected}
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-black transition-all disabled:opacity-30 hover:scale-105 active:scale-95"
                style={{ background: input.trim() && connected ? 'var(--accent)' : 'rgba(255,255,255,0.06)', color: input.trim() && connected ? 'var(--bg)' : '#475569' }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                </svg>
              </button>
            </div>
            <p className="text-[12px] text-slate-700 mt-2 text-center">
              Enter to send · Shift+Enter for new line · Drag &amp; drop images to upload
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
