import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from './supabase'
import { getPublishedVersion, pickPublishedVersion, resetPublishedVersionCacheForTests } from './publishedVersion'

afterEach(() => {
  resetPublishedVersionCacheForTests()
  vi.mocked(apiFetch).mockReset()
})

// 2026-11-24: the header said "Latest SDK 1.39.0" (build constant) while npm
// and the Home card said 1.39.1.
describe('pickPublishedVersion', () => {
  it('prefers a plain semver from the catalog', () => {
    expect(pickPublishedVersion('1.39.1', '1.39.0')).toBe('1.39.1')
    expect(pickPublishedVersion(' 1.39.1 ', '1.39.0')).toBe('1.39.1')
  })
  it('keeps the build constant for missing or odd values', () => {
    expect(pickPublishedVersion(null, '1.39.0')).toBe('1.39.0')
    expect(pickPublishedVersion('latest', '1.39.0')).toBe('1.39.0')
    expect(pickPublishedVersion(42, '1.39.0')).toBe('1.39.0')
  })
})

describe('getPublishedVersion', () => {
  it('fetches once per package and caches the answer', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: { latest: '1.39.1' } } as never)
    const [a, b] = await Promise.all([getPublishedVersion('@mushi-mushi/web'), getPublishedVersion('@mushi-mushi/web')])
    expect([a, b]).toEqual(['1.39.1', '1.39.1'])
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
  it('never rejects and retries after a failure', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'))
    expect(await getPublishedVersion('@mushi-mushi/web')).toBeNull()
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, data: { latest: '1.39.1' } } as never)
    expect(await getPublishedVersion('@mushi-mushi/web')).toBe('1.39.1')
  })
})
