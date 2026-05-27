#!/usr/bin/env node
// Batch deploy any number of edge function slugs by name. Mirrors the
// behaviour of scripts/deploy-all-sentry-functions.mjs but takes the slug
// list from argv instead of grepping for `_shared/sentry` imports.
//
// Usage:
//   node scripts/deploy-edge-functions-batch.mjs slug1 slug2 slug3 …

import { spawn } from 'node:child_process'

const slugs = process.argv.slice(2)
if (slugs.length === 0) {
  console.error('Usage: node scripts/deploy-edge-functions-batch.mjs slug1 slug2 …')
  process.exit(2)
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
      const verifyJwtMatch = stderr.match(/verify_jwt=(true|false)/)
      const okMatch = /deploy ok in (\d+)ms/.exec(stderr)
      resolve({
        slug,
        ok: code === 0,
        version: versionMatch ? Number(versionMatch[1]) : null,
        verify_jwt: verifyJwtMatch ? verifyJwtMatch[1] : null,
        ms: okMatch ? Number(okMatch[1]) : null,
        stderr: code === 0 ? '' : stderr.slice(-2000),
      })
    })
  })
}

const results = []
for (const slug of slugs) {
  process.stderr.write(`> ${slug.padEnd(34)} `)
  const r = await deployOne(slug)
  results.push(r)
  if (r.ok) {
    process.stderr.write(`ok  v${r.version} verify_jwt=${r.verify_jwt} (${r.ms}ms)\n`)
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
