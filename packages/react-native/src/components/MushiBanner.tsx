/**
 * FILE: MushiBanner.tsx
 * PURPOSE: Native bottom strip launcher — parity with web `trigger: 'banner'`.
 *
 * OVERVIEW:
 * - Fixed neon strip using shared MUSHI_BANNER_NEON tokens from @mushi-mushi/core
 * - Tap opens the report sheet; optional dismiss hides until next cold start
 * - Reports layout height so Capacitor/RN hosts can pad content (banner-offset contract)
 *
 * DEPENDENCIES:
 * - @mushi-mushi/core (MUSHI_BANNER_NEON, MUSHI_COPY, MUSHI_GEOMETRY)
 *
 * USAGE:
 * - Rendered by MushiProvider when widget.trigger === 'banner'
 */

import { useCallback, type FC } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  type LayoutChangeEvent,
} from 'react-native'
import { MUSHI_BANNER_NEON, MUSHI_COPY, MUSHI_GEOMETRY } from '@mushi-mushi/core'

export interface MushiBannerProps {
  onPress: () => void
  onDismiss?: () => void
  message?: string
  label?: string
  /** Fires with measured banner height (px) for host safe-area / inset padding. */
  onLayoutHeight?: (height: number) => void
}

export const MUSHI_BANNER_DEFAULT_HEIGHT = MUSHI_GEOMETRY.bannerHeight

export const MushiBanner: FC<MushiBannerProps> = ({
  onPress,
  onDismiss,
  message = MUSHI_COPY.bannerMessage,
  label = MUSHI_COPY.bannerLabel,
  onLayoutHeight,
}) => {
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      onLayoutHeight?.(e.nativeEvent.layout.height)
    },
    [onLayoutHeight],
  )

  return (
    <View
      style={s.wrap}
      onLayout={handleLayout}
      accessibilityRole="header"
      accessibilityLabel="Mushi feedback banner"
    >
      <TouchableOpacity style={s.main} onPress={onPress} activeOpacity={0.85}>
        <Text style={s.eyebrow}>{label.toUpperCase()}</Text>
        <Text style={s.message} numberOfLines={2}>
          {message}
        </Text>
        <Text style={s.cta}>{MUSHI_COPY.bugCta}</Text>
      </TouchableOpacity>
      {onDismiss ? (
        <TouchableOpacity
          style={s.dismiss}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss banner"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={s.dismissText}>×</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: MUSHI_GEOMETRY.bannerHeight,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: MUSHI_BANNER_NEON.bg,
    borderTopWidth: 1,
    borderTopColor: MUSHI_BANNER_NEON.border,
    zIndex: 99998,
    elevation: 8,
    paddingBottom: Platform.OS === 'ios' ? 0 : 0,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: MUSHI_BANNER_NEON.fg,
  },
  message: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: MUSHI_BANNER_NEON.fg,
  },
  cta: {
    fontSize: 12,
    fontWeight: '700',
    color: MUSHI_BANNER_NEON.fg,
    textDecorationLine: 'underline',
  },
  dismiss: {
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dismissText: {
    fontSize: 20,
    lineHeight: 22,
    color: MUSHI_BANNER_NEON.fg,
    opacity: 0.7,
  },
})
