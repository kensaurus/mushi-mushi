/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/reportComments.test.tsx
 * PURPOSE: Comment writes fail loudly and in plain English (2026-10-04
 *          console audit, group B):
 *   item 82  RLS lets authors delete only their own comments; a refused delete
 *            removes 0 rows with NO error, so the hook counts deleted rows;
 *   item 83  a refused insert reads as a permission problem with its fix, not
 *            "new row violates row-level security policy …".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { db } = vi.hoisted(() => ({
  db: {
    insertResult: { error: null as null | { message: string; code?: string } },
    deleteResult: { data: [] as Array<{ id: number }>, error: null as null | { message: string } },
  },
}))

vi.mock('./supabase', () => {
  const listQuery = { eq: () => listQuery, order: async () => ({ data: [], error: null }) }
  const channel = { on: () => channel, subscribe: () => channel }
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'me', email: 'me@x.dev', user_metadata: {} } } }) },
      channel: () => channel,
      removeChannel: async () => {},
      from: () => ({
        select: () => listQuery,
        insert: async () => db.insertResult,
        delete: () => ({ eq: () => ({ select: async () => db.deleteResult }) }),
      }),
    },
  }
})

import { useReportComments, type ReportCommentsThread } from './reportComments'

let container: HTMLDivElement
let root: Root
let thread: ReportCommentsThread

function Probe() {
  thread = useReportComments({ reportId: 'r1', projectId: 'p1' })
  return null
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  db.insertResult = { error: null }
  db.deleteResult = { data: [], error: null }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(Probe)))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useReportComments writes', () => {
  it('knows who is signed in, so the thread can offer delete only on your comments', () => {
    expect(thread.currentUserId).toBe('me')
  })

  it('a delete RLS refused (0 rows, no error) is an error, not a silent success', async () => {
    db.deleteResult = { data: [], error: null }
    await expect(thread.deleteComment(5)).rejects.toThrow('You can only delete comments you wrote.')
  })

  it('a refused post explains the permission and its fix, without database text', async () => {
    db.insertResult = { error: { message: 'new row violates row-level security policy for table "report_comments"', code: '42501' } }
    const err = await thread.postComment('hello').catch((e: Error) => e)
    expect((err as Error).message).toMatch(/Ask an owner or admin/)
    expect((err as Error).message).not.toMatch(/row-level security|report_comments/)
  })

  it('an unknown failure never echoes the database message', async () => {
    db.insertResult = { error: { message: 'duplicate key value violates unique constraint "x"' } }
    const err = await thread.postComment('hello').catch((e: Error) => e)
    expect((err as Error).message).not.toMatch(/duplicate key/)
    expect((err as Error).message).toMatch(/^Try again in a moment/)
  })
})
