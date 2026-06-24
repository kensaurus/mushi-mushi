#!/usr/bin/env node
/**
 * Smithery publisher verification helpers — DNS TXT + backlink smoke tests.
 * Usage: node scripts/smithery-verification-check.mjs
 */

const SMITHERY_SERVER = 'https://smithery.ai/servers/kensaurus/mushi-mushi'
const HOMEPAGE = 'https://kensaur.us/mushi-mushi/docs/connect'
const SERVER_CARD = 'https://kensaur.us/mushi-mushi/hosted-mcp/.well-known/mcp/server-card.json'
const TXT_PREFIX = 'smithery-verification='

let failed = 0

async function checkBacklink() {
  const res = await fetch(HOMEPAGE, {
    headers: { 'User-Agent': 'SmitheryBot/1.0 (+https://smithery.ai)' },
  })
  const html = await res.text()
  const ok =
    res.ok &&
    (html.includes('smithery.ai/servers/kensaurus/mushi-mushi') ||
      html.includes('smithery.ai/badge/kensaurus/mushi-mushi'))
  console.log(`${ok ? '✓' : '✗'} homepage backlink (${res.status}, ${html.length} bytes)`)
  if (!ok) failed++
}

async function checkServerCard() {
  const res = await fetch(SERVER_CARD)
  const card = await res.json()
  const toolCount = Array.isArray(card.tools) ? card.tools.length : 0
  const ok =
    res.ok &&
    toolCount >= 50 &&
    card.serverInfo?.repository?.includes('github.com/kensaurus/mushi-mushi')
  console.log(`${ok ? '✓' : '✗'} server-card tools=${toolCount} repository=${card.serverInfo?.repository ?? 'missing'}`)
  if (!ok) failed++
}

async function checkTxtHint() {
  const { execSync } = await import('node:child_process')
  let txt = ''
  try {
    txt = execSync('nslookup -type=TXT kensaur.us 8.8.8.8', { encoding: 'utf8' })
  } catch {
    txt = ''
  }
  const ok = txt.includes(TXT_PREFIX)
  console.log(`${ok ? '✓' : '⚠'} DNS TXT on kensaur.us ${ok ? 'present' : 'missing — add smithery-verification=… from Settings → Verification'}`)
  if (!ok) failed++
}

console.log('Smithery verification preflight\n')
await checkBacklink()
await checkServerCard()
await checkTxtHint()
console.log(`\nRegistry: ${SMITHERY_SERVER}`)
process.exit(failed ? 1 : 0)
