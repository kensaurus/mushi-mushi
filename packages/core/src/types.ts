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
  /** Hook called before a report is sent. Return null to cancel, or return the (possibly modified) report. */
  beforeSendFeedback?: (report: MushiReport) => MushiReport | null | Promise<MushiReport | null>;
  /** Called once if the app crashed during the previous session. */
  onCrashedLastRun?: (crashed: boolean) => void;
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
   * `auto`   — historical floating stamp FAB.
   * `banner` — slim full-width header strip (recommended default; less obtrusive
   *            than a FAB and visible even when the SDK launcher is `hide()`'d).
   *            Pair with `bannerConfig` to customise appearance.
   */
  trigger?: 'auto' | 'banner' | 'edge-tab' | 'attach' | 'manual' | 'hidden';
  /**
   * Configuration for the header-banner launcher mode.
   * Only applies when `trigger === 'banner'`.
   */
  bannerConfig?: MushiBannerConfig;
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
  /**
   * Beta mode: injects discreet "early access" messaging into the widget panel.
   * Shows a beta strip on the category step and a contact footer on the success
   * step. Designed to reduce user frustration with in-progress apps while
   * actively inviting feedback.
   */
  betaMode?: MushiBetaModeConfig;
  /**
   * Absolute base URL of the Mushi admin console (e.g. `https://mushi.example.com`).
   * When set, the success step surfaces a one-tap link to the user's own report
   * on the console so they can watch the status change in real time. Without
   * this the success step still confirms submission but cannot deep-link.
   *
   * This is intentionally separate from the API endpoint — production apps
   * usually have the API on `api.mushi.example.com` and the console on
   * `app.mushi.example.com`.
   */
  dashboardUrl?: string;
  /**
   * Override the SLA copy shown in the success step's "what happens next"
   * line. Defaults to "We aim to review within 48h". Set to an empty string
   * to hide the line entirely (e.g. internal-only deployments where SLA
   * messaging would be over-promising).
   */
  responseSlaLabel?: string;
  /**
   * Show a first-class "Feature request" card at the top of the category
   * step. Defaults to true. Set to false for production-only deployments
   * where you don't want to invite feature ideas through the widget.
   * Internally this maps to `category='other'` with
   * `user_category='Feature request'` so no DB migration is needed.
   */
  featureRequestCard?: boolean;
  /** Override the localised label for the feature-request card. */
  featureRequestLabel?: string;
  /** Override the helper text shown under the feature-request card. */
  featureRequestDescription?: string;
  /** Minimum description character count before the submit button enables. */
  minDescriptionLength?: number;
}

/**
 * Configuration for the `trigger: 'banner'` header-strip launcher.
 *
 * The banner renders as a slim, full-width strip pinned to the top of the
 * viewport (or bottom if `position === 'bottom'`). It is styled to match the
 * app's brand accent and dismissed per-session via a ✕ button.
 *
 * Variants
 * --------
 * `neon`   — lime / electric-green strip (high contrast, dev / beta tool feel).
 * `brand`  — uses the Mushi vermillion accent (editorial, app-quality feel).
 * `subtle` — near-invisible hairline with muted text (least disruptive).
 */
export interface MushiBannerConfig {
  /** Visual style of the banner strip. Defaults to `'brand'`. */
  variant?: 'neon' | 'brand' | 'subtle';
  /** 'top' pins the banner below any existing sticky headers; 'bottom' pins above bottom navs. Defaults to 'top'. */
  position?: 'top' | 'bottom';
  /** Override the call-to-action text in the banner. Defaults to 'Report a bug'. */
  bugCta?: string;
  /** Show a "✨ Request a feature" button alongside the bug button. Defaults to true. */
  featureCta?: boolean;
  /** Override the feature-request button label. */
  featureCtaLabel?: string;
  /** CSS z-index of the banner element. Defaults to the widget's configured zIndex. */
  zIndex?: number;
}

export interface MushiBetaModeConfig {
  enabled?: boolean;
  /** Display name of the app shown in the beta strip. Defaults to 'This app'. */
  appName?: string;
  /** Contact email shown on success step for direct founder/dev reach. */
  contactEmail?: string;
  /** Override the default beta strip message. */
  message?: string;
  /**
   * Optional perks shown to the user for opting in as a beta tester.
   * e.g. ['Early access to new lessons', 'Priority bug fix queue'].
   */
  perks?: string[];
  /**
   * Version-tied release notes rendered as a collapsible "What's new in this build"
   * row in the widget. Closes the feedback loop — "did you fix what I reported?"
   * Only the first entry (latest) is shown by default.
   */
  changelogItems?: MushiBetaChangelogEntry[];
}

