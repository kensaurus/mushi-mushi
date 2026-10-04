/**
 * @vitest-environment jsdom
 */

/**
 * QA bug 30: "Sync CI secrets" revoked the live CI key before writing GitHub, with
 * no confirm. QA bug 141: without a GitHub token the primary "Copy setup
 * commands" button was permanently disabled. QA bug 139: the manual commands
 * hard-coded the Mushi Cloud endpoint.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../lib/supabase', () => api)
vi.mock('../lib/env', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  RESOLVED_EXTERNAL_API_URL: 'https://self-hosted.example/functions/v1/api',
}))

import { SdkNativeConnectivityCard } from './SdkNativeConnectivityCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'

function diag(over: Record<string, unknown> = {}) {
  return {
    status: 'ci-secret-missing',
    platformHint: 'capacitor',
    endpointMatches: true,
    bannerEnabled: true,
    launcherMode: 'banner',
    requiredVars: ['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'NEXT_PUBLIC_MUSHI_API_KEY', 'NEXT_PUBLIC_MUSHI_API_ENDPOINT'],
    presentVars: [],
    missingVars: ['NEXT_PUBLIC_MUSHI_API_KEY'],
    lastSeenAt: null,
    recommendedFix: null,
    repoUrl: 'https://github.com/acme/app',
    hasGithubToken: true,
    nativeEverSeen: false,
    ...over,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

const button = (label: RegExp) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as
    | HTMLButtonElement
    | undefined

describe('SdkNativeConnectivityCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.apiFetchMutate.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount(d: ReturnType<typeof diag>) {
    api.apiFetch.mockResolvedValue({ ok: true, data: d })
    act(() => {
      root.render(
        createElement(MemoryRouter, null, createElement(SdkNativeConnectivityCard, { projectId: PROJECT, projectSlug: 'acme' })),
      )
    })
    await flush()
  }

  it('asks before writing GitHub, names the repo and what gets revoked, and only syncs on confirm', async () => {
    await mount(diag())
    act(() => button(/Sync CI secrets/)!.click())
    expect(api.apiFetchMutate).not.toHaveBeenCalled()
    const dialog = document.body.textContent ?? ''
    expect(dialog).toContain('Write new CI secrets to GitHub?')
    expect(dialog).toContain('acme/app')
    expect(dialog).toContain('stop sending bug reports')

    api.apiFetchMutate.mockResolvedValue({
      ok: true,
      data: {
        minted: { prefix: 'mushi_abc123', rawKey: 'fake' },
        written: ['NEXT_PUBLIC_MUSHI_API_KEY'],
        failed: [],
        fallback: { commands: [], envBlock: '' },
        priorKeysRevoked: ['mushi_old111'],
      },
    })
    act(() => button(/Write secrets/)!.click())
    await flush()
    expect(api.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/projects/${PROJECT}/sync-ci-secrets`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(document.body.textContent).toContain('Revoked the previous CI key mushi_old111…')
  })

  it('without a GitHub token the primary button opens the commands, using this console’s endpoint', async () => {
    await mount(diag({ hasGithubToken: false, repoUrl: null, missingVars: diag().requiredVars }))
    const cta = button(/Copy setup commands/)!
    expect(cta.disabled).toBe(false)
    act(() => cta.click())
    const text = document.body.textContent ?? ''
    expect(text).toContain('your-org/your-repo')
    expect(text).toContain('https://self-hosted.example/functions/v1/api')
    expect(text).not.toContain('dxptnwrhwsqckaftyymj')
    expect(api.apiFetchMutate).not.toHaveBeenCalled()
  })
})
