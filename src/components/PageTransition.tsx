'use client'
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.classList.remove('page-enter')
    void el.offsetWidth  // force reflow to restart the animation
    el.classList.add('page-enter')
  }, [pathname])

  return (
    <div ref={ref} className="page-enter">
      {children}
    </div>
  )
}
