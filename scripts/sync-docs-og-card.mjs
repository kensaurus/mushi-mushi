#!/usr/bin/env node
/**
 * Copies docs/social-preview/og-card.png into the static exports that
 * advertise it:
 *   apps/docs/public/social-preview/og-card.png
 *     → https://kensaur.us/mushi-mushi/docs/social-preview/og-card.png
 *   apps/testers/public/og-card.png
 *     → https://kensaur.us/mushi-mushi/testers/og-card.png
 * (docs layout + apps/testers/app/layout.tsx openGraph.images).
 *
 * The testers copy has to land in public/ before `next build`; the testers
 * prebuild runs this script. *.png is gitignored, so the testers file is
 * allow-listed in .gitignore or the deploy never receives it.
 *
 * Usage: node scripts/sync-docs-og-card.mjs
 */

import { cp, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'docs/social-preview/og-card.png')
const COPIES = [
  join(ROOT, 'apps/docs/public/social-preview/og-card.png'),
  join(ROOT, 'apps/testers/public/og-card.png'),
]

async function main() {
  if (!existsSync(SRC)) {
    console.error(`[sync-og-card] source missing: ${SRC}`)
    process.exit(1)
  }
  const info = await stat(SRC)
  const kb = (info.size / 1024).toFixed(0)
  for (const dest of COPIES) {
    await mkdir(dirname(dest), { recursive: true })
    await cp(SRC, dest)
    console.log(`[sync-og-card] copied og-card.png (${kb} KB) → ${dest.slice(ROOT.length + 1)}`)
  }
}

main().catch((err) => {
  console.error('[sync-og-card] failed:', err)
  process.exit(1)
})
