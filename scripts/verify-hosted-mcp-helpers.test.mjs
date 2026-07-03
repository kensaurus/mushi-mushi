import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCurlHeadStatusCommand,
  getCurlNullSink,
  parseClientCredentialsMint,
} from './verify-hosted-mcp-helpers.mjs'

describe('getCurlNullSink', () => {
  it('uses /dev/null on Linux and macOS', () => {
    assert.equal(getCurlNullSink('linux'), '/dev/null')
    assert.equal(getCurlNullSink('darwin'), '/dev/null')
  })

  it('uses NUL on Windows', () => {
    assert.equal(getCurlNullSink('win32'), 'NUL')
  })
})

describe('buildCurlHeadStatusCommand', () => {
  it('embeds platform-specific null sink in curl -o', () => {
    const url = 'https://example.com/.well-known/oauth-authorization-server'
    assert.match(
      buildCurlHeadStatusCommand(url, 'linux'),
      /curl -sS -o \/dev\/null -w "%\{http_code\}" --max-time 10 -I "https:\/\/example.com\/\.well-known\/oauth-authorization-server"/,
    )
    assert.match(buildCurlHeadStatusCommand(url, 'win32'), /curl -sS -o NUL -w/)
  })
})

describe('parseClientCredentialsMint', () => {
  it('accepts a valid token payload', () => {
    const result = parseClientCredentialsMint({
      status: 200,
      bodyText: JSON.stringify({ access_token: 'smithery-scanner-token', token_type: 'Bearer' }),
    })
    assert.deepEqual(result, { ok: true, token: 'smithery-scanner-token' })
  })

  it('rejects non-2xx before initialize would run', () => {
    const result = parseClientCredentialsMint({
      status: 401,
      bodyText: JSON.stringify({ error: 'invalid_client' }),
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /HTTP 401/)
  })

  it('rejects invalid JSON', () => {
    const result = parseClientCredentialsMint({
      status: 200,
      bodyText: 'not-json',
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /not valid JSON/)
  })

  it('rejects JSON without access_token', () => {
    const result = parseClientCredentialsMint({
      status: 200,
      bodyText: JSON.stringify({ token_type: 'Bearer' }),
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /missing non-empty access_token/)
  })

  it('rejects empty access_token string', () => {
    const result = parseClientCredentialsMint({
      status: 200,
      bodyText: JSON.stringify({ access_token: '' }),
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /missing non-empty access_token/)
  })
})
