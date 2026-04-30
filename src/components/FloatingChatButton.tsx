'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const HIDE_PATHS = ['/login', '/signup']

export default function FloatingChatButton() {
  const pathname = usePathname() ?? ''
  if (HIDE_PATHS.some(p => pathname.startsWith(p))) return null
  return (
    <Link
      href="/chat"
      aria-label="Open Community Chat"
      className="floating-chat-btn"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '28px', height: '28px' }}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        <circle cx="8.5" cy="10.5" r="0.5" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="10.5" r="0.5" fill="currentColor" stroke="none"/>
        <circle cx="15.5" cy="10.5" r="0.5" fill="currentColor" stroke="none"/>
      </svg>
    </Link>
  )
}
