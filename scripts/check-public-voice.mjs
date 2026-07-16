#!/usr/bin/env node
/**
 * check-public-voice.mjs
 *
 * Visitor + conversion-path voice guard: banned corporate vocabulary,
 * v2 hero fragments, stale tagline, llms.txt freshness.
 *
 * Run: node scripts/check-public-voice.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dir, '..')

/** Case-insensitive banned phrases from docs/marketing/VOICE.md */
const BANNED = [
  'empower',
  'unlock',
  'seamless',
  'elevate',
  'leverage',
  'revolutionize',
  'best-in-class',
  'next generation',
  'game changer',
  'game-changer',
  'disrupt',
  'synergy',
  'delightful user experience',
  "we're excited to announce",
  'we are excited to announce',
  'book a demo',
  'institutional memory',
  'operator-grade',
]

const STALE_TAGLINE = 'bug translation for vibe coders'

const LANDING_PATHS = [
  'apps/docs/content/index.mdx',
  'apps/docs/lib/landing-copy.ts',
  'apps/docs/lib/structured-data.ts',
  'apps/docs/components/landing/LandingFaq.tsx',
  'apps/docs/components/Pillars.tsx',
  'apps/docs/components/WhereToStartGrid.tsx',
  'apps/docs/components/QuickstartGrid.tsx',
  'apps/docs/components/DocsMediaShowcase.tsx',
  'apps/docs/components/OssTrustStrip.tsx',
  'apps/docs/components/ComparisonTable.tsx',
  'apps/docs/app/connect/page.tsx',
  'packages/marketing-ui/src/Hero.tsx',
]

const PUBLIC_PATHS = [
  'apps/docs/lib/public-copy.ts',
  'apps/docs/components/TroubleshootingAccordion.tsx',
  'apps/docs/content/pricing.mdx',
  'apps/docs/content/cloud.mdx',
  'apps/docs/content/concepts/index.mdx',
  'apps/docs/content/quickstart/index.mdx',
  'apps/docs/content/quickstart/incident-loop.mdx',
  'apps/docs/content/quickstart/mcp.mdx',
  'apps/docs/content/integrations/cursor.mdx',
  'apps/docs/content/use-cases/index.mdx',
  'apps/docs/content/use-cases/sentry-alternative.mdx',
  'apps/docs/content/use-cases/debug-cursor-apps.mdx',
  'apps/docs/content/use-cases/debug-claude-code-apps.mdx',
  'apps/docs/content/use-cases/ai-code-bug-fixing.mdx',
  'apps/docs/content/use-cases/mcp-bug-fixing-server.mdx',
  'apps/docs/content/admin/index.mdx',
  'apps/docs/content/admin/onboarding.mdx',
  'apps/docs/content/admin/connect.mdx',
  'apps/docs/content/admin/projects.mdx',
  'apps/docs/content/admin/reports.mdx',
  'apps/docs/content/admin/dashboard.mdx',
  'apps/docs/content/admin/fixes.mdx',
  'apps/docs/content/admin/integrations.mdx',
  'apps/docs/content/admin/inbox.mdx',
  'apps/docs/content/admin/billing.mdx',
  'apps/docs/content/admin/settings.mdx',
  'apps/docs/content/admin/qa-coverage.mdx',
  'apps/docs/content/admin/mcp.mdx',
  'apps/docs/content/admin/judge.mdx',
  'apps/docs/content/admin/anomalies.mdx',
  'apps/docs/content/admin/anti-gaming.mdx',
  'apps/docs/content/admin/audit.mdx',
  'apps/docs/content/admin/code-health.mdx',
  'apps/docs/content/admin/compliance.mdx',
  'apps/docs/content/admin/cost.mdx',
  'apps/docs/content/admin/docs-bridge.mdx',
  'apps/docs/content/admin/drift.mdx',
  'apps/docs/content/admin/experiments.mdx',
  'apps/docs/content/admin/explore.mdx',
  'apps/docs/content/admin/fine-tuning.mdx',
  'apps/docs/content/admin/fullstack-audit.mdx',
  'apps/docs/content/admin/graph.mdx',
  'apps/docs/content/admin/health.mdx',
  'apps/docs/content/admin/intelligence.mdx',
  'apps/docs/content/admin/inventory.mdx',
  'apps/docs/content/admin/iterate.mdx',
  'apps/docs/content/admin/lessons.mdx',
  'apps/docs/content/admin/marketplace.mdx',
  'apps/docs/content/admin/notifications.mdx',
  'apps/docs/content/admin/prompt-lab.mdx',
  'apps/docs/content/admin/query.mdx',
  'apps/docs/content/admin/queue.mdx',
  'apps/docs/content/admin/realtime.mdx',
  'apps/docs/content/admin/releases.mdx',
  'apps/docs/content/admin/repo.mdx',
  'apps/docs/content/admin/research.mdx',
  'apps/docs/content/admin/rewards.mdx',
  'apps/docs/content/admin/sdk-health.mdx',
  'apps/docs/content/admin/skill-pipelines.mdx',
  'apps/docs/content/admin/sso.mdx',
  'apps/docs/content/admin/storage.mdx',
  'apps/docs/content/admin/teams.mdx',
  'apps/docs/content/admin/users.mdx',
  'packages/marketing-ui/src/canvas/data.ts',
  'packages/marketing-ui/src/PersonaTrack.tsx',
  'packages/marketing-ui/src/PrivacyPosture.tsx',
  'packages/marketing-ui/src/ClosingCta.tsx',
  'apps/admin/src/lib/public-copy-shared.ts',
  'apps/admin/src/pages/LoginPage.tsx',
  'apps/admin/src/components/connect/ConnectStudio.tsx',
]

