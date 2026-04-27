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
import { createApiClient, DEFAULT_API_ENDPOINT, type MushiReport, type MushiApiClient } from '@mushi-mushi/core'
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
}

export interface MushiRNInstance {
  open(): void
  close(): void
  attachTo(): { onPress: () => void }
  submitReport(data: { description: string; category: string }): Promise<void>
  getDeviceInfo(): ReturnType<typeof getDeviceInfo>
  getConsoleEntries(): ReturnType<ReturnType<typeof setupConsoleCapture>['getEntries']>
  getNetworkEntries(): ReturnType<ReturnType<typeof setupNetworkCapture>['getEntries']>
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

  // Defer to @mushi-mushi/core's DEFAULT_API_ENDPOINT when not provided
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

    ;(new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<ExpoSensorsModule>)('expo-sensors')
      .then((mod) => {
        if (disposed) return
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
      })
      .catch(() => {
        // expo-sensors is optional so bare React Native apps can stay dependency-light.
      })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [config.widget?.trigger, config.widget?.shakeThreshold, open])

  const submitReport = useCallback(
    async (data: { description: string; category: string }) => {
      const deviceInfo = getDeviceInfo()
      const report: MushiReport = {
        id: `rn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  const instance: MushiRNInstance = useMemo(
    () => ({
      open,
      close,
      attachTo,
      submitReport,
      getDeviceInfo,
      getConsoleEntries: () => consoleRef.current?.getEntries() ?? [],
      getNetworkEntries: () => networkRef.current?.getEntries() ?? [],
    }),
    [open, close, attachTo, submitReport],
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
