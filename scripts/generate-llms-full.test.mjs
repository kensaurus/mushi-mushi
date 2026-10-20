/**
 * FILE: scripts/generate-llms-full.test.mjs
 * PURPOSE: The committed LLM docs (llms-full.txt, llms-ctx.txt, llm-md twins,
 *          blog/feed.xml) must match scripts/generate-llms-full.mjs, and a
 *          second render must be byte-identical (no build clock).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildLlmsArtifacts } from './generate-llms-full.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts', 'generate-llms-full.mjs')
const TWIN = join(ROOT, 'apps/docs/public/llm-md/roadmap.md')

function runCheck() {
  return spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' })
}

test('two renders match and the full dump has no build date', () => {
  const a = buildLlmsArtifacts()
  const b = buildLlmsArtifacts()
  assert.equal(a.fullContent, b.fullContent)
  assert.equal(a.ctxContent, b.ctxContent)
  assert.equal(a.feedXml, b.feedXml)
  assert.equal(a.pages.length, b.pages.length)
  for (let i = 0; i < a.pages.length; i++) {
    assert.equal(a.pages[i].relPath, b.pages[i].relPath)
    assert.equal(a.pages[i].twin, b.pages[i].twin)
  }
  assert.doesNotMatch(a.fullContent.split('\n').slice(0, 12).join('\n'), /^Generated: /m)
  assert.ok(a.pages.length >= 100)
})

test('--check passes on the committed copies and fails when a twin drifts', () => {
  const clean = runCheck()
  assert.equal(clean.status, 0, clean.stderr + clean.stdout)

  const original = readFileSync(TWIN, 'utf8')
  try {
    writeFileSync(TWIN, original.replace(/\n/g, '\r\n'))
    const crlf = runCheck()
    assert.equal(crlf.status, 0, crlf.stderr)

    writeFileSync(TWIN, original.replace(/\n$/, '\n\nstale line\n'))
    const dirty = runCheck()
    assert.equal(dirty.status, 1)
    assert.match(dirty.stderr, /llm-md\/roadmap\.md out of date/)
  } finally {
    writeFileSync(TWIN, original)
  }

  const restored = runCheck()
  assert.equal(restored.status, 0, restored.stderr + restored.stdout)
})
