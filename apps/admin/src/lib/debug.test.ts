import { afterEach, describe, expect, it, vi } from 'vitest'
import { debugLog } from './debug'

afterEach(() => {
  document.documentElement.style.removeProperty('--color-accent')
  window.localStorage.removeItem('mushi:debug')
  vi.restoreAllMocks()
})

describe('debugLog colours', () => {
  it('reads --color-accent when the line is logged', () => {
    window.localStorage.setItem('mushi:debug', 'true')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    document.documentElement.style.setProperty('--color-accent', 'oklch(0.2 0.1 280)')
    debugLog('cat', 'hello')
    expect(String(spy.mock.calls[0]?.[1])).toContain('oklch(0.2 0.1 280)')
    document.documentElement.style.setProperty('--color-accent', 'oklch(0.9 0.1 280)')
    debugLog('cat', 'again')
    expect(String(spy.mock.calls[1]?.[1])).toContain('oklch(0.9 0.1 280)')
  })
})