export interface MushiBetaChangelogEntry {
  version: string;
  date?: string;
  items: string[];
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
  /**
   * Mushi Mushi v2.1 (whitepaper §6 hybrid mode): passive inventory
   * discovery. When enabled the SDK observes navigations and emits a
   * tiny payload — `(route, title, testids[], outbound api paths[],
   * dom_summary[≤200 chars])` — back to `/v1/sdk/discovery`. The
   * server aggregates this over a 30-day rolling window and the
   * admin can ask Claude to propose an `inventory.yaml` from it.
   *
   * Default: off. Recommended: enable in dev/preview/staging from the
   * day you install the SDK so the proposer has data when you go to
   * generate your first inventory.
   *
   * What is sent (per navigation, throttled to ≤1/route/min):
   *   - `location.pathname` template-normalized (`/practice/abc-123`
   *     → `/practice/[id]` via uuid/numeric/hex heuristics + an
   *     optional framework hint if the host app sets
   *     `discoverInventory.routeTemplates`)
   *   - `document.title`
   *   - All `[data-testid]` values currently in the DOM
   *   - Recent fetch/XHR paths the existing network capturer saw
   *   - The first text run of `<h1>` / `<title>` / `<main>` truncated
   *     to 200 chars (helps Claude name stories well)
   *   - Sanitized query-param keys (key names only, never values)
   *   - A SHA-256 of `userId || sessionId` so the server can dedupe
   *     distinct users without ever seeing identity
   *
   * Nothing else. No DOM beyond the summary, no query values, no PII.
   */
  discoverInventory?: boolean | MushiDiscoverInventoryConfig;
}

/**
 * Fine-grained controls for `discoverInventory`. Defaults are tuned
 * to be quiet enough for production but dense enough for the proposer
 * to produce useful drafts.
 */
export interface MushiDiscoverInventoryConfig {
  enabled?: boolean;
  /**
   * Minimum gap between two emissions for the same route (ms). Defaults
   * to 60_000. Set to a larger value for high-traffic SPAs to keep the
   * ingest volume manageable.
   */
  throttleMs?: number;
  /**
   * Static route templates the host framework knows about. When set,
   * a visit to `/practice/abc-123` matches `/practice/[id]` and gets
   * normalized to that template. Without this we fall back to a
   * heuristic (uuid / numeric / 24-char-hex segments collapse to
   * `[id]`). Provide this when you have a static manifest — Next.js'
   * `next.config` route export, React Router's route config, etc.
   */
  routeTemplates?: string[];
  /**
   * Override the SHA-256 user-id-hash input. Defaults to
   * `mushi.userId || sessionId`. Set to `null` to opt out of distinct-
   * user counting entirely.
   */
  userIdSource?: 'auto' | 'session-only' | 'none';
  /**
   * If false, the DOM summary (≤200 chars from h1/title/main) is not
   * captured. Default true.
   */
  captureDomSummary?: boolean;
}

export interface MushiPrivacyConfig {
  /** DOM nodes to visually mask in screenshots before upload. */
  maskSelectors?: string[];
  /** DOM subtrees to remove from screenshots before upload. */
  blockSelectors?: string[];
  /**
   * CSS selectors whose matching elements are blacked-out (filled with an
   * opaque black rectangle) in screenshots before upload. Intended for
   * sensitive fields that should never appear in any form — passwords, PII,
   * financial data. Applied in addition to `maskSelectors`.
   *
   * Default: `['input[type="password"]', '[data-mushi-redact]']`
   *
   * To disable the default redaction, pass an empty array.
   */
  redactSelectors?: string[];
  /** Let reporters remove an attached screenshot before submitting. Defaults to true. */
  allowUserRemoveScreenshot?: boolean;
}

