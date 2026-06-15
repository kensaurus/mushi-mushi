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
  Image,
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

// Reporter-fixed/terminal statuses that should surface the verify ("Yes,
// fixed") / reopen ("Not fixed") row. Mirrors the web widget, which treats
// `resolved` (CLI alias) and `verified` (already-confirmed, still reopenable on
// regression) as fixed-ish alongside `fixed`.
const VERIFIABLE_STATUSES = new Set(['fixed', 'resolved', 'verified'])

export interface MushiBottomSheetProps {
  visible: boolean
  onClose: () => void
  /** Base64 data-URI of the screenshot captured before the sheet opened. Optional. */
  screenshotDataUrl?: string
  /** Called when the user removes the attached screenshot. */
  onClearScreenshot?: () => void
}

export const MushiBottomSheet: FC<MushiBottomSheetProps> = ({
  visible,
  onClose,
  screenshotDataUrl,
  onClearScreenshot,
}) => {
  const mushi = useMushiContext()
  const scheme = useColorScheme()
  const dark = scheme === 'dark'

  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current
  const backdropOpacity = useRef(new Animated.Value(0)).current

  const [category, setCategory] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form')
  const [sheetTab, setSheetTab] = useState<'report' | 'inbox'>('report')
  const [inboxReports, setInboxReports] = useState<Array<{ id: string; status: string; summary?: string | null; description?: string }>>([])
  const [inboxLoading, setInboxLoading] = useState(false)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [threadComments, setThreadComments] = useState<Array<{ id: number; body: string; author_kind: string; created_at: string }>>([])
  const [replyText, setReplyText] = useState('')
  // Local shadow of the screenshot so we can clear it from inside the sheet
  const [screenshotAttached, setScreenshotAttached] = useState(true)

  const loadInbox = useCallback(async () => {
    if (!mushi?.listMyReports) return
    setInboxLoading(true)
    try {
      const rows = await mushi.listMyReports()
      setInboxReports(rows as typeof inboxReports)
    } finally {
      setInboxLoading(false)
    }
  }, [mushi])

  useEffect(() => {
    if (visible) {
      setScreenshotAttached(true)
      if (sheetTab === 'inbox') void loadInbox()
    }
  }, [visible, sheetTab, loadInbox])

  const openThread = useCallback(async (reportId: string) => {
    setSelectedReportId(reportId)
    if (!mushi?.listMyComments) return
    const comments = await mushi.listMyComments(reportId)
    setThreadComments(comments as typeof threadComments)
  }, [mushi])

  const sendReply = useCallback(async () => {
    if (!mushi?.replyToReport || !selectedReportId || !replyText.trim()) return
    await mushi.replyToReport(selectedReportId, replyText.trim())
    setReplyText('')
    await openThread(selectedReportId)
  }, [mushi, selectedReportId, replyText, openThread])

  const submitFeedback = useCallback(async (signal: string) => {
    if (!mushi?.submitFeedbackSignal || !selectedReportId) return
    await mushi.submitFeedbackSignal(selectedReportId, signal)
    await loadInbox()
    await openThread(selectedReportId)
  }, [mushi, selectedReportId, loadInbox, openThread])

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
      await mushi.submitReport({
        category,
        description: description.trim(),
        screenshotDataUrl: screenshotDataUrl && screenshotAttached ? screenshotDataUrl : undefined,
      })
      setPhase('sent')
      setTimeout(handleClose, 1400)
    } catch {
      setPhase('form')
    }
  }

  const activeScreenshot = screenshotDataUrl && screenshotAttached ? screenshotDataUrl : null

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

          {/* Tab row */}
          <View style={s.tabRow}>
            {(['report', 'inbox'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                onPress={() => {
                  setSheetTab(tab)
                  if (tab === 'inbox') void loadInbox()
                  else setSelectedReportId(null)
                }}
                style={[s.tabBtn, sheetTab === tab && { borderBottomColor: colors.accent }]}
              >
                <Text style={[s.tabLabel, { color: sheetTab === tab ? colors.accent : colors.sub }]}>
                  {tab === 'report' ? 'Report' : 'Inbox'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {sheetTab === 'inbox' ? (
            <View style={s.body}>
              {inboxLoading ? (
                <Text style={{ color: colors.sub }}>Loading…</Text>
              ) : selectedReportId ? (
                <>
                  <TouchableOpacity onPress={() => setSelectedReportId(null)}>
                    <Text style={{ color: colors.accent, marginBottom: 8 }}>← Back</Text>
                  </TouchableOpacity>
                  {threadComments.map((c) => (
                    <View key={c.id} style={[s.threadBubble, { backgroundColor: colors.card }]}>
                      <Text style={{ color: colors.sub, fontSize: 11 }}>{c.author_kind}</Text>
                      <Text style={{ color: colors.text }}>{c.body}</Text>
                    </View>
                  ))}
                  {VERIFIABLE_STATUSES.has(
                    inboxReports.find((r) => r.id === selectedReportId)?.status ?? '',
                  ) && (
                    <View style={s.verifyRow}>
                      <TouchableOpacity style={[s.verifyBtn, { backgroundColor: colors.accent }]} onPress={() => submitFeedback('confirms')}>
                        <Text style={s.submitText}>Yes, fixed</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.verifyBtn, { backgroundColor: colors.border }]} onPress={() => submitFeedback('not_fixed')}>
                        <Text style={[s.submitText, { color: colors.text }]}>Not fixed</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <TextInput
                    style={[s.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, minHeight: 48 }]}
                    placeholder="Reply…"
                    placeholderTextColor={colors.sub}
                    value={replyText}
                    onChangeText={setReplyText}
                  />
                  <TouchableOpacity style={[s.submitBtn, { backgroundColor: colors.accent }]} onPress={sendReply}>
                    <Text style={s.submitText}>Send</Text>
                  </TouchableOpacity>
                </>
              ) : (
                inboxReports.map((r) => (
                  <TouchableOpacity key={r.id} style={[s.inboxRow, { borderColor: colors.border }]} onPress={() => openThread(r.id)}>
                    <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                      {(r.summary ?? r.description ?? 'Report').slice(0, 60)}
                    </Text>
                    <Text style={{ color: colors.sub, fontSize: 11 }}>{r.status}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          ) : phase === 'sent' ? (
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

              {/* Screenshot thumbnail — shown if a screenshot was captured */}
              {activeScreenshot ? (
                <View style={s.screenshotRow}>
                  <Image
                    source={{ uri: activeScreenshot }}
                    style={s.screenshotThumb}
                    accessibilityLabel="Attached screenshot"
                  />
                  <View style={s.screenshotMeta}>
                    <Text style={[s.screenshotLabel, { color: colors.text }]}>
                      Screenshot attached
                    </Text>
                    <Text style={[s.screenshotSub, { color: colors.sub }]}>
                      Helps the team see the issue
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setScreenshotAttached(false)
                      onClearScreenshot?.()
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Remove screenshot"
                  >
                    <Text style={[s.screenshotRemove, { color: colors.sub }]}>✕</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

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
  screenshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(128,128,128,0.1)',
  },
  screenshotThumb: {
    width: 48,
    height: 36,
    borderRadius: 4,
    backgroundColor: '#000',
    flexShrink: 0,
  },
  screenshotMeta: {
    flex: 1,
    gap: 2,
  },
  screenshotLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  screenshotSub: {
    fontSize: 11,
  },
  screenshotRemove: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    marginBottom: 8,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  inboxRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  threadBubble: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  verifyRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  verifyBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
})
