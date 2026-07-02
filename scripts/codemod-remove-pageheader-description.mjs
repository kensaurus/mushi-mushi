#!/usr/bin/env node
/**
 * Remove redundant description= from PageHeaderBar when helpWhatIsIt is registered.
 * Run after audit-admin-hint-duplication.mjs.
 *
 * Usage: node scripts/codemod-remove-pageheader-description.mjs [--write]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PAGES_DIR = resolve(__dirname, '../apps/admin/src/pages')
const write = process.argv.includes('--write')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith('Page.tsx')) out.push(p)
  }
  return out
}

function stripPageHeaderDescription(src) {
  if (!src.includes('PageHeaderBar')) return src
  const hasHelp = /\bhelpWhatIsIt=\{/.test(src) || /\bhelpWhatIsIt="/.test(src)
  if (!hasHelp) return src

  const marker = '<PageHeaderBar'
  let out = ''
  let i = 0
  while (i < src.length) {
    const start = src.indexOf(marker, i)
    if (start === -1) {
      out += src.slice(i)
      break
    }
    out += src.slice(i, start)
    const tagEnd = src.indexOf('>', start)
    if (tagEnd === -1) {
      out += src.slice(start)
      break
    }
    // Find matching close: </PageHeaderBar> or self-close
    const selfClose = src.indexOf('/>', start)
    const closeTag = src.indexOf('</PageHeaderBar>', start)
    let end
    if (selfClose !== -1 && (closeTag === -1 || selfClose < closeTag)) {
      end = selfClose + 2
    } else if (closeTag !== -1) {
      end = closeTag + '</PageHeaderBar>'.length
    } else {
      out += src.slice(start)
      break
    }

    let block = src.slice(start, end)
    block = block.replace(/\n[ \t]*description=\{[\s\S]*?\}\s*(?=\n)/g, '\n')
    block = block.replace(/\n[ \t]*description="[^"]*"\s*(?=\n)/g, '\n')
    out += block
    i = end
  }
  return out
}

let changed = 0
for (const file of walk(PAGES_DIR)) {
  const before = readFileSync(file, 'utf8')
  const after = stripPageHeaderDescription(before)
  if (after !== before) {
    changed++
    const rel = file.replace(resolve(__dirname, '..') + '/', '')
    if (write) {
      writeFileSync(file, after)
      console.log('updated', rel)
    } else {
      console.log('would update', rel)
    }
  }
}

if (!write) {
  console.log(`\n${changed} files would change — re-run with --write`)
} else {
  console.log(`\n${changed} files updated`)
}
