/**
 * FILE: optional-modules.ts
 * PURPOSE: The SDK's three optional native peers (network-aware delivery,
 *          screenshots, shake-to-report), loaded without crashing the app.
 *
 * Order for each one:
 * 1. A module the host passed in config (`netInfo`, `viewShot`, `expoSensors`).
 *    No dynamic loading at all — the safest path.
 * 2. A literal `require('<module>')` inside try/catch. Metro resolves a literal
 *    require at bundle time and treats one inside try/catch as optional
 *    (`transformer.allowOptionalDependencies`, on in Expo and React Native's
 *    default Metro config).
 *
 * Why the build matters: esbuild's ESM output rewrites `require('x')` to its
 * `__require('x')` interop shim. Metro can't resolve a module name handed to
 * the shim, so it called its own require with a string at runtime and crashed
 * the app (reportFatalError) — the try/catch never saw it (0.21–0.23).
 * tsup.config.ts restores literal `require(...)` in dist and fails the build
 * if any `__require(` is left (src/bundling/preserve-optional-requires.ts).
 */

export interface MushiNetInfoModule {
  addEventListener(
    listener: (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void,
  ): () => void
}

export interface MushiViewShotModule {
  captureScreen(options: Record<string, unknown>): Promise<string>
}

export interface MushiExpoSensorsModule {
  Accelerometer: {
    setUpdateInterval(ms: number): void
    addListener(listener: (event: { x: number; y: number; z: number }) => void): { remove(): void }
  }
}

/** An ES module namespace or its default export — accept either shape. */
function unwrap<T>(mod: unknown, key: keyof T): T | null {
  if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) return null
  if (key in (mod as object)) return mod as T
  const def = (mod as { default?: unknown }).default
  return def && (typeof def === 'object' || typeof def === 'function') && key in (def as object) ? (def as T) : null
}

export function resolveNetInfo(injected?: unknown): MushiNetInfoModule | null {
  if (injected) return unwrap<MushiNetInfoModule>(injected, 'addEventListener')
  try {
    return unwrap<MushiNetInfoModule>(require('@react-native-community/netinfo'), 'addEventListener')
  } catch {
    return null
  }
}

export function resolveViewShot(injected?: unknown): MushiViewShotModule | null {
  if (injected) return unwrap<MushiViewShotModule>(injected, 'captureScreen')
  try {
    return unwrap<MushiViewShotModule>(require('react-native-view-shot'), 'captureScreen')
  } catch {
    return null
  }
}

export function resolveExpoSensors(injected?: unknown): MushiExpoSensorsModule | null {
  if (injected) return unwrap<MushiExpoSensorsModule>(injected, 'Accelerometer')
  try {
    return unwrap<MushiExpoSensorsModule>(require('expo-sensors'), 'Accelerometer')
  } catch {
    return null
  }
}
