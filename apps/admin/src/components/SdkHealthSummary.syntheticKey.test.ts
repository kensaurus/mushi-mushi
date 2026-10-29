/**
 * The Bugs empty state stood in for "any SDK key" with a fake key row,
 * "mushi_xxxx…", labelled "Most recent SDK heartbeat" (first-time user test,
 * 2026-10-28). Nothing on a signed-in page may look like a key to paste.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'SdkHealthSummary.tsx'), 'utf8')

describe('SdkConnectivityEmptyState stand-in key', () => {
  it('does not look like a key or say heartbeat', () => {
    expect(src).not.toMatch(/key_prefix: 'mushi_/)
    expect(src).not.toContain('Most recent SDK heartbeat')
  })
})
