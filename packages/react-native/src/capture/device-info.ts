import { Platform, Dimensions, PixelRatio, NativeModules } from 'react-native'

export interface DeviceInfo {
  platform: string
  osVersion: string | number
  screenWidth: number
  screenHeight: number
  pixelRatio: number
  fontScale: number
  systemName?: string
  locale?: string
  timezone?: string
  appVersion?: string
}

/**
 * The app's own version ("1.22.59 (1084)"), or undefined. It used to fall back to
 * `Platform.Version`, the OS version, so Expo apps without react-native-device-info
 * reported Android's "36" as their app version (2026-11-16, yen-yen). Order:
 * expo-application's native module (read without importing expo), then
 * react-native-device-info, then a BuildConfig module.
 * @internal Exported for tests only.
 */
export function nativeAppVersion(): string | undefined {
  type ExpoApplicationModule = { nativeApplicationVersion?: string | null; nativeBuildVersion?: string | null }
  const expoApp = (globalThis as { expo?: { modules?: { ExpoApplication?: ExpoApplicationModule } } }).expo?.modules?.ExpoApplication
  const expoVersion = expoApp?.nativeApplicationVersion || null
  if (expoVersion) {
    const build = expoApp?.nativeBuildVersion || null
    return build && build !== expoVersion ? `${expoVersion} (${build})` : expoVersion
  }
  const deviceInfo = NativeModules.RNDeviceInfo?.appVersion as string | undefined
  const buildConfig = NativeModules.RNBuildConfig?.VERSION_NAME as string | undefined
  return deviceInfo || buildConfig || undefined
}

export function getDeviceInfo(): DeviceInfo {
  const { width, height } = Dimensions.get('window')

  // Locale: iOS exposes it via SettingsManager, Android via I18nManager.
  const locale: string =
    (NativeModules.SettingsManager?.settings?.AppleLocale as string | undefined) ??
    (NativeModules.I18nManager?.localeIdentifier as string | undefined) ??
    'en'

  // Timezone: available via Intl in all modern RN environments.
  let timezone = 'UTC'
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    // Intl not available — keep 'UTC'
  }

  const appVersion = nativeAppVersion()

  return {
    platform: Platform.OS,
    osVersion: Platform.Version,
    screenWidth: width,
    screenHeight: height,
    pixelRatio: PixelRatio.get(),
    fontScale: PixelRatio.getFontScale(),
    systemName: Platform.OS,
    locale,
    timezone,
    appVersion,
  }
}
