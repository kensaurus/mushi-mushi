/**
 * FILE: MushiFloatingButton.tsx
 * PURPOSE: Floating action button (FAB) that triggers the Mushi bug-report bottom sheet
 *
 * OVERVIEW:
 * - Renders a persistent 🐛 button at bottom-right or bottom-left
 * - Animated press-scale effect via Animated.spring
 * - Position configurable through `buttonPosition` prop
 *
 * DEPENDENCIES:
 * - React Native built-in APIs only
 *
 * USAGE:
 * - Rendered automatically by MushiProvider when widget.trigger is 'button' or 'both'
 * - Can be used standalone: <MushiFloatingButton onPress={…} />
 *
 * TECHNICAL DETAILS:
 * - Uses Animated.Value for scale, driven by onPressIn / onPressOut
 * - Safe-area aware: extra bottom padding on iOS
 *
 * NOTES:
 * - Keeps zIndex high (9999) so it floats above app content
 */

import { useRef, useCallback, type FC } from 'react'
import {
  Animated,
  TouchableWithoutFeedback,
  StyleSheet,
  Platform,
  useColorScheme,
  type ViewStyle,
} from 'react-native'

export interface MushiFloatingButtonProps {
  onPress: () => void
  position?: 'bottom-right' | 'bottom-left'
}

export const MushiFloatingButton: FC<MushiFloatingButtonProps> = ({
  onPress,
  position = 'bottom-right',
}) => {
  const scheme = useColorScheme()
  const dark = scheme === 'dark'
  const scale = useRef(new Animated.Value(1)).current

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.85,
      useNativeDriver: true,
      damping: 15,
      stiffness: 300,
    }).start()
  }, [scale])

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      damping: 10,
      stiffness: 250,
    }).start()
  }, [scale])

  const positionStyle: ViewStyle =
    position === 'bottom-left' ? { left: 20 } : { right: 20 }

  return (
    <TouchableWithoutFeedback
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          s.fab,
          positionStyle,
          {
            backgroundColor: dark ? '#0a84ff' : '#007aff',
            transform: [{ scale }],
            shadowColor: dark ? '#0a84ff' : '#000',
          } as ViewStyle,
        ]}
      >
        <Animated.Text style={s.emoji}>🐛</Animated.Text>
      </Animated.View>
    </TouchableWithoutFeedback>
  )
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 50 : 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  emoji: {
    fontSize: 26,
  },
})
