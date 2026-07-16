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
  ScrollView,
  useColorScheme,
  type ViewStyle,
  type TextStyle,
} from 'react-native'
import {
  mushiPalette,
  MUSHI_BANNER_NEON,
  MUSHI_COPY,
  MUSHI_CONTROL_DISABLED,
  MUSHI_INVERSE,
  MUSHI_RADIUS,
  MUSHI_SHADOW_INK,
  MUSHI_SPACING,
  MUSHI_TYPE,
} from '@mushi-mushi/core'
import { getLocale } from '@mushi-mushi/web/i18n'
import { useMushiContext } from '../provider'
import { reporterStatusShort } from '../reporter-status'

const { height: SCREEN_HEIGHT } = Dimensions.get('window')
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.55
const DISMISS_THRESHOLD = 80

const CATEGORY_KEYS = ['bug', 'slow', 'visual', 'confusing', 'other'] as const
const CATEGORY_EMOJI: Record<(typeof CATEGORY_KEYS)[number], string> = {
  bug: '🐛',
  slow: '🐢',
  visual: '🎨',
  confusing: '😕',
  other: '💬',
}

// Reporter-fixed/terminal statuses that should surface the verify ("Yes,
// fixed") / reopen ("Not fixed") row. Mirrors the web widget, which treats
// `resolved` (CLI alias) and `verified` (already-confirmed, still reopenable on
// regression) as fixed-ish alongside `fixed`.
const VERIFIABLE_STATUSES = new Set(['fixed', 'resolved', 'verified'])

export interface MushiBottomSheetProps {
  visible: boolean
  onClose: () => void
  /** Tab to select when the sheet opens (controlled by MushiProvider). */
  preferredTab?: 'report' | 'inbox' | 'assistant'
  /** Base64 data-URI of the screenshot captured before the sheet opened. Optional. */
  screenshotDataUrl?: string
  /** Called when the user removes the attached screenshot. */
  onClearScreenshot?: () => void
  /**
   * Privacy caption shown beneath the screenshot preview. `null` hides it.
   * Resolved by the provider from `widget.screenshotSensitiveHint`.
   */
  screenshotSensitiveHint?: string | null
  /** When true, renders an Ask tab with page-aware assistant (web parity). */
  assistantEnabled?: boolean
  assistantLabel?: string
  assistantGreeting?: string
  assistantSuggestions?: string[]
  /** Poll My Reports while inbox tab is open. 0 disables polling. */
  inboxPollIntervalMs?: number
}

