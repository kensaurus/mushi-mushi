/**
 * FILE: packages/cli/src/device-auth.test.ts
 * PURPOSE: Unit tests for the shared RFC 8628 device-auth client. Mocks global
 *          fetch and injects sleep/now into the poll loop for determinism.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProject,
  listProjects,
  mintProjectKey,
  pollDeviceToken,
  startDeviceAuth,
  waitForCliToken,
} from './device-auth.js'

const ENDPOINT = 'https://api.example.test/functions/v1/api'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('startDeviceAuth', () => {
  it('returns the session on success and trims a trailing slash on the endpoint', async () => {
    const session = {
      device_code: 'dc',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://console/cli-auth?code=ABCD-EFGH',
      expires_in: 600,
      interval: 5,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: session }))

    const result = await startDeviceAuth(`${ENDPOINT}/`)

    expect(result).toEqual(session)
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENDPOINT}/v1/cli/auth/device/start`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws a descriptive error when the backend rejects', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { message: 'nope' } }, { ok: false, status: 500 }),
    )
    await expect(startDeviceAuth(ENDPOINT)).rejects.toThrow('nope')
  })
})

describe('pollDeviceToken', () => {
  it('maps an approved response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { cli_token: 'tok', user_id: 'u1' } }),
    )
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'approved',
      cliToken: 'tok',
      userId: 'u1',
    })
  })

  it('maps authorization_pending → pending', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'authorization_pending' }, { ok: false, status: 400 }),
    )
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({ status: 'pending' })
  })

  it('maps access_denied → denied', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'access_denied' }, { ok: false, status: 400 }),
    )
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({ status: 'denied' })
  })

  it('maps expired_token → expired', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'expired_token' }, { ok: false, status: 400 }),
    )
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({ status: 'expired' })
  })

  it('maps an unknown error to status error with a message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'server_error', error_description: 'boom' }, { ok: false, status: 400 }),
    )
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'error',
      message: 'boom',
    })
  })

  it('never throws on a network failure — surfaces it as an error outcome', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(pollDeviceToken(ENDPOINT, 'dc')).resolves.toEqual({
      status: 'error',
      message: 'ECONNRESET',
    })
  })
})

describe('waitForCliToken', () => {
  const session = { device_code: 'dc', interval: 5, expires_in: 600 }

  it('resolves the token after a pending poll', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }, { ok: false, status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { cli_token: 'tok' } }))

    const onPending = vi.fn()
    const token = await waitForCliToken(ENDPOINT, session, {
      sleep: async () => {},
      now: () => 0,
      onPending,
    })

    expect(token).toBe('tok')
    expect(onPending).toHaveBeenCalledTimes(1)
  })

  it('throws when the request is denied', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'access_denied' }, { ok: false, status: 400 }))
    await expect(
      waitForCliToken(ENDPOINT, session, { sleep: async () => {}, now: () => 0 }),
    ).rejects.toThrow(/denied/i)
  })

  it('throws a timeout error once the deadline passes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'authorization_pending' }, { ok: false, status: 400 }))
    // now(): deadline calc (0), first while-check (0), post-poll while-check (past deadline).
    const times = [0, 0, 600_001]
    let i = 0
    const now = () => times[Math.min(i++, times.length - 1)]
    await expect(
      waitForCliToken(ENDPOINT, session, { sleep: async () => {}, now }),
    ).rejects.toThrow(/timed out/i)
  })
})

describe('listProjects', () => {
  it('returns the project list on success', async () => {
    const projects = [{ id: 'p1', name: 'One', slug: 'one' }]
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { projects } }))
    await expect(listProjects(ENDPOINT, 'tok')).resolves.toEqual(projects)
  })

  it('returns an empty array on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(listProjects(ENDPOINT, 'tok')).resolves.toEqual([])
  })
})

describe('createProject', () => {
  it('returns the created project including the minted key', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'p1', name: 'One', slug: 'one', apiKey: 'mushi_x' } }, { status: 201 }),
    )
    await expect(createProject(ENDPOINT, 'tok', 'One')).resolves.toEqual({
      id: 'p1',
      name: 'One',
      slug: 'one',
      apiKey: 'mushi_x',
    })
  })

  it('throws on a backend error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { message: 'no org' } }, { ok: false, status: 400 }),
    )
    await expect(createProject(ENDPOINT, 'tok', 'One')).rejects.toThrow('no org')
  })
})

describe('mintProjectKey', () => {
  it('returns the minted key on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { key: 'mushi_y' } }, { status: 201 }))
    await expect(mintProjectKey(ENDPOINT, 'tok', 'p1')).resolves.toBe('mushi_y')
  })

  it('returns null when the mint fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false }, { ok: false, status: 403 }))
    await expect(mintProjectKey(ENDPOINT, 'tok', 'p1')).resolves.toBeNull()
  })
})
