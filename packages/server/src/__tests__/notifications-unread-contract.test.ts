/**
 * Notifications Inbox (suspected-bugs entries 256 and 118), pinned in source
 * because Hono is stubbed under vitest:
 *   - "Unread" is sent-and-not-read everywhere: the stats badge, the
 *     `unread=1` list filter and "Mark all read", so the three agree and a
 *     held Outbox row is never stamped read before it is released;
 *   - the "updates are off" step points at the Setup tab switch, in words.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/admin-ops.ts'), 'utf8')

function route(signature: string): string {
  const start = src.indexOf(signature)
  expect(start, `${signature} missing`).toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('\n  app.', start + 10))
}

describe('reporter notifications unread rule', () => {
  it('the unread list filter counts sent rows only', () => {
    expect(route("app.get('/v1/admin/notifications', jwtAuth")).toContain(
      "if (onlyUnread) query = query.is('read_at', null).eq('status', 'sent')",
    )
  })

  it('Mark all read stamps sent rows only', () => {
    const body = route("app.post('/v1/admin/notifications/read-all'")
    expect(body).toMatch(/\.is\('read_at', null\)\s*(\/\/[^\n]*\n\s*)*\.eq\('status', 'sent'\)/)
  })

  it('the stats badge skips held and discarded rows', () => {
    expect(route("app.get('/v1/admin/notifications/stats'")).toContain(
      "else if (row.status !== 'discarded' && !row.read_at) unread += 1",
    )
  })
})

describe('reporter updates off', () => {
  it('points at the Setup tab and never names the column', () => {
    const body = route("app.get('/v1/admin/notifications/stats'")
    expect(body).toContain("topPriorityTo = '/notifications?tab=setup'")
    expect(body).not.toMatch(/topPriorityLabel =\s*'reporter_notifications_enabled/)
  })
})
