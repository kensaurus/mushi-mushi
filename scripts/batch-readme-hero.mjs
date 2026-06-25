#!/usr/bin/env node
/**
 * One-shot: prepend v2 hero to package READMEs that lack it.
 * Idempotent — skips files that already contain the tagline.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PACKAGES = join(ROOT, 'packages')

const SUBHERO = {
  core: 'Core types, API client, and shared utilities for every Mushi SDK.',
  server: 'Supabase edge functions and admin API — self-host the comprehension layer.',
  web: 'Browser SDK — already has hero; skipped by idempotency check.',
  react: 'React SDK — already has hero.',
  cli: 'CLI — already has hero.',
  mcp: 'MCP server — already has hero.',
  brand: 'Shared taglines and brand tokens for docs, npm, and the admin console.',
  'create-mushi-mushi': 'Scaffold a new app with Mushi pre-wired.',
  verify: 'Preflight checks for SDK env vars and ingest health.',
  'wasm-classifier': 'On-device spam filter — zero server cost before a report sends.',
  'codebase-graph': 'Symbol graph builder for the codebase explorer.',
  'inventory-schema': 'JSON Schema for inventory.yaml user-story maps.',
  'cursor-plugin': 'Cursor marketplace plugin manifest and install deeplinks.',
  'marketing-ui': 'Shared landing and connect-page React components.',
  launcher: 'Default bug-report launcher UI primitives for web SDKs.',
  agents: 'Cursor Cloud and REST fix-agent adapters.',
  adapters: 'Inbound event adapters (Sentry, Datadog, …).',
  android: 'Android native bridge for Capacitor and React Native hosts.',
  ios: 'iOS native bridge for Capacitor and React Native hosts.',
  flutter: 'Flutter SDK for Mushi bug reporting.',
}

const DEFAULT =
  'Part of the Mushi Mushi monorepo — plain-English bug comprehension for vibe coders.'

let updated = 0
for (const name of readdirSync(PACKAGES)) {
  const dir = join(PACKAGES, name)
  if (!statSync(dir).isDirectory()) continue
  const path = join(dir, 'README.md')
  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  if (content.includes('Your AI wrote it')) continue
  const lines = content.split('\n')
  const titleIdx = lines.findIndex((l) => l.startsWith('# '))
  if (titleIdx < 0) continue
  const sub = SUBHERO[name] ?? DEFAULT
  lines.splice(
    titleIdx + 1,
    0,
    '',
    '> **Your AI wrote it. Mushi tells you why it broke.**',
    '',
    sub,
    '',
  )
  writeFileSync(path, lines.join('\n'))
  updated++
  console.log('updated', path)
}
console.log(`Done — ${updated} README(s) updated.`)
