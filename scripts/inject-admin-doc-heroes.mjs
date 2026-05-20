#!/usr/bin/env node
/**
 * Injects <AdminDocHero page="…" /> after the frontmatter of every admin/*.mdx
 * page that doesn't already have one.
 *
 * Usage: node scripts/inject-admin-doc-heroes.mjs
 *        node scripts/inject-admin-doc-heroes.mjs --dry
 */

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_DIR = join(ROOT, 'apps/docs/content/admin')
const dry = process.argv.includes('--dry')

function slugFromFilename(name) {
  return name.replace(/\.mdx$/, '')
}

function injectHero(content, slug) {
  if (content.includes('<AdminDocHero')) return { changed: false, content }

  const fmEnd = content.indexOf('---', 3)
  if (fmEnd === -1) return { changed: false, content }

  const afterFm = content.slice(fmEnd + 3)
  const heroLine = `\n<AdminDocHero page="${slug}" />\n`

  // Place hero after any import block that immediately follows frontmatter.
  const importMatch = afterFm.match(/^(\s*\n(?:import[^\n]+\n)+)/)
  if (importMatch) {
    const insertAt = fmEnd + 3 + importMatch[0].length
    return {
      changed: true,
      content: content.slice(0, insertAt) + heroLine + content.slice(insertAt),
    }
  }

  return {
    changed: true,
    content: content.slice(0, fmEnd + 3) + heroLine + content.slice(fmEnd + 3),
  }
}

async function main() {
  const files = (await readdir(ADMIN_DIR)).filter((f) => f.endsWith('.mdx'))
  let updated = 0

  for (const file of files) {
    const path = join(ADMIN_DIR, file)
    const slug = slugFromFilename(file)
    const raw = await readFile(path, 'utf8')
    const { changed, content } = injectHero(raw, slug)
    if (!changed) continue
    if (dry) {
      console.log(`[dry] would inject AdminDocHero page="${slug}" → ${file}`)
    } else {
      await writeFile(path, content, 'utf8')
      console.log(`[inject] ${file}`)
    }
    updated += 1
  }

  console.log(`[inject-admin-doc-heroes] ${dry ? 'would update' : 'updated'} ${updated} files`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
