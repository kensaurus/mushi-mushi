/**
 * Tests for scripts/check-site-urls.mjs — run with `pnpm test:scripts`.
 * Routes go through the real CloudFront router; file existence is faked so the
 * cases do not depend on which docs pages exist today.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSiteUrls, keyExists, loadRouter, routeToKey } from './check-site-urls.mjs'

const route = loadRouter()
const FILES = new Set([
  'apps/docs/content/index.mdx',
  'apps/docs/content/quickstart/react.mdx',
  'apps/docs/content/sdks/index.mdx',
  'apps/docs/app/connect/page.tsx',
  'apps/docs/public/llms.txt',
  'apps/docs/public/llm-md/sdks/mcp.md',
  'apps/docs/public/schemas/inventory-2.0.json',
  'apps/docs/app/robots.ts',
])
const exists = (rel) => FILES.has(rel)
const resolve = (path) => {
  const r = routeToKey(route, path)
  return 'error' in r ? { ok: false, reason: r.error } : keyExists(r.key, exists)
}

test('extractSiteUrls finds kensaur.us/mushi-mushi URLs, trims punctuation and flags templates', () => {
  const text = [
    'See https://kensaur.us/mushi-mushi/docs/quickstart/react.',
    '[docs](https://kensaur.us/mushi-mushi/docs/cloud#plans) and `https://kensaur.us/mushi-mushi/docs/llm-md/<path>.md`',
    "fetch(`https://kensaur.us/mushi-mushi/docs${path}`)",
    'Home: https://kensaur.us/mushi-mushi and https://kensaur.us/other-site',
  ].join('\n')
  const urls = extractSiteUrls(text)
  assert.deepEqual(
    urls.map((u) => [u.path, u.line, u.templated]),
    [
      ['/mushi-mushi/docs/quickstart/react', 1, false],
      ['/mushi-mushi/docs/cloud#plans', 2, false],
      ['/mushi-mushi/docs/llm-md/', 2, true],
      ['/mushi-mushi/docs${path}', 3, true],
      ['/mushi-mushi', 4, false],
    ],
  )
})

test('docs pages, app-router pages, public files, metadata routes and schemas resolve', () => {
  for (const path of [
    '/mushi-mushi/docs/quickstart/react',
    '/mushi-mushi/docs/quickstart/react/', // 301 to the slashless page
    '/mushi-mushi/quickstart/react', // mis-prefixed: 301 into /docs/
    '/mushi-mushi/docs/sdks', // folder index
    '/mushi-mushi/docs/connect', // app router
    '/mushi-mushi/docs/llms.txt',
    '/mushi-mushi/docs/llm-md/sdks/mcp.md',
    '/mushi-mushi/docs/robots.txt',
    '/mushi-mushi/schemas/inventory-2.0.json',
    '/mushi-mushi/docs', // 301 to docs/ → index
    '/mushi-mushi/', // bare product root → docs index
    '/mushi-mushi',
  ]) {
    assert.equal(resolve(path).ok, true, path)
  }
})

test('admin routes resolve to the SPA shell', () => {
  assert.deepEqual(resolve('/mushi-mushi/admin/connect'), { ok: true, kind: 'admin-spa' })
  assert.deepEqual(resolve('/mushi-mushi/projects'), { ok: true, kind: 'admin-spa' }) // 302 → admin
})

test('missing pages, files and unpublished prefixes are dead', () => {
  assert.equal(resolve('/mushi-mushi/docs/quickstart/nope').ok, false)
  assert.equal(resolve('/mushi-mushi/docs/llms-nope.txt').ok, false)
  assert.equal(resolve('/mushi-mushi/schemas/nope-2.0.json').ok, false)
  const icon = resolve('/mushi-mushi/integrations/mushi-mark-512.png')
  assert.equal(icon.ok, false)
  assert.match(icon.reason, /no deploy workflow publishes S3 key \/mushi-mushi\/integrations\/mushi-mark-512\.png/)
})
