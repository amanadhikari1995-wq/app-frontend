'use client'
/**
 * useOnlineStatus  —  Browser network detection + auto-reconnect
 *
 * Listens to window `online` / `offline` events and mirrors them in React state.
 * Fires the optional `onReconnect` callback the moment the connection is
 * restored so callers can immediately re-fetch stale data.
 *
 * SSR-safe: starts optimistic (true) to avoid hydration mismatch, then syncs
 * with the real `navigator.onLine` value in the first effect.
 */
import { useState, useEffect, useRef } from 'react'

export interface OnlineStatus {
  /** True when browser believes it has network access */
  isOnline: boolean
  /** True for ~4 s right after reconnecting (use for a "Reconnected" toast) */
  justReconnected: boolean
}

export function useOnlineStatus(onReconnect?: () => void): OnlineStatus {
  // Optimistic initial value — avoids SSR / hydration mismatch
  const [isOnline,        setIsOnline]        = useState(true)
  const [justReconnected, setJustReconnected] = useState(false)

  // Keep callback ref stable so callers can pass an inline arrow function
  const cbRef = useRef(onReconnect)
  cbRef.current = onReconnect

  useEffect(() => {
    let flashTimer: ReturnType<typeof setTimeout>

    // Sync immediately once mounted in the browser
    setIsOnline(navigator.onLine)

    const handleOnline = () => {
      setIsOnline(true)
      setJustReconnected(true)
      cbRef.current?.()              // fire reconnect callback
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => setJustReconnected(false), 4000)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setJustReconnected(false)
      clearTimeout(flashTimer)
    }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearTimeout(flashTimer)
    }
  }, [])  // empty deps — event listeners are stable; callback read via ref

  return { isOnline, justReconnected }
}
