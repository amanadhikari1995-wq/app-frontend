'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isLoggedIn } from '@/lib/auth'

/**
 * Root page: middleware already handles unauthenticated redirects.
 * If we reach here the user is authenticated — send them to the dashboard.
 */
export default function Home() {
  const router = useRouter()

  useEffect(() => {
    if (isLoggedIn()) {
      router.replace('/dashboard')
    } else {
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="w-9 h-9 border-2 border-[#00f5ff] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
