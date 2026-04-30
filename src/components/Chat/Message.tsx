'use client'

/**
 * Message — single chat bubble.
 *
 * Tightens up against the previous bubble from the same sender (avatar
 * only on the first of a streak; bubble corners flow into each other).
 * Ownership flips alignment + color.
 */
import React from 'react'
import type { ChatMessage } from '@/hooks/useChat'


function timeLabel(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 30)        return 'just now'
    if (diff < 60)        return `${Math.floor(diff)}s ago`
    if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`
    if (isToday(d, now))  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function isToday(d: Date, now: Date): boolean {
  return d.getFullYear() === now.getFullYear()
      && d.getMonth()    === now.getMonth()
      && d.getDate()     === now.getDate()
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Stable hue per username so bubbles for one person are always the same color. */
function hueOf(name: string | null | undefined): number {
  if (!name) return 200
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 360
}


interface Props {
  message:        ChatMessage
  mine:           boolean
  /** True if the message right above this one was from the same sender within
   *  the last 2 minutes — used to merge consecutive bubbles. */
  groupedTop:     boolean
  /** True if the message right below is from the same sender within 2 min. */
  groupedBottom:  boolean
}

export default function Message({ message, mine, groupedTop, groupedBottom }: Props) {
  const showAvatar = !groupedTop
  const showName   = !groupedTop && !mine
  const showTime   = !groupedBottom

  const hue = hueOf(message.username)
  const avatarBg = `hsl(${hue}, 65%, 35%)`
  const nameColor = `hsl(${hue}, 70%, 70%)`

  // Smooth corner radii based on grouping
  const baseRadius = 16
  const tightRadius = 4
  const radii = mine
    ? {
        bl: baseRadius,
        br: groupedTop    ? tightRadius : baseRadius,
        tl: baseRadius,
        tr: groupedBottom ? tightRadius : baseRadius,
      }
    : {
        bl: groupedBottom ? tightRadius : baseRadius,
        br: baseRadius,
        tl: groupedTop    ? tightRadius : baseRadius,
        tr: baseRadius,
      }

  return (
    <div
      className={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}
      style={{ marginTop: groupedTop ? 2 : 10, paddingLeft: 8, paddingRight: 8 }}
    >
      {/* avatar slot — kept as fixed-width spacer when avatar is hidden so
          consecutive bubbles align on the bubble edge */}
      {!mine && (
        <div style={{ width: 36, marginRight: 8, flexShrink: 0 }}>
          {showAvatar && (
            <div
              aria-hidden="true"
              style={{
                width: 36, height: 36, borderRadius: '50%',
                background: avatarBg,
                color: '#fff',
                display: 'grid', placeItems: 'center',
                fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
              }}
            >
              {initials(message.username)}
            </div>
          )}
        </div>
      )}

      <div style={{ maxWidth: '74%', minWidth: 0 }}>
        {showName && (
          <div style={{ fontSize: 12, fontWeight: 600, color: nameColor, marginBottom: 4, marginLeft: 4 }}>
            {message.username || 'Anonymous'}
          </div>
        )}

        <div
          style={{
            background: mine
              ? 'linear-gradient(135deg, #00d9e6, #0891b2)'
              : 'rgba(255, 255, 255, 0.06)',
            color: mine ? '#04101a' : 'var(--text-primary, #e2e8f0)',
            padding: '8px 12px',
            borderTopLeftRadius:     radii.tl,
            borderTopRightRadius:    radii.tr,
            borderBottomLeftRadius:  radii.bl,
            borderBottomRightRadius: radii.br,
            fontSize: 14, lineHeight: 1.4,
            wordBreak: 'break-word', overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
            border: mine ? 'none' : '1px solid rgba(255, 255, 255, 0.06)',
            boxShadow: mine ? '0 4px 14px rgba(0, 217, 230, 0.18)' : 'none',
          }}
        >
          {message.content}
        </div>

        {showTime && (
          <div
            style={{
              fontSize: 11,
              color: 'rgba(170, 181, 199, 0.65)',
              marginTop: 3,
              textAlign: mine ? 'right' : 'left',
              paddingLeft: mine ? 0 : 4,
              paddingRight: mine ? 4 : 0,
            }}
          >
            {timeLabel(message.created_at)}
          </div>
        )}
      </div>
    </div>
  )
}
