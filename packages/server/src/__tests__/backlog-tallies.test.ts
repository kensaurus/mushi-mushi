/**
 * FILE: backlog-tallies.test.ts
 * PURPOSE: Backlog summary counts agree with each other, without pinning a row.
 *
 * OVERVIEW:
 * - The class table, the status table and the open-items line must sum to
 *   the same number. The recently-closed line must match that table.
 * - A server test that reads the register and names a backlog id fails.
 *   That pin breaks when the owner closes the row.
 *
 * DEPENDENCIES:
 * - node:fs, node:path, vitest
 *
 * USAGE:
 * - Vitest picks this up from packages/server (`src/**\/*.test.ts`).
 *
 * NOTES:
 * - Does not recount the index. Rows added after the last housekeep can
 *   outnumber the summary; recounting is a housekeep, not this check.
 * - Does not assert any row's wording or status.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const backlog = readFileSync(resolve(__dirname, '../../../../docs/BACKLOG.md'), 'utf8')

function between(start: string, end: string): string {
  const at = backlog.indexOf(start)
  expect(at, `missing ${JSON.stringify(start)}`).toBeGreaterThanOrEqual(0)
  const rest = backlog.slice(at + start.length)
  const stop = rest.indexOf(end)
  expect(stop, `missing ${JSON.stringify(end)} after ${JSON.stringify(start)}`).toBeGreaterThanOrEqual(0)
  return rest.slice(0, stop)
}

function sumColumn(block: string): number {
  let sum = 0
  let rows = 0
  for (const line of block.split('\n')) {
    const match = line.match(/^\| (.+?) \| (\d+) \|$/)
    if (!match) continue
    sum += Number(match[2])
    rows += 1
  }
  expect(rows).toBeGreaterThan(0)
  return sum
}

describe('backlog tallies agree', () => {
  it('class, status and open-item counts are one total', () => {
    const summary = backlog.match(/\*\*Open items:\*\*\s+(\d+)\s+·\s+\*\*Recently closed:\*\*\s+(\d+)/)
    expect(summary, 'open-items summary line').not.toBeNull()
    const openItems = Number(summary![1])
    const classTotal = sumColumn(between('| Class | Open |', '| Status | Open |'))
    const statusTotal = sumColumn(between('| Status | Open |', '\n>'))
    expect(classTotal).toBe(openItems)
    expect(statusTotal).toBe(openItems)
  })

  it('recently-closed count matches that table', () => {
    const summary = backlog.match(/\*\*Recently closed:\*\*\s+(\d+)/)
    expect(summary, 'recently-closed summary').not.toBeNull()
    const closed = between('## Recently closed', '## Keeping this alive')
      .split('\n')
      .filter((line) => line.startsWith('| BL-'))
    expect(closed.length).toBe(Number(summary![1]))
  })

  it('does not let a server test pin one backlog id', () => {
    for (const name of readdirSync(__dirname)) {
      if (!name.endsWith('.test.ts')) continue
      const src = readFileSync(resolve(__dirname, name), 'utf8')
      if (!src.includes('BACKLOG.md')) continue
      expect(src, name).not.toMatch(/BL-\d+/)
    }
  })
})
