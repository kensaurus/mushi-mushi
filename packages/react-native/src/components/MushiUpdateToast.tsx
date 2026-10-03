/**
 * FILE: MushiUpdateToast.tsx
 * PURPOSE: The next-visit toast (Plan 018 §4.2): "The developer replied to
 *          your report" / "Your bug is fixed" with View, shown by
 *          MushiProvider when the app returns to the foreground. Rules for
 *          when it shows live in core's reporter-ui (reporterShouldShowToast).
 *
 * Announced to screen readers (live region); auto-hides after 8 s; respects
 * the host theme. No animation, so reduce-motion needs no special case.
 */

import { useEffect, type FC } from 'react'
import { Text, TouchableOpacity, View, StyleSheet, useColorScheme } from 'react-native'
import { MUSHI_SHADOW_INK } from '@mushi-mushi/core'
import { reporterCopy, resolveReporterLocale } from '@mushi-mushi/core/reporter-ui'
import { resolveRNTheme, type MushiRNTheme } from '../theme'

const AUTO_HIDE_MS = 8000

export interface MushiUpdateToastProps {
  message: string
  onView: () => void
  onDismiss: () => void
  theme?: Partial<MushiRNTheme>
}

export const MushiUpdateToast: FC<MushiUpdateToastProps> = ({ message, onView, onDismiss, theme }) => {
  const colors = resolveRNTheme(useColorScheme() === 'dark', theme)
  const copy = reporterCopy(
    resolveReporterLocale(typeof navigator !== 'undefined' ? (navigator as { language?: string }).language : undefined),
  ).ui
  const font = colors.fontFamily ? { fontFamily: colors.fontFamily } : null

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <View
      style={[s.toast, { backgroundColor: colors.bg, borderColor: colors.border, borderRadius: colors.radius }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={[s.text, { color: colors.fg }, font]} numberOfLines={2}>
        {message}
      </Text>
      <TouchableOpacity
        onPress={onView}
        accessibilityRole="button"
        style={[s.btn, { backgroundColor: colors.accent, borderRadius: colors.radius }]}
      >
        <Text style={[{ color: colors.accentFg, fontWeight: '600' }, font]}>{copy.view}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={copy.done}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={[{ color: colors.muted, fontSize: 18 }, font]}>×</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: MUSHI_SHADOW_INK,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  text: { flex: 1, fontSize: 14 },
  btn: { paddingHorizontal: 12, paddingVertical: 6 },
})
