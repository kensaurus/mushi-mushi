import { describe, expect, it } from 'vitest'
import { DEFAULT_SDK_CONFIG } from '../../lib/sdkSnippets'
import { fromRemoteConfig, toRemoteConfig } from './sdk-install-config-mappers'

describe('toRemoteConfig', () => {
  it('sends the trimmed trigger text, or null when it is blank', () => {
    expect(toRemoteConfig({ ...DEFAULT_SDK_CONFIG, triggerText: '  Report bug  ' }, true).widget?.triggerText).toBe('Report bug')
    expect(toRemoteConfig({ ...DEFAULT_SDK_CONFIG, triggerText: '   ' }, true).widget?.triggerText).toBeNull()
  })
})

describe('accent round trip', () => {
  it('sends null for auto and the colour when set, and reads it back', () => {
    expect(toRemoteConfig({ ...DEFAULT_SDK_CONFIG, accent: '' }, true).widget?.accent).toBeNull()
    // mushi-mushi-allowlist: widget colour values under test, not console UI colours.
    expect(toRemoteConfig({ ...DEFAULT_SDK_CONFIG, accent: '#3b5bdb' }, true).widget?.accent).toBe('#3b5bdb')
    expect(fromRemoteConfig({ widget: { accent: '#3b5bdb', accentText: '#ffffff' } }).accent).toBe('#3b5bdb')
    expect(fromRemoteConfig({ widget: {} }).accent).toBe('')
  })
})
