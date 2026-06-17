/**
 * FILE: apps/admin/src/lib/sdkClientPlatform.ts
 * PURPOSE: Heuristic labels for SDK heartbeat user-agent strings and origin
 *          headers so operators can tell TestFlight vs Play vs dev-client
 *          builds at a glance — and so the CI diagnostic can detect that the
 *          native SDK has never reported.
 */

export type SdkPlatformKind = 'ios-native' | 'android-native' | 'expo-dev' | 'web' | 'server' | 'unknown'

/** Short platform hint from last_seen_user_agent — null when unknown. */
export function sdkPlatformHintFromUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent?.trim()) return null
  const ua = userAgent.toLowerCase()

  if (ua.includes('testflight') || ua.includes('cfnetwork') || ua.includes('iphone') || ua.includes('ipad')) {
    return 'Likely iOS (TestFlight/App Store)'
  }
  if (ua.includes('android') || ua.includes('okhttp')) {
    return 'Likely Android (Play/internal)'
  }
  if (ua.includes('expo')) {
    return 'Likely Expo dev client'
  }
  if (ua.includes('darwin') && ua.includes('react-native')) {
    return 'Likely iOS simulator'
  }

  return null
}

/**
 * Classify an SDK origin header (e.g. `capacitor://localhost`, `https://...`)
 * into a structured platform kind.  Returns 'unknown' when indeterminate.
 */
export function sdkOriginKind(origin: string | null | undefined): SdkPlatformKind {
  if (!origin?.trim()) return 'unknown'
  const o = origin.toLowerCase()
  // `capacitor://` is the Capacitor WebView scheme on BOTH iOS and Android, so
  // the OS is indeterminate from the Origin alone — return 'unknown' rather
  // than mislabelling Android heartbeats as iOS. This must come BEFORE the
  // loopback check because `capacitor://localhost` contains "localhost" and
  // would otherwise be misread as 'web'. `isNativeOrigin()` still recognises
  // the scheme as native, and the user-agent heuristic
  // (`sdkPlatformHintFromUserAgent`) can refine the OS where present.
  if (o.startsWith('capacitor://')) return 'unknown'
  if (o.startsWith('android-app://')) return 'android-native'
  if (o.includes('localhost') || o.includes('127.0.0.1') || o.includes('10.0.2.2')) return 'web'
  if (/^https?:\/\//.test(o)) return 'web'
  return 'unknown'
}

/**
 * True when the (origin, userAgent) pair indicates a native Capacitor / RN app.
 */
export function isNativeOrigin(
  origin: string | null | undefined,
  userAgent: string | null | undefined,
): boolean {
  const o = (origin ?? '').trim().toLowerCase()
  // Capacitor's `capacitor://` scheme is native on both iOS and Android even
  // though `sdkOriginKind` deliberately can't pin the OS from it.
  if (o.startsWith('capacitor://')) return true
  const kind = sdkOriginKind(origin)
  if (kind === 'ios-native' || kind === 'android-native') return true
  // Fallback to UA when origin is null (Capacitor sets Origin on iOS 16+ but not on older)
  const ua = (userAgent ?? '').toLowerCase()
  return ua.includes('cfnetwork') || ua.includes('okhttp') || ua.includes('testflight')
}
