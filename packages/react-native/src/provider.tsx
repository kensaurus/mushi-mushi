/**
 * FILE: provider.tsx
 * PURPOSE: React context provider that initialises capture pipeline and renders widget UI
 *
 * OVERVIEW:
 * - Creates MushiContext with open/close/submitReport/capture accessors
 * - Sets up console + network capture on mount, tears down on unmount
 * - Renders MushiBottomSheet and (optionally) MushiFloatingButton as siblings of children
 * - widget.trigger controls auto-UI: 'button'/'auto' shows FAB, 'manual' shows nothing
 *
 * DEPENDENCIES:
 * - ./capture/* for console, network, device info
 * - ./storage/async-storage-queue for offline queue
 * - ./components/MushiBottomSheet, ./components/MushiFloatingButton
 *
 * USAGE:
 * - Wrap app root: <MushiProvider projectId="…" apiKey="…">{children}</MushiProvider>
 * - Programmatic: const mushi = useMushi(); mushi.open()
 *
 * TECHNICAL DETAILS:
 * - open() / close() toggle `sheetVisible` state which drives the bottom sheet
 * - MushiRNConfig.widget.trigger: 'button' (default) | 'shake' | 'both' | 'manual'
 * - MushiRNConfig.widget.buttonPosition: 'bottom-right' (default) | 'bottom-left'
 *
 * NOTES:
 * - Shake installs lazily through expo-sensors when available.
 * - submitReport flushes captured logs at call-time, then enqueues on failure
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import {
  createApiClient,
  DEFAULT_API_ENDPOINT,
  newUuid,
  type MushiReport,
  type MushiApiClient,
  type MushiRewardsConfig,
  type MushiReputationResult,
  type MushiTierResult,
  type MushiReporterReport,
  type MushiReporterComment,
  type MushiHallOfFameEntry,
} from '@mushi-mushi/core'
import { setupConsoleCapture } from './capture/console-capture'
import { setupNetworkCapture } from './capture/network-capture'
import { getDeviceInfo } from './capture/device-info'
import { AsyncStorageQueue } from './storage/async-storage-queue'
import { MushiBottomSheet } from './components/MushiBottomSheet'
import { MushiFloatingButton } from './components/MushiFloatingButton'

export interface MushiRNConfig {
  projectId: string
  apiKey: string
  endpoint?: string
  widget?: {
    trigger?: 'shake' | 'button' | 'both' | 'manual' | 'auto' | 'edge-tab' | 'hidden' | 'attach'
    shakeThreshold?: number
    buttonPosition?: 'bottom-right' | 'bottom-left'
    inset?: { bottom?: number; left?: number; right?: number }
  }
  capture?: {
    console?: boolean
    network?: boolean
    navigation?: boolean
    maxConsoleEntries?: number
    maxNetworkEntries?: number
  }
  storage?: {
    maxQueueSize?: number
    retryIntervalMs?: number
  }
  rewards?: MushiRewardsConfig
}

// MushiHallOfFameEntry is now defined in and imported from @mushi-mushi/core
export type { MushiHallOfFameEntry }

export interface MushiRNInstance {
  open(): void
  close(): void
  attachTo(): { onPress: () => void }
  /** screenshotDataUrl is optional — pass `undefined` if not captured or removed by the user. */
  submitReport(data: { description: string; category: string; screenshotDataUrl?: string }): Promise<void>
  getDeviceInfo(): ReturnType<typeof getDeviceInfo>
  getConsoleEntries(): ReturnType<ReturnType<typeof setupConsoleCapture>['getEntries']>
  getNetworkEntries(): ReturnType<ReturnType<typeof setupNetworkCapture>['getEntries']>

  // v0.10.0: identity methods (previously caused workarounds in glot.it + yen-yen)
  /** Set the current authenticated user. Equivalent to Mushi.identify() on web. */
  identify(userId: string, traits?: { email?: string; name?: string; provider?: string; [k: string]: unknown }): void
  /** Attach arbitrary key/value metadata to subsequent reports. */
  setMetadata(key: string, value: unknown): void
  /** Set the current screen context attached to subsequent reports. */
  setScreen(screen: { name: string; route?: string; feature?: string }): void

  // Reporter API — returns reports/comments for this device's persistent token
  /** List this device's reports ordered by most recent. Returns [] on failure. */
  listMyReports(): Promise<MushiReporterReport[]>
  /** List admin + reporter comments on a specific report. */
  listMyComments(reportId: string): Promise<MushiReporterComment[]>
  /** Post a reporter reply on a report thread. Returns the new comment or null on failure. */
  replyToReport(reportId: string, body: string): Promise<MushiReporterComment | null>

  // Leaderboard — SDK-public, anonymized
  /** Fetch the project's top contributors by points (max 50). */
  getHallOfFame(limit?: number): Promise<MushiHallOfFameEntry[]>

  // Rewards program (P1)
  /** Manually record a host-defined activity event. */
  recordActivity(action: string, metadata?: Record<string, unknown>): void
  /** Returns the current user's tier. */
  getTier(): Promise<MushiTierResult | null>
  /** Returns the current user's reputation + point totals. */
  getReputation(): Promise<MushiReputationResult | null>
}

