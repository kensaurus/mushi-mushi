// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MushiConfig {
  projectId: string;
  apiKey: string;
  apiEndpoint?: string;
  /** Per-request timeout in ms (default 10000). Raise on slow mobile networks. */
  timeout?: number;
  /** Max retries for transient (network / 5xx) failures (default 2). */
  maxRetries?: number;
  /**
   * Endpoint circuit breaker. After `threshold` consecutive unreachable
   * failures the client fast-fails for `cooldownMs` (then half-opens) instead
   * of hammering a down endpoint; fast-failed reports still hit the offline
   * queue. Set `enabled: false` to opt out. Defaults: enabled, threshold 4,
   * cooldown 30000ms.
   */
  circuitBreaker?: { enabled?: boolean; threshold?: number; cooldownMs?: number };
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
  /** Page-aware, user-data-aware in-SDK assistant (P5). */
  assistant?: MushiAssistantConfig;

  debug?: boolean;
  enabled?: boolean;
  /**
   * Host app release identifier stored on `reports.app_version` at ingest.
   * Pairs with `environment.buildId` (from `<meta name="mushi:build">`) for
   * deploy-level provenance. Falls back to `integrations.vercel.analyticsId`
   * when omitted (legacy Vercel Analytics wiring).
   */
  appVersion?: string;
  /**
   * Probabilistic sampling rate for session-replay recording (rrweb/lite).
   * Range 0–1, default 1 (record all sessions). The sampling decision is made
   * once at session init — a sampled-out session never loads the rrweb chunk,
   * reducing bundle cost and CPU for excluded users.
   *
   * Independent of `sampleRate` (error reporting). A session can have replay
   * on but errors sampled, or vice versa.
   *
   * @example
   * replaySampleRate: 0.2  // record replay for ~20% of sessions
   */
  replaySampleRate?: number;
  /**
   * Probabilistic sampling rate for automatic (non-user-initiated) error
   * reports. Range 0–1, default 1 (send all). User-initiated feedback reports
   * are always sent regardless of this value.
   *
   * Examples:
   *   sampleRate: 0.1  → send ~10% of auto-captured errors
   *   sampleRate: 1    → send all (default)
   *   sampleRate: 0    → send none (disables automatic capture; feedback unaffected)
   *
   * When rate limiting or circuit breaker is also active, the stricter of the
   * two gates applies. Use sampleRate for sustained high-volume apps; use
   * rate limiting for burst protection.
   */
  sampleRate?: number;
  /**
   * Hook called before ANY report (error, exception, or user feedback) is
   * sent. Return null to cancel the report; return the (possibly modified)
   * report to proceed. Async version supported — resolution is awaited before
   * submission. Runs AFTER built-in PII scrubbing.
   *
   * @example
   * beforeSend: (report) => {
   *   if (report.category === 'bug' && report.description.includes('internal')) return null
   *   return { ...report, description: sanitize(report.description) }
   * }
   */
  beforeSend?: (report: MushiReport) => MushiReport | null | Promise<MushiReport | null>;
  /**
   * @deprecated Use `beforeSend` instead. `beforeSendFeedback` is kept for
   * backwards compatibility and applies only to user-submitted feedback reports.
   * `beforeSend` covers all report types and takes precedence when both are set.
   */
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
  theme?: 'auto' | 'light' | 'dark' | 'inherit';
  /**
   * Override the widget's primary accent colour (default: vermillion #E03C2C).
   * Must be a CSS colour value that has sufficient contrast against both light
   * and dark widget backgrounds. The widget derives a wash + accessible ink
   * colour automatically, so only the base colour is required.
   */
  accent?: string;
  /** Explicit text colour on the accent surface. Auto-computed when omitted. */
  accentText?: string;
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
  /**
   * Allow the FAB to be dragged and repositioned by the user.
   * - `true`  — drag enabled, persisted to localStorage, snaps to nearest edge on release.
   * - `false` — fixed position (default).
   * - Object — fine-grained control:
   *   - `persist`     save position per projectId (default true when draggable).
   *   - `snapToEdge`  snap to the nearest left/right edge on release (default true).
   *   - `axis`        constrain movement to one axis (`'x'`, `'y'`, or `'both'` default).
   */
  draggable?: boolean | { persist?: boolean; snapToEdge?: boolean; axis?: 'both' | 'x' | 'y' };
  /** Show the tiny "Powered by Mushi vX" footer inside the widget panel. */
  brandFooter?: boolean;
  /** How the widget should surface SDK freshness warnings. Defaults to auto. */
  outdatedBanner?: 'auto' | 'banner' | 'console-only' | 'off';
  /**
   * Privacy nudge shown beside an attached screenshot preview, reminding the
   * reporter to remove anything sensitive (balances, PII, tokens) before they
   * submit. The widget always renders the captured image as a visible preview
   * so the user can see exactly what will be sent and remove it if needed; this
   * flag only controls the accompanying caption.
   * - `true`  (default) — show the localized default caption.
   * - string  — show this custom caption verbatim.
   * - `false` — hide the caption (the preview + remove control still show).
   *
   * Settable per-host via the SDK config and remotely via the Mushi console
   * runtime config (it travels in the `widget` block of `GET /v1/sdk/config`).
   */
  screenshotSensitiveHint?: boolean | string;
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
  /**
   * CSS selectors of host-app elements that the widget trigger and panel must
   * never visually overlap. At render time the widget queries each selector,
   * measures the union bounding rect, and nudges `--mushi-top` / `--mushi-bottom`
   * so the panel clears every avoided element by at least 8px.
   *
   * Typical use: avoid a sticky mobile header or a fixed sign-in CTA.
   *
   * @example
   * avoidSelectors: ['[data-mobile-header]', '#sign-in-cta']
   */
  avoidSelectors?: string[];
  /**
   * Override the default five-category picker with a custom category list.
   * When set, the widget renders these categories instead of the built-in
   * `bug / slow / visual / confusing / other` set.
   *
   * Each custom category maps onto one of the five built-in `MushiReportCategory`
   * values via `baseCategory` (defaults to `'other'`). The custom id is
   * preserved as `userCategory` on the report so the Mushi console can filter
   * by it independently of the LLM-assigned `category`.
   *
   * Deep-link helpers (`open`, `openWith`, `report`) accept the custom `id`
   * in addition to the built-in enum values when this option is set.
   *
   * When absent, behaviour is identical to the historical defaults (backward-compatible).
   */
  categories?: MushiCustomCategory[];
}

