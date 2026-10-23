#!/usr/bin/env node
/**
 * Copies docs/social-preview/og-card.png to the static export that
 * advertises it:
 *   apps/docs/public/social-preview/og-card.png
 *     → https://kensaur.us/mushi-mushi/docs/social-preview/og-card.png
 *   apps/testers/public/og-card.png
 *     → https://kensaur.us/mushi-mushi/testers/og-card.png
 * (see apps/docs/app/layout.tsx and apps/testers/app/layout.tsx).
 *
 * Each app's prebuild passes its own target so a build refreshes the card
 * that app ships and does not rewrite the other app's tracked file:
 *   docs prebuild:    node ../../scripts/sync-docs-og-card.mjs docs
 *   testers prebuild: node ../../scripts/sync-docs-og-card.mjs testers
 * With no argument, both copies are refreshed (manual use only).
 *
 * Usage: node scripts/sync-docs-og-card.mjs [docs|testers]
 */

import { cp, mkdir, stat } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_REL = 'docs/social-preview/og-card.png'

/** @type {Record<'docs' | 'testers', string>} */
const DESTINATION_REL = {
  docs: 'apps/docs/public/social-preview/og-card.png',
  testers: 'apps/testers/public/og-card.png',
}

/**
 * Public-asset paths this sync may write. A named target is exactly one
 * app, so that app's prebuild cannot touch the other app's tracked PNG.
 *
 * @param {string} root
 * @param {'docs' | 'testers' | undefined} target
 * @returns {string[]}
 */
export function ogCardDestinations(root, target) {
  if (target == null || target === '') {
    return [join(root, DESTINATION_REL.docs), join(root, DESTINATION_REL.testers)]
  }
  if (target !== 'docs' && target !== 'testers') {
    throw new Error(`unknown og-card target "${target}" (expected docs or testers)`)
  }
  return [join(root, DESTINATION_REL[target])]
}

/**
 * @param {string} root
 * @param {'docs' | 'testers' | undefined} target
 * @returns {Promise<string[]>} destination paths written
 */
export async function copyOgCard(root, target) {
  const destinations = ogCardDestinations(root, target)
  const src = join(root, SOURCE_REL)
  if (!existsSync(src)) {
    const err = new Error(`source missing: ${src}`)
    err.code = 'ENOENT'
    throw err
  }
  for (const dest of destinations) {
    await mkdir(dirname(dest), { recursive: true })
    await cp(src, dest)
  }
  return destinations
}

async function main() {
  if (process.argv.length > 3) {
    console.error('[sync-og-card] usage: node scripts/sync-docs-og-card.mjs [docs|testers]')
    process.exit(1)
  }
  const target = process.argv[2]
  let destinations
  try {
    destinations = await copyOgCard(ROOT, target)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('unknown og-card target')) {
      console.error(`[sync-og-card] ${err.message}`)
      process.exit(1)
    }
    throw err
  }
  const info = await stat(join(ROOT, SOURCE_REL))
  const where = target === 'docs' || target === 'testers' ? target : 'docs and testers'
  console.log(
    `[sync-og-card] copied og-card.png (${(info.size / 1024).toFixed(0)} KB) → ${where} public asset${destinations.length === 1 ? '' : 's'}`,
  )
}

function isEntryScript() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryScript()) {
  main().catch((err) => {
    console.error('[sync-og-card] failed:', err)
    process.exit(1)
  })
}
