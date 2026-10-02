/**
 * triage_next_steps "N reporters waiting for a reply" (Plan 018 decision 10)
 * must read the same on both MCP transports. The stdio tool is exercised in
 * packages/mcp's integration test; the hosted handler is a private map entry
 * in functions/mcp/index.ts, so this pins the two blocks to each other.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function waitingBlock(file: string): string {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf('// Reporters who answered in the widget')
  const end = src.indexOf("const fixing = reports.filter((r) => r.status === 'fixing')", start)
  expect(start, `${file} has the waiting block`).toBeGreaterThan(0)
  return src
    .slice(start, end)
    .replace(/;$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('triage_next_steps reporters-waiting parity', () => {
  it('stdio and hosted transports compute and word it identically', () => {
    const stdio = waitingBlock(resolve(HERE, '../../../mcp/src/server.ts'))
    const hosted = waitingBlock(resolve(HERE, '../../supabase/functions/mcp/index.ts'))
    expect(hosted).toBe(stdio)
    expect(stdio).toContain('last_reporter_reply_at')
    expect(stdio).toContain('admin_seen_at')
  })
})