/**
 * Descriptor for a single entry in a host-app custom category list.
 * Passed as `widget.categories` to `Mushi.init()`.
 */
export interface MushiCustomCategory {
  /** Unique identifier used in `openWith(id)` / `report({ category: id })`. */
  id: string;
  /** Human-readable label shown in the category picker step. */
  label: string;
  /** Optional helper text shown beneath the label. */
  description?: string;
  /**
   * Localised intent options displayed on the second step ("What happened?").
   * When omitted, the widget skips the intent step and goes straight to
   * the description.
   */
  intents?: string[];
  /**
   * Emoji or single-character icon rendered next to the label in the picker.
   * Falls back to a neutral bubble when absent.
   */
  icon?: string;
  /**
   * Which built-in `MushiReportCategory` value this custom category maps to
   * for server-side classification. Defaults to `'other'`.
   * The custom `id` is always preserved in `report.userCategory`.
   */
  baseCategory?: MushiReportCategory;
}

/** Optional flat link in the rich banner action row (admin-console BetaBanner style). */
export interface MushiBannerLink {
  /** Link label shown in the action row. */
  label: string;
  /** External URL — opens in a new tab when set. */
  href?: string;
  /** When `href` is absent, opens the widget in feature-request mode. */
  featureRequest?: boolean;
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
  /**
   * Body copy on the strip — the lime "Beta" announcement line users see in
   * the Mushi admin console. When set, the banner switches to the rich layout
   * (pill + message + flat text actions) instead of button-only CTAs.
   */
  message?: string;
  /**
   * Pill label shown before `message` (e.g. "Beta"). Defaults to `"Beta"` when
   * `message` is set. Pass `false` to hide the pill.
   */
  label?: string | false;
  /** Override the call-to-action text in the banner. Defaults to '🐛 Report a bug'. */
  bugCta?: string;
  /** Show a "Request a feature" button alongside the bug button. Defaults to true. */
  featureCta?: boolean;
  /** Override the feature-request button label. */
  featureCtaLabel?: string;
  /** Extra flat links after the bug/feature CTAs (e.g. "My submissions"). */
  links?: MushiBannerLink[];
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

export type MushiPreset =
  | 'production-calm'
  | 'beta-loud'
  | 'internal-debug'
  | 'manual-only'
  // Tiered posture bundles (see presets.ts). `minimal` = widget + console only;
  // `standard` = today's SDK defaults (no-op expansion); `full` = all capture +
  // proactive triggers on.
  | 'minimal'
  | 'standard'
  | 'full';

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
  /**
   * Custom screenshot capture function. When provided, the SDK calls this
   * instead of its built-in DOM-snapshot capturer. Return a JPEG/PNG data URI
   * on success, or `null` to skip attachment. If the function throws the SDK
   * falls back to the built-in capturer.
   *
   * Primary use-case: Capacitor / WebView hosts that route through a native
   * plugin (e.g. `@capawesome/capacitor-screenshot`) to obtain a real pixel-
   * accurate screen grab instead of the SVG-foreignObject DOM reconstruction.
   *
   * @example
   * capture: {
   *   screenshot: 'auto',
   *   screenshotProvider: async () => {
   *     const { Screenshot } = await import('@capawesome/capacitor-screenshot');
   *     const { uri } = await Screenshot.take();
   *     return uri; // data URI on web, file:// on native (SDK handles both)
   *   },
   * }
   */
  screenshotProvider?: () => Promise<string | null>;
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
  /**
   * W3C trace-context propagation for OTel-style frontend→backend correlation.
   *
   * When enabled, the SDK injects a W3C `traceparent` header and an
   * `x-mushi-session` header into every fetch/XHR request whose URL matches
   * the `corsUrls` allowlist. The generated trace_id is recorded on each
   * captured network entry so a bug report can be correlated with the
   * backend span that handled the failing request.
   *
   * Default: disabled. Enable only for origins you control to avoid CORS issues.
   * The backend (node SDK or Supabase edge function) must include
   * `traceparent` and `x-mushi-session` in `Access-Control-Allow-Headers`.
   *
   * @example
   * capture: {
   *   tracePropagation: {
   *     enabled: true,
   *     corsUrls: [/api\.myapp\.com/, /localhost:3000/],
   *   }
   * }
   */
  tracePropagation?: MushiTracePropagationConfig;
}

