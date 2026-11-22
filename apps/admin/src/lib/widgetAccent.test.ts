import { describe, expect, it } from 'vitest'
import { accentInk, parseAccentColour } from './widgetAccent'

describe('parseAccentColour', () => {
  it('normalises the forms the server accepts', () => {
    // mushi-mushi-allowlist: widget colour values under test, not console UI colours.
    expect(parseAccentColour('#3B5BDB')).toBe('#3b5bdb')
    expect(parseAccentColour('fa0')).toBe('#ffaa00')
  })

  it('refuses what the server refuses', () => {
    for (const v of ['blue', '#12', 'rgb(1,2,3)', '#3b5bdb80', '']) expect(parseAccentColour(v), v).toBeNull()
  })
})

describe('accentInk', () => {
  it('picks white on a deep blue and black on a yellow, with the ratio shown', () => {
    // mushi-mushi-allowlist: widget colour values under test, not console UI colours.
    expect(accentInk('#1e3a8a')).toEqual({ ink: '#ffffff', ratio: 10.4 })
    expect(accentInk('#fde047').ink).toBe('#000000')
    expect(accentInk('#fde047').ratio).toBeGreaterThan(14)
  })
})