export interface MushiProactiveConfig {
  rageClick?: boolean;
  errorBoundary?: boolean;
  longTask?: boolean;
  apiCascade?: boolean | MushiApiCascadeConfig;
  cooldown?: MushiCooldownConfig;
  /**
   * Beta-mode nudge: fire after the user has been on the same route for
   * `thresholdMs` continuous milliseconds (default 5min). Pass `true` to
   * accept the default threshold, or a config object to override. Use
   * conservatively — set the per-session cap in `cooldown` to avoid
   * nag fatigue.
   */
  pageDwell?: boolean | MushiPageDwellConfig;
  /**
   * One-shot welcome prompt for first-time visitors. Fires `delayMs` after
   * `Mushi.init` (default 45s) and is suppressed permanently after the
   * first fire via localStorage. Recommended for beta deployments.
   */
  firstSession?: boolean | MushiFirstSessionConfig;
}

export interface MushiPageDwellConfig {
  /** Continuous dwell time before firing. Defaults to 5 minutes. */
  thresholdMs?: number;
  /**
   * Route path prefixes (or glob-style patterns with `*`) that suppress the
   * dwell nudge. Auth routes are excluded by default so users aren't prompted
   * during login/signup flows.
   *
   * Default: `['/login', '/logout', '/signup', '/sso/*', '/auth/*']`
   */
  excludeRoutes?: string[];
}

export interface MushiFirstSessionConfig {
  /** Delay before firing the welcome nudge. Defaults to 45 seconds. */
  delayMs?: number;
  /** Override the localStorage key used to mark the user as welcomed. */
  storageKey?: string;
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
  /**
   * P1: when true the SDK auto-tracks route navigations, [data-testid] clicks,
   * and session dwell time and flushes them to POST /v1/sdk/activity.
   * Default false. Requires opted_in_to_rewards = true from the end user.
   */
  trackActivity?: boolean;
  /**
   * Activity batch flush interval in ms. Default 300_000 (5 min).
   * Minimum 30_000 (30s) — smaller values are clamped.
   */
  flushIntervalMs?: number;
  /**
   * Show a tier + points footer in the SDK widget.
   * Default false.
   */
  showInWidget?: boolean;
  /**
   * Whether to show a "+X pts" toast notification on each award.
   * Default true when enabled.
   */
  showNotifications?: boolean;
  /**
   * 'auto'     — immediately opt the user in when identify() is called.
   * 'explicit' — SDK surfaces a one-time consent prompt. Default 'explicit'.
   */
  consentMode?: 'auto' | 'explicit';
  /**
   * P2: callback that returns a host-app JWT for server-side identity
   * verification before monetary rewards are issued. Return null to skip
   * verification for non-monetary actions.
   */
  verifyUserToken?: () => Promise<string | null>;
  /**
   * @deprecated Superseded by server-side reward_webhooks table.
   * Kept for backwards compatibility; has no effect from v0.10.0.
   */
  webhookOnReward?: string;
}

// ---------------------------------------------------------------------------
// Rewards — public types returned by SDK instance methods
// ---------------------------------------------------------------------------

export interface MushiReputationResult {
  totalPoints: number;
  points30d: number;
  reputation: number;
  confirmedBugs: number;
  totalReports: number;
}

export interface MushiTierResult {
  id: string;
  slug: string;
  displayName: string;
  pointsThreshold: number;
  perks: Record<string, unknown>;
}

export interface MushiActivityEvent {
  action: string;
  metadata?: Record<string, unknown>;
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

  /**
   * Mushi-side breadcrumbs maintained by the SDK in a 50-entry ring buffer.
   * Captured automatically (SDK lifecycle events, console errors, route
   * changes, `[data-testid]` clicks) and via `Mushi.addBreadcrumb()`.
   * Independent of Sentry's breadcrumbs (those land in
   * `sentryContext.breadcrumbs`) so a host using Mushi without Sentry
   * still gets a timeline.
   */
  breadcrumbs?: MushiBreadcrumb[];

  /**
   * Sticky tags set via `Mushi.setTag()` / `Mushi.setTags()`. Mirrors
   * the Sentry / DataDog "tag" vocabulary — short string keys with
   * scalar values. The Triage LLM treats these as high-signal hints
   * ("checkout-flow=redesign-v2" tells the LLM which feature flag the
   * report came from). Plumbed through to `reports.metadata.tags`
   * server-side until a dedicated `tags` column is added.
   */
  tags?: Record<string, string | number | boolean>;

  /**
   * Rich Sentry context captured at report time. Replaces the legacy
   * `sentryEventId`/`sentryReplayId` pair (those are kept for
   * back-compat — server unifies them). When the host has Sentry
   * installed (v7, v8, or v9), every Mushi report carries enough trace
   * data for the admin to pivot into Sentry's MCP / web UI without
   * a manual paste.
   */
  sentryContext?: MushiSentryContext;

