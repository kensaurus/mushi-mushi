#!/usr/bin/env node
/**
 * Copies docs/screenshots/* → apps/docs/public/screenshots/
 *                      and → apps/admin/public/screenshots/
 *
 * Usage: node scripts/sync-marketing-screenshots.mjs
 */

import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'docs/screenshots')
const DESTS = [
  join(ROOT, 'apps/docs/public/screenshots'),
  join(ROOT, 'apps/admin/public/screenshots'),
]

const ALLOWED = /\.(png|jpe?g|webp|gif)$/i

async function syncDest(dest) {
  await mkdir(dest, { recursive: true })
  const files = (await readdir(SRC)).filter((f) => ALLOWED.test(f))
  let copied = 0
  let bytes = 0

  for (const file of files) {
    const from = join(SRC, file)
    const to = join(dest, file)
    const info = await stat(from)
    if (!info.isFile()) continue
    await cp(from, to)
    copied += 1
    bytes += info.size
  }

  return { dest, copied, bytes }
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`[sync-marketing-screenshots] source missing: ${SRC}`)
    process.exit(1)
  }

  for (const result of await Promise.all(DESTS.map(syncDest))) {
    console.log(
      `[sync-marketing-screenshots] copied ${result.copied} files (${(result.bytes / 1024 / 1024).toFixed(2)} MB) → ${result.dest}`,
    )
  }
}

main().catch((e) => {
  console.error('[sync-marketing-screenshots]', e)
  process.exit(1)
})
