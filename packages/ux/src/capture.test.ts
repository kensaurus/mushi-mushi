// SPDX-License-Identifier: MIT
/**
 * A cached profile is the signed-in session. Opening it and then a second
 * browser seeded with storageState drops localStorage and IndexedDB, so
 * audit and explore run signed out. These tests lock that to one profile.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Playwright from 'playwright'

vi.mock('playwright', async (importOriginal) => {
  const actual = await importOriginal<typeof Playwright>()
  return {
    ...actual,
    chromium: {
      ...actual.chromium,
      launch: vi.fn(),
      launchPersistentContext: vi.fn(),
    },
  }
})

import { chromium } from 'playwright'
import { openSession } from './capture.js'

function fakePage() {
  return { close: vi.fn(async () => {}), goto: vi.fn(async () => null) }
}

function fakeContext() {
  return {
    newPage: vi.fn(async () => fakePage()),
    close: vi.fn(async () => {}),
    route: vi.fn(async () => {}),
    addInitScript: vi.fn(async () => {}),
    storageState: vi.fn(async () => ({ cookies: [{ name: 'sid', value: 'live' }], origins: [] })),
  }
}

beforeEach(() => {
  vi.mocked(chromium.launch).mockReset()
  vi.mocked(chromium.launchPersistentContext).mockReset()
})

describe('openSession profile', () => {
  it('keeps audit and explore pages in the cached profile, with no second browser', async () => {
    const profile = fakeContext()
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(profile as unknown as Playwright.BrowserContext)
    const session = await openSession({ profileDir: '/tmp/chrome-profile', channel: 'chrome', headless: true })
    expect(chromium.launch).not.toHaveBeenCalled()
    expect(chromium.launchPersistentContext).toHaveBeenCalledWith('/tmp/chrome-profile', {
      headless: true,
      serviceWorkers: 'block',
      channel: 'chrome',
    })

    const first = await session.freshContext()
    const second = await session.freshContext()
    const pageA = await first.newPage()
    const pageB = await second.newPage()
    expect(profile.newPage).toHaveBeenCalledTimes(2)
    expect(profile.storageState).not.toHaveBeenCalled()

    await first.close()
    expect(pageA.close).toHaveBeenCalledOnce()
    expect(pageB.close).not.toHaveBeenCalled()
    expect(profile.close).not.toHaveBeenCalled()

    await session.warmUp('https://app.test', ['/'])
    expect(profile.storageState).not.toHaveBeenCalled()

    await session.close()
    expect(profile.close).toHaveBeenCalledOnce()
  })

  it('opens a chromium profile with the bundled browser, still without a second process', async () => {
    const profile = fakeContext()
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(profile as unknown as Playwright.BrowserContext)
    const session = await openSession({ profileDir: '/tmp/chromium-profile', channel: 'chromium' })
    expect(chromium.launch).not.toHaveBeenCalled()
    expect(chromium.launchPersistentContext).toHaveBeenCalledWith('/tmp/chromium-profile', {
      headless: true,
      serviceWorkers: 'block',
    })
    await session.close()
  })
})

describe('openSession without a profile', () => {
  it('still isolates each capture in its own context seeded from storage', async () => {
    const shared = fakeContext()
    const fresh = fakeContext()
    const browser = {
      newContext: vi.fn(),
      close: vi.fn(async () => {}),
    }
    browser.newContext.mockResolvedValueOnce(shared as unknown as Playwright.BrowserContext).mockResolvedValueOnce(fresh as unknown as Playwright.BrowserContext)
    vi.mocked(chromium.launch).mockResolvedValue(browser as unknown as Playwright.Browser)
    const session = await openSession()
    expect(chromium.launchPersistentContext).not.toHaveBeenCalled()
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true })
    const ctx = await session.freshContext()
    expect(ctx).toBe(fresh)
    expect(browser.newContext).toHaveBeenLastCalledWith({
      serviceWorkers: 'block',
      storageState: { cookies: [{ name: 'sid', value: 'live' }], origins: [] },
    })
    await session.close()
    expect(browser.close).toHaveBeenCalledOnce()
  })
})