export const MushiBottomSheet: FC<MushiBottomSheetProps> = ({
  visible,
  onClose,
  preferredTab = 'report',
  screenshotDataUrl,
  onClearScreenshot,
  screenshotSensitiveHint,
  assistantEnabled = false,
  assistantLabel = MUSHI_COPY.assistantTab,
  assistantGreeting,
  assistantSuggestions = [],
  inboxPollIntervalMs = 0,
}) => {
  const mushi = useMushiContext()
  const t = getLocale()
  const greeting = assistantGreeting ?? t.assistant.defaultGreeting
  const scheme = useColorScheme()
  const dark = scheme === 'dark'

  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current
  const backdropOpacity = useRef(new Animated.Value(0)).current

  const [category, setCategory] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent' | 'error'>('form')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [sheetTab, setSheetTab] = useState<'report' | 'inbox' | 'assistant'>('report')
  const [inboxReports, setInboxReports] = useState<Array<{ id: string; status: string; summary?: string | null; description?: string }>>([])
  const [inboxLoading, setInboxLoading] = useState(false)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [threadComments, setThreadComments] = useState<Array<{ id: number; body: string; author_kind: string; created_at: string }>>([])
  const [replyText, setReplyText] = useState('')
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantThreadId, setAssistantThreadId] = useState<string | null>(null)
  const [assistantSending, setAssistantSending] = useState(false)
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const [assistantTurns, setAssistantTurns] = useState<Array<{ role: 'user' | 'bot'; text: string; options?: string[] }>>([])
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
      setSheetTab(preferredTab)
      if (preferredTab === 'inbox') void loadInbox()
    }
  }, [visible, preferredTab, loadInbox])

  useEffect(() => {
    if (!visible || sheetTab !== 'inbox' || inboxPollIntervalMs <= 0) return
    const timer = setInterval(() => {
      void loadInbox()
    }, inboxPollIntervalMs)
    return () => clearInterval(timer)
  }, [visible, sheetTab, inboxPollIntervalMs, loadInbox])

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

  const sendAssistant = useCallback(async (message: string) => {
    if (!mushi?.askAssistant || !message.trim() || assistantSending) return
    const trimmed = message.trim()
    setAssistantInput('')
    setAssistantError(null)
    setAssistantTurns((prev) => [...prev, { role: 'user', text: trimmed }])
    setAssistantSending(true)
    try {
      const reply = await mushi.askAssistant(trimmed, assistantThreadId)
      if (!reply) {
        setAssistantError('Could not reach the assistant. Try again.')
        return
      }
      if (reply.threadId) setAssistantThreadId(reply.threadId)
      const botText = reply.kind === 'clarify' ? (reply.question ?? reply.text ?? '') : (reply.text ?? '')
      setAssistantTurns((prev) => [
        ...prev,
        { role: 'bot', text: botText, options: reply.options },
      ])
    } catch {
      setAssistantError('Could not reach the assistant. Try again.')
    } finally {
      setAssistantSending(false)
    }
  }, [mushi, assistantSending, assistantThreadId])

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
    const trimmed = description.trim()
    if (trimmed.length < 20) {
      setSubmitError('Please write at least 20 characters so we can understand the issue.')
      return
    }
    setSubmitError(null)
    setPhase('sending')
    try {
      const outcome = await mushi.submitReport({
        category,
        description: trimmed,
        screenshotDataUrl: screenshotDataUrl && screenshotAttached ? screenshotDataUrl : undefined,
      })
      if (!outcome.ok) {
        if (outcome.failureKind === 'credentials' || outcome.failureKind === 'quota') {
          setSubmitError('Could not send — check the project API key or plan quota.')
          setPhase('error')
          return
        }
        if (outcome.failureKind === 'rate_limited') {
          setSubmitError('Sending too fast — we queued this and will retry shortly.')
          setPhase('error')
          return
        }
        // queued / retrying — still acknowledge without claiming success
        setSubmitError('Queued for retry — we will send it when the connection is back.')
        setPhase('error')
        return
      }
      setPhase('sent')
      setTimeout(handleClose, 1400)
    } catch {
      setSubmitError('Something went wrong. Please try again.')
      setPhase('error')
    }
  }

  const activeScreenshot = screenshotDataUrl && screenshotAttached ? screenshotDataUrl : null

  // Surface/text colours come from the shared washi/sumi tokens so the sheet
  // reads as the same product as the web widget (cross-platform coherence —
  // Workstream C). The neon accent is intentionally retained: it matches the
  // banner the user tapped to open this sheet.
  const pal = mushiPalette(dark ? 'dark' : 'light')
  const colors = dark
    ? { bg: pal.paper, text: pal.ink, sub: pal.inkMuted, card: pal.paperRaised, accent: MUSHI_BANNER_NEON.bg, accentInk: MUSHI_BANNER_NEON.fg, border: pal.ruleStrong, backdrop: 'rgba(0,0,0,0.6)', disabled: MUSHI_CONTROL_DISABLED.dark, disabledText: pal.inkFaint }
    : { bg: pal.paperRaised, text: pal.ink, sub: pal.inkMuted, card: pal.paper, accent: MUSHI_BANNER_NEON.bg, accentInk: MUSHI_BANNER_NEON.fg, border: pal.ruleStrong, backdrop: 'rgba(0,0,0,0.35)', disabled: MUSHI_CONTROL_DISABLED.light, disabledText: pal.inkFaint }

  const sheetTabs = (
    ['report', 'inbox', ...(assistantEnabled ? (['assistant'] as const) : [])] as const
  )

  const canSubmit = !!category && description.trim().length >= 20 && (phase === 'form' || phase === 'error')

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
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

          {/* Neon brand header — mirrors the web SDK banner so the sheet reads
              as the same surface the user tapped to open it. */}
          <View style={[s.brandHeader, { backgroundColor: MUSHI_BANNER_NEON.bg, borderBottomColor: MUSHI_BANNER_NEON.border }]}>
            <Text style={[s.brandEyebrow, { color: MUSHI_BANNER_NEON.fg }]}>MUSHI · BETA</Text>
            <Text style={[s.brandTitle, { color: MUSHI_BANNER_NEON.fg }]}>
              {sheetTab === 'assistant'
                ? assistantLabel
                : sheetTab === 'inbox'
                  ? t.flows.reports.title
                  : t.widget.title}
            </Text>
          </View>

          {/* Tab row */}
          <View style={[s.tabRow, { borderBottomColor: colors.border }]}>
            {sheetTabs.map((tab) => (
              <TouchableOpacity
                key={tab}
                onPress={() => {
                  setSheetTab(tab)
                  if (tab === 'inbox') void loadInbox()
                  else setSelectedReportId(null)
                }}
                style={[s.tabBtn, sheetTab === tab && { borderBottomColor: colors.accent }]}
              >
                <Text style={[s.tabLabel, { color: sheetTab === tab ? colors.text : colors.sub }]}>
                  {tab === 'report'
                    ? t.widget.trigger
                    : tab === 'inbox'
                      ? t.flows.reports.title
                      : assistantLabel}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {sheetTab === 'assistant' ? (
            <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
              {assistantTurns.length === 0 ? (
                <>
                  <Text style={{ color: colors.sub, marginBottom: 12, lineHeight: 20 }}>{greeting}</Text>
                  {assistantSuggestions.map((chip) => (
                    <TouchableOpacity
                      key={chip}
                      style={[s.assistantChip, { borderColor: colors.border, backgroundColor: colors.card }]}
                      onPress={() => void sendAssistant(chip)}
                    >
                      <Text style={{ color: colors.text, fontSize: 13 }}>{chip}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              ) : (
                assistantTurns.map((turn, idx) => (
                  <View
                    key={`${turn.role}-${idx}`}
                    style={[
                      s.assistantBubble,
                      {
                        alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                        backgroundColor: turn.role === 'user' ? colors.accent : colors.card,
                      },
                    ]}
                  >
                    <Text style={{ color: turn.role === 'user' ? colors.accentInk : colors.text }}>{turn.text}</Text>
                    {turn.options?.map((opt) => (
                      <TouchableOpacity key={opt} onPress={() => void sendAssistant(opt)} style={{ marginTop: 8 }}>
                        <Text style={{ color: colors.accent, fontSize: 12 }}>{opt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))
              )}
              {assistantSending ? (
                <Text style={{ color: colors.sub, marginTop: 8 }} accessibilityLiveRegion="polite">
                  {t.assistant.thinking}
                </Text>
              ) : null}
              {assistantError ? (
                <Text style={{ color: pal.danger, marginTop: 8 }} accessibilityRole="alert">
                  {assistantError}
                </Text>
              ) : null}
              <View style={s.assistantComposer}>
                <TextInput
                  style={[s.input, { flex: 1, minHeight: 44, backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                  placeholder={t.assistant.inputPlaceholder}
                  placeholderTextColor={colors.sub}
                  value={assistantInput}
                  onChangeText={setAssistantInput}
                  editable={!assistantSending}
                />
                <TouchableOpacity
                  style={[s.submitBtn, { backgroundColor: colors.accent, paddingHorizontal: 16 }]}
                  onPress={() => void sendAssistant(assistantInput)}
                  disabled={!assistantInput.trim() || assistantSending}
                >
                  <Text style={[s.submitText, { color: colors.accentInk }]}>↑</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : sheetTab === 'inbox' ? (
            <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
              {inboxLoading ? (
                <Text style={{ color: colors.sub }}>{t.flows.reports.loading}</Text>
              ) : selectedReportId ? (
                <>
                  <TouchableOpacity onPress={() => setSelectedReportId(null)}>
                    <Text style={{ color: colors.accent, marginBottom: 8 }}>← {t.widget.back}</Text>
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
                        <Text style={[s.submitText, { color: colors.accentInk }]}>{t.flows.thread.confirmFixed}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.verifyBtn, { backgroundColor: colors.border }]} onPress={() => submitFeedback('not_fixed')}>
                        <Text style={[s.submitText, { color: colors.text }]}>{t.flows.thread.notFixed}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <TextInput
                    style={[s.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, minHeight: 48 }]}
                    placeholder={t.flows.thread.replyPlaceholder}
                    placeholderTextColor={colors.sub}
                    value={replyText}
                    onChangeText={setReplyText}
                  />
                  <TouchableOpacity style={[s.submitBtn, { backgroundColor: colors.accent }]} onPress={sendReply}>
                    <Text style={[s.submitText, { color: colors.accentInk }]}>{t.flows.thread.send}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                inboxReports.map((r) => (
                  <TouchableOpacity key={r.id} style={[s.inboxRow, { borderColor: colors.border }]} onPress={() => openThread(r.id)}>
                    <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                      {(r.summary ?? r.description ?? 'Report').slice(0, 60)}
                    </Text>
                    <Text style={{ color: colors.sub, fontSize: 11 }}>{reporterStatusShort(r.status)}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          ) : phase === 'sent' ? (
            <View style={s.sentWrap}>
              <Text style={[s.sentEmoji]}>✅</Text>
              <Text style={[s.sentText, { color: colors.text }]}>{t.widget.submitted}</Text>
            </View>
          ) : (
            <ScrollView style={s.body} keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}>
              <Text style={[s.stepLabel, { color: colors.sub }]}>{t.step1.heading}</Text>

              {/* Categories */}
              <View style={s.catRow}>
                {CATEGORY_KEYS.map((key) => {
                  const active = category === key
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setCategory(key)}
                      activeOpacity={0.7}
                      style={[
                        s.catBtn,
                        {
                          backgroundColor: active ? colors.accent : colors.card,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text style={s.catEmoji}>{CATEGORY_EMOJI[key]}</Text>
                      <Text
                        style={[
                          s.catLabel,
                          { color: active ? colors.accentInk : colors.text } as TextStyle,
                        ]}
                      >
                        {t.step1.categories[key]}
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
                placeholder={t.step3.descriptionPlaceholder}
                placeholderTextColor={colors.sub}
                multiline
                textAlignVertical="top"
                value={description}
                onChangeText={(text) => {
                  setDescription(text.slice(0, 4000))
                  if (submitError) setSubmitError(null)
                  if (phase === 'error') setPhase('form')
                }}
                editable={phase === 'form' || phase === 'error'}
                maxLength={4000}
              />
              {submitError ? (
                <Text style={{ color: colors.accent, marginTop: 6, fontSize: 12 }}>{submitError}</Text>
              ) : null}

              {/* Screenshot thumbnail — shown if a screenshot was captured */}
              {activeScreenshot ? (
                <View style={s.screenshotRow}>
                  <Image
                    source={{ uri: activeScreenshot }}
                    style={[s.screenshotThumb, { backgroundColor: colors.text }]}
                    accessibilityLabel={t.step3.screenshotPreviewAlt}
                  />
                  <View style={s.screenshotMeta}>
                    <Text style={[s.screenshotLabel, { color: colors.text }]}>
                      {t.step3.screenshotAttached.replace(' ✓', '')}
                    </Text>
                    <Text style={[s.screenshotSub, { color: colors.sub }]}>
                      {screenshotSensitiveHint && screenshotSensitiveHint.trim()
                        ? `⚠ ${screenshotSensitiveHint}`
                        : t.step3.screenshotSensitiveHint.split('—')[0]?.trim() ?? t.step3.screenshotSensitiveHint}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setScreenshotAttached(false)
                      onClearScreenshot?.()
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={t.widget.close}
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
                  { backgroundColor: canSubmit ? colors.accent : colors.disabled },
                ]}
              >
                <Text style={[s.submitText, { color: canSubmit ? colors.accentInk : colors.disabledText }]}>
                  {phase === 'sending' ? t.widget.submitting : t.widget.submit}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    // Inlined StyleSheet.absoluteFillObject — RN 0.86 dropped it from the
    // StyleSheet TS types; the literal is equivalent and works on all RN >=0.72.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: SHEET_HEIGHT,
    borderTopLeftRadius: MUSHI_RADIUS.sheet,
    borderTopRightRadius: MUSHI_RADIUS.sheet,
    paddingBottom: Platform.OS === 'ios' ? 34 : MUSHI_SPACING.roomy,
    shadowColor: MUSHI_SHADOW_INK,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 24,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: MUSHI_SPACING.comfy,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: MUSHI_RADIUS.control,
    opacity: 0.5,
  },
  brandHeader: {
    paddingHorizontal: MUSHI_SPACING.lounge,
    paddingTop: MUSHI_SPACING.comfy,
    paddingBottom: MUSHI_SPACING.comfy,
    borderBottomWidth: 1.5,
  },
  brandEyebrow: {
    fontSize: MUSHI_TYPE.sizeLabel,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 2,
    opacity: 0.7,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  body: {
    paddingHorizontal: MUSHI_SPACING.lounge,
    paddingTop: MUSHI_SPACING.tight,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: MUSHI_SPACING.roomy,
  },
  stepLabel: {
    fontSize: MUSHI_TYPE.sizeLabel,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: MUSHI_SPACING.snug,
    marginBottom: MUSHI_SPACING.comfy,
    textTransform: 'uppercase',
  },
  catRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: MUSHI_SPACING.roomy,
  },
  catBtn: {
    alignItems: 'center',
    paddingVertical: MUSHI_SPACING.comfy,
    paddingHorizontal: 6,
    borderRadius: MUSHI_RADIUS.card,
    borderWidth: 1,
    flex: 1,
    marginHorizontal: 3,
    minHeight: 44,
  },
  catEmoji: {
    fontSize: 22,
    marginBottom: MUSHI_SPACING.tight,
  },
  catLabel: {
    fontSize: MUSHI_TYPE.sizeLabel,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: MUSHI_RADIUS.card,
    padding: 14,
    fontSize: 15,
    minHeight: 100,
    marginBottom: MUSHI_SPACING.roomy,
  },
  submitBtn: {
    borderRadius: MUSHI_RADIUS.card,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 44,
  },
  submitText: {
    color: MUSHI_INVERSE,
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
  assistantBubble: {
    maxWidth: '88%',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  assistantChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  assistantComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 12,
    paddingBottom: 8,
  },
})
