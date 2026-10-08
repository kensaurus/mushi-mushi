/**
 * "Sync now" with a full re-sync embeds every skill and outlasts the 150 s
 * gateway limit, so the console got a 504 while the sync kept running. The
 * route waits a bounded time, then answers `status: 'running'` and keeps the
 * sync alive. Checked at source level, like the other route wiring tests.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const route = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/skills.ts'), 'utf8')
const cli = readFileSync(resolve(__dirname, '../../../cli/src/commands/skills.ts'), 'utf8')

describe('POST /v1/admin/skills/sources/:id/sync', () => {
  it('waits at most SYNC_WAIT_MS, well under the gateway limit', () => {
    const ms = Number(route.match(/const SYNC_WAIT_MS = ([\d_]+)/)?.[1].replace(/_/g, ''))
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThan(150_000)
  })

  it('keeps the sync alive and says it is still running', () => {
    expect(route).toMatch(/waitUntil\(sync/)
    expect(route).toMatch(/status: 'running' \} \}, 202\)/)
  })

  it('the CLI reports a running sync instead of "0 synced"', () => {
    expect(cli).toMatch(/status === 'running'/)
  })
})