const ADMIN_COPY_PATHS = [
  'apps/admin/src/lib/copy.ts',
  'apps/admin/src/lib/configDocs.ts',
]

const ALL_SCAN_PATHS = [...LANDING_PATHS, ...PUBLIC_PATHS, ...ADMIN_COPY_PATHS, 'README.md']

const BEGINNER_JARGON = /\b(triage|pdca|orchestrat)\b/i
const BEGINNER_FIRST_SENTENCE_JARGON = /\b(triage|pdca|orchestrat|ingest|pipeline)\b/i

const MCP_CATALOG_BANNED = ['triage queue', 'fix orchestrator']

const ADMIN_UX_BANNED = ['triage queue', 'fix orchestrator', 'AI triage', 'agentic fix orchestrator']

const STAT_TOOLTIP_JARGON = ['Triage queue', 'PDCA loop', 'fix orchestrator']

const failures = []

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8')
  } catch {
    failures.push(`MISSING FILE  ${rel}`)
    return null
  }
}

for (const rel of ALL_SCAN_PATHS) {
  const content = read(rel)
  if (content === null) continue
  const lower = content.toLowerCase()
  for (const phrase of BANNED) {
    if (lower.includes(phrase.toLowerCase())) {
      failures.push(`${rel}\n      banned phrase: "${phrase}"`)
    }
  }
}

/** Stale v1 tagline — allowed only in comparison/legacy contexts */
for (const rel of ALL_SCAN_PATHS) {
  const content = read(rel)
  if (content === null) continue
  const lower = content.toLowerCase()
  if (!lower.includes(STALE_TAGLINE)) continue
  const legacyOk =
    lower.includes('comparison') ||
    lower.includes('v1 tagline') ||
    lower.includes('legacy') ||
    rel.includes('ComparisonTable')
  if (!legacyOk) {
    failures.push(`${rel}\n      stale tagline: "${STALE_TAGLINE}"`)
  }
}

const indexMdx = read('apps/docs/content/index.mdx')
if (
  indexMdx !== null &&
  !(indexMdx.includes('Your AI wrote it') && indexMdx.includes('why it broke'))
) {
  failures.push(
    'apps/docs/content/index.mdx\n      missing v2 hero H1 fragments:\n      "Your AI wrote it" + "why it broke"',
  )
}

const loginPage = read('apps/admin/src/pages/LoginPage.tsx')
if (loginPage !== null && !loginPage.includes('LOGIN_HERO')) {
  failures.push('apps/admin/src/pages/LoginPage.tsx\n      missing LOGIN_HERO import/usage')
}

