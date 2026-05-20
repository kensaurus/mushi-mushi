#!/usr/bin/env node
/**
 * Moves <AdminDocHero /> from above the H1 to after the page intro
 * (immediately before the first --- horizontal rule following the title).
 *
 * Usage: node scripts/relocate-admin-doc-heroes.mjs
 */

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_DIR = join(ROOT, 'apps/docs/content/admin')

const HERO_RE = /\n<AdminDocHero[^>]*\/>\n/

function findIntroBreak(body) {
  const hr = body.match(/\n---\n/)
  if (hr?.index !== undefined) return hr.index

  const list = body.match(/\n\n(?=[-*] )/)
  if (list?.index !== undefined) return list.index

  const h2 = body.match(/\n## /)
  if (h2?.index !== undefined) return h2.index

  return body.length
}

function relocate(content) {
  const heroMatch = content.match(HERO_RE)
  if (!heroMatch) return { changed: false, content }

  const heroLine = heroMatch[0].trim()
  const withoutHero = content.replace(HERO_RE, '\n')

  const h1Match = withoutHero.match(/^# .+\n/m)
  if (!h1Match || h1Match.index === undefined) {
    return { changed: false, content }
  }

  const bodyStart = h1Match.index + h1Match[0].length
  const body = withoutHero.slice(bodyStart)
  const breakAt = findIntroBreak(body)
  const insertAt = bodyStart + breakAt

  const next = `${withoutHero.slice(0, insertAt).trimEnd()}\n\n${heroLine}\n${withoutHero.slice(insertAt)}`
  return { changed: true, content: next }
}

async function main() {
  const files = (await readdir(ADMIN_DIR)).filter((f) => f.endsWith('.mdx'))
  let updated = 0

  for (const file of files) {
    const path = join(ADMIN_DIR, file)
    const raw = await readFile(path, 'utf8')
    const { changed, content } = relocate(raw)
    if (!changed) continue
    await writeFile(path, content, 'utf8')
    console.log(`[relocate] ${file}`)
    updated += 1
  }

  console.log(`[relocate-admin-doc-heroes] updated ${updated} files`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
