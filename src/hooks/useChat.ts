/**
 * useChat.ts — Discord-like chat hook powered by Supabase Realtime.
 */
'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { getToken, decodeTokenPayload } from '@/lib/auth'
import {
  getChannels, fetchMessages,
  sendMessage as dbSendMessage,
  editMessage as dbEditMessage,
  softDeleteMessage, addReaction, removeReaction,
  fetchReactionsForChannel, getMyDMChannels, getOrCreateDM,
  getProfile, getAllProfiles, uploadChatFile,
  type ChatChannel, type RawChatMessage, type ChatReaction,
  type ChatProfile, type ChatDMChannel, type PresenceEntry,
} from '@/lib/chatClient'

export interface LocalUser { id: string; email: string | null; username: string }

function readLocalUser(): LocalUser | null {
  const token = getToken()
  if (!token) return null
  try {
    const p = decodeTokenPayload(token) as Record<string, unknown> | null
    if (!p) return null
    const id = p.sub as string | undefined
    if (!id) return null
    const meta  = (p.user_metadata as Record<string, unknown>) ?? {}
    const email = (p.email as string | undefined) ?? null
    const username = (meta.full_name as string) || (meta.name as string) || email?.split('@')[0] || 'User'
    return { id, email, username }
  } catch { return null }
}

export type ChannelView =
  | { kind: 'channel'; channelId: string }
  | { kind: 'dm';      dmId: string; otherUserId: string }

export type ReactionMap = Record<string, { count: number; mine: boolean }>

export type ChatMessage = RawChatMessage & {
  profile:   ChatProfile | null
  reactions: ReactionMap
}

function buildReactionMap(reactions: ChatReaction[], msgId: string, myId: string | null): ReactionMap {
  const map: ReactionMap = {}
  for (const r of reactions) {
    if (r.message_id !== msgId) continue
    if (!map[r.emoji]) map[r.emoji] = { count: 0, mine: false }
    map[r.emoji].count++
    if (r.user_id === myId) map[r.emoji].mine = true
  }
  return map
}

function enrichMessages(raws: RawChatMessage[], profiles: Record<string, ChatProfile>, reactions: ChatReaction[], myId: string | null): ChatMessage[] {
  return raws.map((m) => ({ ...m, profile: profiles[m.user_id] ?? null, reactions: buildReactionMap(reactions, m.id, myId) }))
}

