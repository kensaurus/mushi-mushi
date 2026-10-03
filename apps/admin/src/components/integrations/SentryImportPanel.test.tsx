/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/SentryImportPanel.test.tsx
 * PURPOSE: The console reaches every Sentry import option the API and MCP
 *          already had: a Sentry project picker (primary + extra slugs), a
 *          "seen in the last N days" choice, and "Load next page" that repeats
 *          the same search with the answer's nextCursor.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => api)
vi.mock('../ProjectSwitcher', () => ({ useActiveProjectId: () => '11111111-1111-4111-8111-111111111111' }))

import { SentryImportPanel } from './SentryImportPanel'

const PROJECT = '11111111-1111-4111-8111-111111111111'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function page(nextCursor: string | null, shortId: string) {
  return {
    ok: true,
    data: {
      items: [{ input: shortId, issueId: '1', shortId, outcome: 'created', reportId: null }],
      created: ['r1'],
      linked: [],
      failed: 0,
      indexing: { queued: false, paths: 0 },
      sentryProject: 'sbc-be',
      nextCursor,
    },
  }
}

function sentBody(call: number): Record<string, unknown> {
  const init = api.apiFetchMutate.mock.calls[call][1] as { body: string }
  return JSON.parse(init.body) as Record<string, unknown>
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
}

function choose(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('SentryImportPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetchMutate.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(sentryProjects: string[]): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SentryImportPanel, { sentryProjects })))
      await flush()
    })
  }

  it('searches the picked Sentry project for the chosen window and pages with nextCursor', async () => {
    api.apiFetchMutate.mockResolvedValueOnce(page('1700000000:0:0', 'BE-1')).mockResolvedValueOnce(page(null, 'BE-2'))
    await render(['sbc-front', 'sbc-be'])

    const project = container.querySelector<HTMLSelectElement>('select[aria-label="Sentry project"]')!
    const since = container.querySelector<HTMLSelectElement>('select[aria-label="Seen in"]')!
    expect(Array.from(project.options).map((o) => o.value)).toEqual(['sbc-front', 'sbc-be'])
    await act(async () => {
      choose(project, 'sbc-be')
      choose(since, '30')
      await flush()
    })

    await act(async () => {
      buttonByText(container, 'seen in 30d')!.click()
      await flush()
    })
    expect(api.apiFetchMutate.mock.calls[0][0]).toBe(`/v1/admin/projects/${PROJECT}/sentry/import`)
    expect(sentBody(0)).toEqual({ limit: 10, sinceDays: 30, sentryProject: 'sbc-be' })

    const next = buttonByText(container, 'Load next page')
    expect(next).toBeDefined()
    await act(async () => {
      next!.click()
      await flush()
    })
    expect(sentBody(1)).toEqual({ limit: 10, sinceDays: 30, sentryProject: 'sbc-be', cursor: '1700000000:0:0' })
    expect(container.textContent).toContain('Page 2 of sbc-be')
    expect(buttonByText(container, 'Load next page')).toBeUndefined()
    expect(container.textContent).toContain('That was the last page')
  })

  it('hides the picker for a single Sentry project and the search options while ids are typed', async () => {
    api.apiFetchMutate.mockResolvedValueOnce(page(null, 'WEB-12'))
    await render(['web'])
    expect(container.querySelector('select[aria-label="Sentry project"]')).toBeNull()
    expect(container.querySelector('select[aria-label="Seen in"]')).not.toBeNull()

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Sentry issue ids"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'WEB-12')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await flush()
    })
    expect(container.querySelector('select[aria-label="Seen in"]')).toBeNull()
    await act(async () => {
      buttonByText(container, 'Import 1')!.click()
      await flush()
    })
    expect(sentBody(0)).toEqual({ issueIds: ['WEB-12'] })
    expect(buttonByText(container, 'Load next page')).toBeUndefined()
  })
})
