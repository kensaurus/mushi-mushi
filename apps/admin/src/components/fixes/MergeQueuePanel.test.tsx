/**
 * @vitest-environment jsdom
 *
 * Merge when ready rows (ADR 0041). The visible ref is #N when every queue
 * and merged row shares a repo, and <repo>#N (no owner) when those rows
 * span more than one repo. The full owner/repo#N is the title. A train
 * with no PR yet shows the repo name without the owner. A train from a
 * second repo does not by itself switch the queue labels.
 *
 * jsdom cannot measure 390px overflow. That check is
 * examples/e2e-dogfood/tests/merge-queue-panel-overflow.spec.ts.
 * `pnpm test` does not run it (the e2e package's test script is a no-op).
 * The CI e2e job is opt-in (ENABLE_E2E_CI) and the nightly job is opt-in
 * (ENABLE_NIGHTLY_PROD_PDCA). Label and title assertions are what this
 * file owns. Class-name checks are a separate secondary test; they do
 * not prove the layout.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MergeQueueRow, ReleaseTrain } from '../../lib/mergeQueue'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))

import { MergeQueuePanel } from './MergeQueuePanel'

const REPO = 'kensaurus/solo-boss-cloud-documentation'
const BARE_REPO = 'acme/widget-docs'
const PR = 789
const TRAIN_PR = 790
const MERGED_PR = 791
const OTHER_PR = 12
const OTHER_MERGED_PR = 13
const REASON = 'Branch is behind its base after the previous merge.'

function row(partial: Pick<MergeQueueRow, 'id' | 'state' | 'pr_number'> & Partial<MergeQueueRow>): MergeQueueRow {
  return {
    fix_attempt_id: partial.id,
    project_id: 'proj-1',
    repo: REPO,
    detail: REASON,
    head_sha: null,
    queued_at: '2026-10-24T00:00:00Z',
    updated_at: '2026-10-24T01:00:00Z',
    merged_at: partial.state === 'merged' ? '2026-10-24T02:00:00Z' : null,
    conflict_agents: 0,
    ...partial,
  }
}

const TRAIN: ReleaseTrain = {
  id: 'train-1',
  project_id: 'proj-1',
  repo: REPO,
  pr_number: TRAIN_PR,
  state: 'testing',
  members: [PR],
  attempt: 1,
  detail: 'CI running',
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T01:00:00Z',
  merged_at: null,
}

/** A moving train with no PR number yet: the row shows the repo, not #N. */
const BARE_TRAIN: ReleaseTrain = {
  ...TRAIN,
  id: 'train-bare',
  repo: BARE_REPO,
  pr_number: null,
  members: [1],
}

function refHref(pr: number, repo = REPO) {
  return `https://github.com/${repo}/pull/${pr}`
}

function queuePayload(rows: MergeQueueRow[], trains: ReleaseTrain[] = [TRAIN, BARE_TRAIN]) {
  return { ok: true, data: { rows, trains } }
}

