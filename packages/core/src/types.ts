// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MushiConfig {
  projectId: string;
  apiKey: string;
  apiEndpoint?: string;
  /** Opinionated defaults for common environments. Explicit config wins. */
  preset?: MushiPreset;
  /**
   * Fetch non-secret widget/capture settings from the Mushi project at
   * startup. Defaults to true so console changes apply without rebuilding
   * host apps. Set false for fully static/offline deployments.
   */
  runtimeConfig?: boolean | 'auto';

  sentry?: MushiSentryConfig;
  widget?: MushiWidgetConfig;
  capture?: MushiCaptureConfig;
  privacy?: MushiPrivacyConfig;
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
  /**
   * Raw CSS anchors for app shells with bottom navs/chat composers/cookie
   * banners. When set, these values win over `position` + numeric `inset`.
   */
  anchor?: MushiWidgetAnchor;
  theme?: 'auto' | 'light' | 'dark';
  triggerText?: string;
  expandedTitle?: string;
  mode?: 'simple' | 'conversational';
  locale?: string;
  zIndex?: number;
  /**
   * Controls how, or whether, the default trigger is injected.
   * `auto` preserves the historical floating stamp button.
   */
  trigger?: 'auto' | 'edge-tab' | 'attach' | 'manual' | 'hidden';
  /** CSS selector used when `trigger` is `attach`. */
  attachToSelector?: string;
  /**
   * Per-edge trigger offset in pixels. `auto` clears the corresponding edge.
   * Defaults to the historical 24px gutter plus safe-area insets.
   */
  inset?: MushiWidgetInset;
  respectSafeArea?: boolean;
  /** Hide the launcher while any matching element exists in the document. */
  hideOnSelector?: string;
  /** Hide the launcher on matching pathnames. Strings are substring matches. */
  hideOnRoutes?: string[];
  environments?: Partial<Record<'production' | 'staging' | 'development', 'always' | 'never' | 'manual'>>;
  /** Opt-in smart trigger behavior; planned to become the default in a later minor. */
  smartHide?: boolean | MushiWidgetSmartHideConfig;
  draggable?: boolean;
  /** Show the tiny "Powered by Mushi vX" footer inside the widget panel. */
  brandFooter?: boolean;
  /** How the widget should surface SDK freshness warnings. Defaults to auto. */
  outdatedBanner?: 'auto' | 'banner' | 'console-only' | 'off';
}

export interface MushiWidgetInset {
  top?: number | 'auto';
  right?: number | 'auto';
  bottom?: number | 'auto';
  left?: number | 'auto';
}

export interface MushiWidgetAnchor {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export type MushiPreset = 'production-calm' | 'beta-loud' | 'internal-debug' | 'manual-only';

export interface MushiWidgetSmartHideConfig {
  onMobile?: 'edge-tab' | 'hide' | false;
  onScroll?: 'shrink' | 'hide' | false;
  onIdleMs?: number;
}

export interface MushiCaptureConfig {
  console?: boolean;
  network?: boolean;
  /**
   * URLs that should never be captured as host-app traffic. Strings are
   * substring matches; RegExp values are tested against the fully resolved URL.
   */
  ignoreUrls?: MushiUrlMatcher[];
  performance?: boolean;
  screenshot?: 'on-report' | 'auto' | 'off';
  elementSelector?: boolean;
  replay?: 'sentry' | 'rrweb' | 'lite' | 'off';
}

export interface MushiPrivacyConfig {
  /** DOM nodes to visually mask in screenshots before upload. */
  maskSelectors?: string[];
  /** DOM subtrees to remove from screenshots before upload. */
  blockSelectors?: string[];
  /** Let reporters remove an attached screenshot before submitting. Defaults to true. */
  allowUserRemoveScreenshot?: boolean;
}

export interface MushiProactiveConfig {
  rageClick?: boolean;
  errorBoundary?: boolean;
  longTask?: boolean;
  apiCascade?: boolean | MushiApiCascadeConfig;
  cooldown?: MushiCooldownConfig;
}

export type MushiUrlMatcher = string | RegExp;

export interface MushiApiCascadeConfig {
  enabled?: boolean;
  /**
   * URLs ignored by the API cascade detector. The SDK always ignores its own
   * gateway endpoints as well; this hook lets host apps exclude analytics,
   * health probes, or third-party scripts that are noisy by design.
   */
  ignoreUrls?: MushiUrlMatcher[];
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
  timeline?: MushiTimelineEntry[];
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
  /** SDK package that submitted the report, e.g. `@mushi-mushi/web`. */
  sdkPackage?: string;
  /** npm package version that submitted the report, e.g. `0.8.0`. */
  sdkVersion?: string;
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

export type MushiTimelineKind = 'route' | 'click' | 'request' | 'log' | 'screen';

export interface MushiTimelineEntry {
  ts: number;
  kind: MushiTimelineKind;
  payload: Record<string, unknown>;
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

export interface MushiDiagnosticsResult {
  apiEndpointReachable: boolean;
  cspAllowsEndpoint: boolean;
  widgetMounted: boolean;
  shadowDomAvailable: boolean;
  dialogSupported: boolean;
  runtimeConfigLoaded: boolean;
  captureScreenshotAvailable: boolean;
  captureNetworkIntercepting: boolean;
  sdkVersion: string;
}

export interface MushiSDKInstance {
  report(options?: { category?: MushiReportCategory }): void;
  on(event: MushiEventType, handler: MushiEventHandler): () => void;
  setUser(user: { id: string; email?: string; name?: string }): void;
  setMetadata(key: string, value: unknown): void;
  setScreen(screen: { name: string; route?: string; feature?: string }): void;
  isOpen(): boolean;
  open(): void;
  openWith(category: MushiReportCategory): void;
  show(): void;
  hide(): void;
  attachTo(selectorOrElement: string | Element, options?: MushiWidgetConfig): () => void;
  setTrigger(trigger: NonNullable<MushiWidgetConfig['trigger']>): void;
  close(): void;
  destroy(): void;
  updateConfig(config: MushiRuntimeSdkConfig): void;
  diagnose(): Promise<MushiDiagnosticsResult>;

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
  getLatestSdkVersion(packageName: string): Promise<MushiApiResponse<MushiSdkVersionInfo>>;
  listReporterReports(reporterToken: string): Promise<MushiApiResponse<{ reports: MushiReporterReport[] }>>;
  listReporterComments(
    reportId: string,
    reporterToken: string,
  ): Promise<MushiApiResponse<{ comments: MushiReporterComment[] }>>;
  replyToReporterReport(
    reportId: string,
    reporterToken: string,
    body: string,
  ): Promise<MushiApiResponse<{ comment: MushiReporterComment }>>;
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

export interface MushiSdkVersionInfo {
  package: string;
  latest: string | null;
  current?: string;
  deprecated: boolean;
  deprecationMessage?: string | null;
  releasedAt?: string | null;
}

export interface MushiReporterReport {
  id: string;
  status: string;
  category: string;
  severity?: string | null;
  summary?: string | null;
  description?: string | null;
  created_at: string;
  last_admin_reply_at?: string | null;
  last_reporter_reply_at?: string | null;
  unread_count?: number;
}

export interface MushiReporterComment {
  id: number;
  author_kind: 'admin' | 'reporter';
  author_name?: string | null;
  body: string;
  visible_to_reporter?: boolean;
  created_at: string;
}
