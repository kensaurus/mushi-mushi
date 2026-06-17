import { describe, expect, it } from 'vitest'
import { sdkPlatformHintFromUserAgent } from './sdkClientPlatform'

describe('sdkPlatformHintFromUserAgent', () => {
  it('labels iOS TestFlight-ish agents', () => {
    expect(sdkPlatformHintFromUserAgent('MyApp/1 CFNetwork/1410 Darwin/22.6.0')).toMatch(/iOS/)
  })

  it('labels Android agents', () => {
    expect(sdkPlatformHintFromUserAgent('okhttp/4.12.0 Android/14')).toMatch(/Android/)
  })

  it('returns null for empty input', () => {
    expect(sdkPlatformHintFromUserAgent(null)).toBeNull()
  })
})
