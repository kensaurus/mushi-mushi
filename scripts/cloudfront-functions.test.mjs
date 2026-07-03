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
    const out = apex(reqWithQs('/quickstart/mcp', { utm_source: 'test' }))
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/mcp?utm_source=test')
  })

  it('omits empty CloudFront querystring object', () => {
    const out = apex(req('/quickstart/mcp', {}))
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/mcp')
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

describe('cloudfront-kensaur-default-viewer', () => {
  const combined = loadHandler('cloudfront-kensaur-default-viewer.js')

  it('redirects mushi docs before glot SPA rewrite', () => {
    const out = combined(req('/quickstart/incident-loop'))
    assert.equal(out.statusCode, 301)
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/incident-loop')
  })

  it('still serves glot.it well-known via glot handler', () => {
    const out = combined(req('/.well-known/assetlinks.json'))
    assert.equal(out.statusCode, 200)
    assert.match(out.body, /com\.glotit\.app/)
  })
})

describe('cloudfront-mushi-spa-router', () => {
  const spa = loadHandler('cloudfront-mushi-spa-router.js')

  it('301 mis-prefixed docs path to /mushi-mushi/docs/…', () => {
    const out = spa(req('/mushi-mushi/quickstart/incident-loop'))
    assert.equal(out.statusCode, 301)
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/incident-loop')
  })

  it('preserves query string on mis-prefixed docs redirect (regression)', () => {
    const out = spa(reqWithQs('/mushi-mushi/quickstart/mcp', { utm_source: 'test' }))
    assert.equal(out.headers.location.value, '/mushi-mushi/docs/quickstart/mcp?utm_source=test')
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

  it('301 bare /mushi-mushi/testers to trailing-slash form', () => {
    const out = spa(req('/mushi-mushi/testers'))
    assert.equal(out.statusCode, 301)
    assert.equal(out.headers.location.value, '/mushi-mushi/testers/')
  })

  it('rewrites /mushi-mushi/testers/ to index.html', () => {
    const out = spa(req('/mushi-mushi/testers/'))
    assert.equal(out.uri, '/mushi-mushi/testers/index.html')
  })

  it('rewrites /mushi-mushi/testers/apps/ to index.html', () => {
    const out = spa(req('/mushi-mushi/testers/apps/'))
    assert.equal(out.uri, '/mushi-mushi/testers/apps/index.html')
  })

  it('301 nested testers path missing trailing slash', () => {
    const out = spa(req('/mushi-mushi/testers/apps'))
    assert.equal(out.statusCode, 301)
    assert.equal(out.headers.location.value, '/mushi-mushi/testers/apps/')
  })

  it('preserves query string when adding trailing slash', () => {
    const out = spa(reqWithQs('/mushi-mushi/testers/roadmap', { app: 'demo' }))
    assert.equal(out.statusCode, 301)
    assert.equal(out.headers.location.value, '/mushi-mushi/testers/roadmap/?app=demo')
  })

  it('rewrites any /apps/<slug>/ to the pre-rendered shell (regression)', () => {
    // apps/[slug]/page.tsx can only pre-render a fixed placeholder shell
    // under `output: export` — any real slug published after the last
    // build must still resolve, not 404 against a nonexistent S3 key.
    const out = spa(req('/mushi-mushi/testers/apps/some-real-app/'))
    assert.equal(out.uri, '/mushi-mushi/testers/apps/_shell/index.html')
  })

  it('rewrites /apps/<slug> without trailing slash to the shell too', () => {
    const out = spa(req('/mushi-mushi/testers/apps/some-real-app'))
    assert.equal(out.uri, '/mushi-mushi/testers/apps/_shell/index.html')
  })

  it('does not rewrite the /apps/ listing page itself to the shell', () => {
    const out = spa(req('/mushi-mushi/testers/apps/'))
    assert.equal(out.uri, '/mushi-mushi/testers/apps/index.html')
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

  it('serves Smithery backlink HTML at edge', () => {
    const out = router(req('/mushi-mushi/hosted-mcp/smithery-backlink', '', 'GET'))
    assert.equal(out.statusCode, 200)
    assert.match(out.body, /smithery\.ai\/servers\/kensaurus\/mushi-mushi/)
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