  /** @deprecated use `sentryContext.eventId` — kept for back-compat. */
  sentryEventId?: string;
  /** @deprecated use `sentryContext.replayId` — kept for back-compat. */
  sentryReplayId?: string;

  queuedAt?: string;
  createdAt: string;
}

/**
 * Single breadcrumb entry. Shape follows the Sentry breadcrumb schema
 * 1:1 so an admin tooling layer (or the Triage LLM) can treat Mushi
 * breadcrumbs and Sentry breadcrumbs interchangeably without a
 * normalisation pass.
 */
export interface MushiBreadcrumb {
  /** Unix epoch ms when the breadcrumb fired. */
  timestamp: number;
  /**
   * Coarse bucket for filtering / coloring in the report drawer.
   * - `navigation` — route or url change
   * - `ui.click` — user clicked a `[data-testid]` element (web SDK)
   * - `ui.tap` — user tapped a `UIView` / Android `View` (native SDKs)
   * - `console` — `console.error` / `console.warn` callsite
   * - `xhr` / `fetch` — network request that errored or 4xx/5xx (web SDK)
   * - `network` — network failure on iOS / Android (native SDKs)
   * - `lifecycle` — Mushi SDK init / open / submit / queue
   * - `custom` — host called `Mushi.addBreadcrumb()`
   *
   * Admin tooling that filters by interaction should treat
   * `ui.click` ∪ `ui.tap` as one bucket and `xhr` ∪ `fetch` ∪ `network`
   * as one bucket. Native enums are platform-idiomatic (`tap` on touch
   * devices, `network` because iOS/Android don't expose `XHR` / `fetch`
   * separately) — every wire string is documented in the native READMEs.
   */
  category:
    | 'navigation'
    | 'ui.click'
    | 'ui.tap'
    | 'console'
    | 'xhr'
    | 'fetch'
    | 'network'
    | 'lifecycle'
    | 'custom';
  /**
   * Severity — `info` is the default. `warning` / `error` map to a
   * coloured pill in the drawer; the Triage LLM uses these to decide
   * which breadcrumbs to feature in the "what happened" summary.
   */
  level: 'debug' | 'info' | 'warning' | 'error';
  /** Free-form short summary, capped at 500 chars at submit time. */
  message: string;
  /** Optional structured payload — kept small to keep ingest cheap. */
  data?: Record<string, unknown>;
}

/**
 * Snapshot of Sentry's current scope at report submission. Captured by
 * `captureSentryContext()` in the web SDK; designed to be cheap to
 * serialise and exhaustively useful when the admin pivots into Sentry
 * MCP via `find_organizations` → `search_issues` → `get_event_attachment`.
 *
 * Every field is optional so a host without Sentry installed (and a
 * Sentry SDK that exposes only a subset of these globals) still
 * produces a partial — but useful — payload.
 */
export interface MushiSentryContext {
  /** Sentry SDK version family detected at capture time. */
  sdk?: 'v7' | 'v8' | 'v9' | 'unknown';
  /** `Sentry.lastEventId()` (v8+) / `getLastEventId()` (v7). */
  eventId?: string;
  /** Replay session id from `Sentry.getReplay()?.getReplayId()`. */
  replayId?: string;
  /** Distributed-tracing trace id (32 hex). */
  traceId?: string;
  /** Active span id at capture time (16 hex). */
  spanId?: string;
  /** `transaction` field from the active scope, e.g. `GET /checkout`. */
  transactionName?: string;
  /** Build identifier set via `Sentry.init({ release })`. */
  release?: string;
  /** Logical environment, e.g. `production`. */
  environment?: string;
  /** Session id when Sentry session-tracking is enabled. */
  sessionId?: string;
  /** User context from Sentry's scope (id/email/username/ip). */
  user?: { id?: string; email?: string; username?: string; ip_address?: string };
  /** Tags attached to Sentry's current scope. */
  tags?: Record<string, string | number | boolean>;
  /**
   * Last N Sentry breadcrumbs (default cap = 30). Already-formatted
   * Sentry breadcrumbs, not Mushi's — the two are surfaced side by
   * side in the admin drawer so users can correlate.
   */
  breadcrumbs?: Array<{
    timestamp?: number;
    category?: string;
    level?: string;
    message?: string;
    type?: string;
    data?: Record<string, unknown>;
  }>;
  /**
   * Issue url (deeplink) when the SDK can derive it from the event id
   * + DSN. Lets the admin jump straight to the Sentry issue page
   * without the user pasting a link.
   */
  issueUrl?: string;
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
  /**
   * v2 inventory hints (whitepaper §4.7).
   *
   * `route` — the bare pathname (no query / hash). Pinned to the
   * inventory's `Page.path` so the Triage LLM can shortcut from a
   * freeform "the streak counter is broken" report to the right page.
   *
   * `nearestTestid` — the closest ancestor of the active element with
   * a `data-testid`, captured at widget-open time. This pins the
   * report to one Action node when more than one page has the same
   * page path (e.g. a shared "Buy Pro" CTA on landing + dashboard).
   *
   * Both are best-effort; freeform reports with no active element will
   * have `route` only.
   */
  route?: string;
  nearestTestid?: string;

