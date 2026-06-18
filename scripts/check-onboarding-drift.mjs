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
  'packages/cli/README.md',
  'packages/mcp/README.md',
  'skills',
  '.cursor/skills',
]

const EXT = new Set(['.md', '.mdx'])

const SKIP_PATH_RE = /CHANGELOG\.md$|docs\/audit-/

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

const failures = []

for (const file of collectFiles()) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  if (SKIP_PATH_RE.test(rel)) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const rule of RULES) {
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
