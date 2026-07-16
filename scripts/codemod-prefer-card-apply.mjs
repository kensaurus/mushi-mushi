#!/usr/bin/env node
/**
 * Prefer-card drain: rewrite hand-rolled card-chrome <div>s to <Card>.
 * Only transforms opening tags that match HAND_ROLLED + card padding.
 * Adds Card import when missing. Does NOT rewrite closing tags beyond
 * tracking depth for simple single-level replacements.
 *
 * DANGER: Earlier runs corrupted template literals / mismatched JSX closings /
 * duplicate Card imports. Do NOT re-run against a clean tree unless you have
 * a fresh prefer-card-hits.txt and pass --force. Prefer manual Card edits.
 *
 * Usage: node scripts/codemod-prefer-card-apply.mjs --force [--dry-run] [--limit=N]
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HIT_FILE = path.join(ROOT, 'apps/admin/.playwright-mcp/prefer-card-hits.txt')
const dry = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity

if (!force && !dry) {
  console.error(
    'Refusing to run: pass --force (or --dry-run). This codemod previously broke JSX/imports.',
  )
  process.exit(1)
}

const HAND_ROLLED =
  /(?:^|[\s])(?:rounded(?:-\S+)?)\b[\s\S]{0,80}\bborder(?:-\S+)?\b[\s\S]{0,80}\bbg-surface-(?:raised|overlay)\b|(?:^|[\s])bg-surface-(?:raised|overlay)\b[\s\S]{0,100}\bborder(?:-\S+)?\b[\s\S]{0,60}\brounded(?:-\S+)?\b/
const CARD_PADDING = /\b(?:p|px|py)-(?:3|4|5|6|8)\b/

function ensureCardImport(text) {
  if (/\bCard\b/.test(text) && /from ['"].*components\/ui/.test(text)) {
    // Try to add Card to existing ui import
    const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]*components\/ui[^'"]*)['"]/
    const m = text.match(re)
    if (m && !/\bCard\b/.test(m[1])) {
      return text.replace(re, (_a, names, from) => {
        const next = `${names.trim()}${names.trim().endsWith(',') ? '' : ','} Card`
        return `import { ${next} } from '${from}'`
      })
    }
    if (/\bCard\b/.test(text)) return text
  }
  if (/from ['"]\.\.\/components\/ui['"]/.test(text) || /from ['"]\.\.\/\.\.\/components\/ui['"]/.test(text)) {
    return text.replace(
      /import\s*\{([^}]*)\}\s*from\s*(['"][^'"]*components\/ui[^'"]*['"])/,
      (full, names, from) => {
        if (/\bCard\b/.test(names)) return full
        return `import { ${names.trim()}${names.trim() ? ', ' : ''}Card } from ${from}`
      },
    )
  }
  // Insert after first import
  const m = text.match(/^import .+$/m)
  if (!m) return `import { Card } from '../components/ui'\n${text}`
  const idx = text.indexOf(m[0]) + m[0].length
  // Guess relative path depth from file later — default ../components/ui for pages
  return text.slice(0, idx) + `\nimport { Card } from '../components/ui'` + text.slice(idx)
}

function stripChrome(cls) {
  return cls
    .replace(/\bbg-surface-(?:raised|overlay)\S*/g, '')
    .replace(/\bborder(?:-\S+)?/g, '')
    .replace(/\brounded(?:-\S+)?/g, '')
    .replace(/\bshadow-(?:card|raised|md|sm|lg)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function transformFile(text, fileRel) {
  // Only transform <div ... className="..."> openings that look like cards
  const re =
    /<(div)(\s+)([^>]*?)className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})([^>]*)>/g
  let changed = 0
  const next = text.replace(re, (full, tag, sp, before, c1, c2, c3, after) => {
    const cls = c1 ?? c2 ?? c3 ?? ''
    if (!HAND_ROLLED.test(cls)) return full
    if (!CARD_PADDING.test(cls)) return full
    if (/\brounded-full\b/.test(cls)) return full
    if (/\bplaceholder:/.test(cls)) return full
    const rest = stripChrome(cls)
    changed++
    const classAttr = rest ? ` className="${rest}"` : ''
    return `<Card${sp}${before.trim() ? before : ''}${classAttr}${after}>`.replace(
      /\s+>/,
      '>',
    )
  })
  if (!changed) return { text, changed: 0 }
  // Closing tags: naive — replace same number of </div> that we can't safely do globally.
  // Leave </div>; React/JSX doesn't care about Card vs div closing mismatch for HTML validity
  // but JSX requires matching component names. So we MUST fix closings.
  // Strategy: only transform when the opening and its matching close are unambiguous
  // (same-line or simple). For multi-line, convert both via stack scan.
  return transformWithStack(text, fileRel)
}

