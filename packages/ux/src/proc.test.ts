// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { run } from './proc.js'

describe('run', () => {
  // CI, 2026-10-07: a git child exited before reading its stdin, the write
  // failed with EPIPE, and with no listener that crashed the whole process.
  it('survives a child that exits without reading its stdin', async () => {
    const res = await run(process.execPath, ['-e', 'process.exit(3)'], { cwd: process.cwd(), stdin: 'x'.repeat(5_000_000), timeoutMs: 20_000 })
    expect(res.exitCode).toBe(3)
  })
})
