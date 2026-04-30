/**
 * useChat.ts — Supabase Realtime chat hook.
 *
 * Composes three Supabase Realtime features on a single channel:
 *
 *   • postgres_changes (INSERT)  →  message stream from `public.messages`
 *   • presence                   →  who's online in this room (`track()`/`sync`)
 *   • broadcast                  →  ephemeral typing indicators
 *
 * Plus a one-time historical fetch to backfill the last N messages so
 * the user doesn't open an empty room.
 *
 * Same hook serves Electron desktop AND the web dashboard at /app/ —
 * Supabase Realtime is just a WebSocket to the cloud, identical from
 * both environments.
 */
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { decodeTokenPayload, getToken, getTokenUser } from '@/lib/auth'


export interface ChatMessage {
  id:         string
  created_at: string
  user_id:    string
  username:   string | null
  avatar_url: string | null
  content:    string
  room_id:    string
}

export interface PresenceUser {
  user_id:   string
  username:  string
  online_at: string
}


/**
 * Read the user's identity from our local JWT. This is the same token
 * the rest of the app uses, so the chat sees the same `auth.uid()` that
 * the rest of the API does.
 */
function readMe(): { id: string; username: string } | null {
  const token = getToken()
  if (!token) return null
  const payload = decodeTokenPayload(token) as Record<string, unknown> | null
  if (!payload) return null
  // Supabase JWT has `sub` = uuid, optional `email`, and `user_metadata`
  const id = payload.sub as string | undefined
  if (!id) return null
  const meta = (payload.user_metadata as Record<string, unknown> | undefined) || {}
  const username =
    (meta.full_name as string | undefined) ||
    (meta.name      as string | undefined) ||
    (payload.email  as string | undefined) ||
    'Anonymous'
  return { id, username }
}


export function useChat(roomId: string = 'global', initialLimit: number = 100) {
  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [presence, setPresence]   = useState<Record<string, PresenceUser>>({})
  const [typing,   setTyping]     = useState<Record<string, number>>({})  // userId -> last typing timestamp
  const [status,   setStatus]     = useState<'connecting' | 'subscribed' | 'closed' | 'error'>('connecting')
  const [me, setMe]               = useState<{ id: string; username: string } | null>(null)

  const channelRef                = useRef<RealtimeChannel | null>(null)
  const supabaseRef               = useRef<SupabaseClient | null>(null)
  const cancelledRef              = useRef(false)


  // ── identify the current user ────────────────────────────────────────────
  useEffect(() => {
    setMe(readMe())
  }, [])


  // ── one-time history backfill + realtime subscribe ──────────────────────
  useEffect(() => {
    cancelledRef.current = false

    let unsub: (() => void) | null = null

    ;(async () => {
      const supabase = await getSupabase()
      if (cancelledRef.current) return
      supabaseRef.current = supabase

      // History — last `initialLimit` messages, oldest first so they
      // render top-to-bottom in chronological order.
      const { data: hist, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(initialLimit)

      if (cancelledRef.current) return
      if (error) {
        console.warn('[useChat] history fetch failed:', error.message)
      } else if (hist) {
        setMessages([...hist].reverse() as ChatMessage[])
      }

      // Live channel: postgres_changes + presence + broadcast (typing)
      const meNow = readMe()
      const channel = supabase.channel(`chat:${roomId}`, {
        config: { presence: { key: meNow?.id || crypto.randomUUID() } },
      })

      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const m = payload.new as ChatMessage
          setMessages((prev) => {
            // Replace optimistic copy if the same id already exists
            const i = prev.findIndex((x) => x.id === m.id)
            if (i >= 0) {
              const next = [...prev]; next[i] = m; return next
            }
            return [...prev, m]
          })
        },
      )

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, PresenceUser[]>
        const flat: Record<string, PresenceUser> = {}
        for (const arr of Object.values(state)) {
          for (const p of arr) flat[p.user_id] = p
        }
        setPresence(flat)
      })

      channel.on('broadcast', { event: 'typing' }, (msg) => {
        const userId = (msg.payload as { user_id?: string })?.user_id
        if (!userId || userId === meNow?.id) return
        setTyping((t) => ({ ...t, [userId]: Date.now() }))
      })

      channel.subscribe(async (s) => {
        if (s === 'SUBSCRIBED') {
          setStatus('subscribed')
          if (meNow) {
            await channel.track({
              user_id:   meNow.id,
              username:  meNow.username,
              online_at: new Date().toISOString(),
            } satisfies PresenceUser)
          }
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          setStatus('error')
        } else if (s === 'CLOSED') {
          setStatus('closed')
        }
      })

      channelRef.current = channel
      unsub = () => {
        try { channel.unsubscribe() } catch { /* ignore */ }
        try { supabase.removeChannel(channel) } catch { /* ignore */ }
      }
    })()

    return () => {
      cancelledRef.current = true
      unsub?.()
      channelRef.current = null
    }
  }, [roomId, initialLimit])


  // ── prune stale typing indicators ────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setTyping((cur) => {
        const next: Record<string, number> = {}
        for (const [k, v] of Object.entries(cur)) {
          if (now - v < 4_000) next[k] = v
        }
        return next
      })
    }, 1_500)
    return () => clearInterval(t)
  }, [])


  // ── send a message ───────────────────────────────────────────────────────
  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return { ok: false, error: 'empty' as const }
      if (!me) return { ok: false, error: 'not_signed_in' as const }
      if (trimmed.length > 4000) return { ok: false, error: 'too_long' as const }

      const supabase = supabaseRef.current ?? (await getSupabase())

      // Optimistic insert so the sender sees their own message instantly,
      // before the realtime echo arrives. Keyed by a UUID that the DB will
      // also use, so the realtime echo updates rather than duplicates.
      const optimistic: ChatMessage = {
        id:         crypto.randomUUID(),
        created_at: new Date().toISOString(),
        user_id:    me.id,
        username:   me.username,
        avatar_url: null,
        content:    trimmed,
        room_id:    roomId,
      }
      setMessages((prev) => [...prev, optimistic])

      const { error } = await supabase
        .from('messages')
        .insert({
          id:       optimistic.id,
          user_id:  me.id,
          username: me.username,
          content:  trimmed,
          room_id:  roomId,
        })

      if (error) {
        // Roll back optimistic + surface the error to the UI
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        return { ok: false, error: error.message }
      }
      return { ok: true as const }
    },
    [me, roomId],
  )


  // ── broadcast typing ─────────────────────────────────────────────────────
  const sendTyping = useCallback(() => {
    const ch = channelRef.current
    if (!ch || !me) return
    ch.send({ type: 'broadcast', event: 'typing', payload: { user_id: me.id } })
  }, [me])


  return {
    /** Identity of the current user (null until JWT is read). */
    me,
    /** Chronological message list, oldest first. */
    messages,
    /** { user_id → presence info } for everyone currently in the room. */
    presence,
    /** { user_id → epoch_ms } for users who broadcast 'typing' in last 4s. */
    typing,
    /** Channel state — useful for showing a "Connecting…" indicator. */
    status,
    /** Send a message. Returns { ok: true } or { ok: false, error: '...' }. */
    send,
    /** Broadcast a typing indicator. Cheap; safe to call on every keystroke. */
    sendTyping,
  }
}
