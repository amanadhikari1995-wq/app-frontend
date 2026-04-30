import type { Metadata } from 'next'
import FloatingChatButton from '@/components/FloatingChatButton'
import PageTransition from '@/components/PageTransition'
import RightSidebar from '@/components/RightSidebar'
import AuthGate from '@/components/AuthGate'
import BackToSiteButton from '@/components/BackToSiteButton'
import './globals.css'

export const metadata: Metadata = {
  title: 'WATCH-DOG | Universal Bot Platform',
  description: 'Run any type of bot with your own Python code',
}

function WatchdogWatermark() {
  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden select-none">
      <svg viewBox="0 0 520 480" fill="none" xmlns="http://www.w3.org/2000/svg"
        className="w-[700px] h-[700px] opacity-[0.028]">
        <path d="M72 268 Q28 200 55 138 Q72 104 102 126" stroke="white" strokeWidth="20" strokeLinecap="round" fill="none"/>
        <ellipse cx="218" cy="290" rx="130" ry="82" fill="white"/>
        <path d="M305 238 Q336 212 348 198" stroke="white" strokeWidth="34" strokeLinecap="round" fill="none"/>
        <circle cx="366" cy="172" r="62" fill="white"/>
        <path d="M328 128 Q298 72 322 50 Q348 80 350 126 Z" fill="white"/>
        <path d="M386 124 Q408 72 432 68 Q438 102 412 132 Z" fill="white"/>
        <circle cx="382" cy="156" r="10" fill="#05070f"/>
        <circle cx="385" cy="153" r="3.5" fill="white"/>
        <ellipse cx="364" cy="198" rx="28" ry="22" fill="white"/>
        <ellipse cx="364" cy="186" rx="12" ry="9" fill="#05070f"/>
        <path d="M346 208 Q364 220 382 208" stroke="#05070f" strokeWidth="3.5" strokeLinecap="round" fill="none"/>
        <rect x="388" y="196" width="104" height="12" rx="6" fill="white"/>
        <rect x="482" y="180" width="24" height="36" rx="5" fill="white"/>
        <path d="M480 180 Q487 144 500 128 Q510 148 508 168 Q504 184 490 182 Z" fill="white"/>
        <path d="M486 180 Q492 155 500 140 Q507 158 504 173 Z" fill="white" opacity="0.6"/>
        <line x1="514" y1="142" x2="526" y2="133" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="518" y1="156" x2="532" y2="154" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="506" y1="130" x2="511" y2="116" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="490" y1="126" x2="490" y2="112" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="474" y1="132" x2="466" y2="120" stroke="white" strokeWidth="3" strokeLinecap="round"/>
        <rect x="122" y="354" width="32" height="74" rx="12" fill="white"/>
        <rect x="172" y="360" width="32" height="68" rx="12" fill="white"/>
        <rect x="236" y="360" width="32" height="68" rx="12" fill="white"/>
        <rect x="286" y="354" width="32" height="74" rx="12" fill="white"/>
        <ellipse cx="138" cy="430" rx="22" ry="12" fill="white"/>
        <ellipse cx="188" cy="430" rx="22" ry="12" fill="white"/>
        <ellipse cx="252" cy="430" rx="22" ry="12" fill="white"/>
        <ellipse cx="302" cy="430" rx="22" ry="12" fill="white"/>
      </svg>
    </div>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Apply stored theme before first paint — prevents flash */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('watchdog-theme');
            if (t) document.documentElement.setAttribute('data-theme', t);
          } catch(e) {}
        `}} />
      </head>
      {/* No inline background — body bg comes from var(--bg) in globals.css */}
      <body className="min-h-screen text-slate-100 antialiased">
        <WatchdogWatermark />
        <AuthGate>
          <PageTransition>
            <div className="relative z-10">
              {children}
            </div>
          </PageTransition>
          <RightSidebar />
          <FloatingChatButton />
          <BackToSiteButton />
        </AuthGate>
      </body>
    </html>
  )
}
