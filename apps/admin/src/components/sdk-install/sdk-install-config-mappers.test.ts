import { describe, expect, it } from 'vitest'
import { DEFAULT_SDK_CONFIG } from '../../lib/sdkSnippets'
import { toRemoteConfig } from './sdk-install-config-mappers'

describe('toRemoteConfig', () => {
  it('sends the trimmed trigger text, or null when it is blank', () => {
    expect(toRemoteConfig({ ...DEFAULT_SDK_CONFIG, triggerText: '  Report bug  ' }, true).widget?.triggerText).toBe('Report bug')
    expect(toRemoteConfig({ ...DEFAULT_SDK_CONFIG, triggerText: '   ' }, true).widget?.triggerText).toBeNull()
  })
})
