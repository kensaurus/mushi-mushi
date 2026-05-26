export { MushiProvider, type MushiProviderProps } from './provider';
export { useMushi, useMushiSdk, useMushiReady, useMushiReport, type UseMushiResult } from './hooks';
export { MushiErrorBoundary, type MushiErrorBoundaryProps } from './error-boundary';
export { MushiTrigger, MushiAttach } from './trigger';
export { MushiRewardsBadge, useReputation, useTier } from './rewards';

// Re-export main class and types for convenience
export { Mushi } from '@mushi-mushi/web';
export type {
  MushiConfig,
  MushiReport,
  MushiReportCategory,
  MushiSDKInstance,
  MushiWidgetConfig,
  MushiEventType,
  MushiEventHandler,
} from '@mushi-mushi/core';
