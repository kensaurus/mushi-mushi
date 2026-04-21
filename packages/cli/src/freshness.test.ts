import { describe, it, expect } from 'vitest'
import { isNewerStableVersion } from './freshness.js'

describe('isNewerStableVersion', () => {
  it('flags a patch bump as newer', () => {
    expect(isNewerStableVersion('0.4.1', '0.4.0')).toBe(true)
  })

  it('flags a minor bump as newer', () => {
    expect(isNewerStableVersion('0.5.0', '0.4.9')).toBe(true)
  })

  it('flags a major bump as newer', () => {
    expect(isNewerStableVersion('1.0.0', '0.99.99')).toBe(true)
  })

  it('returns false when versions match', () => {
    expect(isNewerStableVersion('0.4.0', '0.4.0')).toBe(false)
  })

  it('returns false when current is ahead', () => {
    expect(isNewerStableVersion('0.4.0', '0.4.1')).toBe(false)
  })

  it('ignores pre-release tags on the registry side', () => {
    expect(isNewerStableVersion('0.5.0-beta.1', '0.4.0')).toBe(false)
  })

  it('treats pre-release on current as the base core', () => {
    expect(isNewerStableVersion('0.4.0', '0.4.0-rc.1')).toBe(false)
  })
})
