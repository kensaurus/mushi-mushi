/**
 * FILE: backlog-bl090.test.ts
 * PURPOSE: Closing BL-090 moves its row from the open index to Recently
 *          closed (dated 2026-10-27), and the summary counts match a recount
 *          of the two tables.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const backlog = readFileSync(resolve(__dirname, '../../../../docs/BACKLOG.md'), 'utf8')

function between(start: string, end: string): string {
  const from = backlog.indexOf(start)
  const to = backlog.indexOf(end, from + start.length)
  return backlog.slice(from, to)
}

function rows(section: string): string[][] {
  return section
    .split('\n')
    .filter((line) => line.startsWith('| BL-'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
}

function summaryCounts(section: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of section.split('\n')) {
    const m = /^\| ([^|]+?) \| (\d+) \|$/.exec(line)
    if (m) counts.set(m[1], Number(m[2]))
  }
  return counts
}

function tally(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return counts
}

const openRows = rows(between('## Index', '## Recently closed'))
const closedRows = rows(between('## Recently closed', '## Keeping this alive'))

describe('BL-090 close in docs/BACKLOG.md', () => {
  it('moves BL-090 to Recently closed, dated 2026-10-27', () => {
    expect(openRows.some((r) => r[1] === 'BL-090')).toBe(false)
    const closed = closedRows.find((r) => r[1] === 'BL-090')
    expect(closed?.[3]).toBe('2026-10-27')
    expect(backlog).toContain('**Closed 2026-10-27:** BL-090.')
    expect(backlog).toContain('(BL-090 on 2026-10-27;')
  })

  it('states open and recently-closed counts that match the tables', () => {
    const m = /\*\*Open items:\*\* (\d+) · \*\*Recently closed:\*\* (\d+) /.exec(backlog)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(openRows.length)
    expect(Number(m![2])).toBe(closedRows.length)
  })

  it('states class and status counts that match the open index', () => {
    const classes = summaryCounts(between('| Class | Open |', '| Status | Open |'))
    expect(classes).toEqual(tally(openRows.map((r) => r[2])))

    const statuses = summaryCounts(between('| Status | Open |', '> **Scanned'))
    const counted = tally(openRows.map((r) => r[4]))
    for (const [status, n] of statuses) expect(n, status).toBe(counted.get(status) ?? 0)
    expect([...statuses.values()].reduce((a, b) => a + b, 0)).toBe(openRows.length)
  })
})
