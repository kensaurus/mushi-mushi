import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { setupConsoleCapture } from './capture/console-capture'
import { setupNetworkCapture } from './capture/network-capture'
import { getDeviceInfo } from './capture/device-info'
import { AsyncStorageQueue } from './storage/async-storage-queue'

export interface MushiRNConfig {
  projectId: string
  apiKey: string
  endpoint?: string
  widget?: {
    trigger?: 'shake' | 'button' | 'both'
    shakeThreshold?: number
    buttonPosition?: 'bottom-right' | 'bottom-left'
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
  submitReport(data: { description: string; category: string }): Promise<void>
  getDeviceInfo(): ReturnType<typeof getDeviceInfo>
  getConsoleEntries(): ReturnType<ReturnType<typeof setupConsoleCapture>['getEntries']>
  getNetworkEntries(): ReturnType<ReturnType<typeof setupNetworkCapture>['getEntries']>
}

const MushiContext = createContext<MushiRNInstance | null>(null)

export function MushiProvider({ children, ...config }: MushiRNConfig & { children: ReactNode }) {
  const consoleRef = useRef<ReturnType<typeof setupConsoleCapture> | null>(null)
  const networkRef = useRef<ReturnType<typeof setupNetworkCapture> | null>(null)
  const queueRef = useRef<AsyncStorageQueue | null>(null)

  const apiEndpoint = config.endpoint ?? 'https://api.mushimushi.dev'

  useEffect(() => {
    if (config.capture?.console !== false) {
      consoleRef.current = setupConsoleCapture(config.capture?.maxConsoleEntries)
    }
    if (config.capture?.network !== false) {
      networkRef.current = setupNetworkCapture(config.capture?.maxNetworkEntries, apiEndpoint)
    }
    queueRef.current = new AsyncStorageQueue({
      maxSize: config.storage?.maxQueueSize,
      apiEndpoint,
      apiKey: config.apiKey,
    })

    return () => {
      consoleRef.current?.restore()
      networkRef.current?.restore()
    }
  }, [])

  const instance: MushiRNInstance = {
    open: () => { /* widget open — handled by bottom sheet component */ },
    close: () => { /* widget close */ },
    submitReport: async (data) => {
      const report = {
        projectId: config.projectId,
        ...data,
        environment: getDeviceInfo(),
        console_logs: consoleRef.current?.getEntries() ?? [],
        network_logs: networkRef.current?.getEntries() ?? [],
      }
      try {
        const res = await fetch(`${apiEndpoint}/v1/reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Mushi-Api-Key': config.apiKey },
          body: JSON.stringify(report),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } catch {
        await queueRef.current?.enqueue(report)
      }
    },
    getDeviceInfo,
    getConsoleEntries: () => consoleRef.current?.getEntries() ?? [],
    getNetworkEntries: () => networkRef.current?.getEntries() ?? [],
  }

  return (
    <MushiContext.Provider value={instance}>
      {children}
    </MushiContext.Provider>
  )
}

export function useMushiContext() {
  return useContext(MushiContext)
}
