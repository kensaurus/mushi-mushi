/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/releases/StoreUploadCards.test.tsx
 * PURPOSE: Store uploads are approval requests: "Ask for approval" posts the
 *          exact body the server's storeSchema takes, a spec-check refusal is
 *          shown inline, and Approve sends the payload hash the person was
 *          shown to the team's connector-actions route. A connector without
 *          Act turned on says so.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/supabase', () => api)

import { StoreUploadCards } from './StoreUploadCards'
import type { ReleaseKitData } from '../../lib/releaseShipView'

const PID = '11111111-1111-4111-8111-111111111111'
const RID = '22222222-2222-4222-8222-222222222222'
const HASH = 'ab'.repeat(32)

function data(over: Partial<ReleaseKitData> = {}): ReleaseKitData {
  return {
    kit: { id: 'k1', preset: 'app_store_preview', changelog: [], brand: { name: 'Acme', accent: null, theme: null, logoUrl: null }, exportedAt: null, exportCount: 0 },
    release: { id: RID, version: '1.2.0', title: 'v1.2.0', status: 'draft', publishedAt: null, commitSha: null },
    assets: [
      {
        id: 'a1', kind: 'screenshot_after', source: 'upload', storage_path: `${PID}/k1/screenshot_after-1-home.png`, mime: 'image/png', bytes: 4096, sha256: 'f'.repeat(64),
        width: 1290, height: 2796, duration_ms: null, fps: null, codec: null, metadata_from: 'measured', platform: 'ios', surface_path: '/', viewport: 'mobile',
        label: 'Home after', status: 'ready', created_at: '2026-11-27T00:00:00Z', url: 'https://storage.test/a1.png', usableAs: 'APP_IPHONE_67',
        checks: [{ id: 'size', label: 'Size', state: 'pass', detail: '1290×2796' }],
      },
    ],
    readiness: { ready: true, screenshots: 1, videos: 0, problems: [] },
    presets: [],
    settings: { clipsEnabled: false, clipMaxSeconds: 30, clipMaxMb: 25 },
    storeTargets: [{ connectorId: '44444444-4444-4444-8444-444444444444', kind: 'app_store_connect', name: 'Acme ASC', externalId: '6761582648', actEnabled: true, actions: ['upload_screenshots', 'upload_app_preview'] }],
    storeActions: [],
    organizationId: 'org-1',
    ...over,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

const button = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text))!

describe('StoreUploadCards', () => {
  let container: HTMLDivElement
  let root: Root
  const onChanged = vi.fn()

  beforeEach(() => {
    api.apiFetchMutate.mockReset()
    onChanged.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(d: ReleaseKitData) {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(StoreUploadCards, { projectId: PID, releaseId: RID, data: d, canEdit: true, onChanged })))
      await flush()
    })
  }

  it('asks for approval with the exact body the server takes', async () => {
    api.apiFetchMutate.mockResolvedValue({ ok: true, data: { actionId: 'act-1' } })
    await render(data())
    const ask = button(container, 'Ask for approval')
    expect(ask.disabled).toBe(true)
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => {
      box.click()
      await flush()
    })
    expect(button(container, 'Ask for approval').disabled).toBe(false)
    await act(async () => {
      button(container, 'Ask for approval').click()
      await flush()
    })
    expect(api.apiFetchMutate).toHaveBeenCalledWith(`/v1/admin/projects/${PID}/releases/${RID}/kit/store-upload`, {
      method: 'POST',
      body: JSON.stringify({ connectorId: '44444444-4444-4444-8444-444444444444', action: 'upload_screenshots', locale: 'en-US', displayType: 'APP_IPHONE_67', assetIds: ['a1'] }),
    })
    expect(onChanged).toHaveBeenCalled()
    expect(container.textContent).toContain('approves it below before anything is uploaded')
  })

  it('shows a spec-check refusal inline', async () => {
    api.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'SPEC_CHECK_FAILED', message: 'Home after: Size: 1440×900; App Store accepts 1290×2796.' } })
    await render(data())
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
      await flush()
    })
    await act(async () => {
      button(container, 'Ask for approval').click()
      await flush()
    })
    expect(container.textContent).toContain('App Store accepts 1290×2796')
  })

  it('approves with the hash of the payload shown', async () => {
    api.apiFetchMutate.mockResolvedValue({ ok: true, data: {} })
    await render(data({
      storeActions: [{ id: 'act-1', action: 'upload_screenshots', status: 'pending_approval', payload: { kitId: 'k1', appleId: '6761582648' }, payload_sha256: HASH, requested_at: '2026-11-27T09:00:00Z', expires_at: null, error: null }],
    }))
    expect(container.querySelector('[data-testid="store-actions"]')!.textContent).toContain('Waiting for approval')
    expect(container.textContent).toContain(`hash ${HASH.slice(0, 12)}`)
    await act(async () => {
      button(container, 'Approve').click()
      await flush()
    })
    expect(api.apiFetchMutate).toHaveBeenCalledWith('/v1/admin/orgs/org-1/connector-actions/act-1/approve', { method: 'POST', body: JSON.stringify({ payloadSha256: HASH }) })
  })

  it('says when the connector cannot run an upload yet', async () => {
    const d = data()
    await render({ ...d, storeTargets: [{ ...d.storeTargets[0], actEnabled: false }] })
    expect(container.textContent).toContain('Turn on Act for this connector and add a write key')
  })
})
