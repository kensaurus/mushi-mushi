// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cachedProfile, parseChannel, profileDirHelp } from './profile.js'

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

  it('tells --profile-dir users that captures share the profile and are not isolated', () => {
    const help = profileDirHelp('Reuse a profile')
    expect(help).toContain('Reuse a profile')
    expect(help).toMatch(/not isolated/)
    expect(help).toMatch(/localStorage/)
    expect(help).toMatch(/IndexedDB/)

    const cli = readFileSync(new URL('./cli.ts', import.meta.url), 'utf8')
    expect(cli.match(/--profile-dir <dir>/g)).toHaveLength(4)
    expect(cli.match(/profileDirHelp\(/g)).toHaveLength(4)

    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    expect(readme).toMatch(/not isolated/)
    expect(readme).toMatch(/one after another/)
    expect(readme).toMatch(/not in parallel/)
  })
})
