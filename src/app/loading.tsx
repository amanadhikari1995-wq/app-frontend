export default function Loading() {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-none z-40"
      style={{
        background: 'rgba(3,6,15,0.40)',
        backdropFilter: 'blur(10px) saturate(160%)',
        WebkitBackdropFilter: 'blur(10px) saturate(160%)',
      }}
    >
      <div className="flex flex-col items-center gap-6">
        {/* Spinner */}
        <div style={{ position: 'relative', width: 76, height: 76 }}>
          {/* Outer ring */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '3px solid rgba(255,255,255,0.06)',
            }}
          />
          {/* Spinning accent arc */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '3px solid transparent',
              borderTopColor: 'var(--accent)',
              borderRightColor: 'var(--accent)',
              animation: 'wd-loader-spin 0.95s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite',
              boxShadow: '0 0 28px var(--accent-dim)',
            }}
          />
          {/* Inner pulsing dot */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 24px var(--accent), 0 0 48px var(--accent-dim)',
              animation: 'wd-loader-pulse 1.6s ease-in-out infinite',
            }}
          />
        </div>

        {/* Label */}
        <div className="flex flex-col items-center gap-2">
          <span
            style={{
              fontFamily: 'Poppins, sans-serif',
              fontSize: 15.6,
              fontWeight: 800,
              letterSpacing: '0.30em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
            }}
          >
            Loading
          </span>

          {/* Animated bar */}
          <div
            style={{
              width: 120,
              height: 2,
              borderRadius: 2,
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.06)',
            }}
          >
            <div
              style={{
                width: '25%',
                height: '100%',
                background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
                animation: 'wd-loader-bar 1.4s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
