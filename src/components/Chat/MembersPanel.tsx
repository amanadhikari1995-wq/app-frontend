'use client'

/**
 * MembersPanel — right sidebar showing online/offline members.
 * Admin can kick/ban users from here.
 */
import React, { useState } from 'react'
import type { ChatProfile, PresenceEntry } from '@/lib/chatClient'

interface Props {
  allProfiles: Record<string, ChatProfile>
  onlineIds:   Set<string>
  myId:        string | null
  isAdmin:     boolean
  onOpenDM:    (uid: string) => void
  onBanUser:   (uid: string) => Promise<void>
}

function initials(name: string) { const p = name.trim().split(/\s+/); return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase() }
function hueOf(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return h % 360 }

function Avatar({ profile, size = 32, online }: { profile: ChatProfile; size?: number; online: boolean }) {
  const hue = hueOf(profile.username)
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {profile.avatar_url ? (
        <img src={profile.avatar_url} alt={profile.username} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
      ) : (
        <div style={{ width: size, height: size, borderRadius: '50%', background: `hsl(${hue},65%,35%)`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: size * 0.36, fontWeight: 600 }}>
          {initials(profile.username)}
        </div>
      )}
      <div style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: '50%', background: online ? '#22c55e' : '#6b7280', border: '2px solid #0d1117' }} />
    </div>
  )
}

export default function MembersPanel({ allProfiles, onlineIds, myId, isAdmin, onOpenDM, onBanUser }: Props) {
  const [ctxMenu, setCtxMenu] = useState<{ uid: string; x: number; y: number } | null>(null)

  const profiles   = Object.values(allProfiles)
  const onlineList = profiles.filter((p) => onlineIds.has(p.user_id)).sort((a, b) => a.user_id === myId ? -1 : b.user_id === myId ? 1 : a.username.localeCompare(b.username))
  const offlineList = profiles.filter((p) => !onlineIds.has(p.user_id)).sort((a, b) => a.username.localeCompare(b.username))

  const Section = ({ label, count, children }: { label: string; count: number; children: React.ReactNode }) => (
    <div>
      <div style={{ padding: '10px 12px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(170,181,199,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'rgba(170,181,199,0.3)', fontWeight: 500 }}>— {count}</span>
      </div>
      {children}
    </div>
  )

  const MemberRow = ({ profile, online }: { profile: ChatProfile; online: boolean }) => {
    const isMe = profile.user_id === myId
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 10px', borderRadius: 8, margin: '1px 6px', cursor: 'pointer', opacity: online ? 1 : 0.55, transition: 'background 0.12s' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        onClick={() => { if (!isMe) onOpenDM(profile.user_id) }}
        onContextMenu={(e) => { if (!isAdmin || isMe) return; e.preventDefault(); setCtxMenu({ uid: profile.user_id, x: e.clientX, y: e.clientY }) }}
        title={isMe ? undefined : `Click to DM ${profile.username}`}
      >
        <Avatar profile={profile} online={online} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: isMe ? '#00d9e6' : '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profile.username}
            {isMe && <span style={{ fontSize: 11, color: 'rgba(170,181,199,0.4)', fontWeight: 400 }}> (you)</span>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <aside className="members-panel" style={{ width: 220, borderLeft: '1px solid rgba(255,255,255,0.06)', background: '#161b22', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: 52, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', padding: '0 16px', background: '#1c2128' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(170,181,199,0.7)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Members</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(0,217,230,0.7)', fontWeight: 600 }}>{Object.keys(allProfiles).length}</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', padding: '4px 0 12px' }}>
          {onlineList.length > 0 && (
            <Section label="Online" count={onlineList.length}>
              {onlineList.map((p) => <MemberRow key={p.user_id} profile={p} online />)}
            </Section>
          )}

          {offlineList.length > 0 && (
            <Section label="Offline" count={offlineList.length}>
              {offlineList.map((p) => <MemberRow key={p.user_id} profile={p} online={false} />)}
            </Section>
          )}

          {Object.keys(allProfiles).length === 0 && (
            <div style={{ padding: '24px 16px', fontSize: 13, color: 'rgba(170,181,199,0.4)', textAlign: 'center' }}>
              No members yet
            </div>
          )}
        </div>
      </aside>

      {/* Admin context menu */}
      {ctxMenu && (
        <div
          style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, background: '#1c2128', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.55)', zIndex: 400, minWidth: 160, overflow: 'hidden' }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          <button
            onClick={() => { onOpenDM(ctxMenu.uid); setCtxMenu(null) }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', color: '#e2e8f0', fontSize: 14, textAlign: 'left' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >💬 Send DM</button>
          <button
            onClick={() => { void onBanUser(ctxMenu.uid); setCtxMenu(null) }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', fontSize: 14, textAlign: 'left' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,107,107,0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >🔨 Ban User</button>
        </div>
      )}

      <style jsx global>{`
        @media (max-width: 1024px) { .members-panel { display: none; } }
      `}</style>
    </>
  )
}