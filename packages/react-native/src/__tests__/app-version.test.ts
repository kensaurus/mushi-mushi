import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ modules: {} as Record<string, unknown> }))
vi.mock('react-native', () => ({
  NativeModules: native.modules,
  Platform: { OS: 'android', Version: 36 },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
  PixelRatio: { get: () => 2, getFontScale: () => 1 },
}))

import { getDeviceInfo, nativeAppVersion } from '../capture/device-info'

type G = { expo?: { modules?: Record<string, unknown> } }

afterEach(() => {
  delete (globalThis as G).expo
  for (const k of Object.keys(native.modules)) delete native.modules[k]
})

describe('app version (2026-11-16: reports said "36", the Android version)', () => {
  it('reads expo-application, with the build number', () => {
    ;(globalThis as G).expo = { modules: { ExpoApplication: { nativeApplicationVersion: '1.22.59', nativeBuildVersion: '1084' } } }
    expect(nativeAppVersion()).toBe('1.22.59 (1084)')
  })

  it('falls back to react-native-device-info', () => {
    native.modules.RNDeviceInfo = { appVersion: '3.4.0' }
    expect(nativeAppVersion()).toBe('3.4.0')
  })

  it('is unset, never the OS version, when no native module knows it', () => {
    expect(nativeAppVersion()).toBeUndefined()
    const info = getDeviceInfo()
    expect(info.appVersion).toBeUndefined()
    expect(info.osVersion).toBe(36)
  })
})
