/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/explore/repoUnderstanding.test.tsx
 * PURPOSE: "Copy digest" copies the server's digest text for the right scope,
 *          and the public-page card never publishes a private repo without
 *          the owner ticking the consent box on the exact preview.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch, apiFetchMutate, toast } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchMutate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), push: vi.fn(), warn: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ apiFetch, apiFetchMutate }))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { CopyRepoDigestButton } from './CopyRepoDigestButton'
import { ExploreDiagramPublishCard } from './ExploreDiagramPublishCard'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

function button(text: string): HTMLButtonElement {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!el) throw new Error(`no button "${text}"`)
  return el as HTMLButtonElement
}

describe('CopyRepoDigestButton', () => {
  it('copies the digest for a bug and says what went first', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    apiFetch.mockResolvedValue({
      ok: true,
      data: {
        sha: 'a'.repeat(40),
        total_tokens: 900,
        eligible_files: 3,
        files: [{ path: 'src/a.ts', tokens: 900, truncated: false }],
        redacted: [],
        scope: { kind: 'report', label: '', sources: { stack_frames: 1, fix_files: 0, related_code: 0, dependents: 0 } },
        text: 'Repository: acme/shop',
      },
    })

    act(() => root.render(createElement(CopyRepoDigestButton, { projectId: 'p1', reportId: 'r1', showBudgetPicker: false, label: 'Copy code for this bug' })))
    await act(async () => button('Copy code for this bug').click())
    await flush()

    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/projects/p1/codebase/digest?budget=50000&report_id=r1', { cache: 'no-store' })
    expect(writeText).toHaveBeenCalledWith('Repository: acme/shop')
    expect(toast.success).toHaveBeenCalledWith(
      'Digest copied — paste it into your AI chat',
      expect.stringMatching(/^1 file linked to this bug goes first\./),
    )
  })

  it('uses the picked size and reports a server error instead of copying', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    apiFetch.mockResolvedValue({ ok: false, error: { code: 'NO_REPO', message: 'Connect a GitHub repo to this project first.' } })

    act(() => root.render(createElement(CopyRepoDigestButton, { projectId: 'p1' })))
    const select = container.querySelector('select')!
    await act(async () => {
      select.value = '25000'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => button('Copy digest').click())
    await flush()

    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/projects/p1/codebase/digest?budget=25000', { cache: 'no-store' })
    expect(writeText).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not copy the digest', 'Connect a GitHub repo to this project first.')
  })
})

describe('ExploreDiagramPublishCard', () => {
  const preview = (repoPrivate: boolean) => ({
    ok: true,
    data: {
      diagram_id: 'd1',
      repo_private: repoPrivate,
      payload: { owner: 'acme', repo: 'shop', sha: 'b'.repeat(40), groups: [], edges: [], nodes: [{ id: 'ui', label: 'Web UI', group: 'g', path: 'apps/web', description: 'The app', x: 0, y: 0 }] },
      payload_hash: 'h'.repeat(64),
      url: 'https://kensaur.us/mushi-mushi/r/acme/shop',
      can_publish: true,
    },
  })

  it('shows exactly what becomes public and needs consent for a private repo', async () => {
    apiFetch.mockResolvedValue(preview(true))
    apiFetchMutate.mockResolvedValue({ ok: true, data: { url: 'https://kensaur.us/mushi-mushi/r/acme/shop' } })
    const onChanged = vi.fn()
    act(() => root.render(createElement(ExploreDiagramPublishCard, { projectId: 'p1', publication: { published: false }, onChanged })))

    await act(async () => button('Preview public page').click())
    await flush()
    expect(container.textContent).toContain('This repo is private on GitHub')
    expect(container.textContent).toContain('Web UI')
    expect(container.textContent).toContain('apps/web')
    expect(button('Publish').disabled).toBe(true)

    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => box.click())
    expect(button('Publish').disabled).toBe(false)
    await act(async () => button('Publish').click())
    await flush()

    expect(apiFetchMutate).toHaveBeenCalledWith('/v1/admin/projects/p1/codebase/diagram/publish', {
      method: 'POST',
      body: JSON.stringify({ diagram_id: 'd1', payload_hash: 'h'.repeat(64), confirm_private: true }),
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('reloads the preview when the diagram changed after it was shown', async () => {
    apiFetch.mockResolvedValue(preview(false))
    apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'STALE_PREVIEW', message: 'changed' } })
    act(() => root.render(createElement(ExploreDiagramPublishCard, { projectId: 'p1', publication: { published: false }, onChanged: vi.fn() })))

    await act(async () => button('Preview public page').click())
    await flush()
    expect(button('Publish').disabled).toBe(false)
    await act(async () => button('Publish').click())
    await flush()

    expect(toast.error).toHaveBeenCalledWith('The diagram changed', 'Review the new preview, then publish.')
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('offers unpublish once live', async () => {
    apiFetchMutate.mockResolvedValue({ ok: true, data: { published: false } })
    const onChanged = vi.fn()
    act(() =>
      root.render(
        createElement(ExploreDiagramPublishCard, {
          projectId: 'p1',
          publication: { published: true, url: 'https://kensaur.us/mushi-mushi/r/acme/shop', commit_sha: 'c'.repeat(40), repo_private: false, published_at: '', outdated: false },
          onChanged,
        }),
      ),
    )
    expect(container.textContent).toContain('Live at')
    await act(async () => button('Unpublish').click())
    await flush()
    expect(apiFetchMutate).toHaveBeenCalledWith('/v1/admin/projects/p1/codebase/diagram/publish', { method: 'DELETE' })
    expect(onChanged).toHaveBeenCalled()
  })
})
