// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MushiConfig {
  projectId: string;
  apiKey: string;
  apiEndpoint?: string;
  /**
   * Fetch non-secret widget/capture settings from the Mushi project at
   * startup. Defaults to true so console changes apply without rebuilding
   * host apps. Set false for fully static/offline deployments.
   */
  runtimeConfig?: boolean;

  sentry?: MushiSentryConfig;
  widget?: MushiWidgetConfig;
  capture?: MushiCaptureConfig;
  proactive?: MushiProactiveConfig;
  preFilter?: MushiPreFilterConfig;
  integrations?: MushiIntegrationsConfig;
  offline?: MushiOfflineConfig;
  rewards?: MushiRewardsConfig;

  debug?: boolean;
  enabled?: boolean;
}

export interface MushiSentryConfig {
  dsn?: string;
  consumeUserFeedback?: boolean;
  enrichWithSeer?: boolean;
  useReplay?: boolean;
}

export interface MushiWidgetConfig {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  theme?: 'auto' | 'light' | 'dark';
  triggerText?: string;
  expandedTitle?: string;
  mode?: 'simple' | 'conversational';
  locale?: string;
  zIndex?: number;
}

export interface MushiCaptureConfig {
  console?: boolean;
  network?: boolean;
  performance?: boolean;
  screenshot?: 'on-report' | 'auto' | 'off';
  elementSelector?: boolean;
  replay?: 'sentry' | 'rrweb' | 'lite' | 'off';
}

export interface MushiProactiveConfig {
  rageClick?: boolean;
  errorBoundary?: boolean;
  longTask?: boolean;
  apiCascade?: boolean;
  cooldown?: MushiCooldownConfig;
}

export interface MushiCooldownConfig {
  maxProactivePerSession?: number;
  dismissCooldownHours?: number;
  suppressAfterDismissals?: number;
}

export interface MushiPreFilterConfig {
  enabled?: boolean;
  blockObviousSpam?: boolean;
  minDescriptionLength?: number;
  maxDescriptionLength?: number;
  /**
   * V5.3 §2.12: optional on-device classifier (typically from
   * `@mushi-mushi/wasm-classifier`). Consulted before the pattern pre-filter.
   * Must conform to the `MushiOnDeviceClassifier` shape.
   */
  wasmClassifier?: MushiOnDeviceClassifier;
}

export interface MushiOnDeviceClassifierInput {
  description: string;
  category?: string;
  url?: string;
  hasScreenshot?: boolean;
  hasSelectedElement?: boolean;
  hasNetworkErrors?: boolean;
  hasConsoleErrors?: boolean;
  proactiveTrigger?: string;
}

export interface MushiOnDeviceClassifierResult {
  verdict: 'pass' | 'block' | 'unsure';
  confidence: number;
  reason: string;
  modelId: string;
  durationMs: number;
}

export interface MushiOnDeviceClassifier {
  readonly modelId: string;
  classify(input: MushiOnDeviceClassifierInput): Promise<MushiOnDeviceClassifierResult>;
  destroy(): void;
}

export interface MushiIntegrationsConfig {
  opentelemetry?: { traceContext?: boolean };
  vercel?: { analyticsId?: string };
  custom?: (report: MushiReportBuilder) => void;
}

export interface MushiOfflineConfig {
  enabled?: boolean;
  maxQueueSize?: number;
  syncOnReconnect?: boolean;
  /**
   * Encrypt queued reports at rest (IndexedDB + localStorage) with AES-GCM.
   *
   * Wave S1 / D-16: on a shared device (kiosks, iPads, support-agent
   * laptops) any queued report sits in plaintext until the next online flush.
   * With this flag set we generate a non-extractable AES-GCM key at first use,
   * stash it in a single tightly-scoped IndexedDB record, and wrap every
   * queued report payload under it. The key never leaves the origin's
   * IndexedDB; stealing the DB file on disk still requires the OS-level
   * Web Crypto keystore to decrypt.
   *
   * Defaults to `true`. Set false only if you need to inspect raw queue
   * contents during local dev.
   */
  encryptAtRest?: boolean;
}

export interface MushiRewardsConfig {
  enabled?: boolean;
  requireAuth?: boolean;
  showNotifications?: boolean;
  webhookOnReward?: string;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type MushiReportCategory = 'bug' | 'slow' | 'visual' | 'confusing' | 'other';

export type MushiReportStatus =
  | 'pending'
  | 'submitted'
  | 'classified'
  | 'grouped'
  | 'fixing'
  | 'fixed'
  | 'dismissed';

export interface MushiReport {
  id: string;
  projectId: string;
  category: MushiReportCategory;
  description: string;
  userIntent?: string;

