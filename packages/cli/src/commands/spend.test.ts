import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { okReply, runCli } from '../test-harness.js'
import { registerSpendCommands } from './spend.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const IMP = '22222222-3333-4444-8555-666666666666'

const ledger = {
  organizationId: 'org',
  from: '2026-09-03T00:00:00Z',
  to: '2026-10-03T00:00:00Z',
  days: 30,
  apps: [{ projectId: 'p1', name: 'glot.it', totalUsd: 12.5 }, { projectId: 'p2', name: 'yen-yen', totalUsd: 30 }],
  totals: { mushiLlmUsd: 2, providerLlmUsd: 10, ciUsd: 5.5, supabaseUsd: 25, billsUsd: 0, totalUsd: 42.5 },
  unattributedProviderUsd: null,
  complete: false,
  imports: [{ id: IMP, vendor: 'vercel', filename: 'sept.csv', totalUsd: 7.5, periodStart: '2026-09-01', periodEnd: '2026-09-30', createdAt: '2026-10-01T00:00:00Z' }],
}

function bill(content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'mushi-spend-')), 'vercel-sept.csv')
  writeFileSync(file, content)
  return file
}

describe('mushi spend show', () => {
  it('prints the totals, the apps most expensive first, and the latest imports', async () => {
    const run = await runCli(registerSpendCommands, ['spend', 'show'], () => okReply(ledger))
    expect(run.calls[0]!.path).toBe('/v1/admin/orgs/current/spend')
    expect(run.stdout).toContain('$42.50')
    expect(run.stdout.indexOf('yen-yen')).toBeLessThan(run.stdout.indexOf('glot.it'))
    expect(run.stdout).toContain('the totals are a floor')
    expect(run.stdout).toContain(IMP)
  })
})

describe('mushi spend import', () => {
  it('posts the file with its vendor, name and app', async () => {
    const file = bill('date,service,cost\n2026-09-01,Functions,3')
    const run = await runCli(registerSpendCommands, ['spend', 'import', file, '--vendor', 'vercel', '--project-id', PID], () => okReply({
      importId: IMP, format: 'generic', rowsRead: 1, rowsImported: 1, rowsSkipped: 0, skipReasons: [], unmatchedApps: [], totalUsd: 3, periodStart: '2026-09-01', periodEnd: '2026-09-01',
    }))
    expect(run.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/admin/orgs/current/spend/imports',
      body: { vendor: 'vercel', csv: 'date,service,cost\n2026-09-01,Functions,3', filename: 'vercel-sept.csv', projectId: PID },
    })
    expect(run.stdout).toContain('Imported 1 of 1 row(s)')
  })

  it('refuses an unknown vendor or a missing file before calling the API', async () => {
    const vendor = await runCli(registerSpendCommands, ['spend', 'import', bill('x'), '--vendor', 'gcp'])
    expect(vendor.calls).toHaveLength(0)
    expect(vendor.error?.code).toBe('E_INVALID_INPUT')
    const missing = await runCli(registerSpendCommands, ['spend', 'import', join(tmpdir(), 'no-such-bill.csv'), '--vendor', 'aws'])
    expect(missing.calls).toHaveLength(0)
    expect(missing.error?.message).toContain('Cannot read')
  })
})

describe('mushi spend remove', () => {
  it('removes an import only with --yes', async () => {
    const refused = await runCli(registerSpendCommands, ['spend', 'remove', IMP])
    expect(refused.calls).toHaveLength(0)
    const run = await runCli(registerSpendCommands, ['spend', 'remove', IMP, '--yes'], () => okReply({ importId: IMP, rowsRemoved: 2, rowsRestored: 1, restoredFrom: 1 }))
    expect(run.calls[0]).toMatchObject({ method: 'DELETE', path: `/v1/admin/orgs/current/spend/imports/${IMP}` })
    expect(run.stdout).toContain('2 row(s) removed, 1 restored')
  })
})