describe('MergeQueuePanel narrow rows', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue(queuePayload([
      row({ id: 'held', state: 'blocked', pr_number: PR }),
      row({ id: 'done', state: 'merged', pr_number: MERGED_PR, detail: null }),
    ]))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderPanel() {
    await act(async () => {
      root.render(createElement(MergeQueuePanel, { projectId: 'proj-1', refreshKey: 0 }))
    })
  }

  it('shows #N and the full owner/repo#N title when queue and merged rows share one repo', async () => {
    await renderPanel()

    const link = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(PR)}"]`)
    expect(link?.textContent).toBe(`#${PR}`)
    expect(link?.getAttribute('title')).toBe(`${REPO}#${PR}`)
    expect(link?.textContent).not.toContain('/')
    expect(link?.textContent).not.toContain(REPO)

    const train = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(TRAIN_PR)}"]`)
    expect(train?.textContent).toBe(`#${TRAIN_PR}`)
    expect(train?.getAttribute('href')).toBe(refHref(TRAIN_PR))
    expect(train?.getAttribute('title')).toBe(`${REPO}#${TRAIN_PR}`)

    // BARE_TRAIN is a second repo, but it is not a queue or merged row.
    const bare = Array.from(document.querySelectorAll('span')).find((el) => el.textContent === 'widget-docs')
    expect(bare?.getAttribute('title')).toBe(BARE_REPO)

    const showMerged = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('merged today'))
    expect(showMerged).toBeTruthy()
    await act(async () => showMerged!.click())
    const merged = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(MERGED_PR)}"]`)
    expect(merged?.textContent).toBe(`#${MERGED_PR}`)
    expect(merged?.getAttribute('title')).toBe(`${REPO}#${MERGED_PR}`)
    expect(merged?.textContent).not.toContain('/')
  })

  it('shows repo#N without the owner when queue or merged rows span more than one repo', async () => {
    mocks.apiFetch.mockResolvedValue(queuePayload([
      row({ id: 'held', state: 'blocked', pr_number: PR }),
      row({ id: 'other', state: 'queued', pr_number: OTHER_PR, repo: BARE_REPO, detail: 'Waiting on CI.' }),
      row({ id: 'done', state: 'merged', pr_number: MERGED_PR, detail: null }),
      row({ id: 'done-other', state: 'merged', pr_number: OTHER_MERGED_PR, repo: BARE_REPO, detail: null }),
    ]))
    await renderPanel()

    const held = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(PR)}"]`)
    expect(held?.textContent).toBe(`solo-boss-cloud-documentation#${PR}`)
    expect(held?.getAttribute('title')).toBe(`${REPO}#${PR}`)
    expect(held?.textContent).not.toContain('kensaurus/')

    const other = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(OTHER_PR, BARE_REPO)}"]`)
    expect(other?.textContent).toBe(`widget-docs#${OTHER_PR}`)
    expect(other?.getAttribute('title')).toBe(`${BARE_REPO}#${OTHER_PR}`)
    expect(other?.getAttribute('href')).toBe(refHref(OTHER_PR, BARE_REPO))
    expect(other?.textContent).not.toContain('acme/')

    // Train links stay #N. The multi-repo label is for queue and merged rows.
    const train = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(TRAIN_PR)}"]`)
    expect(train?.textContent).toBe(`#${TRAIN_PR}`)

    const showMerged = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('merged today'))
    expect(showMerged).toBeTruthy()
    await act(async () => showMerged!.click())
    const merged = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(MERGED_PR)}"]`)
    const mergedOther = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(OTHER_MERGED_PR, BARE_REPO)}"]`)
    expect(merged?.textContent).toBe(`solo-boss-cloud-documentation#${MERGED_PR}`)
    expect(merged?.getAttribute('title')).toBe(`${REPO}#${MERGED_PR}`)
    expect(mergedOther?.textContent).toBe(`widget-docs#${OTHER_MERGED_PR}`)
    expect(mergedOther?.getAttribute('title')).toBe(`${BARE_REPO}#${OTHER_MERGED_PR}`)
    expect(document.body.textContent).not.toContain('kensaurus/')
    expect(document.body.textContent).not.toContain('acme/')
  })

  describe('secondary class names (they do not prove the 390px layout)', () => {
    it('keeps wrap classes on the ref and a content flex basis on the reason', async () => {
      await renderPanel()

      const link = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(PR)}"]`)
      expect(link?.className).toContain('wrap-anywhere')
      expect(link?.className).toContain('min-w-0')
      expect(link?.className).toContain('max-w-full')

      const queueRow = link?.closest('li')
      expect(queueRow?.className).toContain('flex-wrap')
      // Badge and Remove forward className (shrink-0 is not on those primitives).
      expect(queueRow?.firstElementChild?.className).toContain('shrink-0')
      expect(queueRow?.querySelector('button')?.className).toContain('shrink-0')
      const reason = queueRow?.querySelector('span.flex-auto')
      expect(reason?.textContent).toContain(REASON)
      expect(reason?.className).toContain('wrap-break-word')
      expect(reason?.className.split(/\s+/)).not.toContain('flex-1')

      const train = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(TRAIN_PR)}"]`)
      expect(train?.className).toContain('wrap-anywhere')
      expect(train?.className).toContain('min-w-0')

      const showMerged = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('merged today'))
      expect(showMerged).toBeTruthy()
      await act(async () => showMerged!.click())
      const merged = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(MERGED_PR)}"]`)
      expect(merged?.className).toContain('wrap-anywhere')
    })
  })
})

describe('review follow-up locks', () => {
  it('builds the train href inside the ref instead of checking prNumber twice', () => {
    const source = readFileSync(join(__dirname, 'MergeQueuePanel.tsx'), 'utf8')
    expect(source).not.toContain('ref && typeof prNumber')
    expect(source).toContain('href: prLink(')
    expect(source).toContain('href={ref.href}')
  })

  it('tells the overflow spec to create its harness under the OS temp dir', () => {
    const spec = readFileSync(join(__dirname, '../../../../../examples/e2e-dogfood/tests/merge-queue-panel-overflow.spec.ts'), 'utf8')
    expect(spec).toContain('mkdtempSync(path.join(tmpdir()')
    expect(spec).not.toContain("const harnessPath = path.join(adminRoot, 'merge-queue-overflow-harness.tsx')")
    expect(spec).not.toContain("const apiMockPath = path.join(adminRoot, 'merge-queue-overflow-api.ts')")
    expect(spec).not.toContain("const viteConfigPath = path.join(adminRoot, 'node_modules'")
    expect(spec).not.toMatch(/writeFileSync\(\s*path\.join\(adminRoot/)
  })
})
