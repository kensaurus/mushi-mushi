#!/usr/bin/env node
/**
 * Copies docs/social-preview/og-card.png to the static exports that
 * advertise a share card:
 *   apps/docs/public/social-preview/og-card.png
 *     → https://kensaur.us/mushi-mushi/docs/social-preview/og-card.png
 *   apps/testers/public/og-card.png
 *     → https://kensaur.us/mushi-mushi/testers/og-card.png
 * (see apps/docs/app/layout.tsx and apps/testers/app/layout.tsx).
 *
 * Mirrors scripts/sync-docs-screenshots.mjs. gen-og-card.mjs writes the same
 * copies when it re-renders the card. This script refreshes them from the
 * committed source without a browser.
 *
 * Usage: node scripts/sync-docs-og-card.mjs
 */

import { cp, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'docs/social-preview/og-card.png')
const DESTINATIONS = [
  join(ROOT, 'apps/docs/public/social-preview/og-card.png'),
  join(ROOT, 'apps/testers/public/og-card.png'),
]

async function main() {
  if (!existsSync(SRC)) {
    console.error(`[sync-og-card] source missing: ${SRC}`)
    process.exit(1)
  }
  const info = await stat(SRC)
  for (const dest of DESTINATIONS) {
    await mkdir(dirname(dest), { recursive: true })
    await cp(SRC, dest)
  }
  console.log(`[sync-og-card] copied og-card.png (${(info.size / 1024).toFixed(0)} KB) → docs and testers public assets`)
}

main().catch((err) => {
  console.error('[sync-og-card] failed:', err)
  process.exit(1)
})
