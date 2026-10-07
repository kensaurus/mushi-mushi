// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { normalizeLink, surfaceKey, tidyLabels, triggerSelector } from './discover.js'

const BASE = 'http://localhost:5173/app'

describe('normalizeLink', () => {
  it('keeps same-origin paths with their query and drops the hash', () => {
    expect(normalizeLink('/reports?status=new#top', BASE)).toBe('/reports?status=new')
    expect(normalizeLink('settings', 'http://localhost:5173/app/')).toBe('/app/settings')
  })

  it('skips other origins, non-http schemes, assets and sign-out routes', () => {
    expect(normalizeLink('https://github.com/x', BASE)).toBeNull()
    expect(normalizeLink('mailto:a@b.c', BASE)).toBeNull()
    expect(normalizeLink('/export.csv', BASE)).toBeNull()
    expect(normalizeLink('/logout', BASE)).toBeNull()
    expect(normalizeLink('/auth/sign-out', BASE)).toBeNull()
  })
})

describe('triggerSelector', () => {
  it('prefers the test id, falls back to role and name, and skips an element with neither', () => {
    expect(triggerSelector('open-keys', 'tab', 'Keys')).toBe('[data-testid="open-keys"]')
    expect(triggerSelector(null, 'tab', 'Keys')).toBe('role=tab[name="Keys"]')
    expect(triggerSelector('', '', 'Keys')).toBe('')
  })

  it('escapes backslashes as well as quotes, so a trailing backslash cannot end the string (CodeQL js/incomplete-sanitization)', () => {
    expect(triggerSelector('a\\"b', 'button', 'x')).toBe('[data-testid="a\\\\\\"b"]')
    expect(triggerSelector(null, 'button', 'Path C:\\')).toBe('role=button[name="Path C:\\\\"]')
    expect(triggerSelector(null, 'tab', 'Say "hi"')).toBe('role=tab[name="Say \\"hi\\""]')
  })
})

describe('surfaceKey', () => {
  it('is stable and distinguishes replay steps', () => {
    const a = surfaceKey('/settings', [])
    expect(surfaceKey('/settings', [])).toBe(a)
    expect(surfaceKey('/settings', [{ action: 'click', selector: 'role=tab[name="Keys"]', label: 'Keys' }])).not.toBe(a)
    expect(a).toMatch(/^settings-[0-9a-f]{6}$/)
  })
})

describe('tidyLabels', () => {
  const page = (path: string, label: string) => ({ kind: 'page', path, label })

  it('drops the site name the titles share, and names the home page', () => {
    const out = tidyLabels([
      page('/', 'glot.it – Learn Thai with AI, Music, Podcasts & Conversation Practice'),
      page('/words/', 'Thai Word Bank — glot.it'),
      page('/account/', 'Account — glot.it'),
      { kind: 'tab', path: '/account/', label: 'Account — glot.it › Billing' },
    ])
    expect(out.map((s) => s.label)).toEqual(['Home', 'Thai Word Bank', 'Account', 'Account › Billing'])
  })

  it('leaves titles alone when no site name repeats, or when names would collide', () => {
    const plain = [page('/', 'Dashboard'), page('/a', 'Reports | Acme')]
    expect(tidyLabels(plain)).toEqual(plain)
    const clash = tidyLabels([page('/a', 'Reports | Acme'), page('/b', 'Reports'), page('/c', 'Usage | Acme')])
    expect(clash.map((s) => s.label)).toEqual(['Reports | Acme', 'Reports', 'Usage'])
  })
})
