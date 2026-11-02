// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { cachedProfile, parseChannel } from './profile.js'

describe('cachedProfile', () => {
  it('opens a cached profile with the installed Chrome by default, expanding ~', () => {
    expect(cachedProfile({ profileDir: '~/.playwright-cli-profiles/app' }, '/home/k')).toEqual({
      profileDir: '/home/k/.playwright-cli-profiles/app',
      channel: 'chrome',
    })
  })

  it('honours --channel chromium and needs a directory to do anything', () => {
    expect(cachedProfile({ profileDir: '/p/app', channel: 'chromium' }, '/home/k')).toEqual({ profileDir: '/p/app', channel: 'chromium' })
    expect(cachedProfile({}, '/home/k')).toBeNull()
    expect(cachedProfile({ profileDir: '   ' }, '/home/k')).toBeNull()
  })

  it('accepts only chrome or chromium as a channel', () => {
    expect(parseChannel('chrome')).toBe('chrome')
    expect(() => parseChannel('firefox')).toThrow('chrome or chromium')
  })
})
