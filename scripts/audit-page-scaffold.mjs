#!/usr/bin/env node
/**
 * FILE: scripts/audit-page-scaffold.mjs
 * PURPOSE: Re-runnable audit of admin operator page scaffolding drift.
 *
 * Scans apps/admin/src/pages/ for *Page.tsx files and reports per-page
 * deviations from the canonical scaffold
 * (apps/admin/src/components/ui/page-scaffold.ts):
 *   - legacy PageHeader import (not PageHeaderBar)
 *   - root not using PAGE_CONTENT_STACK
 *   - root className with padding / mx-auto / max-w (shell already pads)
 *   - PageHeaderBar missing helpTitle / helpWhatIsIt
 *   - arbitrary Tailwind value count (non-var)
 *   - hand-rolled card chrome count (rounded + border + bg-surface)
 *
 * Usage:
 *   node scripts/audit-page-scaffold.mjs
 *   node scripts/audit-page-scaffold.mjs --json > burndown.json
 *   node scripts/audit-page-scaffold.mjs --cluster   # Start-here 6 only
 *   node scripts/audit-page-scaffold.mjs --write     # write JSON under .playwright-mcp
 *
 * Exit 0 always (informational). Pipe --json into CI dashboards as needed.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGES_DIR = path.join(ROOT, 'apps/admin/src/pages')
const OUT_DIR = path.join(ROOT, 'apps/admin/.playwright-mcp')

const CLUSTER = new Set([
  'OverviewPage.tsx',
  'ActivityPage.tsx',
  'DashboardPage.tsx',
  'ConnectPage.tsx',
  'FeedbackPage.tsx',
  'FeatureBoardPage.tsx',
])

/** Auth / public / tester / util pages that intentionally skip the scaffold. */
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
const wantJson = args.has('--json')
const clusterOnly = args.has('--cluster')
const writeFileOut = args.has('--write')

async function collectPageFiles(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'tester') {
        // Tester portal uses its own shell — still list for completeness unless skipped.
        out.push(...(await collectPageFiles(full)))
      } else {
        out.push(...(await collectPageFiles(full)))
      }
    } else if (ent.isFile() && /Page\.tsx$/.test(ent.name)) {
      out.push(full)
    }
  }
  return out
}

function countMatches(text, re) {
  const m = text.match(re)
  return m ? m.length : 0
}

/**
 * Find the page body root className.
 * Prefer the div that wraps <PageHeaderBar> (canonical operator pages).
 * Fall back to PAGE_CONTENT_STACK usage or the first return root.
 */
