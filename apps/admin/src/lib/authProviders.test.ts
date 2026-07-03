/**
 * FILE: apps/admin/src/lib/authProviders.test.ts
 * PURPOSE: Lock the fail-closed contract that keeps the login page from
 *          offering an OAuth provider GoTrue will reject with a raw
 *          "provider is not enabled" JSON page (the mushi console Google bug).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAuthProviderAvailability, NO_PROVIDERS } from './authProviders'

describe('parseAuthProviderAvailability', () => {
  it('reports a provider enabled only when external[provider] === true', () => {
    const result = parseAuthProviderAvailability({
      external: { google: true, github: false },
      passkeys_enabled: true,
    })
    expect(result).toEqual({ google: true, github: false, passkeys: true })
  })

  it('mirrors the live mushi payload where only email is enabled', () => {
    // Snapshot of GET /auth/v1/settings on dxptnwrhwsqckaftyymj at report time.
    const result = parseAuthProviderAvailability({
      external: { google: false, github: false, email: true },
      passkeys_enabled: false,
    })
    expect(result).toEqual(NO_PROVIDERS)
  })

  it('fails closed for truthy-but-not-true values', () => {
    const result = parseAuthProviderAvailability({
      external: { google: 'true' as unknown as boolean, github: 1 as unknown as boolean },
      passkeys_enabled: 1 as unknown as boolean,
    })
    expect(result).toEqual(NO_PROVIDERS)
  })

  it('fails closed for null / undefined / malformed payloads', () => {
    expect(parseAuthProviderAvailability(null)).toEqual(NO_PROVIDERS)
    expect(parseAuthProviderAvailability(undefined)).toEqual(NO_PROVIDERS)
    expect(parseAuthProviderAvailability({})).toEqual(NO_PROVIDERS)
    expect(parseAuthProviderAvailability({ external: null })).toEqual(NO_PROVIDERS)
    expect(parseAuthProviderAvailability('nonsense')).toEqual(NO_PROVIDERS)
  })
})

describe('fetchEnabledAuthProviders', () => {
  beforeEach(() => {
    // Fresh module → fresh module-level cache for each case.
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('parses a successful /settings response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ external: { google: true, github: true }, passkeys_enabled: false }),
      }),
    )
    const { fetchEnabledAuthProviders } = await import('./authProviders')
    await expect(fetchEnabledAuthProviders()).resolves.toEqual({
      google: true,
      github: true,
      passkeys: false,
    })
  })

  it('fails closed on a non-2xx response (e.g. GoTrue outage)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    const mod = await import('./authProviders')
    await expect(mod.fetchEnabledAuthProviders()).resolves.toEqual(mod.NO_PROVIDERS)
  })

  it('fails closed on a network error and does not cache the failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ external: { google: true }, passkeys_enabled: false }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('./authProviders')

    // First call fails → fail-closed default, cache cleared.
    await expect(mod.fetchEnabledAuthProviders()).resolves.toEqual(mod.NO_PROVIDERS)
    // Second call retries the network rather than being pinned to the default.
    await expect(mod.fetchEnabledAuthProviders()).resolves.toEqual({
      google: true,
      github: false,
      passkeys: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches a successful result (one network round-trip per page load)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ external: { github: true }, passkeys_enabled: false }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const mod = await import('./authProviders')
    await mod.fetchEnabledAuthProviders()
    await mod.fetchEnabledAuthProviders()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