  /**
   * SDK boost (2026-05-07): richer per-report context so the Triage LLM
   * and the admin /reports detail drawer have something to reason about
   * beyond `userAgent`. Every field is optional so legacy SDKs and
   * non-browser callers (CLI, server-to-server) keep validating.
   */

  /**
   * Parsed UA-CH (User-Agent Client Hints) high-entropy values when the
   * browser supports `navigator.userAgentData.getHighEntropyValues`.
   * This is the modern, reliable way to identify Chromium browsers — UA
   * sniffing is unreliable post-Chrome 100 because the UA string was
   * frozen for privacy. Safari + Firefox don't expose UA-CH so we still
   * fall back to UA parsing for those (handled server-side).
   */
  userAgentData?: {
    /** Best-effort browser brand (e.g. "Chrome", "Edge", "Brave"). */
    browser?: string;
    /** Browser version (full semver where available, e.g. "131.0.6778.86"). */
    browserVersion?: string;
    /** OS family (e.g. "macOS", "Windows", "Android", "iOS"). */
    os?: string;
    /** OS version when the browser exposes it (e.g. "14.5.0"). */
    osVersion?: string;
    /** Whether the device self-identifies as mobile (UA-CH `mobile`). */
    mobile?: boolean;
    /** Device model when the OS exposes it (Android only, e.g. "Pixel 8"). */
    model?: string;
    /** CPU architecture (e.g. "x86", "arm"). */
    architecture?: string;
    /** CPU bitness ("32" or "64"). */
    bitness?: string;
  };

  /**
   * Physical device pixels behind the viewport. `viewport` already
   * captures the CSS pixel box; this lets us tell a 1080p MacBook from a
   * Retina iPhone and explain "looks fine on my screen, broken on
   * theirs" by surfacing devicePixelRatio mismatches.
   */
  screen?: {
    /** `screen.width` — outer device width in CSS px. */
    width?: number;
    /** `screen.height` — outer device height in CSS px. */
    height?: number;
    /** `window.devicePixelRatio` — physical / CSS px ratio. */
    devicePixelRatio?: number;
    /** `screen.colorDepth` — bits per pixel (typically 24/30). */
    colorDepth?: number;
    /** Active orientation type from `screen.orientation`. */
    orientation?: 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary' | string;
  };

  /**
   * Accessibility / display preferences resolved via media queries.
   * These are reproduction hints — a bug that only repros under
   * `prefers-reduced-motion: reduce` or `forced-colors: active` is one
   * the developer would otherwise spend hours hunting for.
   */
  prefersColorScheme?: 'dark' | 'light' | 'no-preference';
  prefersReducedMotion?: boolean;
  prefersReducedData?: boolean;
  prefersContrast?: 'more' | 'less' | 'no-preference' | 'custom';
  forcedColors?: boolean;

  /** `navigator.onLine` at capture time. False = the report was filed offline. */
  online?: boolean;

  /**
   * `(display-mode: standalone | minimal-ui | fullscreen | browser)`
   * resolved via media queries. Tells us whether the user filed the
   * report from a regular browser tab, an installed PWA, or a TWA — a
   * different code path on iOS Safari for each.
   */
  displayMode?: 'browser' | 'minimal-ui' | 'standalone' | 'fullscreen';

  /** `document.title` at capture time. Surface for "what page were they on?". */
  documentTitle?: string;

