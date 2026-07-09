#!/usr/bin/env node
/**
 * Fail CI when onboarding docs contain known-phantom patterns.
 *
 *   pnpm check:onboarding-drift
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const SCAN_PATHS = [
  'apps/docs/content',
  'docs/quickstart-0-to-first-fix.md',
  'docs/strategy',
  'docs/dogfood.md',
  'docs/operators',
  'docs/DEPLOYMENT.md',
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
  'packages/cli/README.md',
  'packages/mcp/README.md',
  'skills',
  '.cursor/skills',
]

const EXT = new Set(['.md', '.mdx'])

const SKIP_PATH_RE = /CHANGELOG\.md$|docs\/audit-|docs\/archive\//

const RULES = [
  {
    id: 'mushi_mcp_env',
    pattern: /MUSHI_MCP_(PROJECT_ID|API_KEY)/,
    message: 'Use MUSHI_PROJECT_ID / MUSHI_API_KEY — not MUSHI_MCP_*',
  },
  {
    id: 'mushi_list_tools',
    pattern: /mushi_list_reports|mushi_get_report|mushi_dispatch_fix/,
    message: 'Stale MCP tool names — use get_recent_reports, get_report_detail, dispatch_fix',
  },
  {
    id: 'mcp_project_id_flag',
    pattern: /@mushi-mushi\/mcp.*--project-id/,
    message: 'No --project-id flag on @mushi-mushi/mcp — use MUSHI_PROJECT_ID env',
  },
  {
    id: 'bare_mushirc',
    pattern: /~\/\.mushirc/,
    exception: /auto-migrat|legacy|XDG|~\/\.config\/mushi/,
    message:
      'Bare ~/.mushirc without XDG note — prefer ~/.config/mushi/config.json (legacy auto-migrated)',
  },
  {
    id: 'vite_api_base_url',
    pattern: /VITE_API_BASE_URL/,
    message: 'Admin SPA uses VITE_API_URL — see apps/admin/src/lib/env.ts',
  },
  {
    id: 'mushi_dev_cli',
    pattern: /mushi-dev/,
    message: 'No mushi-dev binary — use mushi qa run <story-id>',
  },
  {
    id: 'npm_workspace_admin_build',
    pattern: /npm run -w apps\/admin/,
    message: 'Monorepo uses pnpm — pnpm --filter @mushi-mushi/admin build',
  },
  {
    id: 'npm_install_monorepo',
    pattern: /(?<![p/])npm install/,
    paths: ['apps/docs/content/self-hosting'],
    exception: /@mushi-mushi|npm install -g|npm install @/,
    message: 'Monorepo dev uses pnpm install — npm install is for end-user SDK packages only',
  },
  {
    id: 'check_destructive_npm_script',
    pattern: /npm run check:destructive-migrations/,
    message: 'Use node scripts/check-destructive-migrations.mjs',
  },
  {
    id: 'android_sdk_artifact',
    pattern: /dev\.mushimushi:sdk\b/,
    message: 'Maven artifact is dev.mushimushi:mushi-android (not :sdk)',
  },
  {
    id: 'ios_pod_0_8',
    pattern: /pod ['"]MushiMushi['"],\s*['"]~> 0\.8['"]/,
    message: "CocoaPods pin is ~> 0.4 — see packages/ios",
  },
  {
    id: 'npx_create_mushi',
    pattern: /npx create mushi-mushi/,
    message: 'Use npm create mushi-mushi or npx mushi-mushi',
  },
  {
    id: 'mushi_qa_audit',
    pattern: /mushi qa audit/,
    message: 'Use top-level mushi audit — not mushi qa audit',
  },
  {
    id: 'get_lessons_tool',
    pattern: /`get_lessons`/,
    message: 'No get_lessons tool — use query_lessons / list_lessons',
  },
  {
    id: 'bare_wizard_env',
    pattern: /writes `MUSHI_PROJECT_ID`/,
    message:
      'Wizard writes framework-prefixed keys (VITE_/NEXT_PUBLIC_/…) — see examples/sdk.env.example',
  },
]

function walk(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.name === 'node_modules' || e.name === '.next') continue
    if (e.isDirectory()) walk(full, acc)
    else if (EXT.has(path.extname(e.name))) acc.push(full)
  }
  return acc
}

function collectFiles() {
  const out = []
  for (const rel of SCAN_PATHS) {
    const abs = path.join(ROOT, rel)
    try {
      const st = statSync(abs)
      if (st.isFile()) out.push(abs)
      else if (st.isDirectory()) walk(abs, out)
    } catch {
      // optional path missing
    }
  }
  return out
}

function ruleAppliesToFile(rule, rel) {
  if (!rule.paths) return true
  return rule.paths.some((p) => rel === p || rel.startsWith(`${p}/`))
}

const failures = []

for (const file of collectFiles()) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  if (SKIP_PATH_RE.test(rel)) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const rule of RULES) {
      if (!ruleAppliesToFile(rule, rel)) continue
      if (!rule.pattern.test(line)) continue
      if (rule.exception?.test(line)) continue
      failures.push({ file: rel, line: i + 1, rule: rule.id, message: rule.message, text: line.trim() })
    }
  }
}

if (failures.length === 0) {
  console.log('✓ onboarding-drift: no phantom MCP/env patterns found')
  process.exit(0)
}

console.error(`\n✗ onboarding-drift: ${failures.length} issue(s)\n`)
for (const f of failures) {
  console.error(`  ${f.file}:${f.line} [${f.rule}]`)
  console.error(`    ${f.message}`)
  console.error(`    ${f.text}\n`)
}
process.exit(1)
