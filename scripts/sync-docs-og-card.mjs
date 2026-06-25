#!/usr/bin/env node
/**
 * Copies docs/social-preview/og-card.png → apps/docs/public/social-preview/
 * so the static export serves it at the URL the metadata advertises:
 *   https://kensaur.us/mushi-mushi/docs/social-preview/og-card.png
 * (see apps/docs/app/layout.tsx + app/[[...mdxPath]]/page.tsx openGraph.images).
 *
 * Mirrors scripts/sync-docs-screenshots.mjs. Runs in the docs `prebuild`.
 *
 * Usage: node scripts/sync-docs-og-card.mjs
 */

import { cp, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'docs/social-preview/og-card.png')
const DEST_DIR = join(ROOT, 'apps/docs/public/social-preview')
const DEST = join(DEST_DIR, 'og-card.png')

async function main() {
  if (!existsSync(SRC)) {
    console.error(`[sync-og-card] source missing: ${SRC}`)
    process.exit(1)
  }
  await mkdir(DEST_DIR, { recursive: true })
  const info = await stat(SRC)
  await cp(SRC, DEST)
  console.log(`[sync-og-card] copied og-card.png (${(info.size / 1024).toFixed(0)} KB) → apps/docs/public/social-preview/`)
}

main().catch((err) => {
  console.error('[sync-og-card] failed:', err)
  process.exit(1)
})
