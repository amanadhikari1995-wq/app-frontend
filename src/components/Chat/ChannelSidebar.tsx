'use client'

/**
 * ChannelSidebar — left sidebar with channel list and DMs.
 */
import React, { useEffect, useRef, useState } from 'react'
import type { ChatChannel, ChatDMChannel, ChatProfile } from '@/lib/chatClient'
import type { ChannelView } from '@/hooks/useChat'

interface Props {
  channels: ChatChannel[]; dmChannels: ChatDMChannel[]
  activeView: ChannelView | null; onSelectView: (v: ChannelView) => void
  onOpenDM: (uid: string) => void; myId: string | null; isAdmin: boolean
  allProfiles: Record<string, ChatProfile>
  onCreateChannel: (name: string, desc?: string) => void
  onRenameChannel: (id: string, name: string) => Promise<boolean>
  onDeleteChannel: (id: string) => Promise<boolean>
  mobileOpen: boolean; onMobileClose: () => void
}

function initials(name: string) { const p = name.trim().split(/\s+/); return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase() }
function hueOf(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return h % 360 }

function Avatar({ name, url, size = 28 }: { name: string; url?: string | null; size?: number }) {
  return url
    ? <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', background: `hsl(${hueOf(name)},65%,35%)`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: size * 0.38, fontWeight: 600, flexShrink: 0 }}>{initials(name)}</div>
}

