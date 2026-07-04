#!/usr/bin/env node
/**
 * Fail CI when critical env vars are documented in onboarding paths but missing
 * from the appropriate `.env.example` templates.
 *
 *   pnpm check:env-docs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/** key → relative paths that must mention the key (commented or not) */
const REQUIRED_IN_EXAMPLES = {
  VITE_API_URL: ['.env.example', 'apps/admin/.env.example'],
  VITE_SUPABASE_URL: ['.env.example', 'apps/admin/.env.example'],
  ADMIN_BASE_URL: ['.env.example', 'packages/server/.env.example'],
  MUSHI_INTERNAL_CALLER_SECRET: ['.env.example', 'packages/server/.env.example'],
  VITE_CLOUD_SUPABASE_URL: ['apps/admin/.env.example'],
  VITE_CLOUD_SUPABASE_ANON_KEY: ['apps/admin/.env.example'],
  LANGFUSE_BASE_URL: ['.env.example', 'deploy/.env.example'],
}

const ONBOARDING_SCAN = ['apps/docs/content/self-hosting', 'CONTRIBUTING.md', 'SELF_HOSTED.md']

const ENV_KEY_RE = /^#?\s*([A-Z][A-Z0-9_]*)\s*=/

function fileContainsKey(relPath, key) {
  const abs = path.join(ROOT, relPath)
  const source = readFileSync(abs, 'utf8')
  return source.split('\n').some((line) => {
    const m = line.match(ENV_KEY_RE)
    return m?.[1] === key
  })
}

function walkMd(dir, acc = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkMd(full, acc)
    else if (/\.(md|mdx)$/.test(e.name)) acc.push(full)
  }
  return acc
}

function collectOnboardingFiles() {
  const out = []
  for (const rel of ONBOARDING_SCAN) {
    const abs = path.join(ROOT, rel)
    try {
      const st = statSync(abs)
      if (st.isFile()) out.push(abs)
      else walkMd(abs, out)
    } catch {
      // optional
    }
  }
  return out
}

const failures = []

for (const [key, files] of Object.entries(REQUIRED_IN_EXAMPLES)) {
  for (const rel of files) {
    if (!fileContainsKey(rel, key)) {
      failures.push(`${rel}: missing ${key} (required in .env.example template)`)
    }
  }
}

/** Env vars mentioned in onboarding docs must exist in at least one .env.example */
const EXAMPLE_KEYS = new Set()
for (const rel of [
  '.env.example',
  'apps/admin/.env.example',
  'packages/server/.env.example',
  'deploy/.env.example',
  'apps/docs/.env.example',
  'examples/react-demo/.env.example',
]) {
  const abs = path.join(ROOT, rel)
  try {
    readFileSync(abs, 'utf8')
      .split('\n')
      .forEach((line) => {
        const m = line.match(ENV_KEY_RE)
        if (m) EXAMPLE_KEYS.add(m[1])
      })
  } catch {
    // optional file
  }
}

const DOC_ENV_RE = /\b(VITE_[A-Z0-9_]+|MUSHI_[A-Z0-9_]+|LANGFUSE_[A-Z0-9_]+|ADMIN_[A-Z0-9_]+)\b/g
const ALLOW_UNDOCUMENTED = new Set([
  'VITE_INSTANCE_TYPE',
  'VITE_RELEASE',
  'VITE_BASE_PATH',
  'MUSHI_INIT_ORG_NAME',
  'MUSHI_INIT_ORG_ID',
  'MUSHI_INIT_PROJECT_NAME',
  'MUSHI_INIT_PROJECT_ID',
  'MUSHI_INIT_REPORTER_KEY',
  'MUSHI_EE_LICENSE_KEY',
  'MUSHI_ALLOW_INTERNAL_PUSH',
  'MUSHI_WEBHOOK_SECRET',
  'MUSHI_INGEST_KEY',
  'MUSHI_ADMIN_EMAIL',
  'MUSHI_ADMIN_PASSWORD',
  'MUSHI_ADMIN_JWT',
  'MUSHI_CURSOR_API_KEY_OVERRIDE',
  'MUSHI_NO_UPDATE_CHECK',
  'MUSHI_CLUSTER_REGION',
  'MUSHI_PEER_REGIONS',
  'LANGFUSE_HOST', // alias documented in observability.mdx
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_PUBLIC_KEY',
])

for (const file of collectOnboardingFiles()) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const source = readFileSync(file, 'utf8')
  const mentioned = new Set([...source.matchAll(DOC_ENV_RE)].map((m) => m[1]))
  for (const key of mentioned) {
    if (ALLOW_UNDOCUMENTED.has(key)) continue
    if (key.endsWith('_') && key.length > 1) continue // e.g. MUSHI_INIT_* pattern in prose
    if (key === 'VITE_API_BASE_URL') {
      failures.push(`${rel}: phantom env var VITE_API_BASE_URL — use VITE_API_URL`)
      continue
    }
    if (!EXAMPLE_KEYS.has(key)) {
      failures.push(`${rel}: mentions ${key} but no .env.example template defines it`)
    }
  }
}

if (failures.length === 0) {
  console.log('✓ env-docs: critical keys present in .env.example templates')
  process.exit(0)
}

console.error(`\n✗ env-docs: ${failures.length} issue(s)\n`)
for (const f of failures) console.error(`  - ${f}\n`)
process.exit(1)
