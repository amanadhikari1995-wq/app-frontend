'use client'

/**
 * /chat — Discord-like community chat powered by Supabase Realtime.
 * Layout: channels sidebar | message feed | members panel.
 */
import React, { useState, useEffect } from 'react'
import Navbar from '@/components/Navbar'
import { useChat } from '@/hooks/useChat'
import ProfileSetupModal from '@/components/Chat/ProfileSetupModal'
import ChannelSidebar    from '@/components/Chat/ChannelSidebar'
import MessageFeed       from '@/components/Chat/MessageFeed'
import ChatInputBar      from '@/components/Chat/ChatInputBar'
import MembersPanel      from '@/components/Chat/MembersPanel'
import { ADMIN_EMAIL, createChannel, renameChannel, deleteChannel, banUser } from '@/lib/chatClient'
import type { ChatMessage } from '@/hooks/useChat'

export default function ChatPage() {
  const {
    me, myProfile, allProfiles,
    channels, activeView, setActiveView,
    messages, loadingMsgs, hasMore, loadMore,
    send, sendFile, editMsg, deleteMsg, react,
    presence, onlineIds, dmChannels, openDM,
    typing, sendTyping, status,
  } = useChat()

  const [showProfileSetup, setShowProfileSetup] = useState(false)
  const [replyTo,           setReplyTo]          = useState<ChatMessage | null>(null)
  const [mobileSidebar,     setMobileSidebar]    = useState(false)

  // Show profile setup for first-time users
  useEffect(() => {
    if (me && myProfile === null) {
      const t = setTimeout(() => setShowProfileSetup(true), 1200)
      return () => clearTimeout(t)
    }
  }, [me, myProfile])

  const isAdmin = me?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()

  const channelKey =
    activeView?.kind === 'channel' ? activeView.channelId :
    activeView?.kind === 'dm'      ? activeView.dmId      : null

  const activeChannelName =
    activeView?.kind === 'channel' ? channels.find((c) => c.id === activeView.channelId)?.name ?? '' :
    activeView?.kind === 'dm'      ? allProfiles[activeView.otherUserId]?.username ?? 'DM'          : ''

  const typingNames = channelKey
    ? Object.entries(typing)
        .filter(([k, v]) => k.startsWith(`${channelKey}:`) && Date.now() - v < 4000)
        .map(([k]) => {
          const uid = k.split(':')[1]
          return presence[uid]?.username ?? allProfiles[uid]?.username ?? 'Someone'
        })
    : []

  return (
    <>
      <Navbar />
      <main style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d1117' }}>

        {showProfileSetup && me && (
          <ProfileSetupModal
            userId={me.id}
            suggestedName={me.username}
            onComplete={() => setShowProfileSetup(false)}
          />
        )}

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left: channels */}
          <ChannelSidebar
            channels={channels}
            dmChannels={dmChannels}
            activeView={activeView}
            onSelectView={setActiveView}
            onOpenDM={openDM}
            myId={me?.id ?? null}
            isAdmin={isAdmin}
            allProfiles={allProfiles}
            onCreateChannel={async (name, desc) => { if (me) await createChannel(name, desc, me.id) }}
            onRenameChannel={renameChannel}
            onDeleteChannel={deleteChannel}
            mobileOpen={mobileSidebar}
            onMobileClose={() => setMobileSidebar(false)}
          />

          {/* Center: messages */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

            {/* Header */}
            <div style={{ height: 52, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', background: '#0d1117', flexShrink: 0 }}>
              <button
                className="chat-mobile-menu"
                onClick={() => setMobileSidebar(true)}
                style={{ display: 'none', background: 'none', border: 'none', color: '#aab5c7', cursor: 'pointer', padding: 4 }}
              >
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>

              {activeView?.kind === 'channel' && <span style={{ color: 'rgba(170,181,199,0.45)', fontSize: 20, fontWeight: 300 }}>#</span>}
              {activeView?.kind === 'dm'      && <span style={{ fontSize: 18 }}>💬</span>}

              <span style={{ fontWeight: 600, fontSize: 16, color: '#e2e8f0' }}>
                {activeChannelName || 'Select a channel'}
              </span>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(170,181,199,0.5)' }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                  background: status === 'subscribed' ? '#22c55e' : status === 'error' ? '#ef4444' : '#f59e0b',
                }} />
                {status === 'subscribed' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
              </div>
            </div>

            {/* Feed */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <MessageFeed
                messages={messages}
                myUserId={me?.id ?? null}
                isAdmin={isAdmin}
                allProfiles={allProfiles}
                loading={loadingMsgs}
                hasMore={hasMore}
                onLoadMore={loadMore}
                onEdit={editMsg}
                onDelete={deleteMsg}
                onReact={react}
                onReply={setReplyTo}
                onOpenDM={openDM}
                emptyHint={!activeView ? <>Select a channel to start chatting</> : <>No messages yet — say hello! 👋</>}
              />
            </div>

            {/* Typing */}
            {typingNames.length > 0 && (
              <div style={{ padding: '2px 20px 3px', fontSize: 12, color: 'rgba(170,181,199,0.6)', fontStyle: 'italic', background: '#0d1117', flexShrink: 0 }}>
                {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.slice(0, 2).join(' and ')} are typing…`}
              </div>
            )}

            {/* Reply banner */}
            {replyTo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 0', fontSize: 12, color: 'rgba(170,181,199,0.65)', background: '#0d1117', flexShrink: 0 }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#00d9e6" strokeWidth={2} strokeLinecap="round">
                  <path d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6-6M3 10l6 6" />
                </svg>
                <span>Replying to <strong style={{ color: '#e2e8f0' }}>{allProfiles[replyTo.user_id]?.username ?? 'User'}</strong></span>
                <span style={{ color: 'rgba(170,181,199,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                  {replyTo.content ?? replyTo.file_name ?? ''}
                </span>
                <button onClick={() => setReplyTo(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(170,181,199,0.4)', cursor: 'pointer', padding: '0 4px', fontSize: 14 }}>✕</button>
              </div>
            )}

            {/* Input */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: '#0d1117', flexShrink: 0 }}>
              <ChatInputBar
                disabled={status !== 'subscribed' || !me || !activeView}
                placeholder={
                  !me         ? 'Sign in to chat…' :
                  !activeView ? 'Select a channel…' :
                  status !== 'subscribed' ? 'Connecting…' :
                  activeView.kind === 'channel' ? `Message #${activeChannelName}` : `Message ${activeChannelName}`
                }
                onSend={async (text) => { const r = await send(text, replyTo?.id); if (r.ok) setReplyTo(null); return r }}
                onSendFile={async (file) => { const r = await sendFile(file, replyTo?.id); if (r.ok) setReplyTo(null); return r }}
                onTyping={sendTyping}
              />
            </div>
          </div>

          {/* Right: members */}
          <MembersPanel
            allProfiles={allProfiles}
            onlineIds={onlineIds}
            myId={me?.id ?? null}
            isAdmin={isAdmin}
            onOpenDM={openDM}
            onBanUser={async (userId) => { if (me && channelKey) await banUser(channelKey, userId, me.id) }}
          />
        </div>

        <style jsx global>{`
          @media (max-width: 768px) { .chat-mobile-menu { display: block !important; } }
        `}</style>
      </main>
    </>
  )
}