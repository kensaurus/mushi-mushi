export { MushiProvider, type MushiProviderProps } from './provider';
export { useMushi, useMushiReady, useMushiReport } from './hooks';
export { MushiErrorBoundary, type MushiErrorBoundaryProps } from './error-boundary';

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
