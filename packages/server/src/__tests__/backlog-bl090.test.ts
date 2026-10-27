/**
 * FILE: backlog-bl090.test.ts
 * PURPOSE: Closing BL-090 decrements the backlog summary by one and dates
 *          the close to the day the route manifest and config docs were
 *          regenerated. The summary must not gain a dependency class row.
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

describe('BL-090 close in docs/BACKLOG.md', () => {
  it('drops open and unfinished-feature by one, leaves dependency out, and dates the close 2026-10-27', () => {
    expect(backlog).toContain('**Open items:** 56 · **Recently closed:** 25 (BL-090 on 2026-10-27;')
    expect(backlog).toContain('**Closed 2026-10-27:** BL-090.')
    expect(backlog).not.toContain('BL-090 on 2026-10-20')
    expect(backlog).not.toContain('**Closed 2026-10-20:** BL-090')

    const classes = between('| Class | Open |', '| Status | Open |')
    expect(classes).toContain('| unfinished-feature | 21 |')
    expect(classes).not.toContain('| dependency |')

    const statuses = between('| Status | Open |', '> **Scanned')
    expect(statuses).toContain('| relevant | 53 |')

    const openIndex = between('## Index', '## Recently closed')
    expect(openIndex).not.toContain('| BL-090 |')

    const closed = between('## Recently closed', '## Keeping this alive')
    expect(closed).toContain(
      '| BL-090 | Cursor model picker for spend-down and Integrations. The console took a free-text model spec validated by `parseCursorModelSpec` | 2026-10-27 |',
    )
    expect(closed).not.toContain('| 2026-10-20 | `GET /v1/admin/byok/cursor/models`')
  })
})
