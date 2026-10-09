/**
 * FILE: apps/admin/src/lib/mushi-self.test.ts
 * PURPOSE: The console dogfoods the Mushi web SDK. These tests pin the three
 *          things that decide whether it reports anything once deployed:
 *            - the SDK import is one Vite can bundle (no `@vite-ignore`,
 *              which left a bare `import("@mushi-mushi/web")` in the
 *              production chunk that every browser rejects);
 *            - init labels console analytics with the 'console' surface and
 *              keeps the launcher hidden behind the BetaBanner;
 *            - it stays a no-op when the self-project env vars are absent.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const web = vi.hoisted(() => {
  const instance = {
    setTrigger: vi.fn(),
    hide: vi.fn(),
    identify: vi.fn(),
    setMetadata: vi.fn(),
    track: vi.fn(),
    report: vi.fn(),
  }
  return { instance, init: vi.fn(() => instance) }
})

vi.mock('@mushi-mushi/web', () => ({ Mushi: { init: web.init } }))
vi.mock('./sentry', () => ({ Sentry: { captureMessage: vi.fn(), captureException: vi.fn() } }))
vi.mock('./env', () => ({ RESOLVED_API_URL: 'https://api.example.test/functions/v1/api' }))

const INIT_KEY = '__mushi_admin_self_init__'

async function freshModule() {
  vi.resetModules()
  return import('./mushi-self')
}

describe('mushi-self', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)[INIT_KEY]
    web.init.mockClear()
    for (const fn of Object.values(web.instance)) fn.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('imports @mushi-mushi/web with a plain dynamic import Vite can bundle', () => {
    const source = readFileSync(join(__dirname, 'mushi-self.ts'), 'utf8')
    expect(source).toMatch(/await import\('@mushi-mushi\/web'\)/)
    expect(source).not.toMatch(/import\(\s*\/\*\s*@vite-ignore/)
  })

  it('is a no-op when the self-project env vars are absent', async () => {
    vi.stubEnv('VITE_MUSHI_SELF_PROJECT_ID', '')
    vi.stubEnv('VITE_MUSHI_SELF_API_KEY', '')
    const { initMushiSelf, isMushiSelfEnabled } = await freshModule()

    expect(isMushiSelfEnabled()).toBe(false)
    await expect(initMushiSelf()).resolves.toBeNull()
    expect(web.init).not.toHaveBeenCalled()
  })

  it('initialises with the console analytics surface and a hidden launcher', async () => {
    vi.stubEnv('VITE_MUSHI_SELF_PROJECT_ID', 'proj-self')
    vi.stubEnv('VITE_MUSHI_SELF_API_KEY', 'mushi_self_key')
    vi.stubEnv('VITE_MUSHI_SELF_API_ENDPOINT', '')
    const { initMushiSelf, getMushiSelf } = await freshModule()

    const sdk = await initMushiSelf({ userId: 'user-1', activeProjectId: 'proj-a' })

    expect(sdk).toBe(web.instance)
    expect(getMushiSelf()).toBe(web.instance)
    expect(web.init).toHaveBeenCalledTimes(1)
    expect(web.init).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-self',
        apiKey: 'mushi_self_key',
        apiEndpoint: 'https://api.example.test/functions/v1/api',
        runtimeConfig: false,
        analytics: { surface: 'console' },
        widget: expect.objectContaining({ trigger: 'hidden' }),
      }),
    )
    expect(web.instance.setTrigger).toHaveBeenCalledWith('hidden')
    expect(web.instance.hide).toHaveBeenCalled()
    expect(web.instance.identify).toHaveBeenCalledWith('user-1', {})
    expect(web.instance.setMetadata).toHaveBeenCalledWith('active_project_id', 'proj-a')
  })

  it('attributes a later sign-in to the SDK the pre-login call created', async () => {
    vi.stubEnv('VITE_MUSHI_SELF_PROJECT_ID', 'proj-self')
    vi.stubEnv('VITE_MUSHI_SELF_API_KEY', 'mushi_self_key')
    const { initMushiSelf } = await freshModule()

    const first = initMushiSelf()
    const second = initMushiSelf({ userId: 'user-2' })
    await Promise.all([first, second])

    expect(web.init).toHaveBeenCalledTimes(1)
    expect(web.instance.identify).toHaveBeenCalledWith('user-2', {})
  })
})
