#!/usr/bin/env node
/**
 * CI guard: logLlmInvocation(...) call sites should pass langfuseTraceId.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'packages', 'server', 'supabase', 'functions')
const SKIP_FILES = new Set(['_shared/telemetry.ts', '_shared/pricing.ts'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules') continue
      walk(p, out)
    } else if (name.endsWith('.ts')) {
      out.push(p)
    }
  }
  return out
}

function rel(p) {
  return p.replace(/\\/g, '/').split('/supabase/functions/')[1] ?? p
}

const violations = []
for (const file of walk(ROOT)) {
  const relPath = rel(file)
  if (SKIP_FILES.has(relPath)) continue
  const src = readFileSync(file, 'utf8')
  if (!src.includes('logLlmInvocation(')) continue
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('import ') && line.includes('logLlmInvocation')) continue
    if (!/\blogLlmInvocation\s*\(/.test(line)) continue
    const block = lines.slice(i, Math.min(i + 30, lines.length)).join('\n')
    if (!block.includes('langfuseTraceId')) {
      violations.push(`${file.replace(/\\/g, '/')}:${i + 1}`)
    }
  }
}

if (violations.length > 0) {
  console.error('logLlmInvocation calls missing langfuseTraceId:')
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}

console.log('check-llm-trace-linkage: ok')
