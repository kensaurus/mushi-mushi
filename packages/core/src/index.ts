// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/** @public */
export type {
  MushiConfig,
  MushiPreset,
  MushiSentryConfig,
  MushiWidgetConfig,
  MushiWidgetAnchor,
  MushiCaptureConfig,
  MushiDiscoverInventoryConfig,
  MushiDiscoveryEventPayload,
  MushiSessionEventPayload,
  MushiPrivacyConfig,
  MushiProactiveConfig,
  MushiApiCascadeConfig,
  MushiUrlMatcher,
  MushiCooldownConfig,
  MushiPreFilterConfig,
  MushiIntegrationsConfig,
  MushiOfflineConfig,
  MushiRewardsConfig,
  MushiReputationResult,
  MushiTierResult,
  MushiActivityEvent,
  MushiReportCategory,
  MushiReportStatus,
  MushiReport,
  MushiCustomCategory,
  MushiReportBuilder,
  MushiEnvironment,
  MushiConsoleEntry,
  MushiNetworkEntry,
  MushiPerformanceMetrics,
  MushiSelectedElement,
  MushiTimelineEntry,
  MushiTimelineKind,
  MushiEventType,
  MushiEventHandler,
  MushiDiagnosticsResult,
  MushiSDKInstance,
  MushiCaptureEventInput,
  MushiCaptureExceptionOptions,
  MushiApiClient,
  MushiApiResponse,
  MushiRuntimeSdkConfig,
  MushiSdkVersionInfo,
  MushiReporterReport,
  MushiReporterComment,
  MushiHallOfFameEntry,
  MushiCrossAppReport,
  MushiLeaderboardEntry,
  MushiTesterReputation,
  MushiOnDeviceClassifier,
  MushiOnDeviceClassifierInput,
  MushiOnDeviceClassifierResult,
  MushiBreadcrumb,
  MushiSentryContext,
  MushiBetaModeConfig,
  MushiBetaChangelogEntry,
  MushiBannerConfig,
  MushiBannerLink,
  MushiTracePropagationConfig,
  MushiPageContext,
  MushiAssistantConfig,
  MushiAssistantStep,
  MushiAssistantReply,
} from './types';

/** @public */
export {
  createApiClient,
  buildSdkIngestHeaders,
  resolveRequestBaseUrl,
  getBackoffDelay,
  parseRetryAfter,
  flushLastOutboundOnUnload,
  DEFAULT_API_ENDPOINT,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  MUSHI_INTERNAL_HEADER,
  MUSHI_INTERNAL_INIT_MARKER,
  MUSHI_PROJECT_HEADER,
  MUSHI_USER_TOKEN_HEADER,
  MUSHI_SDK_PACKAGE_HEADER,
  MUSHI_SDK_VERSION_HEADER,
  type ApiClientOptions,
  type MushiInternalRequestKind,
} from './api-client';
/** @public */
export {
  shouldDropCapturedError,
  matchesErrorFilter,
  type MushiErrorFilter,
} from './error-filters';
/** @public */
export {
  sendOnUnload,
  markPageUnloading,
  isPageUnloading,
  isMushiBeaconEnvelope,
  buildBeaconEnvelope,
  extractTunnelPath,
  isSameOriginOrRelative,
  MUSHI_BEACON_MAX_BYTES,
  type MushiBeaconEnvelope,
} from './unload-transport';
/** @public */
export { resolveRegionEndpoint, REGION_ENDPOINTS, type MushiRegion } from './region';
/** @public */
export {
  resolveEnvConfig,
  diagnoseEnvConfig,
  type ResolvedEnvConfig,
  type EnvConfigDiagnostics,
  type EnvNearMiss,
} from './env-config';
/** @public */
export { expandPreset, validateConfig } from './presets';
/** @public */
export { createPreFilter, type PreFilterResult } from './pre-filter';
/** @public */
export { createOfflineQueue, type OfflineQueue } from './queue';
/** @public */
export { captureEnvironment } from './environment';
/** @public */
export { getReporterToken } from './reporter-token';
/** @public */
export { sha256Hex, hmacSha256Hex } from './digest';
/** @public */
export { newUuid } from './uuid';
/** @public */
export { getDeviceFingerprintHash } from './fingerprint';
/** @public */
export { getSessionId } from './session';
/** @public */
export {
  initSessionTracker,
  trackPageView,
  updateSessionIdentity,
  destroySessionTracker,
  type SessionTrackerOptions,
} from './session-tracker';
/** @public */
export { createRateLimiter, type RateLimiter, type RateLimiterConfig } from './rate-limiter';
/** @public */
export { createPiiScrubber, scrubPii, scrubUrl, type PiiScrubberConfig } from './pii-scrubber';
/** @public */
export {
  createBreadcrumbBuffer,
  type BreadcrumbBuffer,
  type BreadcrumbBufferOptions,
} from './breadcrumbs';
/** @public */
export {
  checkReportPayloadSize,
  estimateJsonBytes,
  formatBytes,
  MAX_REPORT_PAYLOAD_BYTES,
  MAX_SCREENSHOT_DATA_URL_BYTES,
  type PayloadGuardResult,
} from './payload-guard';
/** @public */
export {
  normaliseThrown,
  type NormalisedException,
} from './exception-normaliser';
/** @public */
export {
  createLogger,
  noopLogger,
  type Logger,
  type LogLevel,
  type LogFormat,
  type LoggerOptions,
  type LogEntry,
} from './logger';
/** @public */
export {
  MUSHI_COLORS_LIGHT,
  MUSHI_COLORS_DARK,
  MUSHI_SPACING,
  MUSHI_RADIUS,
  MUSHI_TYPE,
  MUSHI_Z,
  MUSHI_MOTION,
  MUSHI_DURATION,
  MUSHI_BORDER,
  MUSHI_OPACITY,
  MUSHI_LETTER_SPACING,
  MUSHI_GEOMETRY,
  MUSHI_COPY,
  MUSHI_BANNER_NEON,
  MUSHI_TIER_COLORS,
  MUSHI_ON_ACCENT,
  MUSHI_INVERSE,
  MUSHI_CONTROL_DISABLED,
  MUSHI_SHADOW_INK,
  MUSHI_ACCENT_SHADOW,
  MUSHI_BANNER_BRAND_BORDER,
  MUSHI_REPORTER_STATUS,
  mushiPalette,
  mushiTokens,
  resolveWidgetAccent,
  safeWidgetHex,
  type MushiThemeMode,
  type MushiColorPalette,
  type MushiTokenSnapshot,
} from './design-tokens';
/** @public */
export {
  buildIdentityClaims,
  parseIdentityToken,
  MUSHI_IDENTITY_TOKEN_PREFIX,
  type MushiIdentityClaims,
} from './identity';
/** @public */
export {
  faviconUrlCandidates,
  originToDomain,
  githubRepoDomainHint,
  resolveProjectDomain,
  resolveProjectFaviconDomains,
  projectFaviconUrlCandidates,
  isLikelyGenericFavicon,
  isUntrustedFaviconUrl,
  projectInitials,
  projectInitialsThemeIndex,
  readPageFaviconHref,
  type ProjectFaviconSource,
} from './favicon';