export interface MushiTracePropagationConfig {
  /** Enable W3C traceparent injection. Defaults to false. */
  enabled?: boolean;
  /**
   * URL patterns for which the SDK injects `traceparent` + `x-mushi-session`
   * headers. Only requests matching at least one pattern are instrumented.
   * Strings are substring-matched; RegExp values are tested against the full URL.
   * Required when `enabled` is true — an empty allowlist silently disables propagation.
   */
  corsUrls?: Array<string | RegExp>;
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
  /**
   * Cross-reload re-show cooldown, in minutes (default 30; `0` disables).
   *
   * The `dismissCooldownHours` window only starts after a clean dismissal is
   * recorded (widget `onClose`). A page reload or crash tears down the JS
   * context before that, so on a broken/reloading page the proactive panel
   * would otherwise re-open on every load. When a prompt is shown the SDK
   * persists a timestamp; a fresh session (new JS context) suppresses prompts
   * shown within this window. Within a live session the per-session limit
   * governs instead, so this never blocks a legitimate second trigger.
   */
  reshowCooldownMinutes?: number;
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
  /**
   * Custom category identifier set by the host app via `widget.categories`.
   * Preserved as `reports.user_category` on the server so the Mushi console
   * can filter by it independently of the LLM-assigned `category`.
   * Not set when the host uses the default built-in category set.
   */
  userCategory?: string;
  description: string;
  userIntent?: string;

