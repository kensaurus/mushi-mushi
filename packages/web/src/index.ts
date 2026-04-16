export { Mushi } from './mushi';
export { MushiWidget } from './widget';

export {
  createConsoleCapture,
  createNetworkCapture,
  createScreenshotCapture,
  createPerformanceCapture,
  createElementSelector,
} from './capture';

export type {
  ConsoleCapture,
  NetworkCapture,
  ScreenshotCapture,
  PerformanceCapture,
  ElementSelector,
} from './capture';

export { getLocale, getAvailableLocales } from './i18n';
export type { MushiLocale } from './i18n';

export { createProactiveManager } from './proactive-manager';
export type { ProactiveConfig, ProactiveManager } from './proactive-manager';

export { setupProactiveTriggers } from './proactive-triggers';
export type { ProactiveTriggerCallbacks, ProactiveTriggerCleanup } from './proactive-triggers';

// Re-export core types for convenience
export type {
  MushiConfig,
  MushiReport,
  MushiReportCategory,
  MushiSDKInstance,
  MushiEnvironment,
  MushiConsoleEntry,
  MushiNetworkEntry,
  MushiPerformanceMetrics,
  MushiWidgetConfig,
  MushiEventType,
  MushiEventHandler,
} from '@mushi-mushi/core';
