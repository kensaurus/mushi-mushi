// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
export { MushiProvider } from './provider'
export type { MushiRNConfig, MushiRNInstance } from './provider'

export { useMushi } from './hooks/useMushi'
export { useMushiReport } from './hooks/useMushiReport'
export { useMushiWidget } from './hooks/useMushiWidget'

export { MushiBottomSheet } from './components/MushiBottomSheet'
export type { MushiBottomSheetProps } from './components/MushiBottomSheet'

export { MushiFloatingButton } from './components/MushiFloatingButton'
export type { MushiFloatingButtonProps } from './components/MushiFloatingButton'

export { MushiTrigger } from './components/MushiTrigger'
export type { MushiTriggerProps } from './components/MushiTrigger'

export { getDeviceInfo } from './capture/device-info'
export type { DeviceInfo } from './capture/device-info'

export { setupConsoleCapture } from './capture/console-capture'
export type { ConsoleEntry } from './capture/console-capture'

export { setupNetworkCapture } from './capture/network-capture'
export type { NetworkEntry } from './capture/network-capture'

export { useNavigationCapture } from './capture/navigation-capture'
export type { NavigationEntry } from './capture/navigation-capture'

export { AsyncStorageQueue } from './storage/async-storage-queue'

// Re-export shared types that host apps commonly need
export type { MushiReporterReport, MushiReporterComment, MushiHallOfFameEntry } from '@mushi-mushi/core'
