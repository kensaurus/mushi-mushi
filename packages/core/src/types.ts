// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MushiConfig {
  projectId: string;
  apiKey: string;
  apiEndpoint?: string;

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
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface MushiApiClient {
  submitReport(report: MushiReport): Promise<MushiApiResponse<{ reportId: string }>>;
  getReportStatus(reportId: string): Promise<MushiApiResponse<{ status: MushiReportStatus }>>;
}

export interface MushiApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}