  /**
   * Optional opt-in build identifier from `<meta name="mushi:build" content="...">`.
   * Hosts that already expose a git SHA / build number to their HTML
   * (e.g. `<meta name="mushi:build" content="abc123def">`) get it
   * threaded through automatically — no SDK config required. Pairs with
   * `appVersion` to pin reports to a specific deploy.
   */
  buildId?: string;

  /**
   * Snapshot of the Navigation Timing entry. Reports that come in
   * during a slow page load look very different from steady-state
   * reports, and the LLM can't tell the difference from a stack alone.
   */
  pageLoadTiming?: {
    /** `domContentLoadedEventEnd - startTime` in ms. */
    domContentLoadedMs?: number;
    /** `loadEventEnd - startTime` in ms. */
    loadCompleteMs?: number;
    /** `responseStart - startTime` in ms (TTFB). */
    timeToFirstByteMs?: number;
    /** Navigation type (`navigate`, `reload`, `back_forward`, `prerender`). */
    navigationType?: string;
  };
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
  inpAttribution?: {
    eventType?: string;
    targetSelector?: string;
    inputDelay?: number;
    processingDuration?: number;
    presentationDelay?: number;
  };
}

export interface MushiSelectedElement {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  xpath?: string;
  rect?: { x: number; y: number; width: number; height: number };
  /**
   * `data-testid` of the closest ancestor that has one. Mushi v2 uses this
   * to map a report → Action node in the bidirectional graph (whitepaper §4.7).
   * Falls back to `undefined` when no ancestor declares a testid — the v2
   * Triage LLM still classifies these reports, just without the inventory
   * grounding shortcut.
   */
  nearestTestid?: string;
  /** Path of the page the user reported from (`window.location.pathname`).
   *  Combined with `nearestTestid` it pins a report to one Action even when
   *  the same testid exists on multiple pages. */
  route?: string;
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
  | 'proactive:dismissed'
  | 'report:dispatched';

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
  /**
   * Open the reporter widget. With no options, opens to the category
   * picker so the user can choose between bug categories and the
   * feature-request shortcut. Pass `{ category }` to deep-link into a
   * specific bug intent, or `{ featureRequest: true }` to deep-link into
   * the feature-request description step (skips intent picker).
   */
  report(options?: {
    category?: MushiReportCategory;
    featureRequest?: boolean;
  }): void;
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
   * 2026-05-07 — `try/catch`-friendly sugar over `captureEvent`. Pass
   * a thrown value directly and Mushi normalises it (any exotic
   * throw shape: `Error`, string, plain object, `null`) into a report
   * with category `bug`, severity `high` (overridable), and the
   * stack trace folded into both `description` (compact) and
   * `metadata.error.stack` (full).
   *
   * Pairs with Sentry: when `config.sentry` is present, the same
   * call-site can flush to Sentry (`Sentry.captureException(err)`)
   * and Mushi (`Mushi.captureException(err)`) — the two reports get
   * cross-linked via `sentryContext.eventId` automatically.
   */
  captureException(
    error: unknown,
    options?: MushiCaptureExceptionOptions,
  ): Promise<string | null>;

  /**
   * Wave G4 — sugar alias for `setUser()`. Name mirrors the
   * identify/track/capture vocabulary that PostHog/Segment/Mixpanel
   * users already know.
   */
  identify(userId: string, traits?: { email?: string; name?: string; [k: string]: unknown }): void;

  /**
   * Sentry-grade observability surface (2026-05-07).
   *
   * Hosts can drop a breadcrumb on every meaningful state change in
   * their app — feature-flag toggles, route transitions, optimistic
   * UI commits, server reconciliation — and the buffer's last 50
   * entries automatically attach to every report. Useful even when
   * Sentry isn't installed; when it is, Mushi reports also carry
   * Sentry's breadcrumbs alongside Mushi's own.
   */
  addBreadcrumb(crumb: Omit<MushiBreadcrumb, 'timestamp'> & { timestamp?: number }): void;

  /** Snapshot of the current breadcrumb ring buffer (oldest first). */
  getBreadcrumbs(): MushiBreadcrumb[];

  /**
   * Set a sticky tag that lands on every subsequent report. Numeric
   * and boolean values are accepted; they're coerced to strings on
   * the wire so the Triage LLM can read them without type juggling.
   */
  setTag(key: string, value: string | number | boolean): void;

