'use client'

/**
 * MessageBubble — single message with reactions, reply, edit, delete.
 */
import React, { useState } from 'react'
import type { ChatMessage } from '@/hooks/useChat'
import type { ChatProfile } from '@/lib/chatClient'

const EMOJI_LIST = ['👍','❤️','😂','😮','😢','🔥','🎉','💯']

function timeLabel(iso: string): string {
  try {
    const d = new Date(iso); const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 30)       return 'just now'
    if (diff < 60)       return `${Math.floor(diff)}s ago`
    if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`
    const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function initials(name: string) { const p = name.trim().split(/\s+/); return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase() }
function hueOf(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return h % 360 }

function Avatar({ profile, size = 36 }: { profile: ChatProfile | null; size?: number }) {
  const name = profile?.username ?? '?'
  const hue  = hueOf(name)
  return profile?.avatar_url
    ? <img src={profile.avatar_url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', background: `hsl(${hue},65%,35%)`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: size * 0.36, fontWeight: 600, flexShrink: 0 }}>{initials(name)}</div>
}

function isImage(type: string | null) { return type?.startsWith('image/') ?? false }
function isVideo(type: string | null) { return type?.startsWith('video/') ?? false }
function isAudio(type: string | null) { return type?.startsWith('audio/') ?? false }

interface Props {
  message:   ChatMessage
  mine:      boolean
  grouped:   boolean
  isAdmin:   boolean
  onEdit:    (id: string, content: string) => Promise<boolean>
  onDelete:  (id: string) => Promise<boolean>
  onReact:   (id: string, emoji: string) => Promise<void>
  onReply:   (msg: ChatMessage) => void
  onOpenDM:  (uid: string) => void
}

export default function MessageBubble({ message, mine, grouped, isAdmin, onEdit, onDelete, onReact, onReply, onOpenDM }: Props) {
  const [editing,    setEditing]    = useState(false)
  const [editVal,    setEditVal]    = useState(message.content ?? '')
  const [showEmoji,  setShowEmoji]  = useState(false)
  const [showMenu,   setShowMenu]   = useState(false)
  const [hovered,    setHovered]    = useState(false)

  const name = message.profile?.username ?? 'Unknown'
  const hue  = hueOf(name)

  const handleEdit = async () => {
    if (!editVal.trim()) return
    await onEdit(message.id, editVal.trim())
    setEditing(false)
  }

  const canModify = mine || isAdmin

  const fileBlock = message.file_url && (
    isImage(message.file_type) ? (
      <a href={message.file_url} target="_blank" rel="noopener noreferrer">
        <img src={message.file_url} alt={message.file_name ?? 'image'} style={{ maxWidth: 320, maxHeight: 280, borderRadius: 10, display: 'block', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.08)' }} />
      </a>
    ) : isVideo(message.file_type) ? (
      <video controls style={{ maxWidth: 320, borderRadius: 10, display: 'block', border: '1px solid rgba(255,255,255,0.08)' }}>
        <source src={message.file_url} type={message.file_type ?? undefined} />
      </video>
    ) : isAudio(message.file_type) ? (
      <audio controls style={{ display: 'block', width: '100%', maxWidth: 280 }}>
        <source src={message.file_url} type={message.file_type ?? undefined} />
      </audio>
    ) : (
      <a href={message.file_url} target="_blank" rel="noopener noreferrer" download={message.file_name ?? true}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(0,217,230,0.08)', border: '1px solid rgba(0,217,230,0.2)', borderRadius: 10, padding: '8px 14px', color: '#00d9e6', textDecoration: 'none', fontSize: 13 }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {message.file_name ?? 'Download file'}
        {message.file_size && <span style={{ color: 'rgba(170,181,199,0.5)', fontSize: 11 }}>({(message.file_size / 1024 / 1024).toFixed(1)} MB)</span>}
      </a>
    )
  )

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowMenu(false); setShowEmoji(false) }}
      style={{ display: 'flex', gap: 10, padding: `${grouped ? 2 : 14}px 16px 2px`, position: 'relative', background: hovered ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'background 0.1s' }}
    >
      {/* Avatar column */}
      <div style={{ width: 36, flexShrink: 0 }}>
        {!grouped && <Avatar profile={message.profile} />}
      </div>

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!grouped && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: `hsl(${hue},70%,70%)`, cursor: 'pointer' }}
              onClick={() => { if (!mine) onOpenDM(message.user_id) }}
            >{name}</span>
            <span style={{ fontSize: 11, color: 'rgba(170,181,199,0.45)' }}>{timeLabel(message.created_at)}</span>
            {(message.updated_at && message.updated_at !== message.created_at) && <span style={{ fontSize: 10, color: 'rgba(170,181,199,0.35)', fontStyle: 'italic' }}>(edited)</span>}
          </div>
        )}

        {/* Message content */}
        {message.is_deleted ? (
          <span style={{ fontSize: 14, color: 'rgba(170,181,199,0.35)', fontStyle: 'italic' }}>Message deleted</span>
        ) : editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleEdit() }; if (e.key === 'Escape') setEditing(false) }}
              rows={2}
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(0,217,230,0.35)', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', fontSize: 14, outline: 'none', resize: 'none' }}
            />
            <div style={{ display: 'flex', gap: 6, fontSize: 12 }}>
              <button onClick={() => void handleEdit()} style={{ background: 'linear-gradient(135deg,#00d9e6,#0891b2)', color: '#04101a', border: 'none', borderRadius: 6, padding: '5px 12px', fontWeight: 600, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditing(false)} style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(170,181,199,0.7)', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {message.content && (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: '#c9d1d9', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{message.content}</p>
            )}
            {fileBlock}
          </>
        )}

        {/* Reactions */}
        {Object.entries(message.reactions).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {Object.entries(message.reactions).map(([emoji, { count, mine: isMine }]) => (
              <button key={emoji} onClick={() => void onReact(message.id, emoji)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: isMine ? 'rgba(0,217,230,0.15)' : 'rgba(255,255,255,0.06)', border: `1px solid ${isMine ? 'rgba(0,217,230,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 100, padding: '2px 8px', cursor: 'pointer', fontSize: 14 }}
              >
                {emoji} <span style={{ fontSize: 12, color: 'rgba(170,181,199,0.8)', fontWeight: 500 }}>{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover actions */}
      {hovered && !message.is_deleted && !editing && (
        <div style={{ position: 'absolute', right: 16, top: -8, display: 'flex', gap: 4, background: '#1c2128', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '2px 4px', zIndex: 10 }}>
          {/* Emoji picker toggle */}
          <div style={{ position: 'relative' }}>
            <ActionBtn title="Add reaction" onClick={() => { setShowEmoji((s) => !s); setShowMenu(false) }}>😊</ActionBtn>
            {showEmoji && (
              <div style={{ position: 'absolute', bottom: '100%', right: 0, background: '#1c2128', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 6, display: 'flex', gap: 4, flexWrap: 'wrap', width: 180, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 20 }}>
                {EMOJI_LIST.map((e) => (
                  <button key={e} onClick={() => { void onReact(message.id, e); setShowEmoji(false) }}
                    style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 3, borderRadius: 6, lineHeight: 1 }}
                    onMouseEnter={(el) => (el.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                    onMouseLeave={(el) => (el.currentTarget.style.background = 'none')}
                  >{e}</button>
                ))}
              </div>
            )}
          </div>

          <ActionBtn title="Reply" onClick={() => onReply(message)}>↩</ActionBtn>

          {canModify && mine && !message.is_deleted && (
            <ActionBtn title="Edit" onClick={() => { setEditVal(message.content ?? ''); setEditing(true); setShowMenu(false) }}>✏️</ActionBtn>
          )}

          {canModify && (
            <ActionBtn title="Delete" onClick={() => { if (window.confirm('Delete this message?')) void onDelete(message.id) }} danger>🗑️</ActionBtn>
          )}
        </div>
      )}
    </div>
  )
}

function ActionBtn({ title, onClick, children, danger = false }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button title={title} onClick={onClick}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 5, fontSize: 14, color: danger ? '#ff6b6b' : 'rgba(170,181,199,0.7)', lineHeight: 1 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? 'rgba(255,107,107,0.15)' : 'rgba(255,255,255,0.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >{children}</button>
  )
}