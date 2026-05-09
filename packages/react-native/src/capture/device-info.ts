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

export function getDeviceInfo(): DeviceInfo {
  const { width, height } = Dimensions.get('window')

  // Locale: iOS exposes it via SettingsManager, Android via I18nManager.
  const locale: string =
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (NativeModules.SettingsManager?.settings?.AppleLocale as string | undefined) ??
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (NativeModules.I18nManager?.localeIdentifier as string | undefined) ??
    'en'

  // Timezone: available via Intl in all modern RN environments.
  let timezone = 'UTC'
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    // Intl not available — keep 'UTC'
  }

  // App version: use NativeModules (set by the app's build system) as the
  // source of truth; fall back to the OS version string. Avoids a `process`
  // global that would require @types/node in a mobile-first package.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const appVersion: string =
    (NativeModules.RNDeviceInfo?.appVersion as string | undefined) ??
    (NativeModules.RNBuildConfig?.VERSION_NAME as string | undefined) ??
    String(Platform.Version)

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
