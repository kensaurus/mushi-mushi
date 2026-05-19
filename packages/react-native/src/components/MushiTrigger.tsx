/**
 * FILE: packages/react-native/src/components/MushiTrigger.tsx
 * PURPOSE: Headless RN primitive that passes an `onPress` handler from
 *          the Mushi SDK context to any host Pressable / TouchableOpacity.
 *
 * OVERVIEW:
 * - MushiTrigger: renders `children` as-is, injecting `onPress` that
 *   calls `mushi.open()`. Designed so the host provides the entire visual
 *   surface (button, icon, menu item, etc.) and Mushi supplies only the
 *   open-reporter behaviour.
 * - Useful when `trigger: 'manual'` is set in MushiProvider so the default
 *   floating FAB is not rendered.
 *
 * USAGE:
 *   <MushiTrigger>
 *     <Pressable style={styles.btn}>
 *       <Text>Report a bug</Text>
 *     </Pressable>
 *   </MushiTrigger>
 *
 * NOTES:
 * - If useMushiContext() returns null (provider not mounted) the press is
 *   silently swallowed — the child still renders normally.
 */

import { type ReactElement, cloneElement, isValidElement } from 'react'
import { useMushiContext } from '../provider'

export interface MushiTriggerProps {
  /** A single React Native element that accepts `onPress`. */
  children: ReactElement<{ onPress?: () => void }>
}

/**
 * Clones `children` and injects `onPress` → `mushi.open()`.
 * The child is responsible for its own visual styling.
 */
export function MushiTrigger({ children }: MushiTriggerProps) {
  const mushi = useMushiContext()
  if (!isValidElement(children)) return children

  const originalOnPress = (children.props as { onPress?: () => void }).onPress

  return cloneElement(children, {
    onPress: () => {
      originalOnPress?.()
      mushi?.open()
    },
  } as { onPress: () => void })
}