export function useChat() {
  const [me,          setMe]          = useState<LocalUser | null>(null)
  const [myProfile,   setMyProfile]   = useState<ChatProfile | null>(null)
  const [allProfiles, setAllProfiles] = useState<Record<string, ChatProfile>>({})
  const [channels,    setChannels]    = useState<ChatChannel[]>([])
  const [activeView,  _setActiveView] = useState<ChannelView | null>(null)
  const [rawMessages, setRawMessages] = useState<RawChatMessage[]>([])
  const [reactions,   setReactions]   = useState<ChatReaction[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [hasMore,     setHasMore]     = useState(false)
  const [presence,    setPresence]    = useState<Record<string, PresenceEntry>>({})
  const [onlineIds,   setOnlineIds]   = useState<Set<string>>(new Set())
  const [dmChannels,  setDmChannels]  = useState<ChatDMChannel[]>([])
  const [typing,      setTyping]      = useState<Record<string, number>>({})
  const [status,      setStatus]      = useState<'connecting' | 'subscribed' | 'error' | 'closed'>('connecting')

  const meRef         = useRef<LocalUser | null>(null)
  const globalChRef   = useRef<RealtimeChannel | null>(null)
  const profilesRef   = useRef<Record<string, ChatProfile>>({})
  const reactionsRef  = useRef<ChatReaction[]>([])
  const activeViewRef = useRef<ChannelView | null>(null)

  const messages: ChatMessage[] = useMemo(
    () => enrichMessages(rawMessages, allProfiles, reactions, me?.id ?? null),
    [rawMessages, allProfiles, reactions, me?.id]
  )

  const setActiveView = useCallback((v: ChannelView | null) => {
    activeViewRef.current = v
    _setActiveView(v)
  }, [])

  const channelKey =
    activeView?.kind === 'channel' ? activeView.channelId :
    activeView?.kind === 'dm'      ? activeView.dmId      : null

  // Identify user + load all profiles
  useEffect(() => {
    const u = readLocalUser()
    setMe(u); meRef.current = u
    if (u) {
      getProfile(u.id).then((p) => {
        if (p) { setMyProfile(p); setAllProfiles((prev) => { const n = { ...prev, [p.user_id]: p }; profilesRef.current = n; return n }) }
      })
    }
    getAllProfiles().then((list) => {
      const map: Record<string, ChatProfile> = {}
      for (const p of list) map[p.user_id] = p
      setAllProfiles(map); profilesRef.current = map
    })
  }, [])

  // Load channel list + auto-select first
  useEffect(() => {
    getChannels().then((chs) => {
      setChannels(chs)
      if (chs.length > 0 && !activeViewRef.current) {
        const v: ChannelView = { kind: 'channel', channelId: chs[0].id }
        activeViewRef.current = v; _setActiveView(v)
      }
    })
    const u = readLocalUser()
    if (u) getMyDMChannels(u.id).then(setDmChannels)
  }, [])

  // Global channel: presence + typing + metadata changes
  useEffect(() => {
    let unsub: (() => void) | null = null
    ;(async () => {
      const supabase = await getSupabase()
      const ch = supabase.channel('wd-chat-global')

      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_channels' }, () => { getChannels().then(setChannels) })
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_profiles' }, () => {
        getAllProfiles().then((list) => {
          const map: Record<string, ChatProfile> = {}
          for (const p of list) map[p.user_id] = p
          setAllProfiles(map); profilesRef.current = map
        })
      })

      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, PresenceEntry[]>
        const flat: Record<string, PresenceEntry> = {}
        const ids = new Set<string>()
        for (const arr of Object.values(state)) for (const p of arr) { flat[p.user_id] = p; ids.add(p.user_id) }
        setPresence(flat); setOnlineIds(ids)
      })

      ch.on('broadcast', { event: 'typing' }, (msg) => {
        const { user_id, channel_id } = (msg.payload ?? {}) as { user_id?: string; channel_id?: string }
        if (!user_id || user_id === meRef.current?.id) return
        setTyping((t) => ({ ...t, [`${channel_id}:${user_id}`]: Date.now() }))
      })

      ch.subscribe(async (s) => {
        if (s === 'SUBSCRIBED') {
          setStatus('subscribed')
          const u = meRef.current; const prof = u ? profilesRef.current[u.id] : null
          if (u) await ch.track({ user_id: u.id, username: prof?.username ?? u.username, avatar_url: prof?.avatar_url ?? null, online_at: new Date().toISOString() } satisfies PresenceEntry)
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { setStatus('error')
        } else if (s === 'CLOSED') { setStatus('closed') }
      })

      globalChRef.current = ch
      unsub = () => { try { ch.unsubscribe() } catch { /* */ }; try { supabase.removeChannel(ch) } catch { /* */ } }
    })()
    return () => { unsub?.() }
  }, [])

  // Re-track presence when profile loads
  useEffect(() => {
    const ch = globalChRef.current
    if (!ch || !me) return
    const prof = allProfiles[me.id]
    if (!prof) return
    void ch.track({ user_id: me.id, username: prof.username, avatar_url: prof.avatar_url ?? null, online_at: new Date().toISOString() } satisfies PresenceEntry)
  }, [myProfile, me, allProfiles])

  // Stale typing pruner
  useEffect(() => {
    if (Object.keys(typing).length === 0) return
    const t = setInterval(() => setTyping((cur) => { const now = Date.now(); const next: Record<string, number> = {}; for (const [k, v] of Object.entries(cur)) if (now - v < 4000) next[k] = v; return next }), 1500)
    return () => clearInterval(t)
  }, [typing])

  // Per-channel messages + reactions subscription
  useEffect(() => {
    if (!channelKey) return
    let unsub: (() => void) | null = null
    setRawMessages([]); setReactions([]); reactionsRef.current = []; setHasMore(false); setLoadingMsgs(true)

    ;(async () => {
      const [msgs, rxns] = await Promise.all([fetchMessages(channelKey, 50), fetchReactionsForChannel(channelKey)])
      setRawMessages(msgs); setReactions(rxns); reactionsRef.current = rxns; setHasMore(msgs.length === 50); setLoadingMsgs(false)

      const supabase = await getSupabase()
      const ch = supabase.channel(`wd-chat-msgs-${channelKey}`)

      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channelKey}` }, (payload) => {
        const m = payload.new as RawChatMessage
        if (!profilesRef.current[m.user_id]) {
          getProfile(m.user_id).then((p) => { if (p) { const next = { ...profilesRef.current, [p.user_id]: p }; profilesRef.current = next; setAllProfiles(next) } })
        }
        setRawMessages((prev) => prev.find((x) => x.id === m.id) ? prev : [...prev, m])
      })

      ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channelKey}` }, (payload) => {
        const updated = payload.new as RawChatMessage
        setRawMessages((prev) => prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m))
      })

      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_reactions' }, (payload) => {
        const r = payload.new as ChatReaction
        setReactions((prev) => { const next = [...prev, r]; reactionsRef.current = next; return next })
      })

      ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_reactions' }, (payload) => {
        const old = payload.old as Partial<ChatReaction>
        if (!old.id) return
        setReactions((prev) => { const next = prev.filter((x) => x.id !== old.id); reactionsRef.current = next; return next })
      })

      ch.subscribe()
      unsub = () => { try { ch.unsubscribe() } catch { /* */ }; try { supabase.removeChannel(ch) } catch { /* */ } }
    })()

    return () => { unsub?.() }
  }, [channelKey])

  const loadMore = useCallback(async () => {
    if (!channelKey || !hasMore || loadingMsgs) return
    const oldest = rawMessages[0]?.created_at; if (!oldest) return
    setLoadingMsgs(true)
    const older = await fetchMessages(channelKey, 50, oldest)
    setHasMore(older.length === 50); setRawMessages((prev) => [...older, ...prev]); setLoadingMsgs(false)
  }, [channelKey, hasMore, loadingMsgs, rawMessages])

  const send = useCallback(async (text: string, replyToId?: string) => {
    const u = meRef.current
    if (!u)          return { ok: false as const, error: 'not_signed_in' }
    if (!channelKey) return { ok: false as const, error: 'no_channel' }
    const trimmed = text.trim(); if (!trimmed) return { ok: false as const, error: 'empty' }
    const msg = await dbSendMessage({ channelId: channelKey, userId: u.id, content: trimmed, replyToId })
    return msg ? { ok: true as const } : { ok: false as const, error: 'send_failed' }
  }, [channelKey])

  const sendFile = useCallback(async (file: File, replyToId?: string) => {
    const u = meRef.current
    if (!u)          return { ok: false as const, error: 'not_signed_in' }
    if (!channelKey) return { ok: false as const, error: 'no_channel' }
    const uploaded = await uploadChatFile(u.id, file)
    if (!uploaded)   return { ok: false as const, error: 'upload_failed' }
    const msg = await dbSendMessage({ channelId: channelKey, userId: u.id, content: undefined, fileUrl: uploaded.url, fileName: uploaded.name, fileType: uploaded.type, fileSize: uploaded.size, replyToId })
    return msg ? { ok: true as const } : { ok: false as const, error: 'send_failed' }
  }, [channelKey])

  const editMsg   = useCallback((id: string, content: string) => dbEditMessage(id, content), [])
  const deleteMsg = useCallback((id: string) => softDeleteMessage(id), [])

  const react = useCallback(async (messageId: string, emoji: string) => {
    const u = meRef.current; if (!u) return
    const existing = reactionsRef.current.find((r) => r.message_id === messageId && r.user_id === u.id && r.emoji === emoji)
    if (existing) await removeReaction(messageId, u.id, emoji)
    else           await addReaction(messageId, u.id, emoji)
  }, [])

  const openDM = useCallback(async (otherUserId: string) => {
    const u = meRef.current; if (!u) return
    const dm = await getOrCreateDM(u.id, otherUserId); if (!dm) return
    setDmChannels((prev) => prev.find((d) => d.id === dm.id) ? prev : [...prev, dm])
    setActiveView({ kind: 'dm', dmId: dm.id, otherUserId })
  }, [setActiveView])

  const sendTyping = useCallback(() => {
    const ch = globalChRef.current; const u = meRef.current
    if (!ch || !u || !channelKey) return
    ch.send({ type: 'broadcast', event: 'typing', payload: { user_id: u.id, channel_id: channelKey } })
  }, [channelKey])

  return { me, myProfile, allProfiles, channels, activeView, setActiveView, messages, loadingMsgs, hasMore, loadMore, send, sendFile, editMsg, deleteMsg, react, presence, onlineIds, dmChannels, openDM, typing, sendTyping, status }
}