  environment: MushiEnvironment;
  consoleLogs?: MushiConsoleEntry[];
  networkLogs?: MushiNetworkEntry[];
  performanceMetrics?: MushiPerformanceMetrics;
  timeline?: MushiTimelineEntry[];
  screenshotDataUrl?: string;
  selectedElement?: MushiSelectedElement;
  /** rrweb / lite rolling-buffer events attached on submit when capture.replay is enabled. */
  replayEvents?: unknown[];

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
  /**
   * Correlation ID linking this breadcrumb to the `MushiNetworkEntry` and
   * `MushiConsoleEntry` entries emitted during the same network request's
   * lifetime (Phase 3b). Set for `fetch` / `xhr` category crumbs and for
   * console entries captured while a request was in-flight.
   */
  correlationId?: string;
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
   * Native-shell detection (best-effort, present only when a native bridge is
   * detected). Lets triage distinguish a Capacitor/Cordova/React-Native WebView
   * report from a plain browser one, and lets the SDK gate DOM-only behaviour.
   */
  native?: {
    capacitor?: boolean;
    cordova?: boolean;
    reactNative?: boolean;
  };

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
  /**
   * Correlation ID linking this console entry to the network request that was
   * active when this log was emitted (e.g. the fetch whose catch block called
   * console.error). Matches `MushiNetworkEntry.correlationId`. Set by the SDK's
   * active-request tracker (Phase 3b).
   */
  correlationId?: string;
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
  /**
   * W3C trace ID (32-char lowercase hex) injected by the SDK's trace propagation
   * feature. Present only when `capture.tracePropagation.enabled` is true AND
   * the request URL matched the `corsUrls` allowlist.
   * Used to correlate this network entry with a backend span in the admin console.
   */
  traceId?: string;
  /**
   * Whether this entry was captured by the fetch interceptor or the XHR interceptor
   * (Phase 3a). Used for row-level provenance badges in the console UI.
   */
  captureMethod?: 'fetch' | 'xhr';
  /**
   * Correlation ID shared with `MushiConsoleEntry.correlationId` and
   * `MushiBreadcrumb.correlationId` for entries emitted during this request's
   * lifetime (Phase 3b). Enables "highlight all logs/crumbs from this request."
   */
  correlationId?: string;
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
  /**
   * True when the widget host element has `pointer-events: none` and
   * zero width/height — i.e. it cannot act as a touch blocker over host UI.
   * False when the SDK has not yet mounted, or when a consumer has overridden
   * the host styles without restoring the pass-through contract.
   */
  widgetHostPointerSafe: boolean;
  /**
   * Bounding rect of the widget host element (`offsetWidth × offsetHeight`).
   * Should be `{ width: 0, height: 0 }` for a healthy SDK — the host is
   * zero-sized with `overflow: visible` so the shadow internals extend
   * outward without creating a hit-test surface.  `null` when not mounted.
   */
  widgetHostBounds: { width: number; height: number } | null;
  /**
   * True when the widget is currently suppressed: `hideOnSelector` matched an
   * element, `hideOnRoutes` matched the current pathname, or `hide()` was
   * called.  A suppressed widget renders nothing and removes the body nudge.
   */
  widgetSuppressed: boolean;
  /**
   * True when `trigger: 'banner'` is active and the banner is currently
   * rendered in the shadow DOM (not dismissed, not suppressed).
   */
  bannerRendered: boolean;
}

/**
 * Page-aware assistant (P5). The host app publishes a structured snapshot of
 * what the current screen is showing; the SDK forwards only this narrow,
 * server-validated subset so a malicious page cannot inject arbitrary prompt
 * fields. Ported from the admin console's page-context registry.
 */
