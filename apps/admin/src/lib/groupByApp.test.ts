import { describe, expect, it } from 'vitest'
import { countBy, groupByApp, UNASSIGNED_APP_ID } from './groupByApp'

type Row = { pid: string | null; name?: string; status: 'failed' | 'passed' | 'running'; n: number }
const RANK = { failed: 0, running: 1, passed: 2 } as const

describe('groupByApp', () => {
  const rows: Row[] = [
    { pid: 'a', name: 'alpha', status: 'passed', n: 1 },
    { pid: 'b', name: 'beta', status: 'failed', n: 2 },
    { pid: 'a', name: 'alpha', status: 'failed', n: 3 },
    { pid: null, status: 'passed', n: 4 },
    { pid: 'c', name: 'gamma', status: 'passed', n: 5 },
    { pid: 'b', name: 'beta', status: 'passed', n: 6 },
  ]

  it('groups rows by app and keeps input order without a rank', () => {
    const g = groupByApp(rows, (r) => ({ id: r.pid, name: r.name }))
    expect(g.map((x) => x.id)).toEqual(['a', 'b', 'c', UNASSIGNED_APP_ID])
    expect(g[0].items.map((r) => r.n)).toEqual([1, 3])
  })

  it('puts the app with the worst row first and sorts rows worst first', () => {
    const g = groupByApp(rows, (r) => ({ id: r.pid, name: r.name }), { rank: (r) => RANK[r.status] })
    // a and b both hold a failure (rank 0) and two rows: name decides.
    expect(g.map((x) => x.name)).toEqual(['alpha', 'beta', 'gamma', 'Unassigned'])
    expect(g[0].items.map((r) => r.status)).toEqual(['failed', 'passed'])
    expect(g[0].worstRank).toBe(0)
  })

  it('names an app from a later row when the first had no name', () => {
    const g = groupByApp(
      [
        { pid: '12345678-aaaa', status: 'passed', n: 1 },
        { pid: '12345678-aaaa', name: 'yen-yen', status: 'passed', n: 2 },
      ] as Row[],
      (r) => ({ id: r.pid, name: r.name }),
    )
    expect(g[0].name).toBe('yen-yen')
  })
})

it('countBy counts per key and skips nulls', () => {
  expect(countBy(['failed', 'passed', 'failed', null], (s) => s)).toEqual({ failed: 2, passed: 1 })
})
