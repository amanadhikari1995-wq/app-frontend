'use client'

/**
 * ChatInputBar — text input + file upload button.
 */
import React, { useEffect, useRef, useState } from 'react'

interface Props {
  disabled?:    boolean
  placeholder?: string
  onSend:       (text: string) => Promise<{ ok: boolean; error?: string } | void>
  onSendFile?:  (file: File) => Promise<{ ok: boolean; error?: string } | void>
  onTyping?:    () => void
}

const THROTTLE_MS = 1000
const MAX_FILE_MB = 50

export default function ChatInputBar({ disabled = false, placeholder = 'Write a message…', onSend, onSendFile, onTyping }: Props) {
  const [value,     setValue]     = useState('')
  const [sending,   setSending]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [dragOver,  setDragOver]  = useState(false)
  const taRef       = useRef<HTMLTextAreaElement | null>(null)
  const fileRef     = useRef<HTMLInputElement | null>(null)
  const lastTyping  = useRef(0)

  useEffect(() => {
    const ta = taRef.current; if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [value])

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed || sending || disabled) return
    setSending(true); setError(null)
    try {
      const r = await onSend(trimmed)
      if (r && 'ok' in r && !r.ok) { setError(r.error ?? 'Failed to send'); return }
      setValue('')
    } finally {
      setSending(false)
      requestAnimationFrame(() => taRef.current?.focus())
    }
  }

  const handleFile = async (file: File) => {
    if (!onSendFile) return
    if (file.size > MAX_FILE_MB * 1024 * 1024) { setError(`File must be under ${MAX_FILE_MB} MB`); return }
    setUploading(true); setError(null)
    try {
      const r = await onSendFile(file)
      if (r && 'ok' in r && !r.ok) setError(r.error ?? 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    if (onTyping) {
      const now = Date.now()
      if (now - lastTyping.current > THROTTLE_MS) { lastTyping.current = now; onTyping() }
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && onSendFile && !disabled) void handleFile(file)
  }

  const isDisabled = disabled || sending || uploading

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{ padding: '10px 12px 14px', transition: 'background 0.15s', background: dragOver ? 'rgba(0,217,230,0.04)' : 'transparent' }}
    >
      {error && (
        <div style={{ fontSize: 12, color: '#ff8a8a', padding: '6px 10px', marginBottom: 6, background: 'rgba(255,107,138,0.08)', border: '1px solid rgba(255,107,138,0.22)', borderRadius: 8 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#ff8a8a', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      )}

      {dragOver && (
        <div style={{ textAlign: 'center', fontSize: 13, color: '#00d9e6', marginBottom: 6 }}>Drop file to upload</div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, background: 'rgba(255,255,255,0.04)', border: `1px solid ${dragOver ? 'rgba(0,217,230,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 14, padding: '6px 6px 6px 12px', transition: 'border-color 0.2s' }}>
        {/* File upload */}
        {onSendFile && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isDisabled}
            title="Attach file"
            style={{ background: 'none', border: 'none', cursor: isDisabled ? 'not-allowed' : 'pointer', color: 'rgba(170,181,199,0.5)', padding: '6px 4px', display: 'flex', alignItems: 'center', flexShrink: 0, opacity: isDisabled ? 0.4 : 1, transition: 'color 0.15s' }}
            onMouseEnter={(e) => { if (!isDisabled) e.currentTarget.style.color = '#00d9e6' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(170,181,199,0.5)' }}
          >
            {uploading ? (
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" strokeOpacity="0.3" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.85s" repeatCount="indefinite" /></path></svg>
            ) : (
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            )}
          </button>
        )}
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />

        {/* Text area */}
        <textarea
          ref={taRef} value={value} disabled={isDisabled} rows={1} placeholder={placeholder}
          onChange={onChange} onKeyDown={onKey}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#e2e8f0', resize: 'none', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.45, padding: '6px 0', maxHeight: 160 }}
        />

        {/* Send button */}
        <button
          onClick={() => void submit()}
          disabled={!value.trim() || isDisabled}
          style={{
            background: !value.trim() || isDisabled ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#00d9e6,#0891b2)',
            color:      !value.trim() || isDisabled ? 'rgba(170,181,199,0.4)' : '#04101a',
            border: 'none', borderRadius: 10, padding: '8px 14px', cursor: !value.trim() || isDisabled ? 'not-allowed' : 'pointer',
            display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'all 0.15s',
          }}
        >
          {sending ? (
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" strokeOpacity="0.25" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.85s" repeatCount="indefinite" /></path></svg>
          ) : (
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          )}
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'rgba(170,181,199,0.35)', marginTop: 5, paddingLeft: 4 }}>
        Enter to send · Shift+Enter for new line · Drag &amp; drop files
      </div>
    </div>
  )
}