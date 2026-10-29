/**
 * FILE: apps/admin/src/components/fixes/PdcaReceipt.test.ts
 * PURPOSE: The fixes-page receipt must show a local Cursor run in plain words
 *          and must not print stored ANSI (including a double-encoded \\u001b).
 */

import { describe, expect, it } from 'vitest'
import type { FixAttempt } from './types'
import { buildReceipts } from './PdcaReceipt'

const fix = (overrides: Partial<FixAttempt>): FixAttempt => ({
  id: 'f1',
  report_id: '11111111-1111-4111-8111-111111111111',
  agent: 'mcp',
  status: 'failed',
  started_at: '2026-10-28T00:00:00Z',
  error: 'git push failed: \\u001b[38;2;56;56;56m│\\u001b[0m hook steps failed: test',
  ...overrides,
})

describe('buildReceipts', () => {
  it('labels a local Cursor run and strips a double-encoded color from the error', () => {
    const receipts = buildReceipts(fix({ agent: 'local-cursor' }), [])
    expect(receipts.plan.proof).toContain('local Cursor')
    expect(receipts.plan.proof).not.toContain('mcp')
    const mcp = buildReceipts(fix({ agent: 'mcp' }), [])
    expect(mcp.plan.proof).toContain('MCP')
    expect(mcp.plan.proof).not.toContain('local Cursor')
    expect(receipts.do.proof).toContain('hook steps failed: test')
    expect(receipts.do.proof).not.toContain('\\u001b')
    expect(receipts.act.proof).not.toContain('\\u001b')
  })
})
