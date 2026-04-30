'use client'

/**
 * MessageList — scroll container with sticky-bottom behavior.
 *
 * The non-trivial bit: we want the view to follow the latest message
 * UNLESS the user has scrolled up to read history — in that case new
 * messages should arrive silently and a "↓ New messages" pill should
 * appear letting them jump back. This matches Slack / WhatsApp / iMessage.
 */
import React, { useEffect, useRef, useState } from 'react'
import Message from './Message'
import type { ChatMessage } from '@/hooks/useChat'


const GROUP_GAP_MS = 2 * 60 * 1000   // bubbles within 2 min from same sender are grouped


interface Props {
  messages:    ChatMessage[]
  myUserId:    string | null
  emptyHint?:  React.ReactNode
}

export default function MessageList({ messages, myUserId, emptyHint }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const bottomRef   = useRef<HTMLDivElement | null>(null)
  const [autoStick, setAutoStick] = useState(true)
  const [unread,    setUnread]    = useState(0)

  // detect if the user scrolled up off the bottom
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = distFromBottom < 60
      setAutoStick(atBottom)
      if (atBottom) setUnread(0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // when a new message arrives, either follow it or count it as unread
  const lastCountRef = useRef(0)
  useEffect(() => {
    if (messages.length > lastCountRef.current) {
      const added = messages.length - lastCountRef.current
      if (autoStick) {
        // microtask so the new bubble exists in the DOM first
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        })
      } else {
        setUnread((n) => n + added)
      }
    }
    lastCountRef.current = messages.length
  }, [messages.length, autoStick])

  // jump to bottom on first load (without animation) so the page lands
  // on the freshest message even if there are 100 history items
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [])

  const onJumpToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setUnread(0)
    setAutoStick(true)
  }

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div
        ref={scrollerRef}
        style={{
          height: '100%', overflowY: 'auto', overflowX: 'hidden',
          paddingTop: 16, paddingBottom: 16,
          // hide scrollbar default chrome look in webkit
          scrollbarWidth: 'thin',
        }}
      >
        {messages.length === 0 && emptyHint && (
          <div style={{
            height: '100%', display: 'grid', placeItems: 'center',
            color: 'rgba(170, 181, 199, 0.6)', fontSize: 14, padding: 24, textAlign: 'center',
          }}>
            {emptyHint}
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const next = messages[i + 1]
          const groupedTop =
            !!prev &&
            prev.user_id === m.user_id &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_GAP_MS
          const groupedBottom =
            !!next &&
            next.user_id === m.user_id &&
            new Date(next.created_at).getTime() - new Date(m.created_at).getTime() < GROUP_GAP_MS

          return (
            <Message
              key={m.id}
              message={m}
              mine={m.user_id === myUserId}
              groupedTop={groupedTop}
              groupedBottom={groupedBottom}
            />
          )
        })}

        <div ref={bottomRef} />
      </div>

      {!autoStick && unread > 0 && (
        <button
          onClick={onJumpToLatest}
          style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #00d9e6, #0891b2)',
            color: '#04101a',
            border: 'none', borderRadius: 999,
            padding: '8px 16px',
            fontSize: 13, fontWeight: 600,
            boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span>{unread} new {unread === 1 ? 'message' : 'messages'}</span>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  )
}
