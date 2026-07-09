#!/usr/bin/env node
/**
 * Phase 11 blast-radius guard: hand-rolled primary CTA classes in feature
 * components touched by the UX unification burndown (Phases 8–10).
 *
 * Intentional raw <button> remains in disclosure rows, list-row triggers,
 * icon-only controls, and flow-primitives — see .cursor/burndown-state.md.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DIRS = [
  'apps/admin/src/components/dashboard/HeroIntro.tsx',
  'apps/admin/src/components/hero-flow/HeroDetailPanel.tsx',
  'apps/admin/src/components/query/QueryPromptLibrary.tsx',
]

const PATTERNS = [
  { name: 'hand-rolled primary CTA', re: 'rounded-md bg-brand px-' },
  { name: 'hand-rolled primary CTA (sm)', re: 'rounded-sm bg-brand px-' },
  { name: 'hand-rolled category tab strip', re: 'aria-pressed=\\{active\\}' },
]

const problems = []
for (const file of DIRS) {
  for (const { name, re } of PATTERNS) {
    try {
      const hits = execSync(`rg -n '${re}' "${file}"`, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
      if (hits) problems.push(`${file} — ${name}:\n${hits}`)
    } catch {
      /* no match */
    }
  }
}

if (problems.length > 0) {
  console.error('audit-blast-radius-buttons: FAIL\n')
  console.error(problems.join('\n\n'))
  process.exit(1)
}

console.log('audit-blast-radius-buttons: OK (0 hits)')
