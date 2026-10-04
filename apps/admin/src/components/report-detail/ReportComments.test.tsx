/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/report-detail/ReportComments.test.tsx
 * PURPOSE: The triage thread (2026-10-04 console audit, group B):
 *   #82  × shows only on your own comments; a delete RLS refused fails loudly;
 *   #83  a refused post reads in plain English, not raw RLS text;
 *   item 239 a reporter-visible post tells the page so the Reporter view refetches.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(), push: vi.fn() },
}))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { ReportComments } from './ReportComments'
import { commentWriteErrorText, type ReportCommentRow, type ReportCommentsThread } from '../../lib/reportComments'

const ME = 'user-me'

function comment(id: number, overrides: Partial<ReportCommentRow>): ReportCommentRow {
  return {
    id,
    report_id: 'r1',
    project_id: 'p1',
    author_user_id: null,
    author_kind: 'admin',
    author_name: 'Someone',
    body: `comment ${id}`,
    visible_to_reporter: false,
    parent_id: null,
    edited_at: null,
    created_at: '2026-10-02T10:00:00Z',
    ...overrides,
  }
}

function thread(overrides: Partial<ReportCommentsThread> = {}): ReportCommentsThread {
  return {
    comments: [
      comment(1, { author_user_id: ME, author_name: 'Me' }),
      comment(2, { author_user_id: 'other-admin', author_name: 'Teammate' }),
      comment(3, { author_user_id: null, author_kind: 'reporter', author_name: null }),
    ],
    loading: false,
    currentUserId: ME,
    postComment: vi.fn(async () => {}),
    deleteComment: vi.fn(async () => {}),
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  toast.error.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(t: ReportCommentsThread, onPosted = vi.fn()) {
  await act(async () => {
    root.render(createElement(ReportComments, { thread: t, onPosted }))
  })
  return { onPosted }
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
}

async function type(value: string) {
  const ta = container.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ReportComments delete (#82)', () => {
  it('offers delete only on comments you wrote', async () => {
    await render(thread())
    expect(container.querySelectorAll('button[aria-label="Delete comment"]').length).toBe(1)
  })

  it('offers none until the signed-in user is known', async () => {
    await render(thread({ currentUserId: null }))
    expect(container.querySelectorAll('button[aria-label="Delete comment"]').length).toBe(0)
  })

  it('a refused delete shows an error instead of closing silently', async () => {
    const t = thread({ deleteComment: vi.fn(async () => { throw new Error('You can only delete comments you wrote.') }) })
    await render(t)
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Delete comment"]')?.click())
    await act(async () => button('Delete')?.click())
    expect(toast.error).toHaveBeenCalledWith('Couldn’t delete comment', 'You can only delete comments you wrote.')
  })
})

describe('ReportComments post (item 239)', () => {
  it('tells the page a reporter-visible reply went out', async () => {
    const { onPosted } = await render(thread())
    await act(async () => button('Message reporter')?.click())
    await type('We shipped a fix')
    await act(async () => button('Post')?.click())
    expect(onPosted).toHaveBeenCalledWith(true)
  })

  it('reports an internal note as not visible to the reporter', async () => {
    const { onPosted } = await render(thread())
    await type('internal note')
    await act(async () => button('Post')?.click())
    expect(onPosted).toHaveBeenCalledWith(false)
  })
})

describe('commentWriteErrorText (#83, #86)', () => {
  it('turns RLS refusals into plain English with the fix', () => {
    const text = commentWriteErrorText(
      { message: 'new row violates row-level security policy for table "report_comments"', code: '42501' },
      'post',
    )
    expect(text).not.toMatch(/row-level security|report_comments/)
    expect(text).toMatch(/Ask an owner or admin/)
  })

  it('never echoes unknown database text', () => {
    expect(commentWriteErrorText({ message: 'duplicate key value violates unique constraint' }, 'post')).toBe(
      'The comment was not saved. Try again in a moment.',
    )
  })
})
