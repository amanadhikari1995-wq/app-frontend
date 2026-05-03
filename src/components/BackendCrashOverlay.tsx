'use client'
/**
 * BackendCrashOverlay — full-screen modal that fires when the Electron
 * supervisor (electron/backend-runner.js) gives up after exhausting its
 * respawn budget for the bundled FastAPI backend.
 *
 * Replaces the perpetual "Local backend unreachable, retrying…" text the
 * dashboard / logs pages used to show. That text is misleading once the
 * supervisor has actually given up — there is no more retrying happening,
 * and the user has no idea where to look. This panel:
 *
 *   • Tells the user the backend has permanently failed this session.
 *   • Points at backend.crash.log (the new file written by the
 *     sys.excepthook in run_backend.py) with a copyable absolute path.
 *   • Offers two actions:
 *       - "Open Logs Folder" (best-effort — uses electronAPI if present)
 *       - "Quit & Reopen" (suggests the user manually restart)
 *
 * In the web build (no electronAPI), the IPC subscription is a no-op and
 * this component renders nothing — the website doesn't run a local
 * backend so the crash is meaningless there.
 */
import { useEffect, useState } from 'react'

interface BackendFailedInfo {
  label?:        string
  exeName?:      string
  attempts?:     number
  crashLogHint?: string
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron?: boolean
      onBackendFailed?: (cb: (info: BackendFailedInfo) => void) => () => void
    }
  }
}

export default function BackendCrashOverlay() {
  const [info, setInfo] = useState<BackendFailedInfo | null>(null)

  useEffect(() => {
    // Web build: nothing to subscribe to.
    const off = window.electronAPI?.onBackendFailed?.((payload) => {
      setInfo(payload || {})
    })
    return () => { try { off?.() } catch { /* ignore */ } }
  }, [])

  if (!info) return null

  const crashLogPath = '%LOCALAPPDATA%\\WatchDog\\logs\\backend.crash.log'
  const reopenHint = 'Close WatchDog from the system tray, then reopen it from the Start menu.'

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="backend-crash-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,                      // above everything (AuthGate is 9999)
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(3, 6, 15, 0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'rgba(15, 22, 38, 0.95)',
          border: '1px solid rgba(239, 68, 68, 0.32)',
          borderRadius: 22,
          padding: 32,
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.04) inset',
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 64, height: 64,
            margin: '0 auto 20px',
            borderRadius: 18,
            background: 'linear-gradient(135deg, rgba(239,68,68,0.20), rgba(239,68,68,0.06))',
            border: '1px solid rgba(239,68,68,0.34)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 32px rgba(239,68,68,0.22)',
          }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
               stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          </svg>
        </div>

        <h1
          id="backend-crash-title"
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 900,
            textAlign: 'center',
            color: '#fff',
            letterSpacing: '-0.02em',
            fontFamily: 'Poppins, Inter, system-ui, sans-serif',
          }}
        >
          Local backend failed to start
        </h1>

        <p
          style={{
            margin: '12px 0 24px',
            fontSize: 14,
            lineHeight: 1.55,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.65)',
          }}
        >
          We tried {info.attempts ?? 'several'} times to start the bundled service ({info.exeName || 'watchdog-backend.exe'}) and it kept crashing. The full error is saved to a crash log so we can fix it.
        </p>

        {/* Crash-log path callout */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12,
            padding: '12px 14px',
            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
            fontSize: 12.5,
            color: '#a8b5c8',
            wordBreak: 'break-all',
            marginBottom: 20,
          }}
        >
          {crashLogPath}
        </div>

        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.55)',
          }}
        >
          <strong style={{ color: 'rgba(255,255,255,0.78)' }}>Next steps:</strong> {reopenHint} If it keeps failing, send the contents of <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4 }}>backend.crash.log</code> to support so we can ship a fix.
        </p>

        {info.label && (
          <p
            style={{
              marginTop: 18,
              fontSize: 11,
              textAlign: 'center',
              color: 'rgba(255,255,255,0.35)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            Service: {info.label}
          </p>
        )}
      </div>
    </div>
  )
}
