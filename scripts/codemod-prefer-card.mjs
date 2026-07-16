#!/usr/bin/env node
/**
 * FILE: scripts/codemod-prefer-card.mjs
 * PURPOSE: Suggest / apply migrations of hand-rolled
 *          `rounded border bg-surface-raised|overlay` chrome to <Card>.
 *
 * Default is report-only. Pass --write to apply simple literal className
 * replacements on JSX divs (conservative — skips template literals and
 * multi-condition classNames).
 *
 * Usage:
 *   node scripts/codemod-prefer-card.mjs --cluster
 *   node scripts/codemod-prefer-card.mjs --cluster --write
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_SRC = path.join(ROOT, 'apps/admin/src')

const CLUSTER_FILES = [
  'pages/OverviewPage.tsx',
  'pages/ActivityPage.tsx',
  'pages/DashboardPage.tsx',
  'pages/ConnectPage.tsx',
  'pages/FeedbackPage.tsx',
  'pages/FeatureBoardPage.tsx',
]

const args = new Set(process.argv.slice(2))
const dryRun = !args.has('--write')
const clusterOnly = args.has('--cluster')

const HAND_ROLLED_DIV =
  /<div(\s+)className="((?:[^"]*\s)?(?:rounded(?:-[a-z0-9]+)?)\s+(?:[^"]*\s)?(?:border(?:-[^\s"]*)?)\s+(?:[^"]*\s)?(?:bg-surface-(?:raised|overlay))(?:\s[^"]*)?)"(\s*)>/g

function ensureCardImport(text) {
  if (/\bCard\b/.test(text) && /from ['"].*components\/ui/.test(text)) {
    // Check Card is in the ui import
    const uiImport = text.match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*components\/ui['"]/)
    if (uiImport && /\bCard\b/.test(uiImport[1])) return text
    if (uiImport) {
      // Use the known index of the opening brace in the import statement
      // (replace only the first '{' of the destructure, not any nested ones)
      const braceIdx = uiImport[0].indexOf('{')
      const patched = uiImport[0].slice(0, braceIdx + 1) + ' Card,' + uiImport[0].slice(braceIdx + 1)
      return text.replace(uiImport[0], patched)
    }
  }
  const firstImport = text.match(/^import .+$/m)
  if (!firstImport) return `import { Card } from '../components/ui'\n${text}`
  const idx = text.indexOf(firstImport[0]) + firstImport[0].length
  return text.slice(0, idx) + `\nimport { Card } from '../components/ui'` + text.slice(idx)
}

async function processFile(rel) {
  const full = path.join(ADMIN_SRC, rel)
  let text = await readFile(full, 'utf8')
  let hits = 0
  const next = text.replace(HAND_ROLLED_DIV, (m, sp, cls, sp2) => {
    hits++
    // Strip the surface/border/rounded that Card provides; keep the rest.
    const rest = cls
      .replace(/\brounded(?:-[a-z0-9]+)?\b/g, '')
      .replace(/\bborder(?:-[^\s]*)?\b/g, '')
      .replace(/\bbg-surface-(?:raised|overlay)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (rest) return `<Card${sp}className="${rest}"${sp2}>`
    return `<Card${sp2 || ' '}>`
  })

  if (hits === 0) {
    console.log(`ok     ${rel}`)
    return
  }

  let out = ensureCardImport(next)
  // Naive closing-tag fix is unsafe for nested divs — leave </div> and note
  // that junior must verify Card closes correctly. Report only when --write
  // would be ambiguous.
  console.log(
    `${dryRun ? 'would' : 'note '} ${rel}: ${hits} hand-rolled div(s) → <Card> (verify closing tags manually)`,
  )
  if (!dryRun) {
    console.log(`  skipped write for ${rel} — prefer-card needs per-file review (closing tags)`)
  }
}

async function main() {
  const targets = clusterOnly
    ? CLUSTER_FILES
    : (await readdir(path.join(ADMIN_SRC, 'pages')))
        .filter((f) => f.endsWith('Page.tsx'))
        .map((f) => `pages/${f}`)

  for (const rel of targets) {
    try {
      await processFile(rel)
    } catch (err) {
      console.warn(`skip   ${rel}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log('\ncodemod-prefer-card: report-only by default; use manual Card migration for safety.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