export interface MushiPageContext {
  /** Current route/path (e.g. '/activity'). */
  route: string;
  /** Human title of the screen. */
  title?: string;
  /** One-line description of what is on screen. */
  summary?: string;
  /** Active filters as a flat key/value map. */
  filters?: Record<string, string | number | boolean | null | undefined>;
  /** The focused/selected entity, if any. */
  selection?: { kind: string; id: string; label?: string } | null;
}

export interface MushiAssistantConfig {
  /**
   * Enable the in-SDK assistant tab. Defaults to false; the console can also
   * enable it via runtime config so it can be turned on without a rebuild.
   */
  enabled?: boolean;
  /** Tab label (default: "Ask"). */
  label?: string;
  /** Greeting shown on an empty assistant thread. */
  greeting?: string;
  /** Suggested starter questions shown on an empty thread. */
  suggestions?: string[];
}

export interface MushiAssistantStep {
  label: string;
  detail?: string;
}

export interface MushiAssistantReply {
  /** 'answer' resolves the turn; 'clarify' asks the user a follow-up. */
  kind: 'answer' | 'clarify';
  text?: string;
  steps?: MushiAssistantStep[];
  /** For 'clarify' replies. */
  question?: string;
  options?: string[];
  /** Server-assigned thread id so the next turn continues the conversation. */
  threadId?: string;
}

