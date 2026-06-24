#!/usr/bin/env node
/**
 * Smoke-test hosted MCP on kensaur.us + optional Smithery setup POST.
 * Usage: node scripts/verify-hosted-mcp.mjs
 */

import { execSync } from 'node:child_process'

const HOSTED = 'https://kensaur.us/mushi-mushi/hosted-mcp'
const ORIGIN_PRM =
  'https://kensaur.us/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp'

const checks = [
  ['origin PRM', ORIGIN_PRM],
  ['resource PRM', `${HOSTED}/`],
  ['AS metadata', `${HOSTED}/.well-known/oauth-authorization-server`],
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

const init = await fetch(`${HOSTED}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'SmitheryBot/1.0',
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

const asHead = await fetch(`${HOSTED}/.well-known/oauth-authorization-server`, { method: 'HEAD' })
const asHeadText = await asHead.text()
// Node fetch strips HEAD bodies; use curl — Smithery reads issuer from HEAD (RFC 8414).
let curlHeadText = ''
try {
  curlHeadText = execSync(`curl -sS --max-time 15 -X HEAD "${HOSTED}/.well-known/oauth-authorization-server"`, {
    encoding: 'utf8',
  })
} catch {
  curlHeadText = ''
}
const asHeadOk =
  asHead.ok && (curlHeadText.includes('"issuer"') || asHeadText.includes('"issuer"'))
console.log(`${asHeadOk ? '✓' : '✗'} AS metadata HEAD (Smithery RFC 8414) ${asHead.status}`)
if (!asHeadOk) {
  failed++
  console.log(`  fetch body: ${asHeadText.slice(0, 80)} curl: ${curlHeadText.slice(0, 120)}`)
}

const regGet = await fetch(`${HOSTED}/oauth/register`)
const regText = await regGet.text()
const regOk = regGet.status === 405 || !regText.includes('"resource"')
console.log(`${regOk ? '✓' : '✗'} GET /oauth/register not PRM (${regGet.status})`)
if (!regOk) {
  failed++
  console.log(`  body: ${regText.slice(0, 160)}`)
}

process.exit(failed ? 1 : 0)