  /** Bulk variant of `setTag`. Replaces existing values for shared keys. */
  setTags(tags: Record<string, string | number | boolean>): void;

  /** Remove a single tag, or all tags when called with no argument. */
  clearTag(key?: string): void;

  // ─── Rewards program (P1) ───────────────────────────────────

  /**
   * Returns the current user's reputation + legacy point totals from the
   * reporter_reputation table. Available even when the rewards program is
   * disabled (legacy surface).
   */
  getReputation(): Promise<MushiReputationResult | null>;

  /**
   * Returns the current user's tier from the rewards program.
   * Returns null when the user has not yet been identified or the project
   * has rewards_enabled = false.
   */
  getTier(): Promise<MushiTierResult | null>;

  /**
   * Manually record a host-defined activity event (e.g. 'lesson_completed').
   * The SDK batches these and flushes to POST /v1/sdk/activity.
   * No-op when rewards are disabled or the user has not opted in.
   */
  recordActivity(action: string, metadata?: Record<string, unknown>): void;

  /**
   * Briefly animate the bug-report trigger button to draw the user's
   * attention without opening the full widget. Ideal for subtle "feedback
   * welcome" nudges (first-session, beta-onboarding).
   */
  pulseTrigger(): void;
}

export interface MushiCaptureExceptionOptions {
  /** Override the default `'bug'` category (e.g. `'slow'` for timeouts). */
  category?: MushiReportCategory;
  /** Default `'high'`. Use `'critical'` for boot-time errors, `'low'` for known recoverables. */
  severity?: 'critical' | 'high' | 'medium' | 'low';
  /** Affected component / page area, surfaces in the admin reports list. */
  component?: string;
  /** Optional human-readable summary that overrides the auto-derived one. */
  description?: string;
  /** Per-call tags merged with sticky tags. */
  tags?: Record<string, string | number | boolean>;
  /** Free-form metadata folded into `reports.metadata`. */
  metadata?: Record<string, unknown>;
  /** Source label — defaults to `'captureException'`. */
  source?: string;
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
  /**
   * Mushi v2.1: ship a single passive-discovery observation (route +
   * testids + outbound APIs + DOM summary). Best-effort fire-and-forget;
   * the caller should not block on the response. The server rate-limits
   * per (project, route) to keep ingest cheap, so it's fine for clients
   * to over-emit on the throttle window — the server picks the freshest.
   */
  postDiscoveryEvent(event: MushiDiscoveryEventPayload): Promise<MushiApiResponse<{ accepted: boolean }>>;
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

  // ─── Rewards program (P1) ───────────────────────────────────

  /**
   * Submit a batch of activity events for the current user.
   * Requires rewards to be enabled on the project.
   */
  submitActivity(
    userId: string,
    events: MushiActivityEvent[],
    opts?: {
      userTraits?: { email?: string; name?: string; provider?: string };
      reporterTokenHash?: string;
      optedIn?: boolean;
      /** P2: host-app JWT; when present the server attempts verifyHostJwt
       *  and updates end_users.jwt_verified_at if valid. Required for
       *  monetary payout eligibility. */
      hostJwt?: string;
    },
  ): Promise<MushiApiResponse<{ accepted: number; total: number }>>;

  /** Fetch the current user's point totals (requires userId). */
  getMyPoints(userId: string): Promise<MushiApiResponse<{
    total_points: number;
    points_30d: number;
    points_lifetime: number;
    tier: MushiTierResult | null;
  }>>;

  /** Fetch the current user's tier (requires userId). */
  getMyTier(userId: string): Promise<MushiApiResponse<MushiTierResult | null>>;

  /** Fetch the current user's activity history (requires userId). */
  getMyHistory(
    userId: string,
    opts?: { limit?: number },
  ): Promise<MushiApiResponse<{ items: unknown[]; total: number }>>;
}

/**
 * Wire shape of a single discovery event sent by the SDK to
 * `POST /v1/sdk/discovery`. Mirrored server-side in
 * `_shared/schemas.ts::discoveryEventSchema`.
 */
export interface MushiDiscoveryEventPayload {
  route: string;
  page_title?: string | null;
  dom_summary?: string | null;
  testids: string[];
  network_paths: string[];
  query_param_keys: string[];
  user_id_hash?: string | null;
  sdk_version?: string;
  observed_at: string;
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
