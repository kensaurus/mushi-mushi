import { describe, expect, it, vi } from 'vitest'
import { fetchIngestSetup, waitForIngestReady } from './heartbeat-wait.js'

const TEST_API_KEY = 'mushi_test_key_1234567890abcdef'

describe('heartbeat-wait', () => {
  it('fetchIngestSetup unwraps ok envelope', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          ready: false,
          required_complete: 2,
          required_total: 4,
          steps: [{ id: 'sdk_installed', label: 'SDK', complete: false, required: true }],
        },
      }),
    })

    const payload = await fetchIngestSetup(
      { endpoint: 'https://api.test', apiKey: TEST_API_KEY },
      fetch as typeof fetch,
    )
    expect(payload?.required_complete).toBe(2)
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/v1/sync/ingest-setup',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Mushi-Api-Key': TEST_API_KEY }) }),
    )
  })

  it('waitForIngestReady resolves when sdk_installed completes', async () => {
    let calls = 0
    const fetch = vi.fn().mockImplementation(async () => {
      calls += 1
      const complete = calls >= 2
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            ready: complete,
            required_complete: complete ? 4 : 2,
            required_total: 4,
            steps: [
              { id: 'sdk_installed', label: 'SDK', complete, required: true },
            ],
          },
        }),
      }
    })

    const result = await waitForIngestReady({
      endpoint: 'https://api.test',
      apiKey: TEST_API_KEY,
      maxAttempts: 3,
      intervalMs: 1,
      fetch: fetch as typeof fetch,
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('ready')
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('waitForIngestReady fails fast with reason unauthorized on a 401', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })

    const result = await waitForIngestReady({
      endpoint: 'https://api.test',
      apiKey: 'mushi_invalid_key_1234567890',
      maxAttempts: 10,
      intervalMs: 1,
      fetch: fetch as typeof fetch,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unauthorized')
    // Must not burn the remaining attempts polling a credential error.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('waitForIngestReady keeps polling through retryable 5xx responses', async () => {
    let calls = 0
    const fetch = vi.fn().mockImplementation(async () => {
      calls += 1
      if (calls === 1) return { ok: false, status: 503 }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            ready: true,
            required_complete: 4,
            required_total: 4,
            steps: [{ id: 'sdk_installed', label: 'SDK', complete: true, required: true }],
          },
        }),
      }
    })

    const result = await waitForIngestReady({
      endpoint: 'https://api.test',
      apiKey: TEST_API_KEY,
      maxAttempts: 3,
      intervalMs: 1,
      fetch: fetch as typeof fetch,
    })

    expect(result.ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('waitForIngestReady returns heartbeat when only sdk_installed completes', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          ready: false,
          required_complete: 3,
          required_total: 4,
          steps: [
            { id: 'sdk_installed', label: 'SDK', complete: true, required: true },
            { id: 'first_report_received', label: 'Report', complete: false, required: true },
          ],
        },
      }),
    })

    const result = await waitForIngestReady({
      endpoint: 'https://api.test',
      apiKey: TEST_API_KEY,
      maxAttempts: 1,
      intervalMs: 1,
      fetch: fetch as typeof fetch,
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('heartbeat')
  })
})
