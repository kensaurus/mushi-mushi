/**
 * FILE: scripts/cloudfront-functions.test.mjs
 * PURPOSE: Unit tests for CloudFront viewer-request routing functions.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Load a CloudFront function's `handler` from disk. */
function loadHandler(filename) {
  const src = readFileSync(join(__dirname, filename), 'utf8')
  // CloudFront functions are plain scripts with a top-level `handler`.
  // eslint-disable-next-line no-new-func
  return new Function('event', `${src}\nreturn handler(event);`)
}

function req(uri, querystring = '', method = 'GET', accept = '') {
  const headers = accept ? { accept: { value: accept } } : {}
  return { request: { uri, querystring, method, headers } }
}

function reqWithQs(uri, params, method = 'GET', accept = '') {
  const querystring = {}
  for (const [k, v] of Object.entries(params)) {
    querystring[k] = { value: v }
  }
  return req(uri, querystring, method, accept)
}

describe('cloudfront-mushi-apex-redirect', () => {
  const apex = loadHandler('cloudfront-mushi-apex-redirect.js')

  it('redirects /quickstart/incident-loop to docs', () => {
    const out = apex(req('/quickstart/incident-loop'))
    assert.equal(out.statusCode, 301)
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/incident-loop')
  })

  it('redirects trailing-slash docs paths', () => {
    const out = apex(req('/quickstart/incident-loop/'))
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/incident-loop/')
  })

  it('preserves query string on docs redirect', () => {
    const out = apex(req('/quickstart/mcp', 'utm_source=test'))
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/mcp?utm_source=test')
  })

  it('redirects /reports/uuid to admin (regression)', () => {
    const out = apex(req('/reports/a8054224-5d19-45e3-8c2b-1ad79182f761'))
    assert.equal(out.headers.location.value, '/mushi-mushi/admin/reports/a8054224-5d19-45e3-8c2b-1ad79182f761')
  })

  it('redirects exact /integrations to admin (regression)', () => {
    const out = apex(req('/integrations'))
    assert.equal(out.headers.location.value, '/mushi-mushi/admin/integrations')
  })

  it('redirects /integrations/cursor to docs', () => {
    const out = apex(req('/integrations/cursor'))
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/integrations/cursor')
  })

  it('passes through static assets', () => {
    const event = req('/quickstart/app.js')
    const out = apex(event)
    assert.equal(out.uri, '/quickstart/app.js')
    assert.equal(out.statusCode, undefined)
  })
})

describe('cloudfront-mushi-spa-router', () => {
  const spa = loadHandler('cloudfront-mushi-spa-router.js')

  it('301 mis-prefixed docs path to /mushi-mushi/docs/…', () => {
    const out = spa(req('/mushi-mushi/quickstart/incident-loop'))
    assert.equal(out.statusCode, 301)
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/incident-loop')
  })

  it('rewrites canonical docs path to .html', () => {
    const out = spa(req('/mushi-mushi/docs/quickstart/incident-loop'))
    assert.equal(out.uri, '/mushi-mushi/docs/quickstart/incident-loop.html')
  })

  it('302 unknown mushi path to admin SPA', () => {
    const out = spa(req('/mushi-mushi/login'))
    assert.equal(out.statusCode, 302)
    assert.equal(out.headers.location.value, '/mushi-mushi/admin/login')
  })
})

describe('cloudfront-mushi-hosted-mcp', () => {
  const router = loadHandler('cloudfront-mushi-hosted-mcp-router.js')
  const wellknown = loadHandler('cloudfront-mushi-hosted-mcp-wellknown.js')

  it('forwards resource PRM GET to Supabase origin', () => {
    const out = router(req('/mushi-mushi/hosted-mcp/', '', 'GET'))
    assert.equal(out.uri, '/')
    assert.equal(out.statusCode, undefined)
  })

  it('forwards AS metadata GET to Supabase origin', () => {
    const out = router(req('/mushi-mushi/hosted-mcp/.well-known/oauth-authorization-server', '', 'GET'))
    assert.equal(out.uri, '/.well-known/oauth-authorization-server')
    assert.equal(out.statusCode, undefined)
  })

  it('forwards AS metadata HEAD to Supabase (Smithery RFC 8414)', () => {
    const out = router(req('/mushi-mushi/hosted-mcp/.well-known/oauth-authorization-server', '', 'HEAD'))
    assert.equal(out.uri, '/.well-known/oauth-authorization-server')
    assert.equal(out.statusCode, undefined)
  })

  it('rewrites POST to Supabase path prefix', () => {
    const out = router(req('/mushi-mushi/hosted-mcp', '', 'POST', 'application/json, text/event-stream'))
    assert.equal(out.uri, '/')
    assert.equal(out.statusCode, undefined)
  })

  it('302 OAuth authorize to Smithery callback at edge', () => {
    const out = router(
      reqWithQs('/mushi-mushi/hosted-mcp/oauth/authorize', {
        response_type: 'code',
        redirect_uri: 'https%3A%2F%2Fsmithery.run%2Foauth%2Fcallback',
        state: 'scan',
      }),
    )
    assert.equal(out.statusCode, 302)
    assert.match(out.headers.location.value, /^https:\/\/smithery\.run\/oauth\/callback\?code=mushi-scan-/)
    assert.match(out.headers.location.value, /state=scan/)
  })

  it('serves origin PRM at well-known path', () => {
    const out = wellknown(req('/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp', '', 'GET'))
    assert.equal(out.statusCode, 200)
    assert.match(out.body, /authorization_servers/)
  })
})
