'use client'

/**
 * /chat — community room powered by Supabase Realtime.
 *
 * Same code runs in:
 *   • the Electron desktop app  (loads /chat from the static export)
 *   • the web dashboard at /app/chat
 *
 * Both connect directly to Supabase (no local FastAPI involved), so a
 * message sent from one platform appears on every other platform within
 * ~50 ms over the same realtime channel.
 *
 * Implementation lives in:
 *   src/lib/supabase.ts       — shared Supabase client (lazy init)
 *   src/hooks/useChat.ts      — subscribe/send/presence/typing
 *   src/components/Chat/*     — Message, MessageList, ChatInput, PresencePanel
 */
import React, { useMemo } from 'react'
import Navbar from '@/components/Navbar'
import MessageList   from '@/components/Chat/MessageList'
import ChatInput     from '@/components/Chat/ChatInput'
import PresencePanel from '@/components/Chat/PresencePanel'
import { useChat }   from '@/hooks/useChat'


const ROOM_ID = 'global'


export default function ChatPage() {
  const { me, messages, presence, typing, status, send, sendTyping } = useChat(ROOM_ID, 100)

  // Names of users currently typing (excluding ourselves)
  const typingNames = useMemo(() => {
    return Object.keys(typing)
      .filter((uid) => uid !== me?.id)
      .map((uid) => presence[uid]?.username || 'Someone')
  }, [typing, presence, me])

  const typingLine =
    typingNames.length === 0 ? '' :
    typingNames.length === 1 ? `${typingNames[0]} is typing…` :
    typingNames.length === 2 ? `${typingNames[0]} and ${typingNames[1]} are typing…` :
                               `${typingNames[0]} and ${typingNames.length - 1} others are typing…`

  return (
    <>
      <Navbar />

      <main
        style={{
          height: '100vh',
          display: 'flex', flexDirection: 'column',
          // Chat takes a full-height pane; we can't rely on the
          // global body padding because we need the message list to
          // own the vertical scroll, not the page.
          paddingRight: 0, paddingTop: 0, paddingBottom: 0,
        }}
      >
        <header
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(255, 255, 255, 0.02)',
            flexShrink: 0,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
              Community
            </h1>
            <div style={{ fontSize: 13, color: 'rgba(170, 181, 199, 0.7)', marginTop: 2 }}>
              {connectionLabel(status)} · everyone in WatchDog can see this room
            </div>
          </div>

          <ConnectionDot status={status} />
        </header>

        <div style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'row',
        }}>
          <section style={{
            flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              <MessageList
                messages={messages}
                myUserId={me?.id ?? null}
                emptyHint={
                  status === 'subscribed'
                    ? <>No messages yet. Be the first to say hi 👋</>
                    : <>Connecting to chat…</>
                }
              />
            </div>

            {typingLine && (
              <div style={{
                fontSize: 12, color: 'rgba(170, 181, 199, 0.7)',
                padding: '4px 16px', fontStyle: 'italic',
                minHeight: 18,
              }}>
                {typingLine}
              </div>
            )}

            <div style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              background: 'rgba(255, 255, 255, 0.02)',
            }}>
              <ChatInput
                disabled={status !== 'subscribed' || !me}
                placeholder={
                  !me                       ? 'Sign in to chat…'        :
                  status !== 'subscribed'   ? 'Connecting…'              :
                                              'Write a message…'
                }
                onSend={async (text) => {
                  const r = await send(text)
                  return r
                }}
                onTyping={sendTyping}
              />
            </div>
          </section>

          <div className="presence-hide-mobile" style={{ flexShrink: 0 }}>
            <PresencePanel presence={presence} meId={me?.id ?? null} />
          </div>
        </div>
      </main>

      <style jsx global>{`
        @media (max-width: 768px) {
          .presence-hide-mobile { display: none !important; }
        }
      `}</style>
    </>
  )
}


// ── connection status indicator ──────────────────────────────────────────────

function connectionLabel(s: string): string {
  switch (s) {
    case 'subscribed': return 'Connected'
    case 'connecting': return 'Connecting…'
    case 'closed':     return 'Disconnected'
    case 'error':      return 'Connection error'
    default:           return s
  }
}

function ConnectionDot({ status }: { status: string }) {
  const color =
    status === 'subscribed' ? '#22c55e' :
    status === 'error'      ? '#ef4444' :
                              '#f59e0b'
  return (
    <div
      title={connectionLabel(status)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 12, color: 'rgba(170, 181, 199, 0.8)',
      }}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color,
          boxShadow: `0 0 0 3px ${color}33`,
          animation: status === 'subscribed' ? 'chat-pulse 2s ease-in-out infinite' : undefined,
        }}
      />
      <span>{connectionLabel(status)}</span>

      <style jsx>{`
        @keyframes chat-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}
