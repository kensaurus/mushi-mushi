#!/usr/bin/env node
/**
 * Smoke-test hosted MCP on kensaur.us + optional Smithery setup POST.
 * Usage: node scripts/verify-hosted-mcp.mjs
 */

import { execSync } from 'node:child_process'
import {
  buildCurlHeadStatusCommand,
  parseClientCredentialsMint,
} from './verify-hosted-mcp-helpers.mjs'

const HOSTED = 'https://kensaur.us/mushi-mushi/hosted-mcp'
const ORIGIN_PRM =
  'https://kensaur.us/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp'

const checks = [
  ['origin PRM', ORIGIN_PRM],
  ['resource PRM', `${HOSTED}/`],
  ['AS metadata', `${HOSTED}/.well-known/oauth-authorization-server`],
  ['OIDC fallback', `${HOSTED}/.well-known/openid-configuration`],
  ['server-card', `${HOSTED}/.well-known/mcp/server-card.json`],
]

let failed = 0
for (const [label, url] of checks) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  const ok =
    res.ok &&
    (text.includes('authorization_servers') ||
      text.includes('serverInfo') ||
      text.includes('"issuer"'))
  console.log(`${ok ? '✓' : '✗'} ${label} ${res.status} ${url}`)
  if (!ok) {
    failed++
    console.log(`  ${text.slice(0, 200)}`)
  }
}

// Smithery's real scanner completes the OAuth stub before probing the
// catalog (see _shared/mcp-oauth-smithery-stub.ts) — isSmitheryScanner() no
// longer trusts a spoofable User-Agent, it requires the exact bearer token
// minted here. Mint it the same way Smithery would, then reuse it below.
const scannerTokenRes = await fetch(`${HOSTED}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
})
const scannerTokenBody = await scannerTokenRes.text()
const scannerMint = parseClientCredentialsMint({
  status: scannerTokenRes.status,
  bodyText: scannerTokenBody,
})
console.log(
  `${scannerMint.ok ? '✓' : '✗'} Smithery scanner client_credentials mint (${scannerTokenRes.status})`,
)
if (!scannerMint.ok) {
  failed++
  console.log(`  ${scannerMint.error}`)
  console.log(`  body: ${scannerMint.bodyPreview}`)
} else {
  const init = await fetch(`${HOSTED}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'SmitheryBot/1.0',
      Authorization: `Bearer ${scannerMint.token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'verify-hosted-mcp', version: '1.0' },
      },
    }),
  })
  const initText = await init.text()
  const initOk = init.ok && initText.includes('protocolVersion')
  console.log(`${initOk ? '✓' : '✗'} SmitheryBot initialize ${init.status}`)
  if (!initOk) {
    failed++
    console.log(`  ${initText.slice(0, 200)}`)
  }
}

// Smithery spec: unauthenticated POST must return 401 (not 403) with PRM hint (RFC 9728).
const unauth = await fetch(`${HOSTED}/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  }),
})
const wwwAuth = unauth.headers.get('www-authenticate') ?? ''
const unauthOk =
  unauth.status === 401 &&
  wwwAuth.includes('resource_metadata') &&
  wwwAuth.includes('kensaur.us/mushi-mushi/hosted-mcp')
console.log(`${unauthOk ? '✓' : '✗'} unauthenticated POST → 401 + kensaur.us PRM hint (${unauth.status})`)
if (!unauthOk) {
  failed++
  console.log(`  WWW-Authenticate: ${wwwAuth.slice(0, 160)}`)
}

// Smithery may HEAD before GET; status-only check (CF may omit HEAD body).
let headStatus = '000'
try {
  headStatus = execSync(
    buildCurlHeadStatusCommand(`${HOSTED}/.well-known/oauth-authorization-server`),
    { encoding: 'utf8', shell: true },
  ).trim()
} catch {
  headStatus = '000'
}
const headOk = headStatus === '200'
console.log(`${headOk ? '✓' : '⚠'} AS metadata HEAD status ${headStatus}${headOk ? '' : ' (non-blocking)'}`)

const asMeta = await fetch(`${HOSTED}/.well-known/oauth-authorization-server`)
const asJson = await asMeta.json()
const asEndpointOk =
  asMeta.ok &&
  asJson.authorization_endpoint?.includes('/oauth/authorize') &&
  asJson.response_types_supported?.includes('code')
console.log(`${asEndpointOk ? '✓' : '✗'} AS authorization_endpoint + code flow`)
if (!asEndpointOk) failed++

const authRedirect = await fetch(
  `${HOSTED}/oauth/authorize?response_type=code&client_id=mushi-hosted-mcp-smithery&redirect_uri=${encodeURIComponent('https://smithery.run/oauth/callback')}&state=verify&code_challenge=abc&code_challenge_method=S256`,
  { redirect: 'manual' },
)
const authLocation = authRedirect.headers.get('location') ?? ''
const authOk = authRedirect.status === 302 && authLocation.includes('smithery.run/oauth/callback')
console.log(`${authOk ? '✓' : '✗'} OAuth authorize → Smithery callback (${authRedirect.status})`)
if (!authOk) failed++

// Exchange the mushi-scan-* code the authorize stub just minted — the exact
// flow Smithery's scanner follows. Codes without the mushi-scan- prefix fall
// through to the real PKCE token endpoint, which rejects a bare exchange.
const scanCode = authOk ? new URL(authLocation).searchParams.get('code') ?? '' : ''
const tokenRes = await fetch(`${HOSTED}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: scanCode,
    redirect_uri: 'https://smithery.run/oauth/callback',
  }).toString(),
})
const tokenText = await tokenRes.text()
const tokenOk = tokenRes.status === 200 && tokenText.includes('access_token')
console.log(`${tokenOk ? '✓' : '✗'} OAuth token exchange (${tokenRes.status})`)
if (!tokenOk) {
  failed++
  console.log(`  body: ${tokenText.slice(0, 160)}`)
}

const regGet = await fetch(`${HOSTED}/oauth/register`)
const regText = await regGet.text()
const regOk = regGet.status === 405 || !regText.includes('"resource"')
console.log(`${regOk ? '✓' : '✗'} GET /oauth/register not PRM (${regGet.status})`)
if (!regOk) {
  failed++
  console.log(`  body: ${regText.slice(0, 160)}`)
}

const regPost = await fetch(`${HOSTED}/oauth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  // RFC 7591: redirect_uris is required by the real register route.
  body: JSON.stringify({
    client_name: 'verify-hosted-mcp',
    redirect_uris: ['https://smithery.run/oauth/callback'],
  }),
})
const regPostText = await regPost.text()
const regPostOk = regPost.status === 201 && regPostText.includes('client_id')
console.log(`${regPostOk ? '✓' : '✗'} POST /oauth/register DCR (${regPost.status})`)
if (!regPostOk) {
  failed++
  console.log(`  body: ${regPostText.slice(0, 160)}`)
}

process.exit(failed ? 1 : 0)
