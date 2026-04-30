'use client'

/**
 * ChatInput — auto-growing textarea + send button.
 *
 *   • Enter            → send
 *   • Shift+Enter      → newline
 *   • Throttled typing broadcast (≥ 1 event / sec) so we don't flood
 *     the realtime channel on every keystroke.
 */
import React, { useEffect, useRef, useState } from 'react'


interface Props {
  disabled?:    boolean
  placeholder?: string
  onSend:       (text: string) => Promise<{ ok: boolean; error?: string } | void>
  onTyping?:    () => void
}

const TYPING_THROTTLE_MS = 1_000


export default function ChatInput({
  disabled = false,
  placeholder = 'Write a message…',
  onSend,
  onTyping,
}: Props) {
  const [value,   setValue]   = useState('')
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const lastTypingRef = useRef(0)

  // auto-grow textarea up to a cap
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [value])

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed || sending || disabled) return
    setSending(true)
    setError(null)
    try {
      const result = await onSend(trimmed)
      if (result && 'ok' in result && !result.ok) {
        setError(result.error || 'Could not send message')
      } else {
        setValue('')
      }
    } finally {
      setSending(false)
      // restore focus immediately after send
      requestAnimationFrame(() => taRef.current?.focus())
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    if (onTyping) {
      const now = Date.now()
      if (now - lastTypingRef.current > TYPING_THROTTLE_MS) {
        lastTypingRef.current = now
        onTyping()
      }
    }
  }

  return (
    <div style={{ padding: '10px 12px 14px' }}>
      {error && (
        <div style={{
          fontSize: 12, color: '#ff8a8a',
          padding: '6px 10px', marginBottom: 6,
          background: 'rgba(255, 107, 138, 0.08)',
          border: '1px solid rgba(255, 107, 138, 0.25)',
          borderRadius: 8,
        }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 14,
          padding: 6,
        }}
      >
        <textarea
          ref={taRef}
          value={value}
          disabled={disabled || sending}
          rows={1}
          placeholder={placeholder}
          onChange={onChange}
          onKeyDown={onKey}
          style={{
            flex: 1, minWidth: 0,
            background: 'transparent',
            border: 'none', outline: 'none',
            color: 'var(--text-primary, #e2e8f0)',
            resize: 'none',
            fontFamily: 'inherit', fontSize: 14, lineHeight: 1.45,
            padding: '8px 10px',
            maxHeight: 160,
          }}
        />

        <button
          onClick={submit}
          disabled={!value.trim() || sending || disabled}
          aria-label="Send message"
          style={{
            background: !value.trim() || sending || disabled
              ? 'rgba(255, 255, 255, 0.06)'
              : 'linear-gradient(135deg, #00d9e6, #0891b2)',
            color: !value.trim() || sending || disabled
              ? 'rgba(170, 181, 199, 0.5)'
              : '#04101a',
            border: 'none',
            borderRadius: 10,
            padding: '8px 14px',
            cursor: !value.trim() || sending || disabled ? 'not-allowed' : 'pointer',
            display: 'grid', placeItems: 'center',
            transition: 'transform 120ms ease',
          }}
          onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.96)' }}
          onMouseUp={(e)   => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
          onMouseLeave={(e)=> { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
        >
          {sending ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" strokeOpacity="0.25" />
              <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
              </path>
            </svg>
          ) : (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          )}
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'rgba(170, 181, 199, 0.45)', marginTop: 6, paddingLeft: 10 }}>
        Enter to send · Shift+Enter for new line
      </div>
    </div>
  )
}
