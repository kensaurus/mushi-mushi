/**
 * FILE: MushiBottomSheet.tsx
 * PURPOSE: Bottom-sheet modal for conversational bug reporting in React Native
 *
 * OVERVIEW:
 * - Slide-up modal built entirely on RN built-ins (Modal, Animated, PanResponder)
 * - Conversational flow: category → description → submit → confirmation
 * - Drag-to-dismiss via PanResponder on the handle area
 * - Dark/light theme via useColorScheme
 *
 * DEPENDENCIES:
 * - React Native built-in APIs only (no third-party libs)
 * - MushiContext from ../provider for submitReport
 *
 * USAGE:
 * - Rendered internally by MushiProvider; controlled via `visible` / `onClose` props
 * - Can also be used standalone: <MushiBottomSheet visible={…} onClose={…} />
 *
 * TECHNICAL DETAILS:
 * - PanResponder threshold: 80 px downward drag dismisses
 * - Animated.spring for slide-up, Animated.timing for backdrop
 * - Success confirmation auto-closes after 1.4 s
 *
 * NOTES:
 * - KeyboardAvoidingView wraps the sheet so the text input stays visible
 * - Categories match the web SDK: bug, slow, visual, confusing, other
 */

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type FC,
} from 'react'
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  PanResponder,
  StyleSheet,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  useColorScheme,
  type ViewStyle,
  type TextStyle,
} from 'react-native'
import { useMushiContext } from '../provider'

const { height: SCREEN_HEIGHT } = Dimensions.get('window')
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.55
const DISMISS_THRESHOLD = 80

const CATEGORIES = [
  { key: 'bug', emoji: '🐛', label: 'Bug' },
  { key: 'slow', emoji: '🐢', label: 'Slow' },
  { key: 'visual', emoji: '🎨', label: 'Visual' },
  { key: 'confusing', emoji: '😕', label: 'Confusing' },
  { key: 'other', emoji: '💬', label: 'Other' },
] as const

export interface MushiBottomSheetProps {
  visible: boolean
  onClose: () => void
}

export const MushiBottomSheet: FC<MushiBottomSheetProps> = ({ visible, onClose }) => {
  const mushi = useMushiContext()
  const scheme = useColorScheme()
  const dark = scheme === 'dark'

  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current
  const backdropOpacity = useRef(new Animated.Value(0)).current

  const [category, setCategory] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form')

  const resetForm = useCallback(() => {
    setCategory(null)
    setDescription('')
    setPhase('form')
  }, [])

  const animateIn = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start()
  }, [translateY, backdropOpacity])

  const animateOut = useCallback(
    (cb?: () => void) => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SHEET_HEIGHT,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        resetForm()
        cb?.()
      })
    },
    [translateY, backdropOpacity, resetForm],
  )

  useEffect(() => {
    if (visible) animateIn()
  }, [visible, animateIn])

  const handleClose = useCallback(() => {
    animateOut(onClose)
  }, [animateOut, onClose])

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 4,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy)
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_THRESHOLD) {
          handleClose()
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 200,
          }).start()
        }
      },
    }),
  ).current

  const handleSubmit = async () => {
    if (!category || !description.trim() || !mushi) return
    setPhase('sending')
    try {
      await mushi.submitReport({ category, description: description.trim() })
      setPhase('sent')
      setTimeout(handleClose, 1400)
    } catch {
      setPhase('form')
    }
  }

  const colors = dark
    ? { bg: '#1c1c1e', text: '#f2f2f7', sub: '#8e8e93', card: '#2c2c2e', accent: '#0a84ff', border: '#38383a', backdrop: 'rgba(0,0,0,0.6)' }
    : { bg: '#ffffff', text: '#1c1c1e', sub: '#8e8e93', card: '#f2f2f7', accent: '#007aff', border: '#e5e5ea', backdrop: 'rgba(0,0,0,0.35)' }

  const canSubmit = !!category && description.trim().length > 0 && phase === 'form'

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Backdrop */}
        <Animated.View
          style={[s.backdrop, { backgroundColor: colors.backdrop, opacity: backdropOpacity }]}
        >
          <TouchableOpacity style={s.flex} activeOpacity={1} onPress={handleClose} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          style={[
            s.sheet,
            { backgroundColor: colors.bg, transform: [{ translateY }] } as ViewStyle,
          ]}
        >
          {/* Drag handle */}
          <View {...panResponder.panHandlers} style={s.handleArea}>
            <View style={[s.handle, { backgroundColor: colors.sub }]} />
          </View>

          {phase === 'sent' ? (
            <View style={s.sentWrap}>
              <Text style={[s.sentEmoji]}>✅</Text>
              <Text style={[s.sentText, { color: colors.text }]}>Report sent!</Text>
            </View>
          ) : (
            <View style={s.body}>
              <Text style={[s.title, { color: colors.text }]}>Report an issue</Text>

              {/* Categories */}
              <View style={s.catRow}>
                {CATEGORIES.map((c) => {
                  const active = category === c.key
                  return (
                    <TouchableOpacity
                      key={c.key}
                      onPress={() => setCategory(c.key)}
                      activeOpacity={0.7}
                      style={[
                        s.catBtn,
                        {
                          backgroundColor: active ? colors.accent : colors.card,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text style={s.catEmoji}>{c.emoji}</Text>
                      <Text
                        style={[
                          s.catLabel,
                          { color: active ? '#fff' : colors.text } as TextStyle,
                        ]}
                      >
                        {c.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {/* Description */}
              <TextInput
                style={[
                  s.input,
                  {
                    backgroundColor: colors.card,
                    color: colors.text,
                    borderColor: colors.border,
                  },
                ]}
                placeholder="What happened?"
                placeholderTextColor={colors.sub}
                multiline
                textAlignVertical="top"
                value={description}
                onChangeText={setDescription}
                editable={phase === 'form'}
              />

              {/* Submit */}
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!canSubmit}
                activeOpacity={0.8}
                style={[
                  s.submitBtn,
                  { backgroundColor: canSubmit ? colors.accent : colors.border },
                ]}
              >
                <Text style={s.submitText}>
                  {phase === 'sending' ? 'Sending…' : 'Submit'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: SHEET_HEIGHT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 24,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    opacity: 0.5,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  catRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  catBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    marginHorizontal: 3,
  },
  catEmoji: {
    fontSize: 22,
    marginBottom: 4,
  },
  catLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 100,
    marginBottom: 16,
  },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  sentWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  sentEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  sentText: {
    fontSize: 20,
    fontWeight: '600',
  },
})
