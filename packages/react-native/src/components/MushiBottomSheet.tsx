/**
 * FILE: MushiBottomSheet.tsx
 * PURPOSE: Bottom-sheet modal for conversational bug reporting in React Native
 *
 * OVERVIEW:
 * - Slide-up modal built entirely on RN built-ins (Modal, Animated, PanResponder)
 * - One screen, free text first: optional type chips, Send once there are a
 *   few words (8 by default) or a screenshot, then a receipt in place with
 *   Track it / Done and an optional, never pre-ticked email opt-in
 * - Drag-to-dismiss via PanResponder on the handle area
 * - Host-adaptive theme (`widget.theme`, see ../theme.ts) over light/dark
 * - "Your reports": statuses come from the shared core table
 *   (`@mushi-mushi/core/reporter-ui`), so web and RN say the same thing
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
 * - Reduce Motion (AccessibilityInfo) makes open / close instant
 * - The thread is the report's v2 timeline (GET /v1/reporter/reports/:id):
 *   pipeline events render from the shared core templates in the reporter's
 *   locale, replies as bubbles. Loads show a skeleton, then Retry on failure;
 *   a failed reply keeps its text and offers Retry. Opening a thread marks it
 *   read. An older server without the route falls back to the comment list.
 *
 * NOTES:
 * - KeyboardAvoidingView wraps the sheet so the text input stays visible
 * - Chips come from core's REPORTER_CATEGORIES (bug, slow, visual, confusing,
 *   idea); "Idea" files a feature request
 * - accessibilityViewIsModal is iOS-only; RN's Modal is its own window on
 *   Android, which keeps TalkBack focus inside the sheet there.
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
  AccessibilityInfo,
  useColorScheme,
  type ViewStyle,
  type TextStyle,
} from 'react-native'
import {
  MUSHI_COPY,
  MUSHI_INVERSE,
  MUSHI_RADIUS,
  MUSHI_SHADOW_INK,
  MUSHI_SPACING,
  MUSHI_TYPE,
  type MushiReporterComment,
  type MushiReporterReport,
} from '@mushi-mushi/core'
import {
  REPORTER_CATEGORIES,
  isPlausibleReporterEmail,
  isReporterConversation,
  reporterCanSend,
  reporterCategoryLabel,
  reporterChipToReport,
  reporterCopy,
  reporterStatus,
  reporterTimelineEntryText,
  resolveReporterLocale,
  type ReporterCategory,
} from '@mushi-mushi/core/reporter-ui'
import type { MushiReporterTimelineItem } from '@mushi-mushi/core/reporter-channels'
import { getLocale } from '@mushi-mushi/web/i18n'
import { useMushiContext } from '../provider'
import { resolveRNTheme, type MushiRNTheme } from '../theme'
import { loadReporterThread, settleWithin, THREAD_LOAD_TIMEOUT_MS } from '../reporter-thread'

const { height: SCREEN_HEIGHT } = Dimensions.get('window')
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.55
const DISMISS_THRESHOLD = 80

const CATEGORY_EMOJI: Record<ReporterCategory, string> = {
  bug: '🐛',
  slow: '🐢',
  visual: '🎨',
  confusing: '😕',
  idea: '💡',
}

type EmailOptInState = 'hidden' | 'offer' | 'sending' | 'sent' | 'invalid' | 'failed'

/** Comments from the legacy route, as timeline items (older servers). */
function commentsToTimeline(comments: MushiReporterComment[]): MushiReporterTimelineItem[] {
  return comments.map((c) => ({
    kind: c.author_kind === 'reporter' ? 'reporter_comment' : 'comment',
    at: c.created_at,
    text: c.body,
    body: c.body,
    comment_id: c.id,
  }))
}

