export { createConsoleCapture, type ConsoleCapture } from './console';
export { createNetworkCapture, type NetworkCapture } from './network';
export { createScreenshotCapture, type ScreenshotCapture } from './screenshot';
export { createPerformanceCapture, type PerformanceCapture } from './performance';
export { createElementSelector, type ElementSelector } from './element-selector';
export { createTimelineCapture, type TimelineCapture } from './timeline';
export {
  createDiscoveryCapture,
  type DiscoveryCapture,
  type DiscoveryEvent,
  type DiscoveryCaptureOptions,
  normalizeRoute,
  normalizeSegment,
} from './discovery';
