/**
 * @vitest-environment jsdom
 */

/**
 * QA 292: "Open draft PR" was enabled for a project member, whom the server
 * always refuses (403), so the member learned it only after confirming.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = '0000000c-0000-4000-8000-000000000000'
const role = vi.hoisted(() => ({ value: 'member' }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({
    data: { organizations: [{ id: ORG, slug: 'a', name: 'A', plan_id: 'free', role: role.value }] },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))
vi.mock('../../lib/activeOrg', () => ({ useActiveOrgSignal: () => ORG }))
vi.mock('../../lib/activeProject', () => ({ useActiveProjectSignal: () => '' }))

import { DesignChangePreview } from './DesignChangePreview'

const PREVIEW = {
  dryRun: true,
  files: [{ path: 'tokens.json', additions: 1, deletions: 1, diff: '--- a\n+++ b\n-x\n+y' }],
  denied: [],
  pr: null,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  role.value = 'member'
})

function render() {
  act(() => {
    root.render(
      createElement(DesignChangePreview, {
        state: { phase: 'previewed', preview: PREVIEW, result: null, error: null } as never,
        onConfirm: vi.fn(),
        onDiscard: vi.fn(),
      }),
    )
  })
}

function openPr(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Open draft PR')
}

describe('DesignChangePreview', () => {
  it('disables Open draft PR for a member and says who can open it', () => {
    render()
    expect(openPr()?.disabled).toBe(true)
    expect(container.textContent).toContain("Only owners and admins of this project's team can open a draft PR.")
  })

  it('keeps it enabled for an owner', () => {
    role.value = 'owner'
    render()
    expect(openPr()?.disabled).toBe(false)
  })
})
