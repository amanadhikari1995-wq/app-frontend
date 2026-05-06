'use client'

/**
 * MessageFeed — scrollable message list with sticky-bottom, load more, and date separators.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import MessageBubble from './MessageBubble'
import type { ChatMessage } from '@/hooks/useChat'
import type { ChatProfile } from '@/lib/chatClient'

const GROUP_GAP_MS = 5 * 60 * 1000 // 5 minutes

function dateSeparatorLabel(iso: string): string {
  try {
    const d = new Date(iso); const now = new Date()
    const diff = now.getDate() - d.getDate()
    if (diff === 0 && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return 'Today'
    if (diff === 1) return 'Yesterday'
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  } catch { return '' }
}

function sameDay(a: string, b: string): boolean {
  try {
    const da = new Date(a); const db = new Date(b)
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
  } catch { return true }
}

interface Props {
  messages:    ChatMessage[]
  myUserId:    string | null
  isAdmin:     boolean
  allProfiles: Record<string, ChatProfile>
  loading:     boolean
  hasMore:     boolean
  onLoadMore:  () => Promise<void>
  onEdit:      (id: string, content: string) => Promise<boolean>
  onDelete:    (id: string) => Promise<boolean>
  onReact:     (id: string, emoji: string) => Promise<void>
  onReply:     (msg: ChatMessage) => void
  onOpenDM:    (uid: string) => void
  emptyHint?:  React.ReactNode
}

export default function MessageFeed({ messages, myUserId, isAdmin, allProfiles, loading, hasMore, onLoadMore, onEdit, onDelete, onReact, onReply, onOpenDM, emptyHint }: Props) {
  const scrollerRef  = useRef<HTMLDivElement | null>(null)
  const bottomRef    = useRef<HTMLDivElement | null>(null)
  const [sticky,     setSticky]     = useState(true)
  const [unread,     setUnread]     = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const lastCountRef = useRef(0)

  // Scroll detection
  useEffect(() => {
    const el = scrollerRef.current; if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      setSticky(atBottom)
      if (atBottom) setUnread(0)
      // Load more when scrolled near top
      if (el.scrollTop < 120 && hasMore && !loadingMore) {
        setLoadingMore(true)
        void onLoadMore().finally(() => setLoadingMore(false))
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [hasMore, loadingMore, onLoadMore])

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > lastCountRef.current) {
      const added = messages.length - lastCountRef.current
      if (sticky) {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
      } else {
        setUnread((n) => n + added)
      }
    }
    lastCountRef.current = messages.length
  }, [messages.length, sticky])

  // Initial scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [])

  const jumpToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setUnread(0); setSticky(true)
  }

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div ref={scrollerRef} style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>

        {/* Load more spinner */}
        {(loadingMore || loading) && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="rgba(0,217,230,0.25)" strokeWidth="2.4" />
              <path d="M12 3a9 9 0 0 1 9 9" stroke="#00d9e6" strokeWidth="2.4" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.85s" repeatCount="indefinite" />
              </path>
            </svg>
          </div>
        )}

        {messages.length === 0 && !loading && emptyHint && (
          <div style={{ height: '80%', display: 'grid', placeItems: 'center', color: 'rgba(170,181,199,0.55)', fontSize: 14, padding: 24, textAlign: 'center' }}>
            {emptyHint}
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1]; const next = messages[i + 1]
          const grouped = !!prev && prev.user_id === m.user_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_GAP_MS

          const showDateSep = !prev || !sameDay(prev.created_at, m.created_at)

          return (
            <React.Fragment key={m.id}>
              {showDateSep && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', margin: '4px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                  <span style={{ fontSize: 12, color: 'rgba(170,181,199,0.45)', fontWeight: 500, whiteSpace: 'nowrap' }}>{dateSeparatorLabel(m.created_at)}</span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                </div>
              )}
              <MessageBubble
                message={m}
                mine={m.user_id === myUserId}
                grouped={grouped}
                isAdmin={isAdmin}
                onEdit={onEdit}
                onDelete={onDelete}
                onReact={onReact}
                onReply={onReply}
                onOpenDM={onOpenDM}
              />
            </React.Fragment>
          )
        })}
        <div ref={bottomRef} style={{ height: 16 }} />
      </div>

      {!sticky && unread > 0 && (
        <button onClick={jumpToBottom} style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg,#00d9e6,#0891b2)', color: '#04101a', border: 'none', borderRadius: 999, padding: '8px 18px', fontSize: 13, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{unread} new {unread === 1 ? 'message' : 'messages'}</span>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M19 9l-7 7-7-7" /></svg>
        </button>
      )}
    </div>
  )
}