/**
 * FILE: packages/react-native/src/instance.ts
 * PURPOSE: Module-level singleton registry for MushiRNInstance.
 *
 * OVERVIEW:
 * Mirrors the `Mushi.getInstance()` static on the web SDK.
 * MushiProvider writes the current instance into this registry on mount
 * and clears it on unmount, so code outside the React tree (auth state
 * machines, navigation `onStateChange`, error boundaries) can reach the
 * live instance via `MushiRN.getInstance()` instead of a handcrafted
 * bridge component.
 *
 * USAGE:
 *   // In auth state machine / navigation handler:
 *   import { MushiRN } from '@mushi-mushi/react-native';
 *   MushiRN.getInstance()?.identify('usr_42', { email });
 *   MushiRN.getInstance()?.setScreen({ name: 'Checkout', route: '/checkout' });
 *
 * THREAD SAFETY:
 * React Native runs JS on a single thread. All writes happen inside
 * useEffect callbacks (UI thread post-commit), so there is no race.
 *
 * MULTI-PROVIDER GUARD:
 * If a second MushiProvider mounts while one is already registered, the
 * SDK warns in __DEV__ and ignores the second registration. The first
 * mounted provider holds the singleton until it unmounts.
 */

import type { MushiRNInstance } from './provider'

let _instance: MushiRNInstance | null = null

/** @internal Called by MushiProvider on mount. */
export function setRNInstance(instance: MushiRNInstance): void {
  if (__DEV__ && _instance !== null && _instance !== instance) {
    console.warn(
      '[MushiRN] A second MushiProvider mounted while one is already active. ' +
        'The first provider keeps the singleton registration. ' +
        'Render only one MushiProvider per app.',
    )
    return
  }
  _instance = instance
}

/** @internal Called by MushiProvider on unmount. */
export function clearRNInstance(instance: MushiRNInstance): void {
  // Only clear if this is the currently registered instance — avoids a race
  // where the new provider mounts before the old one's cleanup fires.
  if (_instance === instance) {
    _instance = null
  }
}

/**
 * The `MushiRN` namespace provides imperative access to the active
 * `MushiRNInstance` from outside the React component tree.
 *
 * Equivalent to `Mushi.getInstance()` on the web SDK.
 */
export const MushiRN = {
  /**
   * Returns the `MushiRNInstance` exposed by the currently mounted
   * `MushiProvider`, or `null` if no provider has mounted yet.
   *
   * @example
   * ```ts
   * // In your auth state machine (outside the React tree):
   * import { MushiRN } from '@mushi-mushi/react-native';
   *
   * function onSignIn(user: User) {
   *   MushiRN.getInstance()?.identify(user.id, { email: user.email });
   * }
   *
   * // In React Navigation's onStateChange:
   * MushiRN.getInstance()?.setScreen({ name: route.name, route: route.path });
   * ```
   */
  getInstance(): MushiRNInstance | null {
    return _instance
  },
} as const