export default function ChannelSidebar({ channels, dmChannels, activeView, onSelectView, onOpenDM, myId, isAdmin, allProfiles, onCreateChannel, onRenameChannel, onDeleteChannel, mobileOpen, onMobileClose }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newDesc,    setNewDesc]    = useState('')
  const [renaming,   setRenaming]   = useState<string | null>(null)
  const [renameVal,  setRenameVal]  = useState('')
  const [ctxMenu,    setCtxMenu]    = useState<{ id: string; x: number; y: number } | null>(null)
  const ctxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!ctxMenu) return
    const h = (e: MouseEvent) => { if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ctxMenu])

  const isActiveChannel = (id: string) => activeView?.kind === 'channel' && activeView.channelId === id
  const isActiveDM      = (id: string) => activeView?.kind === 'dm'      && activeView.dmId      === id

  const btnStyle = (active: boolean): React.CSSProperties => ({
    width: 'calc(100% - 16px)', display: 'flex', alignItems: 'center', gap: 7,
    padding: '6px 10px', background: active ? 'rgba(0,217,230,0.1)' : 'none',
    border: 'none', borderRadius: 7, cursor: 'pointer',
    color: active ? '#e2e8f0' : 'rgba(170,181,199,0.6)',
    fontSize: 14, margin: '1px 8px', textAlign: 'left',
  })

  return (
    <>
      {mobileOpen && <div className="chat-sidebar-overlay" onClick={onMobileClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 99, display: 'none' }} />}

      <aside className={`chat-sidebar${mobileOpen ? ' open' : ''}`} style={{ width: 240, borderRight: '1px solid rgba(255,255,255,0.06)', background: '#161b22', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        {/* Header */}
        <div style={{ height: 52, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', padding: '0 16px', background: '#1c2128', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>WatchDog Community</span>
          {mobileOpen && <button onClick={onMobileClose} style={{ background: 'none', border: 'none', color: 'rgba(170,181,199,0.5)', cursor: 'pointer', padding: 4, fontSize: 16 }}>✕</button>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', scrollbarWidth: 'thin' }}>
          {/* Channels label */}
          <div style={{ padding: '12px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(170,181,199,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Channels</span>
            {isAdmin && (
              <button onClick={() => setShowCreate((s) => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(170,181,199,0.4)', fontSize: 20, lineHeight: 1, padding: '0 2px' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#e2e8f0')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(170,181,199,0.4)')}
              >+</button>
            )}
          </div>

          {/* Create form */}
          {showCreate && isAdmin && (
            <div style={{ margin: '4px 8px 6px', background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.07)' }}>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { if (newName.trim()) { onCreateChannel(newName.trim(), newDesc.trim() || undefined); setNewName(''); setNewDesc(''); setShowCreate(false) } }; if (e.key === 'Escape') setShowCreate(false) }} placeholder="channel-name" style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '7px 10px', color: '#e2e8f0', fontSize: 13, outline: 'none', marginBottom: 6 }} />
              <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)" style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '7px 10px', color: '#e2e8f0', fontSize: 13, outline: 'none', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { if (newName.trim()) { onCreateChannel(newName.trim(), newDesc.trim() || undefined); setNewName(''); setNewDesc(''); setShowCreate(false) } }} style={{ flex: 1, background: 'linear-gradient(135deg,#00d9e6,#0891b2)', color: '#04101a', border: 'none', borderRadius: 7, padding: '7px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Create</button>
                <button onClick={() => setShowCreate(false)} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: 'rgba(170,181,199,0.65)', border: 'none', borderRadius: 7, padding: '7px 0', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Channel list */}
          {channels.map((ch) => (
            <div key={ch.id}>
              {renaming === ch.id ? (
                <div style={{ padding: '2px 8px' }}>
                  <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={() => { if (renameVal.trim()) void onRenameChannel(ch.id, renameVal.trim()); setRenaming(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { if (renameVal.trim()) void onRenameChannel(ch.id, renameVal.trim()); setRenaming(null) }; if (e.key === 'Escape') setRenaming(null) }}
                    style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(0,217,230,0.4)', borderRadius: 6, padding: '6px 10px', color: '#e2e8f0', fontSize: 13, outline: 'none' }}
                  />
                </div>
              ) : (
                <button style={btnStyle(isActiveChannel(ch.id))}
                  onClick={() => { onSelectView({ kind: 'channel', channelId: ch.id }); onMobileClose() }}
                  onContextMenu={(e) => { if (!isAdmin) return; e.preventDefault(); setCtxMenu({ id: ch.id, x: e.clientX, y: e.clientY }) }}
                  onMouseEnter={(e) => { if (!isActiveChannel(ch.id)) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#c9d1d9' } }}
                  onMouseLeave={(e) => { if (!isActiveChannel(ch.id)) { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'rgba(170,181,199,0.6)' } }}
                >
                  <span style={{ color: isActiveChannel(ch.id) ? 'rgba(0,217,230,0.7)' : 'rgba(170,181,199,0.35)', fontSize: 17 }}>#</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                </button>
              )}
            </div>
          ))}

          {/* DMs */}
          <div style={{ padding: '18px 12px 4px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(170,181,199,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Direct Messages</span>
          </div>

          {/* Admin support shortcut */}
          <button style={btnStyle(false)}
            onClick={() => { const s = channels.find((c) => c.name === 'support'); if (s) { onSelectView({ kind: 'channel', channelId: s.id }); onMobileClose() } }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#c9d1d9' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'rgba(170,181,199,0.6)' }}
          >
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#00d9e6,#0891b2)', display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0 }}>👑</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Admin Support</div>
              <div style={{ fontSize: 11, color: 'rgba(170,181,199,0.4)' }}>Ask for help</div>
            </div>
          </button>

          {dmChannels.map((dm) => {
            const otherId = dm.user1_id === myId ? dm.user2_id : dm.user1_id
            const profile = allProfiles[otherId]
            const name    = profile?.username ?? otherId.slice(0, 8)
            return (
              <button key={dm.id} style={btnStyle(isActiveDM(dm.id))}
                onClick={() => { onSelectView({ kind: 'dm', dmId: dm.id, otherUserId: otherId }); onMobileClose() }}
                onMouseEnter={(e) => { if (!isActiveDM(dm.id)) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#c9d1d9' } }}
                onMouseLeave={(e) => { if (!isActiveDM(dm.id)) { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'rgba(170,181,199,0.6)' } }}
              >
                <Avatar name={name} url={profile?.avatar_url} size={28} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{name}</span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* Admin context menu */}
      {ctxMenu && (
        <div ref={ctxRef} style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, background: '#1c2128', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.55)', zIndex: 300, minWidth: 170, overflow: 'hidden' }}>
          {[
            { label: 'Rename Channel', icon: '✏️', action: () => { const ch = channels.find((c) => c.id === ctxMenu.id); if (ch) { setRenaming(ch.id); setRenameVal(ch.name) }; setCtxMenu(null) } },
            { label: 'Delete Channel', icon: '🗑️', danger: true, action: () => { if (window.confirm('Delete this channel and all its messages?')) void onDeleteChannel(ctxMenu.id); setCtxMenu(null) } },
          ].map((item) => (
            <button key={item.label} onClick={item.action}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer', color: (item as { danger?: boolean }).danger ? '#ff6b6b' : '#e2e8f0', fontSize: 14, textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = (item as { danger?: boolean }).danger ? 'rgba(255,107,107,0.1)' : 'rgba(255,255,255,0.06)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >{item.icon} {item.label}</button>
          ))}
        </div>
      )}

      <style jsx global>{`
        @media (max-width: 768px) {
          .chat-sidebar { position: fixed !important; left: -260px !important; top: 0; bottom: 0; z-index: 100; transition: left 0.25s ease; }
          .chat-sidebar.open { left: 0 !important; }
          .chat-sidebar-overlay { display: block !important; }
        }
      `}</style>
    </>
  )
}