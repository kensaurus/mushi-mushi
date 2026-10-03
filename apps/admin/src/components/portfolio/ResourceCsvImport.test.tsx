/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/portfolio/ResourceCsvImport.test.tsx
 * PURPOSE: The CSV import posts the picked file to /v1/ingest/recipe/csv for
 *          the active team, lists every row the server refused, says when rows
 *          were past the 500-row limit, and refreshes the card only when a row
 *          was saved. The card shows the import only to owners and admins.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
const pageData = vi.hoisted(() => ({ usePageData: vi.fn() }))

vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/usePageData', () => pageData)

import { ResourceCsvImport } from './ResourceCsvImport'
import { SharedResourcesCard } from './SharedResourcesCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ORG = '0000000a-0000-4000-8000-000000000000'

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

describe('ResourceCsvImport', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetchMutate.mockReset()
    pageData.usePageData.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function pickFile(text: string, name = 'resources.csv'): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File([text], name, { type: 'text/csv' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
    })
  }

  function importButton(): HTMLButtonElement {
    return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Import CSV'))!
  }

  it('posts the file for the team, lists refused rows and refreshes the card', async () => {
    api.apiFetchMutate.mockResolvedValue({ ok: true, data: { imported: 1, errors: ['line 3: project not found in this team'], skippedOverLimit: 0 } })
    const onImported = vi.fn()
    act(() => root.render(createElement(ResourceCsvImport, { orgId: ORG, onImported })))
    expect(importButton().disabled).toBe(true)

    const csv = 'kind,external_id,project\ndomain,glot.it,glot-it\ndomain,x.example,nope\n'
    await pickFile(csv)
    expect(importButton().disabled).toBe(false)
    await act(async () => {
      importButton().click()
      await flush()
    })

    expect(api.apiFetchMutate).toHaveBeenCalledWith('/v1/ingest/recipe/csv', { method: 'POST', body: JSON.stringify({ organizationId: ORG, csv }) })
    expect(container.textContent).toContain('Imported 1 row. 1 row was not saved.')
    expect(container.querySelector('ul[aria-label="Rows that were not saved"]')?.textContent).toContain('line 3: project not found in this team')
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('says how many rows were saved, and which were skipped past the 500-row limit', async () => {
    api.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { imported: 2, errors: [], skippedOverLimit: 0 } })
    act(() => root.render(createElement(ResourceCsvImport, { orgId: ORG, onImported: vi.fn() })))
    await pickFile('kind,external_id,project\n')
    await act(async () => {
      importButton().click()
      await flush()
    })
    expect(container.textContent).toContain('Imported 2 rows.')
    expect(container.querySelector('ul[aria-label="Rows that were not saved"]')).toBeNull()

    api.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { imported: 500, errors: [], skippedOverLimit: 4 } })
    await pickFile('kind,external_id,project\n')
    await act(async () => {
      importButton().click()
      await flush()
    })
    expect(container.textContent).toContain('4 rows past the 500-row limit were skipped')
  })

  it('shows the server error and does not refresh when nothing was saved', async () => {
    api.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'The CSV needs the columns kind, external_id, project (and optionally role).' } })
    const onImported = vi.fn()
    act(() => root.render(createElement(ResourceCsvImport, { orgId: ORG, onImported })))
    await pickFile('a,b\n1,2\n')
    await act(async () => {
      importButton().click()
      await flush()
    })
    expect(container.textContent).toContain('The CSV needs the columns kind, external_id, project')
    expect(onImported).not.toHaveBeenCalled()
  })

  it('refuses a file over 256 KB without a request', async () => {
    act(() => root.render(createElement(ResourceCsvImport, { orgId: ORG, onImported: vi.fn() })))
    await pickFile('x'.repeat(256 * 1024 + 1), 'big.csv')
    expect(container.textContent).toContain('big.csv is over 256 KB')
    expect(importButton().disabled).toBe(true)
    expect(api.apiFetchMutate).not.toHaveBeenCalled()
  })

  it('the card shows the import to owners and admins only', () => {
    pageData.usePageData.mockReturnValue({ data: { canImport: false, resources: [] }, loading: false, error: null, reload: vi.fn() })
    act(() => root.render(createElement(SharedResourcesCard, { orgId: ORG, names: new Map() })))
    expect(container.querySelector('input[type="file"]')).toBeNull()

    pageData.usePageData.mockReturnValue({ data: { canImport: true, resources: [] }, loading: false, error: null, reload: vi.fn() })
    act(() => root.render(createElement(SharedResourcesCard, { orgId: ORG, names: new Map() })))
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
    expect(container.textContent).toContain('or import a CSV below')
  })
})