  environment: MushiEnvironment;
  consoleLogs?: MushiConsoleEntry[];
  networkLogs?: MushiNetworkEntry[];
  performanceMetrics?: MushiPerformanceMetrics;
  screenshotDataUrl?: string;
  selectedElement?: MushiSelectedElement;

  metadata?: Record<string, unknown>;
  sessionId?: string;
  reporterToken: string;
  /**
   * §3c — stable per-device hash from `getDeviceFingerprintHash()`.
   * Sent so the server can run the cross-account anti-gaming check; falls
   * back to IP+UA fingerprinting when omitted.
   */
  fingerprintHash?: string;
  appVersion?: string;
  proactiveTrigger?: string;

  sentryEventId?: string;
  sentryReplayId?: string;

  queuedAt?: string;
  createdAt: string;
}

export interface MushiReportBuilder {
  addMetadata(key: string, value: unknown): void;
  setCategory(category: MushiReportCategory): void;
  setDescription(description: string): void;
}

// ---------------------------------------------------------------------------
// Environment Capture
// ---------------------------------------------------------------------------

export interface MushiEnvironment {
  userAgent: string;
  platform: string;
  language: string;
  viewport: { width: number; height: number };
  url: string;
  referrer: string;
  timestamp: string;
  timezone: string;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
  };
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export interface MushiConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  timestamp: number;
  stack?: string;
}

export interface MushiNetworkEntry {
  method: string;
  url: string;
  status: number;
  duration: number;
  timestamp: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  error?: string;
}

export interface MushiPerformanceMetrics {
  fcp?: number;
  lcp?: number;
  cls?: number;
  fid?: number;
  inp?: number;
  ttfb?: number;
  longTasks?: number;
}

export interface MushiSelectedElement {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  xpath?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// SDK Lifecycle
// ---------------------------------------------------------------------------

export type MushiEventType =
  | 'report:submitted'
  | 'report:queued'
  | 'report:sent'
  | 'report:failed'
  | 'widget:opened'
  | 'widget:closed'
  | 'proactive:triggered'
  | 'proactive:dismissed';

export type MushiEventHandler = (event: { type: MushiEventType; data?: unknown }) => void;

export interface MushiSDKInstance {
  report(options?: { category?: MushiReportCategory }): void;
  on(event: MushiEventType, handler: MushiEventHandler): () => void;
  setUser(user: { id: string; email?: string; name?: string }): void;
  setMetadata(key: string, value: unknown): void;
  isOpen(): boolean;
  open(): void;
  close(): void;
  destroy(): void;
  updateConfig(config: MushiRuntimeSdkConfig): void;

  /**
   * Wave G4 — unified `captureEvent` API. Submits a bug report
   * programmatically without opening the widget. Useful for adapters
   * that translate errors from Datadog / Honeycomb / Sentry /
   * Grafana into Mushi reports.
   *
   * Returns the server-assigned report id when the submit succeeds.
   */
  captureEvent(event: MushiCaptureEventInput): Promise<string | null>;

  /**
   * Wave G4 — sugar alias for `setUser()`. Name mirrors the
   * identify/track/capture vocabulary that PostHog/Segment/Mixpanel
   * users already know.
   */
  identify(userId: string, traits?: { email?: string; name?: string; [k: string]: unknown }): void;
}

export interface MushiCaptureEventInput {
  /** Human-readable summary; becomes `reports.description`. */
  description: string;
  category?: MushiReportCategory;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  component?: string;
  /** Arbitrary tags merged into `reports.metadata.tags`. */
  tags?: Record<string, string | number | boolean>;
  /** Source-of-truth adapter that produced this event (e.g. `'datadog'`). */
  source?: string;
  /** Optional error payload (name/message/stack) captured from the host app. */
  error?: { name?: string; message?: string; stack?: string };
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface MushiApiClient {
  submitReport(report: MushiReport): Promise<MushiApiResponse<{ reportId: string }>>;
  getReportStatus(reportId: string): Promise<MushiApiResponse<{ status: MushiReportStatus }>>;
  getSdkConfig(): Promise<MushiApiResponse<MushiRuntimeSdkConfig>>;
}

export interface MushiApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface MushiRuntimeSdkConfig {
  enabled?: boolean;
  version?: string | null;
  widget?: MushiWidgetConfig;
  capture?: MushiCaptureConfig;
  native?: {
    triggerMode?: 'shake' | 'button' | 'both' | 'none';
    minDescriptionLength?: number;
  };
}
