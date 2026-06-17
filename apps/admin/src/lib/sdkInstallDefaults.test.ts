import { describe, expect, it } from 'vitest'
import { resolveDefaultSdkFramework } from './sdkInstallDefaults'

describe('resolveDefaultSdkFramework', () => {
  it('prefers expo for yen-yen slug', () => {
    expect(resolveDefaultSdkFramework('yen-yen')).toBe('expo')
    expect(resolveDefaultSdkFramework('YenYen')).toBe('expo')
  })

  it('detects expo from package.json when confidence is high', () => {
    const pkg = JSON.stringify({
      dependencies: { expo: '~52.0.0', 'react-native': '0.76.0' },
    })
    expect(resolveDefaultSdkFramework('my-app', pkg)).toBe('expo')
  })

  it('falls back to react for unknown slug without package.json', () => {
    expect(resolveDefaultSdkFramework('my-app')).toBe('react')
  })
})