const llmsGen = join(ROOT, 'scripts/gen-llms-txt.mjs')
if (existsSync(llmsGen)) {
  const check = spawnSync(process.execPath, [llmsGen, '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (check.status !== 0) {
    failures.push(
      'apps/docs/public/llms.txt\n      out of date — run pnpm gen:llms-txt\n      ' +
        (check.stderr || check.stdout || '').trim(),
    )
  }
} else {
  failures.push('scripts/gen-llms-txt.mjs\n      missing llms generator')
}

/** PRICING_TIERS SSOT — both plan pages must import shared tier data */
const pricingMdx = read('apps/docs/content/pricing.mdx')
const cloudMdx = read('apps/docs/content/cloud.mdx')
const publicCopy = read('apps/docs/lib/public-copy.ts')
if (publicCopy !== null && !publicCopy.includes('export const PRICING_TIERS')) {
  failures.push('apps/docs/lib/public-copy.ts\n      missing export const PRICING_TIERS')
}
if (pricingMdx !== null && !pricingMdx.includes('PricingTiersTable')) {
  failures.push('apps/docs/content/pricing.mdx\n      must render <PricingTiersTable /> from PRICING_TIERS SSOT')
}
if (cloudMdx !== null && !cloudMdx.includes('CloudPlansTable')) {
  failures.push('apps/docs/content/cloud.mdx\n      must render <CloudPlansTable /> from PRICING_TIERS SSOT')
}
if (
  pricingMdx !== null &&
  cloudMdx !== null &&
  (pricingMdx.toLowerCase().includes('ai triage') || cloudMdx.toLowerCase().includes('ai triage'))
) {
  failures.push('pricing.mdx / cloud.mdx\n      stale "AI triage" in plan rows — use plain-English reads from PRICING_TIERS')
}

/** Beginner copy.ts — no triage/PDCA/orchestrat in description or whatIsIt */
const copyTs = read('apps/admin/src/lib/copy.ts')
if (copyTs !== null) {
  const beginnerStart = copyTs.indexOf('beginner: {')
  const advancedStart = copyTs.indexOf('advanced: {', beginnerStart)
  if (beginnerStart >= 0 && advancedStart > beginnerStart) {
    const beginnerBlock = copyTs.slice(beginnerStart, advancedStart)
    const fieldRe = /(?:description|whatIsIt):\s*[\n\s]*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|\n\s*'([^']*))/gi
    let match
    while ((match = fieldRe.exec(beginnerBlock)) !== null) {
      const text = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
      const firstSentence = text.split(/[.!?]/)[0] ?? text
      if (BEGINNER_JARGON.test(text)) {
        failures.push(
          `apps/admin/src/lib/copy.ts (beginner block)\n      jargon in description/whatIsIt: "${text.slice(0, 80)}…"`,
        )
        break
      }
      if (BEGINNER_FIRST_SENTENCE_JARGON.test(firstSentence)) {
        failures.push(
          `apps/admin/src/lib/copy.ts (beginner block)\n      ingest/pipeline in first sentence: "${firstSentence.slice(0, 80)}…"`,
        )
        break
      }
    }
  }
}

/** MCP catalog — banned phrases in tool descriptions */
const mcpCatalog = read('packages/mcp/src/catalog.ts')
if (mcpCatalog !== null) {
  const lower = mcpCatalog.toLowerCase()
  for (const phrase of MCP_CATALOG_BANNED) {
    if (lower.includes(phrase)) {
      failures.push(`packages/mcp/src/catalog.ts\n      banned MCP description phrase: "${phrase}"`)
    }
  }
}

/** Generated MCP doc must match built catalog (no stale jargon) */
const mcpGen = read('apps/docs/content/sdks/mcp-tools.generated.mdx')
if (mcpGen !== null) {
  const lower = mcpGen.toLowerCase()
  for (const phrase of MCP_CATALOG_BANNED) {
    if (lower.includes(phrase)) {
      failures.push(
        `apps/docs/content/sdks/mcp-tools.generated.mdx\n      stale phrase "${phrase}" — run pnpm --filter @mushi-mushi/mcp build && pnpm gen:mcp-tools-doc`,
      )
    }
  }
}

/** Admin live UX — banned phrases in user-visible TSX (skip file-header comments) */
function stripTsxComments(src) {
  return src
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

function scanAdminUxDir(relDir) {
  const abs = join(ROOT, relDir)
  if (!existsSync(abs)) return
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`
    if (entry.isDirectory()) {
      scanAdminUxDir(rel)
      continue
    }
    if (!entry.name.endsWith('.tsx')) continue
    const raw = read(rel)
    if (raw === null) continue
    const body = stripTsxComments(raw)
    for (const line of body.split('\n')) {
      const lower = line.toLowerCase()
      for (const phrase of ADMIN_UX_BANNED) {
        if (!lower.includes(phrase.toLowerCase())) continue
        if (
          /isAdvanced\s*\?/.test(line) ||
          /plainLanguage/.test(line) ||
          /plainBanner/.test(line) ||
          /plainStageLabels/.test(line)
        ) {
          continue
        }
        failures.push(`${rel}\n      banned admin UX phrase: "${phrase}"`)
        break
      }
    }
  }
}

scanAdminUxDir('apps/admin/src/pages')
scanAdminUxDir('apps/admin/src/components')

/** statTooltips — beginner-visible jargon without plain-language gate */
const statDir = join(ROOT, 'apps/admin/src/lib/statTooltips')
if (existsSync(statDir)) {
  for (const file of readdirSync(statDir).filter((f) => f.endsWith('.ts'))) {
    const rel = `apps/admin/src/lib/statTooltips/${file}`
    const content = read(rel)
    if (content === null) continue
    const hasGate =
      content.includes('plainStageLabels') ||
      content.includes('plainLanguage') ||
      content.includes('PlainStatTooltipOpts')
    for (const phrase of STAT_TOOLTIP_JARGON) {
      if (content.includes(phrase) && !hasGate) {
        failures.push(`${rel}\n      "${phrase}" without plainStageLabels/plainLanguage gate`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Public voice check failed:\n')
  for (const f of failures) {
    console.error('  ' + f.replace(/\n/g, '\n  '))
    console.error()
  }
  process.exit(1)
}

console.log(
  `Public voice OK (${ALL_SCAN_PATHS.length} surfaces, ${BANNED.length} banned phrases, llms.txt fresh).`,
)