type ThreadStatus = 'idle' | 'loading' | 'ready' | 'error'
type ReplyState = 'idle' | 'sending' | 'failed'

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
  /** Theme tokens (`widget.theme`); unset tokens use the neutral defaults. */
  theme?: Partial<MushiRNTheme>
  /** Characters needed before Send enables (`widget.minDescriptionLength`, default 8). */
  minDescriptionLength?: number
  /** Offer "Get updates by email" on the receipt when the project offers email (`notifications.email`). */
  emailOptIn?: boolean
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
  theme,
  minDescriptionLength,
  emailOptIn = true,
}) => {
  const mushi = useMushiContext()
  const t = getLocale()
  const locale = resolveReporterLocale(
    typeof navigator !== 'undefined' ? (navigator as { language?: string }).language : undefined,
  )
  const rc = reporterCopy(locale)
  const greeting = assistantGreeting ?? t.assistant.defaultGreeting
  const scheme = useColorScheme()
  const dark = scheme === 'dark'

  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current
  const backdropOpacity = useRef(new Animated.Value(0)).current

  const [category, setCategory] = useState<ReporterCategory | null>(null)
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent' | 'error'>('form')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [sheetTab, setSheetTab] = useState<'report' | 'inbox' | 'assistant'>('report')
  const [inboxReports, setInboxReports] = useState<MushiReporterReport[]>([])
  const [inboxLoaded, setInboxLoaded] = useState(false)
  const [inboxLoading, setInboxLoading] = useState(false)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const [threadItems, setThreadItems] = useState<MushiReporterTimelineItem[]>([])
  const [threadStatus, setThreadStatus] = useState<ThreadStatus>('idle')
  const [replyText, setReplyText] = useState('')
  const [replyState, setReplyState] = useState<ReplyState>('idle')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [feedbackError, setFeedbackError] = useState(false)
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantThreadId, setAssistantThreadId] = useState<string | null>(null)
  const [assistantSending, setAssistantSending] = useState(false)
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const [assistantTurns, setAssistantTurns] = useState<Array<{ role: 'user' | 'bot'; text: string; options?: string[] }>>([])
  // Local shadow of the screenshot so we can clear it from inside the sheet
  const [screenshotAttached, setScreenshotAttached] = useState(true)
  const [emailState, setEmailState] = useState<EmailOptInState>('hidden')
  const [emailInput, setEmailInput] = useState('')
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let alive = true
    AccessibilityInfo?.isReduceMotionEnabled?.()
      .then((on) => alive && setReduceMotion(Boolean(on)))
      .catch(() => undefined)
    const sub = AccessibilityInfo?.addEventListener?.('reduceMotionChanged', (on: boolean) => setReduceMotion(Boolean(on)))
    return () => {
      alive = false
      sub?.remove?.()
    }
  }, [])

  /** Load the list. `silent` (polls, refreshes) never blanks what is on screen. */
  const loadInbox = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!mushi?.listMyReports) return
      if (!opts.silent) setInboxLoading(true)
      try {
        const rows = await mushi.listMyReports()
        setInboxReports(rows.filter((r) => !reporterStatus(r, locale).hidden))
        setInboxLoaded(true)
      } catch {
        // listMyReports resolves [] on API failure; a throw keeps the last list.
      } finally {
        if (!opts.silent) setInboxLoading(false)
      }
    },
    [mushi, locale],
  )

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
      void loadInbox({ silent: true })
    }, inboxPollIntervalMs)
    return () => clearInterval(timer)
  }, [visible, sheetTab, inboxPollIntervalMs, loadInbox])

  const openThread = useCallback(
    async (reportId: string, opts: { silent?: boolean } = {}) => {
      selectedRef.current = reportId
      setSelectedReportId(reportId)
      if (!opts.silent) {
        setThreadItems([])
        setThreadStatus('loading')
        setReplyState('idle')
        setFeedbackError(false)
      }
      let items: MushiReporterTimelineItem[] | null = null
      const detail = mushi?.loadMyReportDetail
        ? await settleWithin(mushi.loadMyReportDetail(reportId), THREAD_LOAD_TIMEOUT_MS)
        : 'unsupported'
      if (detail && detail !== 'unsupported') {
        items = detail.timeline
      } else if (detail === 'unsupported') {
        // Older server: the comment list is all there is.
        const load = mushi?.loadMyThread ?? mushi?.listMyComments
        const comments = load ? await loadReporterThread(load, reportId) : null
        items = comments ? commentsToTimeline(comments) : null
      }
      // The reporter may have gone back or opened another thread meanwhile.
      if (selectedRef.current !== reportId) return
      if (items === null) {
        // A failed background refresh keeps the thread that is already shown.
        setThreadStatus((prev) => (opts.silent && prev === 'ready' ? 'ready' : 'error'))
        return
      }
      setThreadItems(items)
      setThreadStatus('ready')
      if (!opts.silent && mushi?.markReportRead) {
        mushi
          .markReportRead(reportId)
          .then((marked) => {
            if (marked > 0) {
              setInboxReports((rows) => rows.map((r) => (r.id === reportId ? { ...r, unread_count: 0 } : r)))
            }
          })
          .catch(() => undefined)
      }
    },
    [mushi],
  )

  const closeThread = useCallback(() => {
    selectedRef.current = null
    setSelectedReportId(null)
    setThreadStatus('idle')
  }, [])

  const sendReply = useCallback(async () => {
    const body = replyText.trim()
    const reportId = selectedReportId
    if (!mushi?.replyToReport || !reportId || !body || replyState === 'sending') return
    setReplyState('sending')
    try {
      const comment = await settleWithin(mushi.replyToReport(reportId, body), THREAD_LOAD_TIMEOUT_MS)
      if (!comment) {
        setReplyState('failed')
        return
      }
      setReplyText('')
      setReplyState('idle')
      if (selectedRef.current === reportId) {
        setThreadItems((prev) => [
          ...prev,
          { kind: 'reporter_comment', at: comment.created_at, text: comment.body, body: comment.body, comment_id: comment.id },
        ])
        void openThread(reportId, { silent: true })
      }
    } catch {
      setReplyState('failed')
    }
  }, [mushi, selectedReportId, replyText, replyState, openThread])

  const submitFeedback = useCallback(
    async (signal: string) => {
      const reportId = selectedReportId
      if (!mushi?.submitFeedbackSignal || !reportId || feedbackSending) return
      setFeedbackSending(true)
      setFeedbackError(false)
      try {
        const outcome = await mushi.submitFeedbackSignal(reportId, signal)
        if (!outcome) {
          setFeedbackError(true)
          return
        }
        await loadInbox({ silent: true })
        await openThread(reportId, { silent: true })
      } catch {
        setFeedbackError(true)
      } finally {
        setFeedbackSending(false)
      }
    },
    [mushi, selectedReportId, feedbackSending, loadInbox, openThread],
  )

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
    setEmailState('hidden')
    setEmailInput('')
  }, [])

  const animateIn = useCallback(() => {
    if (reduceMotion) {
      translateY.setValue(0)
      backdropOpacity.setValue(1)
      return
    }
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
  }, [translateY, backdropOpacity, reduceMotion])

  const animateOut = useCallback(
    (cb?: () => void) => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SHEET_HEIGHT,
          duration: reduceMotion ? 0 : 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: reduceMotion ? 0 : 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        resetForm()
        cb?.()
      })
    },
    [translateY, backdropOpacity, resetForm, reduceMotion],
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

  /** Offer email updates on the receipt only when the server says this app sends them. */
  const offerEmail = useCallback(async () => {
    if (!emailOptIn || !mushi?.getNotificationPrefs) return
    try {
      const prefs = await mushi.getNotificationPrefs()
      if (prefs?.available.email && !prefs.email_verified && !prefs.email_pending) {
        setEmailInput(mushi.emailPrefill?.() ?? '')
        setEmailState('offer')
      }
    } catch {
      /* no offer */
    }
  }, [emailOptIn, mushi])

  const submitEmail = useCallback(async () => {
    const email = emailInput.trim()
    if (!isPlausibleReporterEmail(email)) {
      setEmailState('invalid')
      return
    }
    if (!mushi?.setNotificationPrefs) return
    setEmailState('sending')
    try {
      const res = await mushi.setNotificationPrefs({ email })
      setEmailState(res.ok ? 'sent' : res.error?.status === 422 ? 'invalid' : 'failed')
    } catch {
      setEmailState('failed')
    }
  }, [emailInput, mushi])

  const handleSubmit = async () => {
    const hasAttachment = Boolean(screenshotDataUrl && screenshotAttached)
    if (!mushi || !reporterCanSend(description, hasAttachment, minDescriptionLength)) return
    const trimmed = description.trim()
    setSubmitError(null)
    setPhase('sending')
    try {
      const outcome = await mushi.submitReport({
        ...reporterChipToReport(category),
        description: trimmed,
        screenshotDataUrl: hasAttachment ? screenshotDataUrl : undefined,
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
      // The receipt replaces the form in place; nothing auto-closes.
      setPhase('sent')
      void offerEmail()
    } catch {
      setSubmitError('Something went wrong. Please try again.')
      setPhase('error')
    }
  }

  const activeScreenshot = screenshotDataUrl && screenshotAttached ? screenshotDataUrl : null

  const colors = resolveRNTheme(dark, theme)
  const font: TextStyle | null = colors.fontFamily ? { fontFamily: colors.fontFamily } : null
  const radius = colors.radius

  const sheetTabs = (
    ['report', 'inbox', ...(assistantEnabled ? (['assistant'] as const) : [])] as const
  )

  const canSubmit =
    reporterCanSend(description, Boolean(activeScreenshot), minDescriptionLength) && (phase === 'form' || phase === 'error')
  const submitHint = canSubmit || phase === 'sending' ? undefined : rc.ui.addWords

  const selectedReport = selectedReportId ? inboxReports.find((r) => r.id === selectedReportId) ?? null : null
  const selectedView = selectedReport ? reporterStatus(selectedReport, locale) : null
  const headerTitle =
    sheetTab === 'assistant' ? assistantLabel : sheetTab === 'inbox' ? t.flows.reports.title : t.widget.title

  const renderThread = () => (
    <>
      <TouchableOpacity
        onPress={closeThread}
        accessibilityRole="button"
        accessibilityLabel={t.widget.back}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={[{ color: colors.accent, marginBottom: 8 }, font]}>← {t.widget.back}</Text>
      </TouchableOpacity>

      {/* Header card renders instantly from the list row. */}
      {selectedReport && selectedView ? (
        <View style={[s.headerCard, { backgroundColor: colors.surface, borderRadius: radius, borderColor: colors.border }]}>
          <Text style={[s.pill, { color: colors.fg, borderColor: colors.border }, font]}>{selectedView.label}</Text>
          <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 4 }, font]}>{selectedView.detail}</Text>
          <Text style={[{ color: colors.fg, marginTop: 8 }, font]} numberOfLines={4}>
            {selectedReport.title ?? selectedReport.summary ?? selectedReport.description ?? ''}
          </Text>
        </View>
      ) : null}

      {threadStatus === 'loading' ? (
        <View accessibilityLabel={t.flows.reports.loading} accessibilityLiveRegion="polite">
          {[0, 1, 2].map((i) => (
            <View key={i} style={[s.skeleton, { backgroundColor: colors.surface, width: `${90 - i * 18}%` as `${number}%` }]} />
          ))}
        </View>
      ) : threadStatus === 'error' ? (
        <View style={s.errorRow} accessibilityLiveRegion="polite">
          <Text style={[{ color: colors.error, flex: 1 }, font]} accessibilityRole="alert">
            {rc.ui.loadError}
          </Text>
          <TouchableOpacity
            onPress={() => selectedReportId && void openThread(selectedReportId)}
            accessibilityRole="button"
            style={[s.retryBtn, { borderColor: colors.border, borderRadius: radius }]}
          >
            <Text style={[{ color: colors.fg, fontWeight: '600' }, font]}>{rc.ui.retry}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {threadItems.map((item, idx) =>
            isReporterConversation(item) ? (
              <View
                key={`${item.kind}-${item.comment_id ?? idx}`}
                style={[
                  s.threadBubble,
                  {
                    backgroundColor: colors.surface,
                    alignSelf: item.kind === 'reporter_comment' ? 'flex-end' : 'flex-start',
                  },
                ]}
              >
                <Text style={[{ color: colors.muted, fontSize: 11 }, font]}>
                  {item.kind === 'reporter_comment' ? rc.ui.you : rc.ui.developer}
                </Text>
                <Text style={[{ color: colors.fg }, font]}>{reporterTimelineEntryText(item, locale)}</Text>
              </View>
            ) : (
              <Text
                key={`${item.kind}-${item.at}-${idx}`}
                style={[{ color: colors.muted, fontSize: 12, textAlign: 'center', marginVertical: 6 }, font]}
              >
                {reporterTimelineEntryText(item, locale)}
              </Text>
            ),
          )}
          {!threadItems.some(isReporterConversation) ? (
            <Text style={[{ color: colors.muted, marginBottom: 8 }, font]}>{rc.ui.noReplies}</Text>
          ) : null}
        </>
      )}

      {replyState === 'sending' ? (
        <View style={[s.threadBubble, { backgroundColor: colors.surface, alignSelf: 'flex-end', opacity: 0.7 }]}>
          <Text style={[{ color: colors.muted, fontSize: 11 }, font]}>{rc.ui.sending}</Text>
          <Text style={[{ color: colors.fg }, font]}>{replyText.trim()}</Text>
        </View>
      ) : null}

      {selectedView?.canVerify ? (
        <View style={s.verifyRow}>
          <TouchableOpacity
            style={[s.verifyBtn, { backgroundColor: colors.accent, borderRadius: radius }]}
            onPress={() => void submitFeedback('confirms')}
            disabled={feedbackSending}
            accessibilityRole="button"
            accessibilityState={{ disabled: feedbackSending, busy: feedbackSending }}
          >
            <Text style={[s.submitText, { color: colors.accentFg }, font]}>{rc.ui.yes}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.verifyBtn, { backgroundColor: colors.border, borderRadius: radius }]}
            onPress={() => void submitFeedback('not_fixed')}
            disabled={feedbackSending}
            accessibilityRole="button"
            accessibilityState={{ disabled: feedbackSending, busy: feedbackSending }}
          >
            <Text style={[s.submitText, { color: colors.fg }, font]}>{rc.ui.notYet}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {feedbackError ? (
        <Text style={[{ color: colors.error, marginBottom: 8 }, font]} accessibilityRole="alert">
          {rc.ui.sendFailed}
        </Text>
      ) : null}

      <View style={s.composer}>
        <TextInput
          style={[
            s.input,
            s.composerInput,
            { backgroundColor: colors.surface, color: colors.fg, borderColor: colors.border, borderRadius: radius },
            font,
          ]}
          placeholder={t.flows.thread.replyPlaceholder}
          placeholderTextColor={colors.muted}
          value={replyText}
          onChangeText={(text) => {
            setReplyText(text.slice(0, 2000))
            if (replyState === 'failed') setReplyState('idle')
          }}
          multiline
          maxLength={2000}
          editable={replyState !== 'sending'}
          accessibilityLabel={t.flows.thread.replyPlaceholder}
        />
        <TouchableOpacity
          style={[
            s.sendBtn,
            {
              backgroundColor: replyText.trim() && replyState !== 'sending' ? colors.accent : colors.disabled,
              borderRadius: radius,
            },
          ]}
          onPress={() => void sendReply()}
          disabled={!replyText.trim() || replyState === 'sending'}
          accessibilityRole="button"
          accessibilityLabel={replyState === 'failed' ? rc.ui.retry : t.flows.thread.send}
          accessibilityState={{ disabled: !replyText.trim() || replyState === 'sending', busy: replyState === 'sending' }}
        >
          <Text
            style={[
              s.submitText,
              { color: replyText.trim() && replyState !== 'sending' ? colors.accentFg : colors.disabledFg },
              font,
            ]}
          >
            {replyState === 'failed' ? rc.ui.retry : t.flows.thread.send}
          </Text>
        </TouchableOpacity>
      </View>
      {replyState === 'failed' ? (
        <Text style={[{ color: colors.error, marginTop: 6, fontSize: 12 }, font]} accessibilityRole="alert">
          {rc.ui.sendFailed} · {rc.ui.retry}
        </Text>
      ) : null}
    </>
  )

  const renderInboxList = () => {
    if (inboxLoading && !inboxLoaded) {
      return <Text style={[{ color: colors.muted }, font]}>{t.flows.reports.loading}</Text>
    }
    if (inboxReports.length === 0) {
      return <Text style={[{ color: colors.muted }, font]}>{rc.ui.empty}</Text>
    }
    return inboxReports.map((r) => {
      const view = reporterStatus(r, locale)
      const unread = (r.unread_count ?? 0) > 0
      const title = (r.title ?? r.summary ?? r.description ?? 'Report').slice(0, 80)
      return (
        <TouchableOpacity
          key={r.id}
          style={[s.inboxRow, { borderColor: colors.border }]}
          onPress={() => void openThread(r.id)}
          accessibilityRole="button"
          accessibilityLabel={`${view.label}. ${title}${unread ? `. ${r.unread_count} new` : ''}`}
        >
          <Text style={[{ color: colors.fg, fontWeight: unread ? '700' : '600' }, font]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[{ color: unread ? colors.fg : colors.muted, fontSize: 12, marginTop: 2 }, font]} numberOfLines={1}>
            {view.label}
            {view.othersNote ? ` · ${view.othersNote}` : ''}
          </Text>
          {unread && r.last_event_preview ? (
            <Text style={[{ color: colors.fg, fontSize: 12, fontWeight: '700', marginTop: 2 }, font]} numberOfLines={1}>
              {r.last_event_preview}
            </Text>
          ) : null}
        </TouchableOpacity>
      )
    })
  }

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Backdrop */}
        <Animated.View
          style={[s.backdrop, { backgroundColor: colors.backdrop, opacity: backdropOpacity }]}
        >
          <TouchableOpacity
            style={s.flex}
            activeOpacity={1}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={t.widget.close}
          />
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={handleClose}
          style={[
            s.sheet,
            { backgroundColor: colors.bg, transform: [{ translateY }] } as ViewStyle,
          ]}
        >
          {/* Drag handle */}
          <View
            {...panResponder.panHandlers}
            style={s.handleArea}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t.widget.close}
            accessibilityActions={[{ name: 'decrement', label: t.widget.close }, { name: 'escape' }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'decrement' || e.nativeEvent.actionName === 'escape') handleClose()
            }}
          >
            <View style={[s.handle, { backgroundColor: colors.muted }]} />
          </View>

          {/* Header: host font and colours, no brand strip. */}
          <View style={[s.header, { borderBottomColor: colors.border }]}>
            <Text accessibilityRole="header" style={[s.headerTitle, { color: colors.fg }, font]}>
              {headerTitle}
            </Text>
          </View>

          {/* Tab row */}
          <View style={[s.tabRow, { borderBottomColor: colors.border }]} accessibilityRole="tablist">
            {sheetTabs.map((tab) => (
              <TouchableOpacity
                key={tab}
                onPress={() => {
                  setSheetTab(tab)
                  if (tab === 'inbox') void loadInbox({ silent: inboxLoaded })
                  else closeThread()
                }}
                style={[s.tabBtn, sheetTab === tab && { borderBottomColor: colors.accent }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: sheetTab === tab }}
              >
                <Text style={[s.tabLabel, { color: sheetTab === tab ? colors.fg : colors.muted }, font]}>
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
                  <Text style={[{ color: colors.muted, marginBottom: 12, lineHeight: 20 }, font]}>{greeting}</Text>
                  {assistantSuggestions.map((chip) => (
                    <TouchableOpacity
                      key={chip}
                      style={[s.assistantChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                      onPress={() => void sendAssistant(chip)}
                      accessibilityRole="button"
                    >
                      <Text style={[{ color: colors.fg, fontSize: 13 }, font]}>{chip}</Text>
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
                        backgroundColor: turn.role === 'user' ? colors.accent : colors.surface,
                      },
                    ]}
                  >
                    <Text style={[{ color: turn.role === 'user' ? colors.accentFg : colors.fg }, font]}>{turn.text}</Text>
                    {turn.options?.map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        onPress={() => void sendAssistant(opt)}
                        style={{ marginTop: 8 }}
                        accessibilityRole="button"
                      >
                        <Text style={[{ color: colors.accent, fontSize: 12 }, font]}>{opt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))
              )}
              {assistantSending ? (
                <Text style={[{ color: colors.muted, marginTop: 8 }, font]} accessibilityLiveRegion="polite">
                  {t.assistant.thinking}
                </Text>
              ) : null}
              {assistantError ? (
                <Text style={[{ color: colors.error, marginTop: 8 }, font]} accessibilityRole="alert">
                  {assistantError}
                </Text>
              ) : null}
              <View style={s.assistantComposer}>
                <TextInput
                  style={[s.input, { flex: 1, minHeight: 44, backgroundColor: colors.surface, color: colors.fg, borderColor: colors.border, borderRadius: radius }, font]}
                  placeholder={t.assistant.inputPlaceholder}
                  placeholderTextColor={colors.muted}
                  value={assistantInput}
                  onChangeText={setAssistantInput}
                  editable={!assistantSending}
                />
                <TouchableOpacity
                  style={[s.submitBtn, { backgroundColor: colors.accent, paddingHorizontal: 16, borderRadius: radius }]}
                  onPress={() => void sendAssistant(assistantInput)}
                  disabled={!assistantInput.trim() || assistantSending}
                  accessibilityRole="button"
                  accessibilityLabel={t.flows.thread.send}
                  accessibilityState={{ disabled: !assistantInput.trim() || assistantSending, busy: assistantSending }}
                >
                  <Text style={[s.submitText, { color: colors.accentFg }]}>↑</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : sheetTab === 'inbox' ? (
            <ScrollView style={s.body} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
              {selectedReportId ? renderThread() : renderInboxList()}
            </ScrollView>
          ) : phase === 'sent' ? (
            <ScrollView style={s.body} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
              <View style={s.sentWrap} accessibilityLiveRegion="polite">
                <Text style={[s.sentEmoji]} importantForAccessibility="no">✅</Text>
                <Text style={[s.sentText, { color: colors.fg }, font]}>{rc.ui.receipt}</Text>
              </View>
              <View style={s.verifyRow}>
                <TouchableOpacity
                  style={[s.verifyBtn, { backgroundColor: colors.accent, borderRadius: radius }]}
                  onPress={() => {
                    resetForm()
                    setSheetTab('inbox')
                    void loadInbox()
                  }}
                  accessibilityRole="button"
                >
                  <Text style={[s.submitText, { color: colors.accentFg }, font]}>{rc.ui.trackIt}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.verifyBtn, { backgroundColor: colors.border, borderRadius: radius }]}
                  onPress={handleClose}
                  accessibilityRole="button"
                >
                  <Text style={[s.submitText, { color: colors.fg }, font]}>{rc.ui.done}</Text>
                </TouchableOpacity>
              </View>

              {/* Email opt-in: offered only when the app sends email. Nothing is
                  subscribed until the reporter types an address and taps Send,
                  and the server then sends a confirmation email first. */}
              {emailState === 'sent' ? (
                <Text style={[{ color: colors.fg, marginTop: 12 }, font]} accessibilityLiveRegion="polite">
                  {rc.ui.emailCheckInbox}
                </Text>
              ) : emailState !== 'hidden' ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={[{ color: colors.fg, marginBottom: 6 }, font]}>{rc.ui.emailOptIn}</Text>
                  <View style={s.composer}>
                    <TextInput
                      style={[
                        s.input,
                        s.composerInput,
                        { backgroundColor: colors.surface, color: colors.fg, borderColor: colors.border, borderRadius: radius },
                        font,
                      ]}
                      value={emailInput}
                      onChangeText={(v) => {
                        setEmailInput(v.slice(0, 254))
                        if (emailState === 'invalid' || emailState === 'failed') setEmailState('offer')
                      }}
                      placeholder={rc.ui.emailPlaceholder}
                      placeholderTextColor={colors.muted}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      textContentType="emailAddress"
                      editable={emailState !== 'sending'}
                      accessibilityLabel={rc.ui.emailOptIn}
                    />
                    <TouchableOpacity
                      style={[s.sendBtn, { backgroundColor: emailInput.trim() ? colors.accent : colors.disabled, borderRadius: radius }]}
                      onPress={() => void submitEmail()}
                      disabled={!emailInput.trim() || emailState === 'sending'}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !emailInput.trim() || emailState === 'sending', busy: emailState === 'sending' }}
                    >
                      <Text style={[s.submitText, { color: emailInput.trim() ? colors.accentFg : colors.disabledFg }, font]}>
                        {emailState === 'sending' ? rc.ui.sending : rc.ui.emailSubmit}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {emailState === 'invalid' || emailState === 'failed' ? (
                    <Text style={[{ color: colors.error, marginTop: 6, fontSize: 12 }, font]} accessibilityRole="alert">
                      {emailState === 'invalid' ? rc.ui.emailInvalid : rc.ui.emailFailed}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
          ) : (
            <ScrollView style={s.body} keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}>
              {/* Free text first (Plan 018 §1.1). */}
              <TextInput
                style={[
                  s.input,
                  {
                    backgroundColor: colors.surface,
                    color: colors.fg,
                    borderColor: colors.border,
                    borderRadius: radius,
                  },
                  font,
                ]}
                placeholder={t.step3.descriptionPlaceholder}
                placeholderTextColor={colors.muted}
                accessibilityLabel={t.step3.descriptionPlaceholder}
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
                <Text style={[{ color: colors.error, marginTop: 6, fontSize: 12 }, font]} accessibilityRole="alert">
                  {submitError}
                </Text>
              ) : null}

              {/* Optional type chips: wrap at their label width, never squeezed. Tap again to clear. */}
              <View style={[s.catRow, { marginTop: 12 }]} accessibilityRole="radiogroup">
                {REPORTER_CATEGORIES.map((key) => {
                  const active = category === key
                  const label = reporterCategoryLabel(key, locale)
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setCategory(active ? null : key)}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, checked: active }}
                      accessibilityLabel={label}
                      style={[
                        s.catBtn,
                        {
                          backgroundColor: active ? colors.accent : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text style={s.catEmoji} importantForAccessibility="no">
                        {CATEGORY_EMOJI[key]}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          s.catLabel,
                          { color: active ? colors.accentFg : colors.fg } as TextStyle,
                          font,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {/* Screenshot thumbnail — shown if a screenshot was captured */}
              {activeScreenshot ? (
                <View style={s.screenshotRow}>
                  <Image
                    source={{ uri: activeScreenshot }}
                    style={[s.screenshotThumb, { backgroundColor: colors.fg }]}
                    accessibilityLabel={t.step3.screenshotPreviewAlt}
                  />
                  <View style={s.screenshotMeta}>
                    <Text style={[s.screenshotLabel, { color: colors.fg }, font]}>
                      {t.step3.screenshotAttached.replace(' ✓', '')}
                    </Text>
                    <Text style={[s.screenshotSub, { color: colors.muted }, font]}>
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
                    accessibilityRole="button"
                    accessibilityLabel={t.widget.close}
                  >
                    <Text style={[s.screenshotRemove, { color: colors.muted }]}>✕</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Submit */}
              {submitHint ? (
                <Text style={[{ color: colors.muted, fontSize: 12, marginBottom: 6 }, font]}>{submitHint}</Text>
              ) : null}
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!canSubmit}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={phase === 'sending' ? t.widget.submitting : t.widget.submit}
                accessibilityHint={submitHint}
                accessibilityState={{ disabled: !canSubmit, busy: phase === 'sending' }}
                style={[
                  s.submitBtn,
                  { backgroundColor: canSubmit ? colors.accent : colors.disabled, borderRadius: radius },
                ]}
              >
                <Text style={[s.submitText, { color: canSubmit ? colors.accentFg : colors.disabledFg }, font]}>
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
  header: {
    paddingHorizontal: MUSHI_SPACING.lounge,
    paddingBottom: MUSHI_SPACING.comfy,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  body: {
    paddingHorizontal: MUSHI_SPACING.lounge,
    paddingTop: MUSHI_SPACING.tight,
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
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: MUSHI_SPACING.roomy,
  },
  catBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 44,
  },
  catEmoji: {
    fontSize: 16,
  },
  catLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    padding: 14,
    fontSize: 15,
    minHeight: 100,
    marginBottom: MUSHI_SPACING.roomy,
  },
  submitBtn: {
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
    minHeight: 44,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  inboxRow: {
    paddingVertical: 12,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 12,
  },
  pill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
  },
  skeleton: {
    height: 14,
    borderRadius: 6,
    marginBottom: 10,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  retryBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  threadBubble: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    maxWidth: '88%',
  },
  verifyRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  verifyBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 44,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    marginBottom: 0,
  },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
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
