#!/usr/bin/env node
/**
 * FILE: scripts/codemod-page-root-stack.mjs
 * PURPOSE: Rewrite operator page roots from space-y-N / p-6 flex stacks to
 *          PAGE_CONTENT_STACK (canonical scaffold).
 *
 * Usage:
 *   node scripts/codemod-page-root-stack.mjs --dry-run
 *   node scripts/codemod-page-root-stack.mjs --cluster
 *   node scripts/codemod-page-root-stack.mjs            # all operator pages
 *
 * Value-for-value: only rewrites the page-body root that wraps <PageHeaderBar>.
 * Does not touch nested space-y-* layouts. Adds PAGE_CONTENT_STACK import when
 * missing. Skips auth/public/tester pages.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGES_DIR = path.join(ROOT, 'apps/admin/src/pages')

const CLUSTER = new Set([
  'OverviewPage.tsx',
  'ActivityPage.tsx',
  'DashboardPage.tsx',
  'ConnectPage.tsx',
  'FeedbackPage.tsx',
  'FeatureBoardPage.tsx',
])

const SKIP = new Set([
  'AcceptInvitePage.tsx',
  'CliAuthPage.tsx',
  'ContentQualityDetailPage.tsx',
  'ContentQualityPage.tsx',
  'DocsBridgePage.tsx',
  'IntegrationsRouteGate.tsx',
  'LoginPage.tsx',
  'McpAuthPage.tsx',
  'PublicHomePage.tsx',
  'PublicIntegrationsPage.tsx',
  'ReportDetailPage.tsx',
  'ResetPasswordPage.tsx',
  'SetupGatePage.tsx',
  'TesterSubmissionsReviewPage.tsx',
  'TesterAppsPage.tsx',
  'TesterHomePage.tsx',
  'TesterLearnPage.tsx',
  'TesterSettingsPage.tsx',
  'TesterSubmissionsPage.tsx',
  'TesterWalletPage.tsx',
])

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const clusterOnly = args.has('--cluster')

async function collectPageFiles(dir) {
  const out = []
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...(await collectPageFiles(full)))
    else if (ent.isFile() && /Page\.tsx$/.test(ent.name)) out.push(full)
  }
  return out
}

function slugFromBasename(basename) {
  return basename
    .replace(/Page\.tsx$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

function ensureImport(text) {
  if (/\bPAGE_CONTENT_STACK\b/.test(text) && /from ['"].*pageLayout['"]/.test(text)) {
    return text
  }
  if (/from ['"]\.\.\/lib\/pageLayout['"]/.test(text)) {
    return text.replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/lib\/pageLayout['"]/,
      (m, names) => {
        if (/\bPAGE_CONTENT_STACK\b/.test(names)) return m
        return `import { PAGE_CONTENT_STACK, ${names.trim()} } from '../lib/pageLayout'`
      },
    )
  }
  // Insert after first import block line that imports from components or lib
  const insertAfter = text.match(/^import .+$/m)
  if (!insertAfter) {
    return `import { PAGE_CONTENT_STACK } from '../lib/pageLayout'\n${text}`
  }
  const idx = text.indexOf(insertAfter[0]) + insertAfter[0].length
  return (
    text.slice(0, idx) +
    `\nimport { PAGE_CONTENT_STACK } from '../lib/pageLayout'` +
    text.slice(idx)
  )
}

/**
 * Replace the className on the div that wraps PageHeaderBar.
 */
function rewriteRoot(text, basename) {
  const slug = slugFromBasename(basename)
  const re =
    /<(div|main|section)(\s+)([^>]*?)className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})([^>]*)>(\s*)<(PageHeaderBar)\b/

  if (!re.test(text)) {
    // Already using PAGE_CONTENT_STACK?
    if (/className=\{PAGE_CONTENT_STACK\}/.test(text)) {
      return { text, changed: false, reason: 'already_stack' }
    }
    return { text, changed: false, reason: 'no_match' }
  }

  const next = text.replace(re, (_m, tag, sp1, before, c1, c2, c3, after, ws, header) => {
    const oldClass = c1 ?? c2 ?? c3 ?? ''
    // Preserve data-testid if already in attrs; otherwise add one.
    let attrsBefore = before
    let attrsAfter = after
    const hasTestId = /data-testid=/.test(before + after)
    const testIdAttr = hasTestId ? '' : ` data-testid="mushi-page-${slug}"`
    return `<${tag}${sp1}${attrsBefore}className={PAGE_CONTENT_STACK}${testIdAttr}${attrsAfter}>${ws}<${header}`
  })

  return { text: next, changed: next !== text, reason: next !== text ? 'rewrote' : 'noop' }
}

async function main() {
  const files = await collectPageFiles(PAGES_DIR)
  let changedCount = 0
  let skippedCount = 0

  for (const full of files.sort()) {
    const basename = path.basename(full)
    if (SKIP.has(basename)) {
      skippedCount++
      continue
    }
    if (clusterOnly && !CLUSTER.has(basename)) continue

    let text = await readFile(full, 'utf8')
    if (/className=\{PAGE_CONTENT_STACK\}/.test(text)) {
      console.log(`ok     ${path.relative(ROOT, full)}`)
      continue
    }

    const result = rewriteRoot(text, basename)
    if (!result.changed) {
      console.log(`skip   ${path.relative(ROOT, full)} (${result.reason})`)
      continue
    }

    let next = ensureImport(result.text)
    changedCount++
    console.log(`${dryRun ? 'would' : 'fixed'} ${path.relative(ROOT, full)}`)
    if (!dryRun) await writeFile(full, next)
  }

  console.log(
    `\ncodemod-page-root-stack: ${changedCount} ${dryRun ? 'would change' : 'changed'}, ${skippedCount} skipped`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
