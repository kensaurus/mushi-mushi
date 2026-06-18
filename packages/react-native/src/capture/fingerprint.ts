/**
 * React Native device fingerprint.
 *
 * `@mushi-mushi/core`'s `getDeviceFingerprintHash()` reads browser globals
 * (`navigator`, `screen`, `localStorage`) that don't exist under Hermes, so on
 * RN it would hash a constant "unknown" input — collapsing every device to the
 * same hash and breaking the server's cross-account anti-gaming check.
 *
 * This computes a stable, low-entropy hash from `DeviceInfo` instead. It is
 * deterministic (same device → same hash every session) so no persistence is
 * needed. We never send the raw inputs, only the digest.
 *
 * Hermes does not reliably expose `crypto.subtle`, so we use a fast
 * non-cryptographic digest — adequate for the "is this the same device"
 * question the server asks (it always combines this with server-side IP/geo
 * signals for high-stakes decisions).
 */

import type { DeviceInfo } from './device-info'

function nonCryptoHashHex(input: string): string {
  // FNV-1a-ish rolling hash; good distribution for short strings.
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return `rnfp_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Returns a stable per-device hash derived from durable device characteristics.
 * Returns `null` if device info is unexpectedly empty so callers can omit the
 * field gracefully.
 */
export function getDeviceFingerprintHash(device: DeviceInfo): string | null {
  const inputs = {
    platform: device.platform,
    osVersion: String(device.osVersion ?? ''),
    screenWidth: device.screenWidth,
    screenHeight: device.screenHeight,
    pixelRatio: device.pixelRatio,
    locale: device.locale ?? '',
    timezone: device.timezone ?? '',
  }
  const serialised = JSON.stringify(inputs)
  if (!device.platform && !device.screenWidth) return null
  return nonCryptoHashHex(serialised)
}
