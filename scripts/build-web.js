#!/usr/bin/env node
/**
 * build-web.js — One-shot build + deploy for the web dashboard.
 *
 * What this does:
 *   1. Sets the env vars Next.js needs to inline /app as the basePath
 *      and route API calls through the cloud relay.
 *   2. Runs `next build` — produces a fully static export under ./out
 *   3. Copies the contents of ./out into ../../website/public/app
 *      so the website backend serves them at /app/*.
 *
 * After this runs, commit + push the website repo:
 *   cd ../../website
 *   git add public/app && git commit -m "Rebuild dashboard" && git push
 *
 * Cross-platform — works in Windows cmd, PowerShell, Git Bash, macOS,
 * Linux. No env-var quirks or path-translation gotchas.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── env vars baked into the bundle ──────────────────────────────────────────
const env = {
  ...process.env,
  BASE_PATH:                       '/app',
  NEXT_PUBLIC_BASE_PATH:           '/app',
  NEXT_PUBLIC_TRANSPORT:           'relay',
  NEXT_PUBLIC_WEBSITE_API_URL:     'https://watchdogbot.cloud',
  // Stops MSYS / Git Bash from rewriting "/app" → "C:/Program Files/Git/app"
  MSYS_NO_PATHCONV:                '1',
};

const ROOT_FRONTEND = path.resolve(__dirname, '..');
const OUT_DIR       = path.join(ROOT_FRONTEND, 'out');
// Try the sibling folder name first (watchdog-website), fall back to generic 'website'
const _websiteDir = (() => {
  const candidates = [
    path.resolve(ROOT_FRONTEND, '..', '..', 'watchdog-website'),
    path.resolve(ROOT_FRONTEND, '..', '..', 'website'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[1]; // default — will fail with a clear error below
})();
const TARGET_DIR    = path.join(_websiteDir, 'public', 'app');

console.log('▶ Building Next.js static export with /app basePath …');
// Run next.js binary directly. Avoids the npm wrapper layer that
// sometimes drops env-var-based behavior or swallows output on Windows.
const nextBin = path.join(
  ROOT_FRONTEND, 'node_modules', '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next'
);
const result = spawnSync(nextBin, ['build'], {
  cwd:   ROOT_FRONTEND,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',  // .cmd files need a shell on Windows
});
if (result.status !== 0) {
  console.error('✗ next build failed (status', result.status + ').');
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(OUT_DIR)) {
  console.error('✗ Build output not found at', OUT_DIR);
  process.exit(1);
}

console.log(`▶ Replacing ${TARGET_DIR} with fresh build …`);
// Wipe everything inside target dir (but keep the dir itself so .gitignore
// rules and parent permissions don't get reset)
if (fs.existsSync(TARGET_DIR)) {
  for (const entry of fs.readdirSync(TARGET_DIR)) {
    fs.rmSync(path.join(TARGET_DIR, entry), { recursive: true, force: true });
  }
} else {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

// Recursive copy of out/* → public/app/
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(OUT_DIR, TARGET_DIR);

console.log('✓ Done. Web dashboard staged at', TARGET_DIR);
console.log('');
console.log('Next:  cd ../../website && git add public/app && git commit -m "Rebuild dashboard" && git push');