function transformWithStack(text, fileRel) {
  const lines = text.split('\n')
  const out = [...lines]
  let changed = 0
  // Find div openings with card chrome; track with a simple depth walker from that line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const openRe =
      /<div(\s+)([^>]*?)className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})([^>]*)>/
    const m = line.match(openRe)
    if (!m) continue
    const cls = m[3] ?? m[4] ?? m[5] ?? ''
    if (!HAND_ROLLED.test(cls) || !CARD_PADDING.test(cls)) continue
    if (/\brounded-full\b/.test(cls) || /\bplaceholder:/.test(cls)) continue
    if (line.includes('</div>') && (line.match(/<div\b/g) || []).length === 1) {
      // same-line
      const rest = stripChrome(cls)
      const classAttr = rest ? ` className="${rest}"` : ''
      out[i] = line
        .replace(openRe, `<Card$1$2${classAttr}$6>`.replace(/\s+>/, '>'))
        .replace(/<\/div>/, '</Card>')
      changed++
      continue
    }
    // Multi-line: find matching close
    let depth = 0
    let closeIdx = -1
    for (let j = i; j < lines.length; j++) {
      const opens = (lines[j].match(/<div\b/g) || []).length
      const closes = (lines[j].match(/<\/div>/g) || []).length
      // Also count self-closing? skip
      if (j === i) depth += opens - closes
      else depth += opens - closes
      if (depth === 0) {
        closeIdx = j
        break
      }
    }
    if (closeIdx < 0) continue
    const rest = stripChrome(cls)
    const classAttr = rest ? ` className="${rest}"` : ''
    out[i] = line.replace(openRe, `<Card$1$2${classAttr}$6>`.replace(/\s+>/, '>'))
    // Replace the LAST </div> on closeIdx line
    const ci = out[closeIdx]
    const last = ci.lastIndexOf('</div>')
    if (last >= 0) {
      out[closeIdx] = ci.slice(0, last) + '</Card>' + ci.slice(last + 6)
      changed++
    }
  }
  let next = out.join('\n')
  if (changed) {
    // Fix import path depth
    const depth = (fileRel.match(/\//g) || []).length
    // fileRel like apps/admin/src/pages/X or apps/admin/src/components/foo/X
    const fromSrc = fileRel.replace(/^apps\/admin\/src\//, '')
    const ups = fromSrc.split('/').length - 1
    const relImport = `${'../'.repeat(ups)}components/ui`
    if (!/\bCard\b/.test(next.split('\n').slice(0, 40).join('\n')) || !/from ['"].*components\/ui/.test(next)) {
      next = ensureCardImportWithPath(next, relImport)
    } else {
      next = ensureCardImportWithPath(next, relImport)
    }
  }
  return { text: next, changed }
}

function ensureCardImportWithPath(text, relImport) {
  const re = /import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]*components\/ui[^'"]*)\2/
  if (re.test(text)) {
    return text.replace(re, (full, names, q, from) => {
      if (/\bCard\b/.test(names)) return full
      const trimmed = names.trim()
      return `import { ${trimmed}${trimmed ? ', ' : ''}Card } from ${q}${from}${q}`
    })
  }
  const m = text.match(/^import .+$/m)
  const line = `import { Card } from '${relImport}'`
  if (!m) return `${line}\n${text}`
  const idx = text.indexOf(m[0]) + m[0].length
  return text.slice(0, idx) + `\n${line}` + text.slice(idx)
}

const hits = (await readFile(HIT_FILE, 'utf8'))
  .split(/\n/)
  .map((l) => l.trim())
  .filter(Boolean)

const byFile = new Map()
for (const hit of hits) {
  const [file] = hit.split(':')
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(hit)
}

let filesChanged = 0
let total = 0
let n = 0
for (const [file, fileHits] of byFile) {
  if (n >= limit) break
  n++
  const abs = path.join(ROOT, 'apps/admin', file)
  let text
  try {
    text = await readFile(abs, 'utf8')
  } catch {
    console.log(`skip missing ${file}`)
    continue
  }
  const { text: next, changed } = transformWithStack(text, `apps/admin/${file}`)
  if (!changed) {
    console.log(`no-op ${file} (${fileHits.length} hits)`)
    continue
  }
  filesChanged++
  total += changed
  if (dry) console.log(`would ${file}: ${changed}`)
  else {
    await writeFile(abs, next, 'utf8')
    console.log(`fixed ${file}: ${changed}`)
  }
}
console.log(`\ncodemod-prefer-card-apply: ${total} in ${filesChanged} files${dry ? ' (dry-run)' : ''}`)
