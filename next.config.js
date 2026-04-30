/** @type {import('next').NextConfig} */
//
// Build modes
// ───────────
// Default (Electron):
//   `npm run build`
//   → output:'export', trailingSlash:true, basePath:'',
//     loads via file:// in Electron.
//
// Web dashboard at https://watchdogbot.cloud/app/ :
//   set BASE_PATH=/app && set NEXT_PUBLIC_TRANSPORT=relay && npm run build
//   → same static export, but every route + asset URL is prefixed
//     with /app so we can drop the contents of ./out into the
//     website's public/app/ folder unchanged.
//
const basePath = process.env.BASE_PATH || ''

const nextConfig = {
  reactStrictMode: true,

  // Produces fully static HTML/CSS/JS in ./out/ that Electron loads via file://
  // and the website hosts as static files under /app/.
  output: 'export',

  // Each route becomes /<route>/index.html so file:// loads work cleanly
  trailingSlash: true,

  // Static export disables Next's image optimizer; we don't use next/image
  // anywhere, but this keeps the build from complaining if anyone adds it.
  images: { unoptimized: true },

  // Web build only — prefix every URL with /app so links and chunks resolve
  // correctly when served from https://watchdogbot.cloud/app/.
  basePath:    basePath || undefined,
  assetPrefix: basePath || undefined,
}

module.exports = nextConfig
