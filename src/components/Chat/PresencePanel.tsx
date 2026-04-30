'use client'

/**
 * PresencePanel — list of users currently in the room (Supabase Realtime
 * presence sync). Includes the current user with a "(you)" label.
 *
 * Hidden on small screens — chat takes full width on mobile.
 */
import React from 'react'
import type { PresenceUser } from '@/hooks/useChat'


function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function hueOf(name: string | null | undefined): number {
  if (!name) return 200
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 360
}


interface Props {
  presence: Record<string, PresenceUser>
  meId:     string | null
}

export default function PresencePanel({ presence, meId }: Props) {
  const users = Object.values(presence)
  // sort: me first, then alphabetical
  users.sort((a, b) => {
    if (a.user_id === meId) return -1
    if (b.user_id === meId) return  1
    return a.username.localeCompare(b.username)
  })

  return (
    <aside
      style={{
        width:  240,
        height: '100%',
        borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
        background: 'rgba(255, 255, 255, 0.015)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{
        padding: '14px 16px 8px',
        fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.12em',
        color: 'rgba(170, 181, 199, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Online</span>
        <span style={{
          background: 'rgba(0, 217, 230, 0.12)',
          color: '#62fbff',
          padding: '2px 8px', borderRadius: 999,
          fontSize: 11, fontWeight: 700,
        }}>
          {users.length}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px' }}>
        {users.length === 0 && (
          <div style={{
            padding: '12px 14px',
            fontSize: 13,
            color: 'rgba(170, 181, 199, 0.55)',
          }}>
            No one's here yet.
          </div>
        )}
        {users.map((u) => {
          const hue   = hueOf(u.username)
          const bg    = `hsl(${hue}, 65%, 35%)`
          const isMe  = u.user_id === meId
          return (
            <div
              key={u.user_id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 10,
                marginBottom: 2,
              }}
            >
              <div style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: bg, color: '#fff',
                  display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 600,
                }}>
                  {initials(u.username)}
                </div>
                <div
                  aria-label="online"
                  style={{
                    position: 'absolute', right: -1, bottom: -1,
                    width: 11, height: 11, borderRadius: '50%',
                    background: '#22c55e',
                    border: '2px solid #04101a',
                  }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500,
                  color: 'var(--text-primary, #e2e8f0)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {u.username || 'Anonymous'}
                  {isMe && (
                    <span style={{ color: 'rgba(170, 181, 199, 0.55)', fontWeight: 400 }}>
                      {' '}(you)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
