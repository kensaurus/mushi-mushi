/**
 * Mushi report edb1cf36: the web fallback had no default API endpoint, so
 * `configure({ projectId, apiKey })` without `endpoint` made every report()
 * throw. It now uses the same default as @mushi-mushi/web.
 */
import { DEFAULT_API_ENDPOINT } from '@mushi-mushi/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebMushi } from './web'

const CONFIG = { projectId: '00000000-0000-0000-0000-000000000001', apiKey: 'mushi_test_key_abcdefghijklmnop' }

let urls: string[]
beforeEach(() => {
  urls = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    urls.push(String(input))
    return new Response(JSON.stringify({ ok: true, data: { reportId: 'r-1' } }), { status: 200 })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('WebMushi endpoint', () => {
  it('sends reports to the hosted API when no endpoint is configured', async () => {
    const plugin = new WebMushi()
    await plugin.configure(CONFIG)
    await expect(plugin.report({ description: 'Checkout button does nothing' })).resolves.toEqual({ accepted: true })
    expect(urls).toEqual([`${DEFAULT_API_ENDPOINT}/v1/reports`])
  })

  it('keeps the default after identifyWithToken rebuilds the client', async () => {
    const plugin = new WebMushi()
    await plugin.configure(CONFIG)
    await plugin.identifyWithToken({ token: 'jwt' })
    await plugin.report({ description: 'Checkout button does nothing' })
    expect(urls[0]).toBe(`${DEFAULT_API_ENDPOINT}/v1/reports`)
  })

  it('uses a self-hosted endpoint when one is set', async () => {
    const plugin = new WebMushi()
    await plugin.configure({ ...CONFIG, endpoint: 'https://self.example/functions/v1/api' })
    await plugin.report({ description: 'Checkout button does nothing' })
    expect(urls[0]).toBe('https://self.example/functions/v1/api/v1/reports')
  })
})
