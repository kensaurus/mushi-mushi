#!/usr/bin/env node
// One-shot helper: deploy every edge function that imports `_shared/sentry.ts`
// so a `_shared/sentry.ts` change (e.g. the 2026-05-24 client_aborted_response
// filter) actually rolls out to production for every consumer at once.
//
// This is a thin orchestrator over scripts/deploy-edge-function.mjs — it
// shells out per function so each deploy is independent. We don't parallelise
// because the Management API is rate-limited per-token.
//
// Usage:
//   node scripts/deploy-all-sentry-functions.mjs
//   node scripts/deploy-all-sentry-functions.mjs --skip api,webhooks-github-indexer

import { readdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const FN_ROOT = new URL('../packages/server/supabase/functions/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

async function functionsImportingSentry() {
  const entries = await readdir(FN_ROOT, { withFileTypes: true })
  const out = []
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('_')) continue
    try {
      const idx = await readFile(join(FN_ROOT, ent.name, 'index.ts'), 'utf8')
      if (/from\s+['"]\.\.\/_shared\/sentry/.test(idx)) out.push(ent.name)
    } catch {
      // function dir without index.ts — skip
    }
  }
  return out.sort()
}

function deployOne(slug) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [new URL('./deploy-edge-function.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), slug],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (b) => { stderr += b.toString() })
    child.stdout.on('data', () => { /* JSON body, suppress */ })
    child.on('close', (code) => {
      const versionMatch = stderr.match(/version=(\d+)/)
      const okMatch = /deploy ok in (\d+)ms/.exec(stderr)
      resolve({
        slug,
        ok: code === 0,
        version: versionMatch ? Number(versionMatch[1]) : null,
        ms: okMatch ? Number(okMatch[1]) : null,
        stderr: code === 0 ? '' : stderr.slice(-2000),
      })
    })
  })
}

async function main() {
  const skipArg = process.argv.indexOf('--skip')
  const skip = new Set(skipArg > -1 ? (process.argv[skipArg + 1] ?? '').split(',').filter(Boolean) : [])

  const all = await functionsImportingSentry()
  const targets = all.filter((s) => !skip.has(s))
  console.error(`> ${targets.length}/${all.length} functions to deploy${skip.size ? ` (skipping ${[...skip].join(', ')})` : ''}`)

  const results = []
  for (const slug of targets) {
    process.stderr.write(`> ${slug.padEnd(34)} `)
    const r = await deployOne(slug)
    results.push(r)
    if (r.ok) {
      process.stderr.write(`ok  v${r.version} (${r.ms}ms)\n`)
    } else {
      process.stderr.write(`FAIL\n`)
      process.stderr.write(r.stderr.split('\n').slice(-6).map((l) => `    ${l}`).join('\n') + '\n')
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.error('')
  console.error(`> deployed: ${results.length - failed.length}/${results.length}`)
  if (failed.length > 0) {
    console.error(`> FAILED: ${failed.map((r) => r.slug).join(', ')}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('unexpected:', err)
  process.exit(1)
})
