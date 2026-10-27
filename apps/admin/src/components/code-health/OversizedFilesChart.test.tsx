/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/code-health/OversizedFilesChart.test.tsx
 * PURPOSE: Mushi health → Code size leads with one sentence and a bar chart
 *          of oversized files (console journeys 2026-10-27): longest first,
 *          red past the budget, amber close to it.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { OversizedFilesChart } from './OversizedFilesChart'
import { codeSizeStatus } from '../../pages/CodeHealthPage'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('OversizedFilesChart', () => {
  it('draws one bar per file, longest first, red past the budget and amber below it', () => {
    act(() =>
      root.render(
        createElement(OversizedFilesChart, {
          files: [
            { id: 'a', path: 'app/screens/Settings.tsx', lines: 1800 },
            { id: 'b', path: 'app/screens/Chat.tsx', lines: 3400 },
          ],
        }),
      ),
    )
    const rows = [...host.querySelectorAll('li')]
    expect(rows.map((r) => r.textContent)).toEqual(['Chat.tsx3,400 lines', 'Settings.tsx1,800 lines'])
    expect(rows.map((r) => r.dataset.over)).toEqual(['true', 'false'])
    expect(host.querySelector('figcaption')?.textContent).toContain('2,000-line budget')
  })

  it('caps the bars and says how many more are listed below', () => {
    const files = Array.from({ length: 14 }, (_, i) => ({ id: String(i), path: `f${i}.ts`, lines: 2000 + i }))
    act(() => root.render(createElement(OversizedFilesChart, { files })))
    expect(host.querySelectorAll('li')).toHaveLength(12)
    expect(host.textContent).toContain('2 more files are listed below.')
  })

  it('renders nothing without files', () => {
    act(() => root.render(createElement(OversizedFilesChart, { files: [] })))
    expect(host.innerHTML).toBe('')
  })
})

describe('codeSizeStatus', () => {
  it('leads with files over budget and names the largest', () => {
    expect(codeSizeStatus({ error_count: 6, warn_count: 2, max_loc: 4120, latest_bundle_kb: 312.44 })).toEqual({
      tone: 'danger',
      sentence:
        '6 files are over 2,000 lines — split them before your next release. The largest has 4,120 lines. Your latest bundle is 312.4 KB gzipped.',
    })
  })

  it('is green only when every file is under budget', () => {
    expect(codeSizeStatus({ error_count: 0, warn_count: 0, max_loc: 900, latest_bundle_kb: null }).tone).toBe('ok')
    expect(codeSizeStatus({ error_count: 0, warn_count: 1, max_loc: 1900, latest_bundle_kb: null }).tone).toBe('warn')
  })
})