export interface MushiSDKInstance {
  /**
   * Open the reporter widget. With no options, opens to the category
   * picker so the user can choose between bug categories and the
   * feature-request shortcut. Pass `{ category }` to deep-link into a
   * specific bug intent, or `{ featureRequest: true }` to deep-link into
   * the feature-request description step (skips intent picker).
   *
   * When `widget.categories` is configured, `category` also accepts a
   * custom category `id` from that list.
   */
  report(options?: {
    category?: MushiReportCategory | string;
    featureRequest?: boolean;
  }): void;
  on(event: MushiEventType, handler: MushiEventHandler): () => void;
  setUser(user: { id: string; email?: string; name?: string }): void;
  setMetadata(key: string, value: unknown): void;
  setScreen(screen: { name: string; route?: string; feature?: string }): void;
  isOpen(): boolean;
  open(): void;
  /**
   * Open the widget deep-linked to a specific category. Accepts a built-in
   * `MushiReportCategory` value or a custom category `id` when
   * `widget.categories` is configured.
   */
  openWith(category: MushiReportCategory | string): void;
  show(): void;
  hide(): void;
  attachTo(selectorOrElement: string | Element, options?: MushiWidgetConfig): () => void;
  setTrigger(trigger: NonNullable<MushiWidgetConfig['trigger']>): void;
  /** Open the widget directly to the reporter's "My reports" history view. */
  openReporter(): void;
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
   * Identify the current end user with a signed Mushi identity JWT minted by
   * the host app's server (see `@mushi-mushi/node`'s `mintMushiIdentityToken`).
   * This is the trust anchor for secure "My Reports", rewards-to-membership
   * grants, and the per-user assistant data index — the backend re-verifies
   * the signature against the project's identity secret. Unlike `identify()`,
   * which is spoofable, claims from this token are trusted server-side.
   *
   * Pass `null` (or call on logout) to clear the identity and fall back to the
   * anonymous reporter token.
   */
  identifyWithToken(token: string | null): void;

  /**
   * Publish the current screen's context so the in-SDK assistant can answer
   * page-aware questions. Call on every route/selection change. Pass `null`
   * to clear (e.g. on unmount). Only a narrow subset is sent to the server.
   */
  publishPageContext(context: MushiPageContext | null): void;

  /** Open the widget on the assistant ("Ask") tab. */
  openAssistant(): void;

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

  // ─── Reporter API (cross-platform) ────────────────────────────────

  /**
   * Returns the signed-in reporter's own report history.
   * Keyed to the persistent `reporterToken` stored in localStorage /
   * AsyncStorage. Returns an empty array when no token exists yet.
   */
  listMyReports(): Promise<MushiReporterReport[]>;

  /**
   * Returns the comment thread for a given report. Only returns comments
   * visible to the reporter (their own comments + team replies).
   */
  listMyComments(reportId: string): Promise<MushiReporterComment[]>;

  /**
   * Post a follow-up comment on one of the reporter's own reports.
   * Returns the newly created comment, or null on failure.
   */
  replyToReport(reportId: string, body: string): Promise<MushiReporterComment | null>;

  /**
   * Submit a structured feedback chip (confirms / not_fixed / …) on a report.
   * Drives the verify/reopen lifecycle when the report is in a fixed state.
   */
  submitFeedbackSignal(reportId: string, signal: string, note?: string): Promise<Record<string, unknown> | null>;

  /**
   * Reporter-initiated regression reopen with an optional note.
   */
  reopenReport(reportId: string, note?: string): Promise<Record<string, unknown> | null>;

  /**
   * Open the reporter inbox ("my reports") view in the widget.
   */
  openMyReports(): void;

  /**
   * Returns the global contributor hall-of-fame ranked by total points.
   * Safe to call without an authenticated user; uses public endpoint.
   * @param limit Maximum entries to return (default 20).
   */
  getHallOfFame(limit?: number): Promise<MushiHallOfFameEntry[]>;
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
  /**
   * Send one assistant turn. Forwards the page context + thread id; the
   * end-user identity token (when set) travels on the X-Mushi-User-Token
   * header so the backend can scope retrieval to the verified user.
   */
  askAssistant(input: {
    message: string;
    threadId?: string | null;
    context?: MushiPageContext | null;
  }): Promise<MushiApiResponse<MushiAssistantReply>>;
  getLatestSdkVersion(packageName: string): Promise<MushiApiResponse<MushiSdkVersionInfo>>;
  /**
   * Mushi v2.1: ship a single passive-discovery observation (route +
   * testids + outbound APIs + DOM summary). Best-effort fire-and-forget;
   * the caller should not block on the response. The server rate-limits
   * per (project, route) to keep ingest cheap, so it's fine for clients
   * to over-emit on the throttle window — the server picks the freshest.
   */
  postDiscoveryEvent(event: MushiDiscoveryEventPayload): Promise<MushiApiResponse<{ accepted: boolean }>>;
  /** POST /v1/sdk/session — lightweight session lifecycle event (best-effort). */
  postSessionEvent(payload: MushiSessionEventPayload): Promise<MushiApiResponse<{ accepted: boolean }>>;
  listReporterReports(reporterToken: string): Promise<MushiApiResponse<{ reports: MushiReporterReport[] }>>;
  listReporterComments(
    reportId: string,
    reporterToken: string,
  ): Promise<MushiApiResponse<{ comments: MushiReporterComment[] }>>;
  replyToReporterReport(
    reportId: string,
    reporterToken: string,
    body: string,
    feedbackSignal?: string,
  ): Promise<MushiApiResponse<{ comment: MushiReporterComment; feedback?: Record<string, unknown> }>>;
  reopenReporterReport(
    reportId: string,
    reporterToken: string,
    note?: string,
  ): Promise<MushiApiResponse<{ outcome: Record<string, unknown> }>>;

  /** List in-app notifications for the authenticated reporter. */
  listNotifications(
    reporterToken: string,
    opts?: { since?: string; limit?: number },
  ): Promise<MushiApiResponse<{ notifications: Array<Record<string, unknown>> }>>;

  /** Mark a single reporter notification as read. */
  markNotificationRead(
    notificationId: string,
    reporterToken: string,
  ): Promise<MushiApiResponse<{ ok: boolean }>>;

  /** List the reporter-facing feature board (public roadmap tickets). */
  listReporterFeatureBoard(
    reporterToken: string,
  ): Promise<MushiApiResponse<{ tickets: Array<Record<string, unknown>> }>>;

  /** Toggle the reporter's vote on a feature-board ticket. */
  voteReporterFeatureBoard(
    requestId: string,
    reporterToken: string,
  ): Promise<MushiApiResponse<{ voted: boolean; action: string }>>;

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

  /** Fetch the project's public leaderboard (top contributors). */
  getHallOfFame(limit?: number): Promise<MushiApiResponse<{
    data: Array<{
      display_name: string;
      email_hash: string | null;
      tier_slug: string | null;
      tier_name: string | null;
      points_30d: number;
      total_points: number;
    }>;
    meta: { project_name: string };
  }>>;

  // ─── Cross-app community (in-widget Mushi identity) ──────────

  /** Link the anonymous reporter_token_hash to the caller's mushi_testers row. */
  sendMagicLink(email: string): Promise<MushiApiResponse<{ ok: boolean }>>;
  linkReporterToken(reporterTokenHash: string, jwt: string): Promise<MushiApiResponse<{ ok: boolean; linked: number }>>;

  /** All reports filed by the signed-in tester, across all projects. */
  getCrossAppReports(
    jwt: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<MushiApiResponse<{ reports: MushiCrossAppReport[] }>>;

  /** The signed-in tester's global rank + points. */
  getMyReputation(jwt: string): Promise<MushiApiResponse<{ reputation: MushiTesterReputation | null }>>;

  /** Top-N global tester leaderboard (no auth required). */
  getPublicLeaderboard(limit?: number): Promise<MushiApiResponse<{ leaderboard: MushiLeaderboardEntry[] }>>;

  /** Whether the caller has a mushi_testers row. */
  getTesterStatus(jwt: string): Promise<MushiApiResponse<{ is_tester: boolean; tester_id: string | null; public_handle: string | null; display_name: string | null }>>;
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

/** Payload for /v1/sdk/session — lightweight session lifecycle tracking.
 *  Best-effort, no offline queue. Privacy-safe: no PII by default;
 *  `user_id_hash` is the same device-fingerprint hash used elsewhere. */
export interface MushiSessionEventPayload {
  /** Lifecycle event kind. */
  kind: 'session_start' | 'session_heartbeat' | 'session_end' | 'page_view';
  session_id: string;
  /** ISO timestamp of the event. */
  ts: string;
  /** Entry route for session_start; current route for page_view. */
  route?: string | null;
  /** document.referrer on session_start. */
  referrer?: string | null;
  /** Total page views in this session so far (updated on heartbeat/end). */
  page_view_count?: number;
  /** Device fingerprint hash — same token used in reports. */
  reporter_token_hash?: string | null;
  /** user_id_hash when the host app called Mushi.identify(). */
  user_id_hash?: string | null;
  user_agent?: string | null;
  sdk_version?: string;
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
  /** When false, the widget skips background reporter-inbox polling. Default true. */
  reporterNotificationsEnabled?: boolean;
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
  parent_report_id?: string | null;
  verified_at?: string | null;
  reopened_at?: string | null;
  regression_count?: number;
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

export interface MushiHallOfFameEntry {
  display_name: string;
  email_hash: string | null;
  tier_slug: string | null;
  tier_name: string | null;
  points_30d: number;
  total_points: number;
}

// ── Cross-app community types ─────────────────────────────────────────────────

/** A report filed by the current tester, across any project. */
export interface MushiCrossAppReport {
  id: string;
  short_id: string | null;
  title: string | null;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
  project_id: string | null;
  app_name: string | null;
  app_slug: string | null;
  /** Hostname from latest SDK heartbeat — used for favicon in cross-app list. */
  app_domain?: string | null;
}

/** A single entry in the global tester leaderboard. */
export interface MushiLeaderboardEntry {
  tester_id: string;
  public_handle: string | null;
  display_name: string | null;
  rank: number;
  points_30d: number;
  total_points: number;
  badge_slug?: string | null;
}

/** The caller's global reputation snapshot. */
export interface MushiTesterReputation {
  tester_id: string;
  public_handle: string | null;
  display_name: string | null;
  rank: number | null;
  points_30d: number;
  total_points: number;
}
