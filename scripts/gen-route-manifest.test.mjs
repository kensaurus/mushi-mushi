// Tests for the auth inference in gen-route-manifest.mjs.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inferAuth } from './gen-route-manifest.mjs'

test('an inline handler with no middleware is public', () => {
  assert.equal(inferAuth(" async (c) => {\n  return c.json({ ok: true })\n})\n"), 'public')
  assert.equal(inferAuth(' (c: Context) => c.text("ok"))'), 'public')
})

test('auth middleware after a middleware call with arguments is still found', () => {
  assert.equal(inferAuth(' rateLimit({ max: 5 }), jwtAuth, async (c) => c.json({}))'), 'jwtAuth')
  assert.equal(inferAuth(" adminOrApiKey({ scope: 'mcp:read' }), async (c) => c.json({}))"), 'adminOrApiKey')
})

test('auth names inside the handler body do not count, and unknown middleware stays unknown', () => {
  assert.equal(inferAuth(' readAuth, async (c) => { await jwtAuth(c) })'), 'unknown')
  assert.equal(inferAuth(" namedHandler)\napp.get('/next', jwtAuth, async (c) => c.json({}))"), 'unknown')
})
