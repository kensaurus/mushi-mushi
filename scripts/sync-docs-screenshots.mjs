#!/usr/bin/env node
/**
 * Copies docs/screenshots/* → apps/docs/public/screenshots/
 * so Nextra can serve them at /screenshots/ (or /mushi-mushi/docs/screenshots/ in prod).
 *
 * Usage: node scripts/sync-docs-screenshots.mjs
 */

import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'docs/screenshots')
const DEST = join(ROOT, 'apps/docs/public/screenshots')

const ALLOWED = /\.(png|jpe?g|webp|gif)$/i

async function main() {
  if (!existsSync(SRC)) {
    console.error(`[sync-screenshots] source missing: ${SRC}`)
    process.exit(1)
  }
  await mkdir(DEST, { recursive: true })

  const files = (await readdir(SRC)).filter((f) => ALLOWED.test(f))
  let copied = 0
  let bytes = 0

  for (const file of files) {
    const from = join(SRC, file)
    const to = join(DEST, file)
    const info = await stat(from)
    if (!info.isFile()) continue
    await cp(from, to)
    copied += 1
    bytes += info.size
  }

  console.log(
    `[sync-screenshots] copied ${copied} files (${(bytes / 1024 / 1024).toFixed(2)} MB) → ${DEST}`,
  )
}

main().catch((e) => {
  console.error('[sync-screenshots]', e)
  process.exit(1)
})
