/**
 * FILE: scripts/e2e-dogfood-discovery.test.mjs
 * PURPOSE: Dogfood comments must not claim msw mocks calls when msw is not
 *          wired, and the package test must not pin `playwright test --list`
 *          to a fixed suite size. A future spec has to be able to land
 *          without editing that total.
 *
 * USAGE: pnpm test:scripts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOGFOOD = path.join(REPO, 'examples/e2e-dogfood')
const SKIP_DIRS = new Set(['node_modules', 'test-results', 'playwright-report', 'blob-report'])

/** Historical lines that named msw as the thing doing the mocking. */
const OLD_CLAIMS = [
  'Mocks GitHub by default (msw)',
  'Unset = msw mocks the GitHub REST surface',
  'mocked by msw unless E2E_LIVE_GITHUB=1',
  'MSW intercepts api.cursor.com',
  'MSW mock for Cursor REST API',
  'GitHub is mocked by msw',
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (st.isFile()) out.push(full)
  }
  return out
}

function claimsMswMocks(line) {
  return /\bmsw\b/i.test(line) && /\b(mock(?:ed|s|ing)?|intercept(?:ed|s|ing)?)\b/i.test(line)
}

function readSources() {
  return walk(DOGFOOD)
    .filter((file) => /\.(mjs|cjs|js|ts|tsx|md|json|yml|yaml)$/.test(file))
    .map((file) => ({ file, text: readFileSync(file, 'utf8') }))
}

function mswWired(pkg, sources) {
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  }
  if (deps.msw != null) return true
  return sources.some(({ text }) => /(?:from|import|require)\s*\(?\s*['"]msw(?:\/[^'"]*)?['"]/.test(text))
}

function claimHits(sources) {
  const hits = []
  for (const { file, text } of sources) {
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (claimsMswMocks(lines[i])) {
        hits.push(`${path.relative(REPO, file)}:${i + 1}: ${lines[i].trim()}`)
      }
    }
  }
  return hits
}

/** `playwright test --list` compared to a hardcoded tests/files total. */
function freezesListedSuite(text) {
  if (!text.includes('--list') || !text.includes('playwright')) return false
  return /tests\s*:\s*\d+/.test(text) || /files\s*:\s*\d+/.test(text)
}

test('the old msw sentences are claims, and the real Act wording is not', () => {
  for (const line of OLD_CLAIMS) {
    assert.equal(claimsMswMocks(line), true, line)
  }
  assert.equal(claimsMswMocks('Playwright page.route intercepts api.cursor.com'), false)
  assert.equal(claimsMswMocks('GitHub is not intercepted'), false)
  assert.equal(claimsMswMocks('Act checks the attempt left pending'), false)
})

test('e2e-dogfood does not claim msw mocks calls unless msw is wired', () => {
  const pkg = JSON.parse(readFileSync(path.join(DOGFOOD, 'package.json'), 'utf8'))
  const sources = readSources()
  const hits = claimHits(sources)
  if (!mswWired(pkg, sources)) {
    assert.deepEqual(hits, [])
  }
})

test('the dogfood package test does not freeze the Playwright suite size', () => {
  const pkg = JSON.parse(readFileSync(path.join(DOGFOOD, 'package.json'), 'utf8'))
  const script = String(pkg.scripts?.test ?? '')
  assert.equal(
    /discovery\.test\.mjs|playwright[^\n]*--list/.test(script),
    false,
    'package test must not run a listed-suite total check',
  )
  const pinned = readSources()
    .filter(({ text }) => freezesListedSuite(text))
    .map(({ file }) => path.relative(REPO, file))
  assert.deepEqual(pinned, [])
})
