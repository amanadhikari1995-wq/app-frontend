'use client'

/**
 * ProfileSetupModal — first-time user name + avatar setup.
 */
import React, { useRef, useState } from 'react'
import { upsertProfile, uploadAvatar } from '@/lib/chatClient'
import type { ChatProfile } from '@/lib/chatClient'

interface Props {
  userId:        string
  suggestedName: string
  onComplete:    (profile: ChatProfile) => void
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

export default function ProfileSetupModal({ userId, suggestedName, onComplete }: Props) {
  const [username,      setUsername]      = useState(suggestedName)
  const [avatarFile,    setAvatarFile]    = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    setAvatarFile(f); setAvatarPreview(URL.createObjectURL(f))
  }

  const handleSave = async () => {
    const name = username.trim()
    if (!name) { setError('Please enter a display name.'); return }
    setSaving(true); setError(null)
    try {
      let avatarUrl: string | null = null
      if (avatarFile) avatarUrl = await uploadAvatar(userId, avatarFile)
      const profile = await upsertProfile(userId, name, avatarUrl)
      if (!profile) { setError('Could not save profile. Please try again.'); return }
      onComplete(profile)
    } finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}>
      <div style={{ background: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 40, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg,#00d9e6,#0891b2)', display: 'grid', placeItems: 'center' }}>
            <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#04101a" strokeWidth={2.2} strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#e2e8f0' }}>Welcome to Community Chat</h2>
          <p style={{ fontSize: 14, color: 'rgba(170,181,199,0.65)', margin: 0, lineHeight: 1.5 }}>Set a display name and optional photo before joining.</p>
        </div>

        {/* Avatar picker */}
        <button
          onClick={() => fileRef.current?.click()}
          style={{ width: 92, height: 92, borderRadius: '50%', border: '2px dashed rgba(0,217,230,0.35)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: avatarPreview ? 'none' : 'rgba(0,217,230,0.04)', overflow: 'hidden', padding: 0, transition: 'border-color 0.2s' }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(0,217,230,0.7)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(0,217,230,0.35)')}
        >
          {avatarPreview ? (
            <img src={avatarPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : username ? (
            <span style={{ fontSize: 28, fontWeight: 700, color: 'rgba(0,217,230,0.5)' }}>{initials(username)}</span>
          ) : (
            <>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="rgba(0,217,230,0.5)" strokeWidth={1.8} strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span style={{ fontSize: 10, color: 'rgba(0,217,230,0.5)', marginTop: 4 }}>Upload</span>
            </>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickFile} />

        {/* Name input */}
        <div style={{ width: '100%' }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(170,181,199,0.6)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.09em' }}>
            Display Name <span style={{ color: '#ff6b6b' }}>*</span>
          </label>
          <input
            type="text" value={username} onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
            maxLength={32} placeholder="e.g. TradingWolf"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 14px', color: '#e2e8f0', fontSize: 15, outline: 'none' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(0,217,230,0.5)')}
            onBlur={(e)  => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
          />
          <div style={{ fontSize: 11, color: 'rgba(170,181,199,0.35)', marginTop: 4, textAlign: 'right' }}>{username.trim().length}/32</div>
        </div>

        {error && <div style={{ width: '100%', fontSize: 13, color: '#ff8a8a', background: 'rgba(255,107,138,0.08)', border: '1px solid rgba(255,107,138,0.22)', borderRadius: 8, padding: '10px 14px' }}>{error}</div>}

        <button
          onClick={() => void handleSave()} disabled={saving || !username.trim()}
          style={{ width: '100%', height: 48, background: saving || !username.trim() ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#00d9e6,#0891b2)', color: saving || !username.trim() ? 'rgba(170,181,199,0.45)' : '#04101a', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: saving || !username.trim() ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Saving…' : 'Enter Community Chat →'}
        </button>
      </div>
    </div>
  )
}