function extractRootClass(text) {
  if (/\bclassName=\{PAGE_CONTENT_STACK\}/.test(text)) {
    return { rootClass: 'PAGE_CONTENT_STACK', usesStackToken: true, snippet: 'PAGE_CONTENT_STACK' }
  }

  // Div immediately wrapping PageHeaderBar — the page body root.
  const wrapHeader = text.match(
    /<(?:div|main|section)\s+([^>]*?)\s*>\s*\n?\s*<(?:PageHeaderBar)\b/,
  )
  if (wrapHeader) {
    const attrs = wrapHeader[1]
    const classMatch = attrs.match(
      /className=(?:\{PAGE_CONTENT_STACK\}|\{`([^`]+)`\}|\{"([^"]+)"\}|"([^"]+)"|'([^']+)'|\{'([^']+)'\})/,
    )
    if (classMatch) {
      if (attrs.includes('PAGE_CONTENT_STACK') || classMatch[0].includes('PAGE_CONTENT_STACK')) {
        return { rootClass: 'PAGE_CONTENT_STACK', usesStackToken: true, snippet: classMatch[0] }
      }
      const rootClass =
        classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? classMatch[4] ?? classMatch[5] ?? ''
      return {
        rootClass,
        usesStackToken: /\bPAGE_CONTENT_STACK\b/.test(rootClass),
        snippet: classMatch[0],
      }
    }
  }

  // Last `return (` in the file after export function — often the main render.
  const exportIdx = text.search(/export function \w+Page\b/)
  if (exportIdx < 0) return { rootClass: null, usesStackToken: false, snippet: '' }
  const body = text.slice(exportIdx)
  let lastReturn = -1
  const re = /\breturn\s*\(/g
  let m
  while ((m = re.exec(body)) !== null) lastReturn = m.index
  if (lastReturn < 0) return { rootClass: null, usesStackToken: false, snippet: '' }
  const slice = body.slice(lastReturn, lastReturn + 1200)
  const classMatch = slice.match(
    /<(?:div|main|section)\s+[^>]*className=(?:\{PAGE_CONTENT_STACK\}|\{`([^`]+)`\}|\{"([^"]+)"\}|"([^"]+)"|'([^']+)'|\{'([^']+)'\})/,
  )
  if (classMatch) {
    if (classMatch[0].includes('PAGE_CONTENT_STACK')) {
      return { rootClass: 'PAGE_CONTENT_STACK', usesStackToken: true, snippet: classMatch[0] }
    }
    const rootClass =
      classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? classMatch[4] ?? classMatch[5] ?? ''
    return { rootClass, usesStackToken: false, snippet: classMatch[0] }
  }
  return { rootClass: null, usesStackToken: false, snippet: '' }
}

function hasRootPaddingViolation(rootClass) {
  if (!rootClass || rootClass.startsWith('PAGE_CONTENT_STACK')) return false
  return /\b(?:p|px|py|pt|pb|pl|pr)-\S+|\bmx-auto\b|\bmax-w-\S+/.test(rootClass)
}

function auditFile(relPath, text, basename) {
  const skipped = SKIP.has(basename)
  const { rootClass, usesStackToken } = extractRootClass(text)

  const importsLegacyPageHeader =
    /\bPageHeader\b/.test(text) &&
    /import\s*\{[^}]*\bPageHeader\b[^}]*\}\s*from\s*['"][^'"]*components\/ui/.test(text) &&
    !/PageHeaderBar/.test(text.match(/import\s*\{[^}]*\bPageHeader\b[^}]*\}/)?.[0] ?? '')

  // More precise: named import of PageHeader that is not PageHeaderBar
  const legacyImport =
    /import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g
  let hasLegacyHeader = false
  let m
  while ((m = legacyImport.exec(text)) !== null) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim())
    if (names.includes('PageHeader') && !names.includes('PageHeaderBar')) {
      // Confirm it's the ui PageHeader, not a local alias
      if (/components\/ui|from ['"]\.\.\/components\/ui/.test(m[0]) || /\bPageHeader\b/.test(m[0])) {
        hasLegacyHeader = true
      }
    }
  }
  // Also catch: `import { PageHeader } from '../components/ui'` style already covered.
  // Catch direct: importing PageHeader from page-help
  if (/\bPageHeader\b/.test(text) && /from ['"].*page-help['"]/.test(text)) {
    hasLegacyHeader = true
  }
  // Final check — if file uses <PageHeader (not Bar) as JSX
  if (/<PageHeader[\s>]/.test(text) && !/<PageHeaderBar[\s>]/.test(text)) {
    hasLegacyHeader = true
  }
  // If it uses PageHeaderBar, clear false positive from PageHeader type mentions
  if (/<PageHeaderBar[\s>]/.test(text) && !/<PageHeader[\s>]/.test(text)) {
    hasLegacyHeader = false
  }

  const hasHeaderBar = /<PageHeaderBar[\s>]/.test(text)
  const hasHelpTitle = /\bhelpTitle=/.test(text)
  const hasHelpWhat = /\bhelpWhatIsIt=/.test(text)
  const missingHelp = hasHeaderBar && (!hasHelpTitle || !hasHelpWhat)

  const arbitraryCount = countMatches(
    text,
    /(?:^|[\s"'`])(?:(?:sm|md|lg|xl|2xl|max-[a-z]+):)*(?:w|h|min-w|min-h|max-w|max-h|text|bg|gap|p|px|py|pt|pb|m|mx|my|top|left|right|bottom|rounded|grid-cols)-\[(?!var\(--)[^\]]+\]/g,
  )

  const handRolledCardCount = countMatches(
    text,
    /(?:rounded(?:-[a-z0-9]+)?)\s+(?:[^\n"'`]{0,80}\s)?(?:border(?:-[a-z0-9/]+)?)(?:[^\n"'`]{0,80}\s)?(?:bg-surface-(?:overlay|raised))/g,
  )
  // Also count reverse order: bg-surface-* ... border ... rounded
  const handRolledAlt = countMatches(
    text,
    /bg-surface-(?:overlay|raised)[^\n"'`]{0,100}(?:border)[^\n"'`]{0,60}(?:rounded)/g,
  )

  const deviations = []
  if (!skipped) {
    if (hasLegacyHeader) deviations.push('legacy_PageHeader')
    if (!usesStackToken) deviations.push('missing_PAGE_CONTENT_STACK')
    if (hasRootPaddingViolation(rootClass)) deviations.push('root_padding_or_maxw')
    if (!hasHeaderBar) deviations.push('missing_PageHeaderBar')
    if (missingHelp) deviations.push('missing_help_props')
  }

  return {
    file: relPath.replace(/\\/g, '/'),
    basename,
    cluster: CLUSTER.has(basename),
    skipped,
    usesStackToken,
    rootClass: rootClass ?? '(unparsed)',
    hasLegacyHeader,
    hasHeaderBar,
    missingHelp,
    arbitraryCount,
    handRolledCardCount: Math.max(handRolledCardCount, handRolledAlt),
    deviations,
    ok: skipped || deviations.length === 0,
  }
}

async function main() {
  const files = await collectPageFiles(PAGES_DIR)
  const rows = []

  for (const full of files.sort()) {
    const basename = path.basename(full)
    if (clusterOnly && !CLUSTER.has(basename)) continue
    const text = await readFile(full, 'utf8')
    const rel = path.relative(ROOT, full)
    rows.push(auditFile(rel, text, basename))
  }

  const active = rows.filter((r) => !r.skipped)
  const failing = active.filter((r) => !r.ok)
  const summary = {
    scanned: rows.length,
    operatorPages: active.length,
    ok: active.filter((r) => r.ok).length,
    failing: failing.length,
    clusterFailing: failing.filter((r) => r.cluster).length,
    totals: {
      legacyHeader: active.filter((r) => r.hasLegacyHeader).length,
      missingStack: active.filter((r) => !r.usesStackToken).length,
      rootPadding: active.filter((r) => r.deviations.includes('root_padding_or_maxw')).length,
      missingHeaderBar: active.filter((r) => r.deviations.includes('missing_PageHeaderBar')).length,
      missingHelp: active.filter((r) => r.missingHelp).length,
      arbitraryValues: active.reduce((s, r) => s + r.arbitraryCount, 0),
      handRolledCards: active.reduce((s, r) => s + r.handRolledCardCount, 0),
    },
    generatedAt: new Date().toISOString(),
  }

  const payload = { summary, pages: rows }

  if (wantJson) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
  } else {
    console.log('admin page-scaffold audit')
    console.log('─'.repeat(72))
    console.log(
      `scanned=${summary.scanned} operator=${summary.operatorPages} ok=${summary.ok} failing=${summary.failing} clusterFailing=${summary.clusterFailing}`,
    )
    console.log(
      `legacyHeader=${summary.totals.legacyHeader} missingStack=${summary.totals.missingStack} rootPadding=${summary.totals.rootPadding} missingHeaderBar=${summary.totals.missingHeaderBar} missingHelp=${summary.totals.missingHelp}`,
    )
    console.log(
      `arbitraryValues=${summary.totals.arbitraryValues} handRolledCards=${summary.totals.handRolledCards}`,
    )
    console.log('─'.repeat(72))
    if (failing.length === 0) {
      console.log('All operator pages match the canonical scaffold (or are skipped).')
    } else {
      console.log('Deviations:')
      for (const r of failing) {
        const tag = r.cluster ? '[cluster]' : '         '
        console.log(`  ${tag} ${r.file}`)
        console.log(`           root=${r.rootClass}`)
        console.log(`           ${r.deviations.join(', ')}`)
      }
    }
  }

  if (writeFileOut) {
    await mkdir(OUT_DIR, { recursive: true })
    const outPath = path.join(OUT_DIR, 'page-scaffold-burndown.json')
    await writeFile(outPath, JSON.stringify(payload, null, 2))
    if (!wantJson) console.log(`\nwrote ${path.relative(ROOT, outPath)}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
