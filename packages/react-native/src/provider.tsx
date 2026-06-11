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

export interface MushiRNInstance {
  open(): void
  close(): void
  attachTo(): { onPress: () => void }
  submitReport(data: { description: string; category: string }): Promise<void>
  getDeviceInfo(): ReturnType<typeof getDeviceInfo>
  getConsoleEntries(): ReturnType<ReturnType<typeof setupConsoleCapture>['getEntries']>
  getNetworkEntries(): ReturnType<ReturnType<typeof setupNetworkCapture>['getEntries']>

  // v0.10.0: missing methods that glot.it had to workaround in apps/mobile/src/native/mushi.ts
  /** Set the current authenticated user. Equivalent to Mushi.identify() on web. */
  identify(userId: string, traits?: { email?: string; name?: string; provider?: string; [k: string]: unknown }): void
  /** Attach arbitrary key/value metadata to subsequent reports. */
  setMetadata(key: string, value: unknown): void
  /** Set the current screen context attached to subsequent reports. */
  setScreen(screen: { name: string; route?: string; feature?: string }): void

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

  const open = useCallback(() => setSheetVisible(true), [])
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
    async (data: { description: string; category: string }) => {
      const deviceInfo = getDeviceInfo()
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
          url: '',
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
        reporterToken: `rn-${config.projectId}-anon`,
        createdAt: new Date().toISOString(),
      }
      const client = apiClientRef.current
      if (!client) return

      const result = await client.submitReport(report)
      if (!result.ok) {
        await queueRef.current?.enqueue(report)
      }
    },
    [config.projectId, config.apiKey, apiEndpoint],
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
      <MushiBottomSheet visible={sheetVisible} onClose={close} />
    </MushiContext.Provider>
  )
}

export function useMushiContext() {
  return useContext(MushiContext)
}
