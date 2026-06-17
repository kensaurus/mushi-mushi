import { describe, expect, it } from 'vitest'
import { isNativeOrigin, sdkOriginKind, sdkPlatformHintFromUserAgent } from './sdkClientPlatform'

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

describe('sdkOriginKind', () => {
  it('does not mislabel capacitor:// as iOS (scheme is shared by iOS + Android)', () => {
    // OS is indeterminate from the Origin alone — must NOT return 'ios-native'.
    expect(sdkOriginKind('capacitor://localhost')).toBe('unknown')
  })

  it('labels android-app:// origins as android-native', () => {
    expect(sdkOriginKind('android-app://com.example.app')).toBe('android-native')
  })

  it('labels http(s) and loopback origins as web', () => {
    expect(sdkOriginKind('https://app.example.com')).toBe('web')
    expect(sdkOriginKind('http://localhost:3000')).toBe('web')
    expect(sdkOriginKind('http://10.0.2.2:8080')).toBe('web')
  })

  it('returns unknown for empty / unrecognised origins', () => {
    expect(sdkOriginKind(null)).toBe('unknown')
    expect(sdkOriginKind('')).toBe('unknown')
    expect(sdkOriginKind('ftp://weird')).toBe('unknown')
  })
})

describe('isNativeOrigin', () => {
  it('treats capacitor:// as native regardless of OS', () => {
    expect(isNativeOrigin('capacitor://localhost', null)).toBe(true)
    expect(isNativeOrigin('CAPACITOR://LOCALHOST', null)).toBe(true)
  })

  it('treats android-app:// as native', () => {
    expect(isNativeOrigin('android-app://com.example.app', null)).toBe(true)
  })

  it('falls back to the user-agent when the origin is absent', () => {
    expect(isNativeOrigin(null, 'MyApp/1 CFNetwork/1410 Darwin/22.6.0')).toBe(true)
    expect(isNativeOrigin(null, 'okhttp/4.12.0')).toBe(true)
  })

  it('is not native for plain web origins/agents', () => {
    expect(isNativeOrigin('https://app.example.com', 'Mozilla/5.0')).toBe(false)
    expect(isNativeOrigin(null, null)).toBe(false)
  })
})
