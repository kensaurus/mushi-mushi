#!/usr/bin/env node
/**
 * FILE: scripts/check-env-source-parity.mjs
 * PURPOSE: Every environment variable the source reads must be documented in
 *          at least one tracked `.env.example`. `check-env-docs.mjs` only
 *          cross-checks the templates against the onboarding docs; this one
 *          starts from the code, so a variable that is read but never
 *          templated cannot hide.
 *
 *   pnpm check:env-source-parity            # strict: exit 1 on any undocumented name
 *   pnpm check:env-source-parity -- --warn  # report only, exit 0
 *   pnpm check:env-source-parity -- --json  # machine-readable report
 *
 * Sources scanned (non-test): packages/(star)/src, apps/(star)/src and
 * packages/server/supabase/functions. Recognised reads:
 *   process.env.NAME        process.env['NAME']      process.env["NAME"]
 *   import.meta.env.NAME    Deno.env.get('NAME')
 * Comments are stripped first so a name that only appears in prose is not a
 * read. Runtime/platform builtins are allowlisted below.
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const WARN_ONLY = process.argv.includes('--warn')
const JSON_OUT = process.argv.includes('--json')

/** Names provided by the runtime, the platform, or the Supabase edge runtime. */
const BUILTIN_ALLOWLIST = new Set([
  'APPDATA',
  'BASE_URL',
  'CI',
  'DEV',
  'MODE',
  'NODE_ENV',
  'PROD',
  'SSR',
  'npm_config_user_agent',
  'XDG_CONFIG_HOME',
  'HOME',
  'PATH',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
])

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/
const TEST_FILE = /\.(test|spec)\.[^/]+$/
const TEST_DIR = /(^|\/)(__tests__|__mocks__|__stubs__|e2e|test|tests)\//

const READ_PATTERNS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /Deno\.env\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g,
]

function toRel(abs) {
  return relative(ROOT, abs).split(sep).join('/')
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.next') continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else if (SOURCE_EXT.test(name)) out.push(abs)
  }
  return out
}

function listWorkspaceSrcDirs(parent) {
  const abs = join(ROOT, parent)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .map((name) => join(abs, name, 'src'))
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
}

/** Strip block comments and full-line `//` / ` * ` comments (keeps line count). */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const sourceDirs = [
  ...listWorkspaceSrcDirs('packages'),
  ...listWorkspaceSrcDirs('apps'),
  join(ROOT, 'packages/server/supabase/functions'),
].filter((dir) => existsSync(dir))

const files = []
for (const dir of sourceDirs) walk(dir, files)

/** @type {Map<string, string>} name -> first "file:line" reference */
const reads = new Map()
for (const abs of files) {
  const rel = toRel(abs)
  if (TEST_FILE.test(rel) || TEST_DIR.test(rel)) continue
  const text = stripComments(readFileSync(abs, 'utf8'))
  for (const pattern of READ_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text))) {
      const name = match[1]
      if (reads.has(name)) continue
      const line = text.slice(0, match.index).split('\n').length
      reads.set(name, `${rel}:${line}`)
    }
  }
}

// Documented names: every tracked .env.example (including commented-out
// `# NAME=` lines, which document an optional variable).
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /(^|\/)\.env(\.[A-Za-z0-9_-]+)?\.example$/.test(line))

const documented = new Set()
const DOC_LINE = /^\s*#?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/
for (const rel of tracked) {
  const text = readFileSync(join(ROOT, rel), 'utf8')
  for (const line of text.split('\n')) {
    const match = DOC_LINE.exec(line)
    if (match) documented.add(match[1])
  }
}

const undocumented = [...reads.entries()]
  .filter(([name]) => !BUILTIN_ALLOWLIST.has(name) && !documented.has(name))
  .sort(([a], [b]) => a.localeCompare(b))

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        scannedFiles: files.length,
        envExampleFiles: tracked,
        readNames: reads.size,
        documentedNames: documented.size,
        undocumented: undocumented.map(([name, ref]) => ({ name, firstReference: ref })),
      },
      null,
      2,
    ),
  )
} else {
  console.log(
    `env-source-parity: ${reads.size} env names read in source, ${documented.size} documented across ${tracked.length} .env.example file(s)`,
  )
  if (undocumented.length > 0) {
    console.log(`\n${undocumented.length} read in source but absent from every .env.example:`)
    for (const [name, ref] of undocumented) console.log(`  ${name.padEnd(44)} ${ref}`)
  }
}

if (undocumented.length === 0) {
  if (!JSON_OUT) console.log('\n✓ every env name read in source is documented')
  process.exit(0)
}

if (WARN_ONLY) {
  if (!JSON_OUT) console.log('\n⚠ --warn: reporting only (exit 0). Drop the flag once the list is empty.')
  process.exit(0)
}

console.error('\n✗ undocumented env names. Add each to the owning .env.example (or the allowlist if it is a platform builtin).')
process.exit(1)
