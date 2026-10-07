/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/connect/GithubConnectionCard.test.tsx
 * PURPOSE: A project with a frontend and a backend repo showed only the
 *          primary URL on /connect. Every linked repo now shows with its role.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pageData = vi.hoisted(() => ({ usePageData: vi.fn() }))
vi.mock('../../lib/usePageData', () => pageData)

import { GithubConnectionCard } from './GithubConnectionCard'
import type { PreflightState } from '../../lib/useDispatchPreflight'

const P = '1000000f-0000-4000-8000-000000000000'
const PREFLIGHT = {
  loading: false,
  repoUrl: 'https://github.com/o/web',
  checks: [{ key: 'github', ready: true }],
} as unknown as PreflightState

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  pageData.usePageData.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(projectId: string | null) {
  act(() =>
    root.render(
      createElement(MemoryRouter, null,
        createElement(GithubConnectionCard, { projectId, preflight: PREFLIGHT, fallbackRepoUrl: null }),
      ),
    ),
  )
}

describe('GithubConnectionCard', () => {
  it('lists every linked repo with its role', () => {
    pageData.usePageData.mockReturnValue({
      data: [
        { id: 'r1', repo_url: 'https://github.com/o/web', role: 'frontend', is_primary: true },
        { id: 'r2', repo_url: 'https://github.com/o/api', role: 'backend', is_primary: false },
      ],
    })
    render(P)
    const text = host.textContent ?? ''
    expect(pageData.usePageData).toHaveBeenCalledWith(`/v1/admin/repo/repos?project_id=${P}`)
    expect(text).toContain('GitHub repositories (2)')
    expect(text).toContain('Frontend')
    expect(text).toContain('o/web')
    expect(text).toContain('Backend')
    expect(text).toContain('o/api')
    expect(text).toContain('Manage repos')
  })

  it('falls back to the preflight URL when no repo rows load', () => {
    pageData.usePageData.mockReturnValue({ data: null })
    render(null)
    expect(pageData.usePageData).toHaveBeenCalledWith(null)
    expect(host.textContent).toContain('https://github.com/o/web')
    expect(host.textContent).toContain('Connected')
  })
})
