/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/repo/RepoIndexStatus.test.tsx
 * PURPOSE: The Repo page and repos card show the last sweep of either kind
 *          (index coverage, gap 16a). A repo held at its plan's file limit
 *          never sets last_indexed_at, and used to lose its "Indexed" chip.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RepoIndexStatus, repoIndexView } from './RepoIndexStatus'

const SWEPT = '2026-10-03T10:00:00Z'
const OLD = '2026-09-01T10:00:00Z'

describe('repoIndexView', () => {
  it('a capped repo with no complete sweep reads as partly indexed, with coverage', () => {
    expect(repoIndexView({
      last_indexed_at: null,
      index_swept_at: SWEPT,
      index_coverage_state: 'capped',
      index_files_indexed: 300,
      index_files_eligible: 4714,
    })).toEqual({ label: 'Partly indexed', tone: 'warn', at: SWEPT, coverage: '300 of 4,714 files' })
  })

  it('takes the later sweep, so a frozen pre-migration last_indexed_at is not shown', () => {
    expect(repoIndexView({ last_indexed_at: OLD, index_swept_at: SWEPT, index_coverage_state: 'filling' })?.at).toBe(SWEPT)
  })

  it('a stalled repo says so', () => {
    expect(repoIndexView({ last_indexed_at: null, index_swept_at: SWEPT, index_coverage_state: 'stalled' })?.label).toBe('Index stalled')
  })

  it('complete and older rows read as indexed; never swept is nothing', () => {
    expect(repoIndexView({ last_indexed_at: SWEPT, index_swept_at: SWEPT, index_coverage_state: 'complete' })?.label).toBe('Indexed')
    expect(repoIndexView({ last_indexed_at: SWEPT })?.label).toBe('Indexed')
    expect(repoIndexView({ last_indexed_at: null, index_swept_at: null })).toBeNull()
  })
})

describe('RepoIndexStatus', () => {
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
  })

  function render(props: Parameters<typeof RepoIndexStatus>[0]): HTMLElement | null {
    act(() => root.render(createElement(RepoIndexStatus, props)))
    return container.querySelector('[data-testid="repo-index-status"]')
  }

  it('renders a capped repo (null last_indexed_at) instead of hiding it', () => {
    for (const variant of ['chip', 'line'] as const) {
      const el = render({
        variant,
        repo: { last_indexed_at: null, index_swept_at: SWEPT, index_coverage_state: 'capped', index_files_indexed: 300, index_files_eligible: 4714 },
      })
      expect(el, variant).not.toBeNull()
      expect(el?.textContent).toContain('Partly indexed: 300 of 4,714 files, swept')
      expect(el?.textContent).not.toMatch(/^Indexed/)
    }
  })

  it('renders a complete repo as "Indexed …"', () => {
    const el = render({ variant: 'chip', repo: { last_indexed_at: SWEPT, index_swept_at: SWEPT, index_coverage_state: 'complete' } })
    expect(el?.textContent).toMatch(/^Indexed /)
  })

  it('renders nothing before the first sweep', () => {
    expect(render({ variant: 'line', repo: { last_indexed_at: null, index_swept_at: null } })).toBeNull()
  })
})
