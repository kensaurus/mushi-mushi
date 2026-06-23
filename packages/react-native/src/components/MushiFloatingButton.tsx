/**
 * MushiFloatingButton — draggable, repositionable FAB for the Mushi SDK.
 *
 * Supports:
 * - PanResponder drag with tap-vs-drag threshold (6 px)
 * - Clamp to screen bounds with safe-area respect
 * - Optional edge-snap on release (`snapToEdge`)
 * - Persist position to AsyncStorage (opt-in via `persist` config)
 * - Press-in / press-out spring scale animation
 * - Dark/light adaptive colours
 */

import { useRef, useCallback, useEffect, type FC } from 'react'
import {
  Animated,
  PanResponder,
  StyleSheet,
  Platform,
  Dimensions,
  useColorScheme,
  type ViewStyle,
} from 'react-native'
import { mushiPalette, MUSHI_COPY, MUSHI_GEOMETRY } from '@mushi-mushi/core'

/** Shared footprint with web widget; RN keeps a circle for native FAB ergonomics. */
const FAB_SIZE = MUSHI_GEOMETRY.fabSize
const EDGE_PADDING = 12

function getScreenBounds() {
  const { width, height } = Dimensions.get('window')
  return { width, height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export interface MushiFloatingButtonConfig {
  /** Allow the FAB to be dragged. Default: false. */
  draggable?: boolean
  /** Snap FAB to the nearest vertical edge on release. Default: true. */
  snapToEdge?: boolean
  /** Persist FAB position across app restarts via AsyncStorage. Default: false. */
  persist?: boolean
}

export interface MushiFloatingButtonProps {
  onPress: () => void
  position?: 'bottom-right' | 'bottom-left'
  inset?: { bottom?: number; left?: number; right?: number }
  /** Draggable + persist config */
  config?: MushiFloatingButtonConfig
  /** Accent color (hex) — falls back to platform blue */
  accent?: string
}

const STORAGE_KEY = 'mushi:fab-pos'

async function loadStoredPos(): Promise<{ x: number; y: number } | null> {
  try {
    const AsyncStorage = (
      await import('@react-native-async-storage/async-storage')
    ).default
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as { x: number; y: number }
  } catch {
    return null
  }
}

async function storePos(pos: { x: number; y: number }): Promise<void> {
  try {
    const AsyncStorage = (
      await import('@react-native-async-storage/async-storage')
    ).default
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
  } catch {
    // AsyncStorage unavailable — silently skip
  }
}

export const MushiFloatingButton: FC<MushiFloatingButtonProps> = ({
  onPress,
  position = 'bottom-right',
  inset,
  config,
  accent,
}) => {
  const scheme = useColorScheme()
  const dark = scheme === 'dark'
  const draggable = config?.draggable ?? false
  const snapToEdge = config?.snapToEdge ?? true
  const persist = config?.persist ?? false

  const baseBottom = inset?.bottom ?? (Platform.OS === 'ios' ? 50 : 28)
  const baseX =
    position === 'bottom-left'
      ? inset?.left ?? EDGE_PADDING
      : (() => {
          const { width } = getScreenBounds()
          return width - FAB_SIZE - (inset?.right ?? EDGE_PADDING)
        })()

  const scale = useRef(new Animated.Value(1)).current
  const posX = useRef(new Animated.Value(baseX)).current
  const posY = useRef(new Animated.Value(0)).current

  const currentX = useRef(baseX)
  const currentY = useRef(0)
  const isDragging = useRef(false)

  // Default to the shared Mushi hanko-red accent (cross-platform coherence)
  // instead of platform blue, so the RN FAB matches the web widget. Hosts can
  // still override via the `accent` prop / console accent.
  const accentColor = accent ?? mushiPalette(dark ? 'dark' : 'light').accent

  useEffect(() => {
    if (!persist) return
    void loadStoredPos().then((pos) => {
      if (!pos) return
      currentX.current = pos.x
      currentY.current = pos.y
      posX.setValue(pos.x)
      posY.setValue(pos.y)
    })
  }, [persist, posX, posY])

  const snapAndPersist = useCallback(
    (x: number, y: number) => {
      const { width, height } = getScreenBounds()
      let snappedX = x
      if (snapToEdge) {
        const midX = width / 2
        snappedX = x + FAB_SIZE / 2 < midX ? EDGE_PADDING : width - FAB_SIZE - EDGE_PADDING
      }
      const clampedX = clamp(snappedX, EDGE_PADDING, width - FAB_SIZE - EDGE_PADDING)
      const clampedY = clamp(y, -(height - FAB_SIZE - baseBottom - 60), 0)
      currentX.current = clampedX
      currentY.current = clampedY
      Animated.spring(posX, {
        toValue: clampedX,
        useNativeDriver: false,
        damping: 18,
        stiffness: 220,
      }).start()
      Animated.spring(posY, {
        toValue: clampedY,
        useNativeDriver: false,
        damping: 18,
        stiffness: 220,
      }).start()
      if (persist) void storePos({ x: clampedX, y: clampedY })
    },
    [snapToEdge, persist, posX, posY, baseBottom],
  )

  const panResponder = useRef(
    draggable
      ? PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: (_, g) =>
            Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
          onPanResponderGrant: () => {
            isDragging.current = false
            posX.stopAnimation()
            posY.stopAnimation()
          },
          onPanResponderMove: (_, g) => {
            if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) {
              isDragging.current = true
              // Suppress scale bounce while dragging
              scale.setValue(1)
            }
            const { width, height } = getScreenBounds()
            const newX = clamp(
              currentX.current + g.dx,
              EDGE_PADDING,
              width - FAB_SIZE - EDGE_PADDING,
            )
            const newY = clamp(
              currentY.current + g.dy,
              -(height - FAB_SIZE - baseBottom - 60),
              0,
            )
            posX.setValue(newX)
            posY.setValue(newY)
          },
          onPanResponderRelease: (_, g) => {
            if (isDragging.current) {
              snapAndPersist(currentX.current + g.dx, currentY.current + g.dy)
            }
            isDragging.current = false
          },
        })
      : PanResponder.create({}),
  ).current

  const handlePressIn = useCallback(() => {
    if (isDragging.current) return
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
    if (!isDragging.current) onPress()
  }, [scale, onPress])

  return (
    <Animated.View
      {...(draggable ? panResponder.panHandlers : {})}
      style={[
        s.fab,
        {
          left: posX,
          bottom: Animated.add(new Animated.Value(baseBottom), Animated.multiply(posY, -1)),
          backgroundColor: accentColor,
          shadowColor: dark ? accentColor : '#000',
          transform: [{ scale }],
        } as ViewStyle,
      ]}
      onStartShouldSetResponder={() => !draggable}
      onResponderGrant={handlePressIn}
      onResponderRelease={handlePressOut}
    >
      <Animated.Text style={s.emoji}>{MUSHI_COPY.triggerText}</Animated.Text>
    </Animated.View>
  )
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
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