const MushiContext = createContext<MushiRNInstance | null>(null)

type ExpoSensorsModule = {
  Accelerometer: {
    setUpdateInterval(ms: number): void
    addListener(listener: (event: { x: number; y: number; z: number }) => void): { remove(): void }
  }
}

export function MushiProvider({ children, ...config }: MushiRNConfig & { children: ReactNode }) {
  const consoleRef = useRef<ReturnType<typeof setupConsoleCapture> | null>(null)
  const networkRef = useRef<ReturnType<typeof setupNetworkCapture> | null>(null)
  const queueRef = useRef<AsyncStorageQueue | null>(null)
  const apiClientRef = useRef<MushiApiClient | null>(null)

  const [sheetVisible, setSheetVisible] = useState(false)
  // Screenshot captured just before the sheet opens (captured while app content is still visible)
  const [sheetScreenshot, setSheetScreenshot] = useState<string | null>(null)

  // Per-install reporter token — persisted in AsyncStorage so "My reports" shows
  // reports from this device across sessions. Falls back to the legacy shared constant
  // when AsyncStorage is unavailable (e.g. test environments).
  const reporterTokenRef = useRef<string>(`rn-${config.projectId}-anon`)
  let resolveReporterTokenReady: () => void = () => {}
  const reporterTokenReadyRef = useRef(
    new Promise<void>((resolve) => {
      resolveReporterTokenReady = resolve
    }),
  )

  // Validate: an explicitly empty string is a misconfiguration.
  if (config.endpoint !== undefined && config.endpoint.trim() === '') {
    throw new Error(
      '[MushiProvider] endpoint is set to an empty string. ' +
        'Set endpoint to your Supabase edge function URL, ' +
        'e.g. https://xyz.supabase.co/functions/v1/api, or omit it to use the cloud default.',
    )
  }
  // Defer to @mushi-mushi/core's DEFAULT_API_ENDPOINT when not provided.
  const apiEndpoint = config.endpoint ?? DEFAULT_API_ENDPOINT

  useEffect(() => {
    if (config.capture?.console !== false) {
      consoleRef.current = setupConsoleCapture(config.capture?.maxConsoleEntries)
    }
    if (config.capture?.network !== false) {
      networkRef.current = setupNetworkCapture(config.capture?.maxNetworkEntries, apiEndpoint)
    }
    apiClientRef.current = createApiClient({
      projectId: config.projectId,
      apiKey: config.apiKey,
      apiEndpoint,
    })
    queueRef.current = new AsyncStorageQueue({
      maxSize: config.storage?.maxQueueSize,
      apiEndpoint,
      apiKey: config.apiKey,
    })

    queueRef.current.flush().catch(() => {})

    // Load or create a stable per-install reporter token from AsyncStorage so
    // listMyReports() scopes results to this device's reports correctly.
    ;(async () => {
      const TOKEN_KEY = '@mushi:reporter_token'
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
        const existing = await AsyncStorage.getItem(TOKEN_KEY)
        if (existing && existing.startsWith('mushi_')) {
          reporterTokenRef.current = existing
        } else {
          const fresh = `mushi_${newUuid()}`
          reporterTokenRef.current = fresh
          await AsyncStorage.setItem(TOKEN_KEY, fresh)
        }
        resolveReporterTokenReady()
      } catch {
        // AsyncStorage unavailable — per-session token is fine for fallback
        if (reporterTokenRef.current === `rn-${config.projectId}-anon`) {
          reporterTokenRef.current = `mushi_${newUuid()}`
        }
        resolveReporterTokenReady()
      }
    })().catch(() => {})

    return () => {
      consoleRef.current?.restore()
      networkRef.current?.restore()
    }
  }, [])

  // Added: network-aware delivery (Phase 2.4)
  // Uses require() instead of new Function('s','return import(s)') — Hermes
  // (RN 0.76+, AOT-only) rejects dynamic import() inside Function constructor
  // bodies with "SyntaxError: Invalid expression encountered" at evaluation
  // time, even if the constructed function is never called. require() is the
  // correct sync-optional-dep pattern for Metro + Hermes environments.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NetInfo = (require('@react-native-community/netinfo') as {
        default: {
          addEventListener: (
            cb: (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void,
          ) => () => void
        }
      }).default
      unsubscribe = NetInfo.addEventListener((state) => {
        if (state.isConnected && state.isInternetReachable) {
          queueRef.current?.flush().catch(() => {})
        }
      })
    } catch {
      // @react-native-community/netinfo is an optional peer dep — web / test envs won't have it
    }
    return () => unsubscribe?.()
  }, [])

  const open = useCallback(() => {
    // Capture a screenshot of the current app state BEFORE the sheet overlays it.
    // react-native-view-shot is an optional peer dep — fall through immediately when
    // it isn't installed. The sheet opens after capture resolves (typ. <150 ms).
    let vshot: { captureScreen(opts: Record<string, unknown>): Promise<string> } | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      vshot = require('react-native-view-shot') as { captureScreen(opts: Record<string, unknown>): Promise<string> }
    } catch { /* optional dep not installed */ }

    if (!vshot) {
      setSheetScreenshot(null)
      setSheetVisible(true)
      return
    }

    vshot
      .captureScreen({ format: 'jpg', quality: 0.7, result: 'data-uri' })
      .then((url: string) => { setSheetScreenshot(url) })
      .catch(() => { setSheetScreenshot(null) })
      .finally(() => { setSheetVisible(true) })
  }, [])
  const close = useCallback(() => setSheetVisible(false), [])
  const attachTo = useCallback(() => ({ onPress: open }), [open])

  useEffect(() => {
    const trigger = config.widget?.trigger ?? 'button'
    if (trigger !== 'shake' && trigger !== 'both') return

    let disposed = false
    let cleanup: (() => void) | undefined
    let lastShake = 0
    const threshold = config.widget?.shakeThreshold ?? 2.7

    // require() instead of new Function dynamic import — same Hermes rationale
    // as the NetInfo effect above. expo-sensors is an optional peer dep;
    // bare React Native apps that don't install it stay dependency-light.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('expo-sensors') as ExpoSensorsModule
      if (!disposed) {
        mod.Accelerometer.setUpdateInterval(120)
        const sub = mod.Accelerometer.addListener((evt) => {
          const g = Math.sqrt(evt.x * evt.x + evt.y * evt.y + evt.z * evt.z)
          if (g < threshold) return
          const now = Date.now()
          if (now - lastShake < 1000) return
          lastShake = now
          open()
        })
        cleanup = () => sub.remove()
      }
    } catch {
      // expo-sensors is optional — bare RN apps without it fall back to button-only
    }

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [config.widget?.trigger, config.widget?.shakeThreshold, open])

  const submitReport = useCallback(
    async (data: { description: string; category: string; screenshotDataUrl?: string }) => {
      const deviceInfo = getDeviceInfo()

      // Build rich contextual metadata from identity + screen state so the
      // admin console shows who reported and from which screen without parsing
      // the description text. Merges explicit setMetadata() calls last so the
      // host app can override anything.
      const contextMeta: Record<string, unknown> = {}
      if (userRef.current?.id) contextMeta.userId = userRef.current.id
      if (userRef.current?.email) contextMeta.userEmail = userRef.current.email
      if (userRef.current?.name) contextMeta.userName = userRef.current.name
      if (screenRef.current?.name) contextMeta.screenName = screenRef.current.name
      if (screenRef.current?.route) contextMeta.screenRoute = screenRef.current.route
      if (screenRef.current?.feature) contextMeta.screenFeature = screenRef.current.feature
      const merged = Object.keys(metadataRef.current).length > 0
        ? { ...contextMeta, ...metadataRef.current }
        : Object.keys(contextMeta).length > 0 ? contextMeta : undefined

      const report: MushiReport = {
        id: newUuid(),
        projectId: config.projectId,
        category: data.category as MushiReport['category'],
        description: data.description,
        environment: {
          userAgent: deviceInfo.systemName ?? 'ReactNative',
          platform: deviceInfo.platform ?? 'mobile',
          language: deviceInfo.locale ?? 'en',
          viewport: { width: deviceInfo.screenWidth ?? 0, height: deviceInfo.screenHeight ?? 0 },
          url: screenRef.current?.route ?? '',
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: deviceInfo.timezone ?? 'UTC',
        },
        consoleLogs: consoleRef.current?.getEntries() ?? [],
        networkLogs:
          networkRef.current?.getEntries().map((entry) => ({
            ...entry,
            status: entry.status ?? 0,
          })) ?? [],
        screenshotDataUrl: data.screenshotDataUrl,
        metadata: merged,
        reporterToken: reporterTokenRef.current,
        createdAt: new Date().toISOString(),
      }
      const client = apiClientRef.current
      if (!client) return

      const result = await client.submitReport(report)
      if (!result.ok) {
        await queueRef.current?.enqueue(report)
      }
    },
    [config.projectId, apiEndpoint],
  )

  // v0.10.0: user identity state (was missing, causing workarounds in glot.it)
  const userRef = useRef<{ id: string; email?: string; name?: string; provider?: string } | null>(null)
  const metadataRef = useRef<Record<string, unknown>>({})
  const screenRef = useRef<{ name: string; route?: string; feature?: string } | null>(null)

  // Rewards: activity queue
  const activityQueueRef = useRef<Array<{ action: string; metadata?: Record<string, unknown> }>>([])
  const rewardsFlushRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const rewards = config.rewards
    if (!rewards?.enabled || !rewards.trackActivity) return
    const flushMs = Math.max(30_000, rewards.flushIntervalMs ?? 300_000)
    rewardsFlushRef.current = setInterval(async () => {
      const userId = userRef.current?.id
      const client = apiClientRef.current
      if (!userId || !client || activityQueueRef.current.length === 0) return
      const batch = activityQueueRef.current.splice(0, 100)
      await client.submitActivity(userId, batch, {
        userTraits: userRef.current ?? undefined,
        optedIn: true,
      }).catch(() => {
        activityQueueRef.current.unshift(...batch.slice(0, 50))
      })
    }, flushMs)
    return () => {
      if (rewardsFlushRef.current) clearInterval(rewardsFlushRef.current)
    }
  }, [config.rewards?.enabled, config.rewards?.trackActivity, config.rewards?.flushIntervalMs])

  const instance: MushiRNInstance = useMemo(
    () => ({
      open,
      close,
      attachTo,
      submitReport,
      getDeviceInfo,
      getConsoleEntries: () => consoleRef.current?.getEntries() ?? [],
      getNetworkEntries: () => networkRef.current?.getEntries() ?? [],

      // v0.10.0: new identity methods (these were causing workarounds in apps/mobile/src/native/mushi.ts)
      identify(userId, traits) {
        userRef.current = {
          id: userId,
          email: traits?.email,
          name: traits?.name,
          provider: traits?.provider,
        }
      },
      setMetadata(key, value) {
        metadataRef.current[key] = value
      },
      setScreen(screen) {
        screenRef.current = screen
      },

      // Reporter API — scoped to the device's persistent reporter token
      async listMyReports() {
        const client = apiClientRef.current
        if (!client) return []
        await reporterTokenReadyRef.current
        const res = await client.listReporterReports(reporterTokenRef.current)
        return res.ok
          ? (res.data as { reports?: MushiReporterReport[] } | undefined)?.reports ?? []
          : []
      },
      async listMyComments(reportId: string) {
        const client = apiClientRef.current
        if (!client) return []
        const res = await client.listReporterComments(reportId, reporterTokenRef.current)
        return res.ok
          ? (res.data as { comments: MushiReporterComment[] }).comments ?? []
          : []
      },
      async replyToReport(reportId: string, body: string) {
        const client = apiClientRef.current
        if (!client) return null
        const res = await client.replyToReporterReport(reportId, reporterTokenRef.current, body)
        return res.ok ? (res.data as { comment: MushiReporterComment }).comment : null
      },
      async submitFeedbackSignal(reportId: string, signal: string, note?: string) {
        const client = apiClientRef.current
        if (!client) return null
        const res = await client.replyToReporterReport(reportId, reporterTokenRef.current, note ?? '', signal)
        return res.ok ? (res.data as { feedback?: Record<string, unknown> }).feedback ?? null : null
      },
      async reopenReport(reportId: string, note?: string) {
        const client = apiClientRef.current
        if (!client) return null
        const res = await client.reopenReporterReport(reportId, reporterTokenRef.current, note)
        return res.ok ? (res.data as { outcome: Record<string, unknown> }).outcome : null
      },

      // Leaderboard — SDK-public anonymized hall-of-fame
      async getHallOfFame(limit = 10) {
        const client = apiClientRef.current
        if (!client) return []
        const res = await client.getHallOfFame(limit)
        return res.ok
          ? (res.data as { data: MushiHallOfFameEntry[] }).data ?? []
          : []
      },

      // Rewards (P1)
      recordActivity(action, metadata) {
        if (!config.rewards?.enabled) return
        activityQueueRef.current.push({ action, metadata })
      },
      async getTier() {
        const userId = userRef.current?.id
        const client = apiClientRef.current
        if (!userId || !client) return null
        const res = await client.getMyTier(userId)
        return res.ok ? (res.data as MushiTierResult) : null
      },
      async getReputation() {
        const userId = userRef.current?.id
        const client = apiClientRef.current
        if (!userId || !client) return null
        const res = await client.getMyPoints(userId)
        if (!res.ok) return null
        return {
          totalPoints: (res.data as { total_points: number }).total_points ?? 0,
          points30d: (res.data as { points_30d: number }).points_30d ?? 0,
          reputation: 1.0,
          confirmedBugs: 0,
          totalReports: 0,
        }
      },
    }),
    [open, close, attachTo, submitReport, config.rewards?.enabled],
  )

  const trigger = config.widget?.trigger ?? 'button'
  const showFab = trigger === 'button' || trigger === 'both' || trigger === 'auto' || trigger === 'edge-tab'

  return (
    <MushiContext.Provider value={instance}>
      {children}
      {showFab && (
        <MushiFloatingButton
          onPress={open}
          position={config.widget?.buttonPosition}
          inset={config.widget?.inset}
        />
      )}
      <MushiBottomSheet
        visible={sheetVisible}
        onClose={close}
        screenshotDataUrl={sheetScreenshot ?? undefined}
        onClearScreenshot={() => setSheetScreenshot(null)}
      />
    </MushiContext.Provider>
  )
}

export function useMushiContext() {
  return useContext(MushiContext)
}
