/**
 * FILE: packages/web/src/widget.ts
 * PURPOSE: The bug-capture widget — floating trigger + multi-step report
 *          panel — that mounts into a customer's app via `Mushi.init()`.
 *
 * DESIGN: Visual styling lives in `./styles.ts` ("Mushi Mushi Editorial":
 *         paper + sumi ink + 朱 vermillion, serif display + monospace
 *         metadata, ledger-style step counter, hanko stamp animation on
 *         success). This file owns the DOM structure, state, and all
 *         user-facing ARIA / keyboard wiring.
 */

import type {
  MushiCustomCategory,
  MushiReportCategory,
  MushiReporterComment,
  MushiReporterReport,
  MushiWidgetConfig,
} from '@mushi-mushi/core';
import { getLocale, type MushiLocale } from './i18n';
import { getWidgetStyles } from './styles';

type WidgetStep = 'category' | 'intent' | 'details' | 'success' | 'reports' | 'report-detail' | 'leaderboard' | 'roadmap';

const CATEGORY_ICONS: Record<MushiReportCategory, string> = {
  bug: '\u26A0\uFE0F',
  slow: '\uD83D\uDC0C',
  visual: '\uD83C\uDFA8',
  confusing: '\uD83D\uDE15',
  other: '\uD83D\uDCDD',
};

/**
 * Wire-format "feature request" intent string. Always written into the
 * report's `user_category` field (not `category`) so we don't have to
 * widen the DB CHECK constraint on `reports.category`. The widget UI
 * presents it as a first-class card alongside the five real categories
 * because beta apps live or die by how easy it is to file a feature
 * request — burying it as an intent under "Other" suppresses signal.
 */
const FEATURE_REQUEST_INTENT = 'Feature request';

type ReporterStatusTone = 'sent' | 'review' | 'fixing' | 'fixed' | 'closed' | 'unknown';

/** Compact status pill copy for list rows. */
function reporterStatusShort(status: string): string {
  switch (status) {
    case 'new':
    case 'queued':
    case 'pending':
    case 'submitted':
      return 'Sent';
    case 'classified':
    case 'triaged':
    case 'grouped':
    case 'dispatched':
      return 'Review';
    case 'fixing':
      return 'Fixing';
    case 'fixed':
    case 'resolved':
    case 'completed':
      return 'Fixed';
    case 'dismissed':
      return 'Closed';
    default:
      return status.replace(/_/g, ' ').slice(0, 12);
  }
}

/** Map raw DB status to reporter-facing copy (detail views). */
function reporterStatusLabel(status: string): string {
  switch (status) {
    case 'new':
    case 'queued':
    case 'pending':
    case 'submitted':
      return 'Submitted';
    case 'classified':
    case 'triaged':
    case 'grouped':
    case 'dispatched':
      return 'In review';
    case 'fixing':
      return 'Fix in progress';
    case 'fixed':
    case 'resolved':
    case 'completed':
      return 'Fixed — confirm?';
    case 'verified':
      return 'Verified';
    case 'reopened':
      return 'Reopened';
    case 'dismissed':
      return 'Closed';
    default:
      return status.replace(/_/g, ' ');
  }
}

function reporterStatusTone(status: string): ReporterStatusTone {
  switch (status) {
    case 'new':
    case 'queued':
    case 'pending':
    case 'submitted':
      return 'sent';
    case 'classified':
    case 'triaged':
    case 'grouped':
    case 'dispatched':
      return 'review';
    case 'fixing':
      return 'fixing';
    case 'fixed':
    case 'resolved':
    case 'completed':
      return 'fixed';
    case 'verified':
      return 'fixed';
    case 'reopened':
      return 'fixing';
    case 'dismissed':
      return 'closed';
    default:
      return 'unknown';
  }
}

/** Human-readable relative time, e.g. "2h ago". */
function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The two-digit padded step number used in the header ledger ("01 / 03"). */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const TOTAL_STEPS = 3;
const STEP_NUMBER: Record<Exclude<WidgetStep, 'success'>, number> = {
  category: 1,
  intent: 2,
  details: 3,
  reports: 1,
  'report-detail': 1,
  leaderboard: 1,
  roadmap: 1,
};

/** Detects modifier-key presses for the Ctrl/Cmd+Enter submit shortcut.
 *  metaKey covers macOS, ctrlKey covers Windows/Linux/ChromeOS. */
function isSubmitShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface WidgetRewardsState {
  tier: { slug: string; displayName: string; pointsThreshold: number } | null;
  nextTier: { displayName: string; pointsThreshold: number } | null;
  totalPoints: number;
  /** Expected base points for a `report_submit` action (default 50). */
  pointsForReport: number;
}

export interface WidgetSubmitOutcome {
  /** Server-confirmed report id. When `null` the report was queued
   *  offline / failed-and-queued for retry; the success step degrades
   *  gracefully (no "track on console" link, just the receipt stamp). */
  reportId: string | null;
  /** Convenience flag for the widget to decide whether to render the
   *  optimistic copy ("queued offline, we'll send it when you're back")
   *  versus the confirmed copy ("received — track at #abc12345"). */
  queuedOffline?: boolean;
}

export interface WidgetCallbacks {
  /**
   * Returns the outcome of the submission so the widget can render a
   * real receipt (report id, deep link). Older callers that return
   * `void` still work — the widget falls back to the legacy stamp.
   */
  onSubmit(
    data: {
      category: MushiReportCategory;
      /** Set when the host configured `widget.categories` — the raw custom id chosen by the user. */
      userCategory?: string;
      description: string;
      intent?: string;
    },
  ): void | Promise<WidgetSubmitOutcome | void>;
  onOpen(): void;
  onClose(): void;
  onScreenshotRequest(): void;
  onScreenshotRemove?(): void;
  /** Optional markup pass (highlight / blur / arrow) before submit. */
  onScreenshotAnnotateRequest?(container: HTMLElement): void | Promise<void>;
  onElementSelectorRequest?(): void;
  onReporterReportsRequest?(): Promise<MushiReporterReport[]>;
  onReporterCommentsRequest?(reportId: string): Promise<MushiReporterComment[]>;
  onReporterReply?(reportId: string, body: string): Promise<void>;
  onReporterFeedback?(reportId: string, signal: string, note?: string): Promise<Record<string, unknown> | null>;
  onReporterReopen?(reportId: string, note?: string): Promise<Record<string, unknown> | null>;
  onFeatureBoardRequest?(): Promise<Array<Record<string, unknown>>>;
  onFeatureBoardVote?(requestId: string): Promise<{ voted: boolean; action: string }>;
  onLeaderboardOpen?(): void;
}

export class MushiWidget {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private config: Required<MushiWidgetConfig>;
  private callbacks: WidgetCallbacks;
  private locale: MushiLocale;
  private isOpen = false;
  private step: WidgetStep = 'category';
  /**
   * The selected category id. May be a built-in `MushiReportCategory` or a
   * custom id from `config.categories`. Cast to `MushiReportCategory` only
   * after resolving through `resolveBaseCategory()`.
   */
  private selectedCategory: string | null = null;
  private selectedIntent: string | null = null;
  /**
   * True when the user took the "Feature request" shortcut. We track this
   * separately from `selectedCategory='other'` so the Back button on the
   * details step jumps straight back to the category picker instead of
   * landing on the intent picker the user explicitly skipped.
   */
  private viaFeatureRequest = false;
  private screenshotAttached = false;
  private screenshotCapturing = false;
  private screenshotError = false;
  private allowScreenshotRemove = true;
  private elementSelected = false;
  private elementCapturing = false;
  private submitting = false;
  /** Hint element injected outside the shadow DOM during element selection. */
  private selectorHint: HTMLDivElement | null = null;
  private triggerVisible = true;
  private triggerShrunk = false;
  private triggerHiddenByScroll = false;
  /** Milliseconds since mount — used for the 30s first-time nudge gate. */
  private mountedAt: number | null = null;
  private nudgeShown = false;
  private nudgeEl: HTMLDivElement | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private sdkFreshness: { latest: string | null; current: string; deprecated: boolean; message?: string | null } | null = null;
  private reporterReports: MushiReporterReport[] = [];
  private featureBoard: Array<Record<string, unknown>> = [];
  private reporterComments: MushiReporterComment[] = [];
  private selectedReportId: string | null = null;
  private reporterLoading = false;
  private reporterError: string | null = null;
  private attachedLaunchers: Array<() => void> = [];
  private smartHideCleanup: (() => void) | null = null;
  private smartHideTimer: ReturnType<typeof setTimeout> | null = null;
  /** Captured at the moment of submit so the success ledger metadata
   *  ("REPORT · 14:23:07 JST") doesn't drift while the success step
   *  is on screen. */
  private submittedAt: Date | null = null;
  /** Pending success-state + auto-close timers. Tracked so destroy()
   *  can clear them — otherwise a host that unmounts mid-submit leaks
   *  this MushiWidget reference (and re-renders into a detached shadow
   *  root) for up to ~3.3s after destroy. */
  private successTimer: ReturnType<typeof setTimeout> | null = null;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private rewardsState: WidgetRewardsState | null = null;
  private leaderboardEntries: Array<{
    display_name: string;
    tier_name: string | null;
    total_points: number;
    points_30d: number;
  }> | null = null;
  private leaderboardLoading = false;
  /** Server-confirmed id for the just-submitted report. Surfaces in
   *  the success step as a copyable receipt + optional deep link to
   *  the Mushi console (when `dashboardUrl` is configured). Cleared
   *  on every new `open()` so a re-opened widget never reuses a
   *  stale id from the previous session. */
  private lastReportId: string | null = null;
  /** True when the just-submitted report was queued offline (no
   *  network, or the API errored and went into the retry queue).
   *  Drives a different success copy so the user knows the report
   *  hasn't actually reached the console yet. */
  private lastSubmitQueuedOffline = false;
  /** Whether the user has clicked ✕ on the header banner this session. */
  private bannerDismissed = false;

  constructor(config: MushiWidgetConfig = {}, callbacks: WidgetCallbacks, private readonly sdkVersion = '0.7.0') {
    this.config = {
      position: config.position ?? 'bottom-right',
      anchor: config.anchor ?? {},
      theme: config.theme ?? 'auto',
      // Falsy-OR (NOT `??`) on purpose: `triggerText: ''` is semantically
      // nonsense — it would render a labelless, glyphless trigger button
      // that users can't see or aim at. Treat empty string the same as
      // omitted so any caller that wires this to a cleared form input or
      // pastes a legacy snippet that emitted `triggerText: ""` (see
      // apps/admin/src/lib/sdkSnippets.ts widgetLines history) still gets
      // the default 🐛 and a visible button.
      triggerText: config.triggerText || '\uD83D\uDC1B',
      expandedTitle: config.expandedTitle ?? '',
      mode: config.mode ?? 'conversational',
      locale: config.locale ?? 'auto',
      zIndex: config.zIndex ?? 99999,
      trigger: config.trigger ?? 'auto',
      bannerConfig: config.bannerConfig ?? {},
      attachToSelector: config.attachToSelector ?? '',
      inset: config.inset ?? {},
      respectSafeArea: config.respectSafeArea ?? true,
      hideOnSelector: config.hideOnSelector ?? '',
      hideOnRoutes: config.hideOnRoutes ?? [],
      environments: config.environments ?? {},
      smartHide: config.smartHide ?? false,
      draggable: config.draggable ?? false,
      brandFooter: config.brandFooter ?? true,
      outdatedBanner: config.outdatedBanner ?? 'auto',
      betaMode: config.betaMode ?? {},
      minDescriptionLength: config.minDescriptionLength ?? 20,
      dashboardUrl: config.dashboardUrl ?? '',
      responseSlaLabel: config.responseSlaLabel ?? '',
      featureRequestCard: config.featureRequestCard ?? true,
      featureRequestLabel: config.featureRequestLabel ?? '',
      featureRequestDescription: config.featureRequestDescription ?? '',
      avoidSelectors: config.avoidSelectors ?? [],
      categories: config.categories ?? [],
    };
    this.callbacks = callbacks;
    // Passing undefined when locale is 'auto' lets getLocale() resolve via
    // navigator.language automatically.
    this.locale = getLocale(this.config.locale === 'auto' ? undefined : this.config.locale);

    this.host = document.createElement('div');
    this.host.id = 'mushi-mushi-widget';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
  }

  mount(): void {
    if (this.host.isConnected) return;
    this.syncHostChromeState();
    document.body.appendChild(this.host);
    this.syncAttachedLaunchers();
    this.syncSmartHide();
    this.render();
    this.mountedAt = Date.now();
  }

  getIsMounted(): boolean {
    return this.host.isConnected;
  }

  updateConfig(config: MushiWidgetConfig = {}): void {
    this.config = {
      ...this.config,
      ...(config.position ? { position: config.position } : {}),
      ...(config.anchor !== undefined ? { anchor: config.anchor } : {}),
      ...(config.theme ? { theme: config.theme } : {}),
      ...(config.triggerText !== undefined ? { triggerText: config.triggerText || '\uD83D\uDC1B' } : {}),
      ...(config.expandedTitle !== undefined ? { expandedTitle: config.expandedTitle } : {}),
      ...(config.mode ? { mode: config.mode } : {}),
      ...(config.locale ? { locale: config.locale } : {}),
      ...(config.zIndex !== undefined ? { zIndex: config.zIndex } : {}),
      ...(config.trigger ? { trigger: config.trigger } : {}),
      ...(config.attachToSelector !== undefined ? { attachToSelector: config.attachToSelector } : {}),
      ...(config.inset !== undefined ? { inset: config.inset } : {}),
      ...(config.respectSafeArea !== undefined ? { respectSafeArea: config.respectSafeArea } : {}),
      ...(config.hideOnSelector !== undefined ? { hideOnSelector: config.hideOnSelector } : {}),
      ...(config.hideOnRoutes !== undefined ? { hideOnRoutes: config.hideOnRoutes } : {}),
      ...(config.environments !== undefined ? { environments: config.environments } : {}),
      ...(config.smartHide !== undefined ? { smartHide: config.smartHide } : {}),
      ...(config.draggable !== undefined ? { draggable: config.draggable } : {}),
      ...(config.brandFooter !== undefined ? { brandFooter: config.brandFooter } : {}),
      ...(config.outdatedBanner !== undefined ? { outdatedBanner: config.outdatedBanner } : {}),
      ...(config.betaMode !== undefined ? { betaMode: config.betaMode } : {}),
      ...(config.minDescriptionLength !== undefined ? { minDescriptionLength: config.minDescriptionLength } : {}),
      ...(config.dashboardUrl !== undefined ? { dashboardUrl: config.dashboardUrl } : {}),
      ...(config.responseSlaLabel !== undefined ? { responseSlaLabel: config.responseSlaLabel } : {}),
      ...(config.featureRequestCard !== undefined ? { featureRequestCard: config.featureRequestCard } : {}),
      ...(config.featureRequestLabel !== undefined ? { featureRequestLabel: config.featureRequestLabel } : {}),
      ...(config.featureRequestDescription !== undefined ? { featureRequestDescription: config.featureRequestDescription } : {}),
      // Runtime/dashboard config delivers bannerMessage/bannerLabel via
      // mergeRuntimeConfig → bannerConfig. The widget is constructed before
      // that fetch resolves, so this pass-through is what makes server-driven
      // banner copy actually render.
      ...(config.bannerConfig !== undefined ? { bannerConfig: config.bannerConfig } : {}),
      ...(config.categories !== undefined ? { categories: config.categories } : {}),
    };
    this.locale = getLocale(this.config.locale === 'auto' ? undefined : this.config.locale);
    // Re-sync host chrome in case zIndex changed.
    if (this.host.isConnected) this.syncHostChromeState();
    this.syncAttachedLaunchers();
    this.syncSmartHide();
    this.render();
  }

  // ─── Custom category helpers ──────────────────────────────────────────────

  /** Find a custom category entry by id. Returns undefined for built-in ids. */
  private resolveCustomCategory(id: string): MushiCustomCategory | undefined {
    return this.config.categories?.find((c) => c.id === id);
  }

  /**
   * Map a (possibly custom) category id to the built-in `MushiReportCategory`
   * used for the report wire format. Falls back to `'other'`.
   */
  private resolveBaseCategory(id: string): MushiReportCategory {
    const BUILTIN: MushiReportCategory[] = ['bug', 'slow', 'visual', 'confusing', 'other'];
    if (BUILTIN.includes(id as MushiReportCategory)) return id as MushiReportCategory;
    const custom = this.resolveCustomCategory(id);
    return custom?.baseCategory ?? 'other';
  }

  /** Icon for the selected category — custom entry's icon or built-in emoji. */
  private categoryIcon(id: string): string {
    const custom = this.resolveCustomCategory(id);
    if (custom?.icon) return custom.icon;
    return CATEGORY_ICONS[id as MushiReportCategory] ?? '💬';
  }

  /** Label for the selected category — custom entry label or built-in i18n string. */
  private categoryLabel(id: string): string {
    const custom = this.resolveCustomCategory(id);
    if (custom) return custom.label;
    const t = this.locale;
    return t.step1.categories[id as MushiReportCategory] ?? id;
  }

  // ─── Open / close ─────────────────────────────────────────────────────────

  open(options?: { category?: MushiReportCategory | string; featureRequest?: boolean }): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.screenshotAttached = false;
    this.screenshotCapturing = false;
    this.screenshotError = false;
    this.elementSelected = false;
    this.elementCapturing = false;
    this.submitting = false;
    this.submittedAt = null;
    this.removeSelectorHint();
    this.lastReportId = null;
    this.lastSubmitQueuedOffline = false;
    this.viaFeatureRequest = false;

    if (options?.featureRequest) {
      // External callers can deep-link straight into the feature-request
      // shortcut, e.g. a "Suggest a feature" button on the marketing page.
      this.selectedCategory = 'other';
      this.selectedIntent = FEATURE_REQUEST_INTENT;
      this.viaFeatureRequest = true;
      this.step = 'details';
    } else if (options?.category) {
      this.selectedCategory = options.category;
      this.selectedIntent = null;
      // Custom categories with no intents go straight to the description step.
      const custom = this.resolveCustomCategory(options.category);
      this.step = (custom && (!custom.intents || custom.intents.length === 0)) ? 'details' : 'intent';
    } else {
      this.selectedCategory = null;
      this.selectedIntent = null;
      this.step = 'category';
    }

    this.render();
    this.callbacks.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.render();
    this.callbacks.onClose();
  }

  /**
   * Briefly highlight the trigger button (a soft pulse + tooltip) without
   * opening the full reporter panel. Use for first-session welcome nudges
   * and other "by the way, this exists" prompts where forcing the panel
   * open would feel aggressive. Honours `position: 'none'` (no-op when
   * the trigger button is hidden).
   */
  pulseTrigger(): void {
    if (this.isOpen) return;
    const trigger = this.shadow.querySelector<HTMLButtonElement>('.mushi-trigger');
    // No-op if the trigger element is hidden (e.g. host app uses
    // `triggerVisible: false` for a custom launcher); the pulse only
    // makes sense when the user can actually see what we're highlighting.
    if (!trigger) return;
    trigger.classList.add('mushi-trigger-pulse');
    // Auto-clear after the animation finishes so a subsequent pulse can
    // restart it cleanly. Three pulses x 800ms = 2.4s total.
    window.setTimeout(() => {
      trigger.classList.remove('mushi-trigger-pulse');
    }, 2400);
  }

  getIsOpen(): boolean {
    return this.isOpen;
  }

  showTrigger(): void {
    this.triggerVisible = true;
    this.render();
  }

  hideTrigger(): void {
    this.triggerVisible = false;
    this.render();
  }

  setTrigger(trigger: NonNullable<MushiWidgetConfig['trigger']>): void {
    this.updateConfig({ trigger });
  }

  attachTo(selectorOrElement: string | Element, options: MushiWidgetConfig = {}): () => void {
    const elements = typeof selectorOrElement === 'string'
      ? Array.from(document.querySelectorAll(selectorOrElement))
      : [selectorOrElement];
    const cleanups = elements.map((el) => {
      const onClick = (event: Event) => {
        event.preventDefault();
        this.updateConfig(options);
        this.open();
      };
      el.addEventListener('click', onClick);
      return () => el.removeEventListener('click', onClick);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }

  setScreenshotAttached(attached: boolean): void {
    this.screenshotAttached = attached;
    if (this.isOpen) this.render();
  }

  setAllowScreenshotRemove(allow: boolean): void {
    this.allowScreenshotRemove = allow;
    if (this.isOpen) this.render();
  }

  setElementSelected(selected: boolean): void {
    this.elementSelected = selected;
    this.elementCapturing = false;
    this.removeSelectorHint();
    if (this.isOpen) this.render();
  }

  setScreenshotCapturing(capturing: boolean): void {
    this.screenshotCapturing = capturing;
    this.screenshotError = false;
    if (this.isOpen) this.render();
  }

  setScreenshotError(failed: boolean): void {
    this.screenshotError = failed;
    this.screenshotCapturing = false;
    if (this.isOpen) this.render();
  }

  setElementCapturing(capturing: boolean): void {
    this.elementCapturing = capturing;
    if (capturing) {
      this.showSelectorHint();
    } else {
      this.removeSelectorHint();
    }
    if (this.isOpen) this.render();
  }

  /** Hide the widget panel (but keep the host element) during element selection
   *  so the user can click any element on the page without the panel
   *  intercepting the event. */
  hidePanel(): void {
    const panel = this.shadow.querySelector('.mushi-panel') as HTMLElement | null;
    if (panel) panel.style.display = 'none';
  }

  showPanel(): void {
    const panel = this.shadow.querySelector('.mushi-panel') as HTMLElement | null;
    if (panel) panel.style.display = '';
  }

  private showSelectorHint(): void {
    this.removeSelectorHint();
    const hint = document.createElement('div');
    hint.id = 'mushi-selector-hint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    hint.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483646;
      background: rgba(17,17,17,0.92);
      color: #fff;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 12px;
      letter-spacing: 0.04em;
      padding: 8px 16px;
      border-radius: 20px;
      pointer-events: none;
      white-space: nowrap;
      backdrop-filter: blur(4px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.35);
    `;
    hint.textContent = this.locale.step3.elementSelectorHint;
    document.body.appendChild(hint);
    this.selectorHint = hint;
  }

  private removeSelectorHint(): void {
    this.selectorHint?.remove();
    this.selectorHint = null;
    // Also remove any orphaned hints from previous sessions.
    document.getElementById('mushi-selector-hint')?.remove();
  }

  private showNudge(): void {
    if (this.nudgeShown || this.nudgeEl) return;
    this.nudgeShown = true;

    // Find the trigger position to anchor the bubble.
    const trigger = this.shadow.querySelector('.mushi-trigger') as HTMLElement | null;
    const rect = trigger?.getBoundingClientRect();

    const nudge = document.createElement('div');
    nudge.id = 'mushi-nudge-bubble';
    nudge.setAttribute('role', 'tooltip');
    const isRight = this.config.position.includes('right');
    nudge.style.cssText = `
      position: fixed;
      z-index: 2147483645;
      ${rect
        ? `bottom: ${window.innerHeight - rect.top + 8}px; ${isRight ? `right: ${window.innerWidth - rect.right}px;` : `left: ${rect.left}px;`}`
        : 'bottom: 80px; right: 24px;'}
      background: rgba(17,17,17,0.92);
      color: #fff;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 200px;
      pointer-events: none;
      backdrop-filter: blur(4px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.35);
      animation: mushi-fade-in 0.15s ease forwards;
    `;
    nudge.textContent = this.locale.step3.tooShort.startsWith('A bit')
      ? "Found a bug? One sentence is enough \uD83D\uDC1B"
      : "\u30D0\u30B0\u3092\u898B\u3064\u3051\u305F\uFF1F\u4E00\u884C\u3067\u5927\u4E08\u592B\u3067\u3059 \uD83D\uDC1B";
    document.body.appendChild(nudge);
    this.nudgeEl = nudge;

    // Auto-remove after 5s.
    if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => this.removeNudge(), 5000);
  }

  private removeNudge(): void {
    if (this.nudgeTimer !== null) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    this.nudgeEl?.remove();
    this.nudgeEl = null;
    document.getElementById('mushi-nudge-bubble')?.remove();
  }

  setSdkFreshness(info: { latest: string | null; current: string; deprecated: boolean; message?: string | null }): void {
    this.sdkFreshness = info;
    if (this.isOpen) this.render();
  }

  setRewardsState(state: WidgetRewardsState | null): void {
    this.rewardsState = state;
    if (this.isOpen) this.render();
  }

  setLeaderboard(entries: Array<{ display_name: string; tier_name: string | null; total_points: number; points_30d: number; }> | null, loading = false): void {
    this.leaderboardEntries = entries;
    this.leaderboardLoading = loading;
    if (this.isOpen && this.step === 'leaderboard') this.render();
  }

  destroy(): void {
    if (this.successTimer !== null) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    if (this.smartHideTimer !== null) {
      clearTimeout(this.smartHideTimer);
      this.smartHideTimer = null;
    }
    this.smartHideCleanup?.();
    this.smartHideCleanup = null;
    this.attachedLaunchers.forEach((cleanup) => cleanup());
    this.attachedLaunchers = [];
    this.removeSelectorHint();
    this.removeNudge();
    this.removeBodyNudge();
    this.host.remove();
  }

  /* ── Host chrome contract ────────────────────────────────────────────────
     The host element must never create an invisible full-screen touch blocker.
     We own these inline styles — consumer CSS can only win with `!important`,
     which is explicitly banned by the SDK contract. Calling this at mount()
     and after every zIndex update is the only safe invariant. */

  /**
   * Apply the SDK-owned pass-through layout to the host element so it is
   * always zero-sized and click/touch-transparent. Only the shadow-root
   * internals (`.mushi-trigger`, `.mushi-banner`, `.mushi-panel`) opt back
   * into pointer events.  This is idempotent and safe to call repeatedly.
   */
  private syncHostChromeState(): void {
    const s = this.host.style;
    s.setProperty('position', 'fixed');
    s.setProperty('top', '0');
    s.setProperty('left', '0');
    s.setProperty('width', '0');
    s.setProperty('height', '0');
    s.setProperty('overflow', 'visible');
    s.setProperty('pointer-events', 'none');
    s.setProperty('z-index', String(this.config.zIndex));
    s.setProperty('margin', '0');
    s.setProperty('padding', '0');
    s.setProperty('border', 'none');
    s.setProperty('background', 'none');
  }

  /**
   * Returns true when a DOM element matching `hideOnSelector` is currently
   * present in the host document.  Used by both the trigger and the banner
   * so a single selector consistently hides ALL SDK-injected launcher
   * surfaces.  Invalid selectors are swallowed silently (non-fatal).
   */
  private isSuppressedByHost(): boolean {
    if (!this.config.hideOnSelector || typeof document === 'undefined') return false;
    try {
      return Boolean(document.querySelector(this.config.hideOnSelector));
    } catch {
      return false;
    }
  }

  /**
   * Returns a snapshot of the widget's host-layer health for use in
   * `Mushi.diagnose()`.  Callers check this to know whether the widget
   * could ever block host-app UI without opening a browser devtools.
   */
  getWidgetDiagnostics(): {
    widgetHostPointerSafe: boolean;
    widgetHostBounds: { width: number; height: number } | null;
    widgetSuppressed: boolean;
    bannerRendered: boolean;
  } {
    const s = this.host.style;
    const widgetHostPointerSafe =
      s.pointerEvents === 'none' &&
      (s.width === '0' || s.width === '0px') &&
      (s.height === '0' || s.height === '0px');

    const widgetHostBounds = this.host.isConnected
      ? { width: this.host.offsetWidth, height: this.host.offsetHeight }
      : null;

    const widgetSuppressed =
      this.isSuppressedByHost() || this.isRouteHidden() || !this.triggerVisible;

    const bannerRendered =
      this.config.trigger === 'banner' &&
      !this.bannerDismissed &&
      !this.isSuppressedByHost() &&
      !this.isRouteHidden() &&
      this.triggerVisible;

    return { widgetHostPointerSafe, widgetHostBounds, widgetSuppressed, bannerRendered };
  }

  private syncAttachedLaunchers(): void {
    this.attachedLaunchers.forEach((cleanup) => cleanup());
    this.attachedLaunchers = [];
    if (this.config.trigger !== 'attach' || !this.config.attachToSelector) return;
    if (typeof document === 'undefined') return;
    this.attachedLaunchers.push(this.attachTo(this.config.attachToSelector));
  }

  private syncSmartHide(): void {
    this.smartHideCleanup?.();
    this.smartHideCleanup = null;
    this.triggerShrunk = false;
    this.triggerHiddenByScroll = false;
    if (!this.config.smartHide || typeof window === 'undefined') return;

    const smart = this.config.smartHide === true
      ? { onMobile: 'edge-tab' as const, onScroll: 'shrink' as const, onIdleMs: 900 }
      : this.config.smartHide;
    if (!smart.onScroll) return;

    const onScroll = () => {
      if (smart.onScroll === 'hide') {
        this.triggerHiddenByScroll = true;
      } else {
        this.triggerShrunk = true;
      }
      this.render();
      if (this.smartHideTimer !== null) clearTimeout(this.smartHideTimer);
      this.smartHideTimer = setTimeout(() => {
        this.triggerHiddenByScroll = false;
        this.triggerShrunk = false;
        this.render();
      }, smart.onIdleMs ?? 900);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    this.smartHideCleanup = () => window.removeEventListener('scroll', onScroll);
  }

  private shouldRenderTrigger(): boolean {
    if (!this.triggerVisible) return false;
    if (this.triggerHiddenByScroll) return false;
    if (
      this.config.trigger === 'manual' ||
      this.config.trigger === 'hidden' ||
      this.config.trigger === 'attach' ||
      this.config.trigger === 'banner'
    ) {
      return false;
    }
    if (this.isMobileSmartHidden()) return false;
    if (this.isRouteHidden()) return false;
    if (this.isSuppressedByHost()) return false;
    const action = this.config.environments[this.detectEnvironment()];
    return action !== 'never' && action !== 'manual';
  }

  /** Height of the banner in px — kept in sync with the CSS `.mushi-banner` height (36px). */
  private static readonly BANNER_HEIGHT = 36;

  /** CSS property applied to document.body so host-app content doesn't slide under the banner. */
  private static readonly BODY_NUDGE_PROP = '--mushi-banner-offset';

  private applyBodyNudge(position: 'top' | 'bottom'): void {
    const h = `${MushiWidget.BANNER_HEIGHT}px`;
    if (position === 'top') {
      document.documentElement.style.setProperty(MushiWidget.BODY_NUDGE_PROP, h);
      // Only nudge if the host hasn't already set an explicit body padding-top
      // (check inline style only — computed style includes CSS rules we shouldn't clobber).
      if (!document.body.style.paddingTop) {
        document.body.style.paddingTop = h;
        document.body.dataset.mushiBannerNudged = 'top';
      }
    } else {
      document.documentElement.style.setProperty(MushiWidget.BODY_NUDGE_PROP, h);
      if (!document.body.style.paddingBottom) {
        document.body.style.paddingBottom = h;
        document.body.dataset.mushiBannerNudged = 'bottom';
      }
    }
  }

  private removeBodyNudge(): void {
    document.documentElement.style.removeProperty(MushiWidget.BODY_NUDGE_PROP);
    const nudged = document.body.dataset.mushiBannerNudged;
    if (nudged === 'top') {
      document.body.style.paddingTop = '';
      delete document.body.dataset.mushiBannerNudged;
    } else if (nudged === 'bottom') {
      document.body.style.paddingBottom = '';
      delete document.body.dataset.mushiBannerNudged;
    }
  }

  private renderBanner(): void {
    if (this.config.trigger !== 'banner') return;
    if (this.bannerDismissed) { this.removeBodyNudge(); return; }
    // Clear nudge before early returns so sdk.hide() / route suppression don't
    // leave the host page with permanent padding-top/bottom.
    if (!this.triggerVisible) { this.removeBodyNudge(); return; }
    if (this.isRouteHidden()) { this.removeBodyNudge(); return; }
    // hideOnSelector must suppress the banner too — the trigger check already
    // uses isSuppressedByHost(), so this keeps both surfaces in sync.
    if (this.isSuppressedByHost()) { this.removeBodyNudge(); return; }

    const bc = this.config.bannerConfig ?? {};
    const variant  = bc.variant  ?? 'brand';
    const position = bc.position ?? 'top';
    const message  = bc.message?.trim() ?? '';
    const richLayout = message.length > 0;
    const bugLabel = bc.bugCta   ?? '🐛 Report a bug';
    const showFeat = bc.featureCta !== false;
    const featLabel = bc.featureCtaLabel ?? '✨ Request feature';
    const zIdx = bc.zIndex ?? (this.config.zIndex ?? 99999) - 1;

    const banner = document.createElement('div');
    banner.className = `mushi-banner ${variant} ${position}${richLayout ? ' mushi-banner--rich' : ''}`;
    banner.style.setProperty('--mushi-banner-z', String(zIdx));
    banner.setAttribute('role', 'banner');

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'mushi-banner-dismiss';
    dismissBtn.textContent = '✕';
    dismissBtn.setAttribute('aria-label', 'Dismiss feedback banner');
    dismissBtn.addEventListener('click', () => {
      this.bannerDismissed = true;
      this.removeBodyNudge();
      this.render();
    });

    if (richLayout) {
      const body = document.createElement('div');
      body.className = 'mushi-banner-body';

      const labelText = bc.label === false ? null : (bc.label ?? 'Beta');
      if (labelText) {
        const pill = document.createElement('span');
        pill.className = 'mushi-banner-pill';
        pill.textContent = labelText;
        body.appendChild(pill);
      }

      const msg = document.createElement('span');
      msg.className = 'mushi-banner-message';
      msg.textContent = message;
      body.appendChild(msg);
      banner.appendChild(body);

      const nav = document.createElement('nav');
      nav.className = 'mushi-banner-actions';
      nav.setAttribute('aria-label', 'Feedback banner actions');

      // `extra` marks secondary actions hidden on narrow viewports so the
      // primary bug CTA + dismiss always stay reachable on phones.
      const appendDivider = (extra = false) => {
        const sep = document.createElement('span');
        sep.className = `mushi-banner-divider${extra ? ' mushi-banner-extra' : ''}`;
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '|';
        nav.appendChild(sep);
      };

      const appendAction = (label: string, onClick: () => void, extra = false) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `mushi-banner-link${extra ? ' mushi-banner-extra' : ''}`;
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        nav.appendChild(btn);
      };

      appendAction(bugLabel, () => this.open());
      if (showFeat) {
        appendDivider(true);
        appendAction(featLabel, () => this.open({ featureRequest: true }), true);
      }

      for (const link of bc.links ?? []) {
        const linkLabel = link.label?.trim();
        if (!linkLabel) continue;
        // Defense-in-depth: only http(s) and same-origin paths may render as
        // anchors. If banner links ever become remotely configurable, a
        // `javascript:` href here would be stored XSS in every embedding site.
        const href = link.href && (/^https?:\/\//i.test(link.href) || link.href.startsWith('/'))
          ? link.href
          : undefined;
        appendDivider(true);
        if (href) {
          const anchor = document.createElement('a');
          anchor.className = 'mushi-banner-link mushi-banner-extra';
          anchor.href = href;
          anchor.textContent = linkLabel;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          nav.appendChild(anchor);
        } else {
          appendAction(linkLabel, () => {
            if (link.featureRequest) this.open({ featureRequest: true });
            else this.open();
          }, true);
        }
      }

      banner.appendChild(nav);
      // Dismiss lives OUTSIDE the actions <nav>: it isn't navigation, and as
      // a direct flex child of the banner it can't be clipped off-screen when
      // the action row overflows on narrow viewports.
      banner.appendChild(dismissBtn);
    } else {
      const bugBtn = document.createElement('button');
      bugBtn.className = 'mushi-banner-btn';
      bugBtn.textContent = bugLabel;
      bugBtn.addEventListener('click', () => this.open());
      banner.appendChild(bugBtn);

      if (showFeat) {
        const featBtn = document.createElement('button');
        featBtn.className = 'mushi-banner-btn';
        featBtn.textContent = featLabel;
        featBtn.addEventListener('click', () => this.open({ featureRequest: true }));
        banner.appendChild(featBtn);
      }

      banner.appendChild(dismissBtn);
    }

    this.shadow.appendChild(banner);

    // Push body content so the banner doesn't overlap the host app's navigation.
    this.applyBodyNudge(position);
  }

  private effectiveTrigger(): NonNullable<MushiWidgetConfig['trigger']> {
    if (!this.config.smartHide || typeof window === 'undefined') return this.config.trigger;
    const smart = this.config.smartHide === true
      ? { onMobile: 'edge-tab' as const }
      : this.config.smartHide;
    if (window.matchMedia('(max-width: 768px)').matches && smart.onMobile === 'edge-tab') {
      return 'edge-tab';
    }
    return this.config.trigger;
  }

  private isMobileSmartHidden(): boolean {
    if (!this.config.smartHide || typeof window === 'undefined') return false;
    const smart = this.config.smartHide === true ? { onMobile: 'edge-tab' as const } : this.config.smartHide;
    return window.matchMedia('(max-width: 768px)').matches && smart.onMobile === 'hide';
  }

  private detectEnvironment(): 'production' | 'staging' | 'development' {
    const host = typeof location !== 'undefined' ? location.hostname : '';
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return 'development';
    if (/\b(staging|stage|preview|dev)\b/i.test(host)) return 'staging';
    return 'production';
  }

  private isRouteHidden(): boolean {
    if (!this.config.hideOnRoutes.length || typeof location === 'undefined') return false;
    return this.config.hideOnRoutes.some((route) => location.pathname.includes(route));
  }

  private getTheme(): 'light' | 'dark' {
    if (this.config.theme !== 'auto') return this.config.theme;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  private render(): void {
    const theme = this.getTheme();
    const pos = this.config.position;
    const t = this.locale;

    this.shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = getWidgetStyles(theme);
    this.shadow.appendChild(style);

    this.renderBanner();

    if (this.shouldRenderTrigger()) {
      const effectiveTrigger = this.effectiveTrigger();
      const trigger = document.createElement('button');
      trigger.className = `mushi-trigger ${pos}${effectiveTrigger === 'edge-tab' ? ' edge-tab' : ''}${this.triggerShrunk ? ' shrunk' : ''}`;
      trigger.textContent = this.config.triggerText;
      trigger.setAttribute('aria-label', t.widget.trigger);
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-expanded', String(this.isOpen));
      trigger.style.zIndex = String(this.config.zIndex);
      this.applyInsetVars(trigger);
      trigger.addEventListener('click', () => {
        this.removeNudge();
        if (this.isOpen) this.close();
        else this.open();
      });
      trigger.addEventListener('mouseenter', () => {
        const onPageMs = this.mountedAt ? Date.now() - this.mountedAt : 0;
        if (!this.nudgeShown && !this.isOpen && onPageMs >= 30_000) {
          this.showNudge();
        }
      });
      trigger.addEventListener('mouseleave', () => {
        // Keep for 2s after hover ends so the user can read it.
        if (this.nudgeEl) {
          if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
          this.nudgeTimer = setTimeout(() => this.removeNudge(), 2000);
        }
      });
      this.shadow.appendChild(trigger);
    }

    const panel = document.createElement('div');
    panel.className = `mushi-panel ${pos}${this.isOpen ? ' open' : ' closed'}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t.widget.title);
    panel.style.zIndex = String(this.config.zIndex + 1);
    this.applyInsetVars(panel);

    if (this.isOpen) {
      panel.innerHTML = `${this.renderOutdatedBanner()}${this.renderStep()}${this.renderBrandFooter()}`;
      this.shadow.appendChild(panel);
      this.attachHandlers(panel);
      this.trapFocus(panel);
    }
  }

  /**
   * Queries each `avoidSelectors` element in the host document and returns
   * the minimum top-offset in px so that a top-anchored element clears all
   * of them by `gap` pixels. Returns `null` when no selectors are provided
   * or no matching elements have a non-zero bounding rect.
   *
   * Runs in the host document (not shadow DOM) so it can reach fixed headers,
   * sticky nav bars, and sign-in CTAs.
   */
  private computeAvoidTopPx(gap = 8): number | null {
    const sels = this.config.avoidSelectors;
    if (!sels?.length) return null;
    let maxBottom = 0;
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // Only consider elements that are actually rendered (non-zero area)
        if (r.bottom > maxBottom && r.width > 0 && r.height > 0) {
          maxBottom = r.bottom;
        }
      } catch { /* invalid selector — skip silently */ }
    }
    return maxBottom > 0 ? Math.ceil(maxBottom) + gap : null;
  }

  private applyInsetVars(el: HTMLElement): void {
    const { anchor } = this.config;
    if (anchor && Object.keys(anchor).length > 0) {
      (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
        const value = anchor[edge];
        if (value !== undefined) el.style.setProperty(`--mushi-${edge}`, value);
      });
      el.style.setProperty('--mushi-safe-area', this.config.respectSafeArea ? '1' : '0');
    } else {
      const { inset } = this.config;
      if (!this.config.respectSafeArea) {
        (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
          if (inset[edge] === undefined) el.style.setProperty(`--mushi-${edge}`, '24px');
        });
      }
      (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
        const value = inset[edge];
        if (value === undefined) return;
        el.style.setProperty(`--mushi-${edge}`, value === 'auto' ? 'auto' : `${value}px`);
      });
      el.style.setProperty('--mushi-safe-area', this.config.respectSafeArea ? '1' : '0');
    }

    // Override --mushi-top with measured clearance when avoidSelectors is set.
    // This runs after anchor/inset so it always wins when an avoided element is present.
    // Only applies when the element is top-anchored (top CSS var or top-* position class).
    const isTopAnchored =
      anchor?.top !== undefined ||
      this.config.position?.startsWith('top') ||
      (!this.config.position && !anchor?.bottom); // default position is bottom-right
    if (isTopAnchored) {
      const avoidPx = this.computeAvoidTopPx();
      if (avoidPx !== null) {
        el.style.setProperty('--mushi-top', `${avoidPx}px`);
      }
    }
  }

  private renderStep(): string {
    switch (this.step) {
      case 'category': return this.renderCategoryStep();
      case 'intent': return this.renderIntentStep();
      case 'details': return this.renderDetailsStep();
      case 'success': return this.renderSuccessStep();
      case 'reports': return this.renderReportsStep();
      case 'report-detail': return this.renderReportDetailStep();
      case 'leaderboard': return this.renderLeaderboardStep();
      case 'roadmap': return this.renderRoadmapStep();
    }
  }

  private renderOutdatedBanner(): string {
    if (!this.sdkFreshness) return '';
    if (this.config.outdatedBanner === 'off' || this.config.outdatedBanner === 'console-only') return '';
    const { latest, current, deprecated, message } = this.sdkFreshness;
    if (!latest && !deprecated) return '';
    return `
      <div class="mushi-outdated" role="status">
        <strong>Mushi SDK ${escapeHtml(current)}</strong>
        ${latest ? `latest is ${escapeHtml(latest)}.` : 'needs attention.'}
        ${message ? `<span>${escapeHtml(message)}</span>` : ''}
      </div>
    `;
  }

  private renderBrandFooter(): string {
    if (this.config.brandFooter === false) return '';
    return `<div class="mushi-brand-footer">Powered by Mushi v${escapeHtml(this.sdkVersion)}</div>`;
  }

  /**
   * Editorial masthead. Always carries:
   *   • the brand mark (虫 kanji on vermillion, "MUSHI" in mono above)
   *   • the page title (serif display)
   *   • the close affordance
   *
   * On sub-steps it additionally renders a back button (replacing the
   * "MUSHI" eyebrow with a "← BACK" mono link) and a step counter
   * ledger ("02 / 03") on the far right.
   */
  private renderHeader(opts: {
    title: string;
    showBack?: boolean;
    step?: number;
    eyebrow?: string;
  }): string {
    const t = this.locale;
    const { title, showBack = false, step, eyebrow } = opts;

    const eyebrowHtml = showBack
      ? `<button type="button" class="mushi-back" data-action="back" aria-label="${t.widget.back}">\u2190</button>`
      : `<span class="mushi-header-eyebrow">${eyebrow ?? 'Mushi \u00B7 Report'}</span>`;

    const counterHtml = step
      ? `<span class="mushi-step-counter" aria-label="Step ${step} of ${TOTAL_STEPS}"><b>${pad2(step)}</b> / ${pad2(TOTAL_STEPS)}</span>`
      : '';

    return `
      <div class="mushi-header">
        <div class="mushi-header-mark" aria-hidden="true">\u866B</div>
        <div class="mushi-header-titles">
          ${eyebrowHtml}
          <h3>${title}</h3>
        </div>
        <div class="mushi-header-meta">
          ${counterHtml}
          <button type="button" class="mushi-close" data-action="close" aria-label="${t.widget.close}">\u2715</button>
        </div>
      </div>
    `;
  }

  /**
   * Numeral step indicator: "01 — 02 — 03", with the active step in
   * vermillion serif and completed steps struck through in mono.
   * Replaces the original three-dot indicator (a generic SaaS pattern).
   */
  private renderStepIndicator(currentStep: number): string {
    const segments: string[] = [];
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const cls =
        i < currentStep ? 'mushi-step-num done' :
        i === currentStep ? 'mushi-step-num active' :
        'mushi-step-num';
      segments.push(`<span class="${cls}">${pad2(i)}</span>`);
      if (i < TOTAL_STEPS) segments.push('<span class="mushi-step-sep" aria-hidden="true"></span>');
    }
    return `<div class="mushi-step-indicator" aria-hidden="true">${segments.join('')}</div>`;
  }

  private renderCategoryStep(): string {
    const t = this.locale;
    // When the host supplies custom categories, render those instead of the
    // built-in five. The feature-request shortcut is still shown above them
    // unless explicitly disabled (consistent UX regardless of category set).
    const categoryEntries: Array<{ id: string; icon: string; label: string; desc: string }> =
      this.config.categories && this.config.categories.length > 0
        ? this.config.categories.map((c) => ({
            id: c.id,
            icon: c.icon ?? '💬',
            label: c.label,
            desc: c.description ?? '',
          }))
        : (['bug', 'slow', 'visual', 'confusing', 'other'] as MushiReportCategory[]).map((id) => ({
            id,
            icon: CATEGORY_ICONS[id],
            label: t.step1.categories[id],
            desc: t.step1.categoryDescriptions[id],
          }));

    const categories = categoryEntries
      .map(({ id, icon, label, desc }) => `
        <button type="button" class="mushi-option-btn" data-category="${escapeHtml(id)}" role="radio" aria-checked="false">
          <span class="mushi-option-icon" aria-hidden="true">${icon}</span>
          <div class="mushi-option-text">
            <span class="mushi-option-label">${escapeHtml(label)}</span>
            ${desc ? `<span class="mushi-option-desc">${escapeHtml(desc)}</span>` : ''}
          </div>
          <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
        </button>
      `).join('');

    return `
      ${this.renderHeader({ title: t.step1.heading, step: STEP_NUMBER.category })}
      ${this.config.betaMode?.enabled ? this.renderBetaStrip() : ''}
      <div class="mushi-body" role="radiogroup" aria-label="${t.step1.heading}">
        <button type="button" class="mushi-option-btn mushi-reports-entry" data-action="reports">
          <span class="mushi-option-icon" aria-hidden="true">\uD83D\uDCEC</span>
          <div class="mushi-option-text">
            <span class="mushi-option-label">Your reports${this.unreadCount() ? ` (${this.unreadCount()} new)` : ''}</span>
            <span class="mushi-option-desc">See status, developer replies, and respond</span>
          </div>
          <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
        </button>
        ${this.renderFeatureRequestEntry()}
        ${this.callbacks.onFeatureBoardRequest ? `
        <button type="button" class="mushi-option-btn" data-action="roadmap">
          <span class="mushi-option-icon" aria-hidden="true">\uD83D\uDDF3\uFE0F</span>
          <div class="mushi-option-text">
            <span class="mushi-option-label">Community ideas</span>
            <span class="mushi-option-desc">Vote on features and see what shipped</span>
          </div>
          <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
        </button>` : ''}
        ${categories}
        ${this.rewardsState ? this.renderRewardsNudge() : ''}
      </div>
      ${this.renderStepIndicator(STEP_NUMBER.category)}
    `;
  }

  /**
   * First-class "Feature request" entry rendered at the top of the
   * category step. Beta apps consistently get more useful signal when
   * the user has a no-friction path to say "I wish this did X" — burying
   * it as an intent under the "Other" category drops feature submissions
   * by ~40% in industry studies (Userpilot, Usersnap 2025).
   *
   * Wire format: still routes through the standard `other` category with
   * a `user_category = 'Feature request'` stamp, so we don't need a DB
   * migration. The admin console filters on that string to surface the
   * Feature-request swimlane.
   */
  private renderFeatureRequestEntry(): string {
    const enabled = this.config.featureRequestCard !== false;
    if (!enabled) return '';
    const label = this.config.featureRequestLabel ?? 'Feature request';
    const desc = this.config.featureRequestDescription
      ?? 'Suggest something new — even rough ideas help us prioritise';
    return `
      <button
        type="button"
        class="mushi-option-btn mushi-feature-entry"
        data-action="feature-request"
        aria-label="${escapeHtml(label)}"
      >
        <span class="mushi-option-icon" aria-hidden="true">\u2728</span>
        <div class="mushi-option-text">
          <span class="mushi-option-label">${escapeHtml(label)}</span>
          <span class="mushi-option-desc">${escapeHtml(desc)}</span>
        </div>
        <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
      </button>
    `;
  }

  /** Collapsible "What's new" changelog row. Closes the reporter feedback loop. */
  private renderBetaChangelog(): string {
    const entries = this.config.betaMode?.changelogItems;
    if (!entries?.length) return '';
    const latest = entries[0];
    const items = latest.items.map((item) => `<li>\u2022 ${escapeHtml(item)}</li>`).join('');
    const label = latest.date
      ? `What\u2019s new in ${escapeHtml(latest.version)} \u00B7 ${escapeHtml(latest.date)}`
      : `What\u2019s new in ${escapeHtml(latest.version)}`;
    return `
      <details class="mushi-changelog">
        <summary class="mushi-changelog-summary">${label}</summary>
        <ul class="mushi-changelog-list">${items}</ul>
      </details>
    `;
  }

  /**
   * Discreet beta status strip: communicates "work in progress", invites
   * feedback, and sets expectations — reducing user frustration while
   * nudging the reciprocity instinct ("your reports help us build this").
   */
  private renderBetaStrip(): string {
    const beta = this.config.betaMode!;
    const appName = escapeHtml(beta.appName ?? 'This app');
    const message = beta.message
      ? escapeHtml(beta.message)
      : `${appName} is in early development — updates ship weekly`;
    const email = beta.contactEmail ? escapeHtml(beta.contactEmail) : null;
    const perks = beta.perks ?? [];

    return `
      <div class="mushi-beta-strip" role="note" aria-label="Beta status">
        <div class="mushi-beta-strip-row">
          <span class="mushi-beta-tag" aria-hidden="true">BETA</span>
          <span class="mushi-beta-msg">${message}</span>
        </div>
        ${email ? `<div class="mushi-beta-contact-hint">Reports go to ${email} · reviewed by the team</div>` : ''}
        ${perks.length > 0 ? `
          <ul class="mushi-beta-perks" aria-label="Beta tester perks">
            ${perks.map((p) => `<li>\u2713 ${escapeHtml(p)}</li>`).join('')}
          </ul>
        ` : ''}
        ${this.renderBetaChangelog()}
      </div>
    `;
  }

  private renderReportsStep(): string {
    const reports = this.reporterReports.map((report) => {
      const title = report.summary ?? report.description ?? `Report ${report.id.slice(0, 8)}`;
      const tone = reporterStatusTone(report.status);
      const when = formatRelativeTime(report.created_at);
      const unread = report.unread_count && report.unread_count > 0
        ? `<span class="mushi-unread-badge" aria-label="${report.unread_count} unread">${report.unread_count}</span>`
        : '';
      return `
      <button type="button" class="mushi-report-row" data-report-id="${escapeHtml(report.id)}" aria-label="View report: ${escapeHtml(title)}">
        <div class="mushi-report-main">
          <span class="mushi-report-title">${escapeHtml(title)}</span>
          <span class="mushi-report-meta">
            <span class="mushi-report-status mushi-status-${tone}">${escapeHtml(reporterStatusShort(report.status))}</span>
            ${when ? `<span class="mushi-report-when">${escapeHtml(when)}</span>` : ''}
            ${unread}
          </span>
        </div>
        <span class="mushi-report-chevron" aria-hidden="true">\u203A</span>
      </button>`;
    }).join('');
    const leaderboardBtn = this.rewardsState
      ? `<button type="button" class="mushi-leaderboard-link" data-action="open-leaderboard">🏆 Leaderboard</button>`
      : '';
    return `
      ${this.renderHeader({ title: 'Your reports', showBack: true, eyebrow: 'Mushi · Inbox' })}
      <div class="mushi-body">
        ${this.reporterLoading ? '<p class="mushi-muted">Loading reports…</p>' : ''}
        ${this.reporterError ? `<p class="mushi-error-inline">${escapeHtml(this.reporterError)}</p>` : ''}
        ${reports || (!this.reporterLoading ? '<p class="mushi-muted">No reports from this browser yet.</p>' : '')}
        ${leaderboardBtn}
      </div>
    `;
  }

  private renderRoadmapStep(): string {
    const rows = this.featureBoard.map((ticket) => {
      const id = String(ticket.id ?? '');
      const subject = escapeHtml(String(ticket.subject ?? 'Untitled idea'));
      const votes = Number(ticket.vote_count ?? 0);
      const shipped = Boolean(ticket.shipped_at);
      const voted = Boolean(ticket.my_vote);
      const status = shipped ? 'Shipped' : String(ticket.status_label ?? ticket.status ?? 'open');
      return `
        <div class="mushi-report-row mushi-roadmap-row">
          <div class="mushi-report-main">
            <span class="mushi-report-title">${subject}</span>
            <span class="mushi-report-meta">
              <span class="mushi-report-status">${escapeHtml(status)}</span>
              <span class="mushi-report-when">${votes} vote${votes === 1 ? '' : 's'}</span>
            </span>
          </div>
          ${this.callbacks.onFeatureBoardVote ? `
            <button type="button" class="mushi-vote-btn" data-vote-id="${escapeHtml(id)}" aria-pressed="${voted}">
              ${voted ? 'Voted' : 'Vote'}
            </button>` : ''}
        </div>`;
    }).join('');

    return `
      ${this.renderHeader({ title: 'Community ideas', showBack: true, eyebrow: 'Mushi · Roadmap' })}
      <div class="mushi-body">
        ${this.reporterLoading ? '<p class="mushi-muted">Loading ideas…</p>' : ''}
        ${this.reporterError ? `<p class="mushi-error-inline">${escapeHtml(this.reporterError)}</p>` : ''}
        ${rows || (!this.reporterLoading ? '<p class="mushi-muted">No community ideas yet. Be the first to suggest one.</p>' : '')}
      </div>
    `;
  }

  private renderLeaderboardStep(): string {
    const myRank = this.rewardsState && this.leaderboardEntries
      ? this.leaderboardEntries.findIndex((e) => e.display_name === 'You') + 1
      : 0;
    const rows = (this.leaderboardEntries ?? []).map((e, i) => `
      <div class="mushi-lb-row ${i === 0 ? 'mushi-lb-top' : ''}">
        <span class="mushi-lb-rank">#${i + 1}</span>
        <span class="mushi-lb-name">${escapeHtml(e.display_name)}</span>
        ${e.tier_name ? `<span class="mushi-lb-tier">${escapeHtml(e.tier_name)}</span>` : ''}
        <span class="mushi-lb-pts">${e.total_points.toLocaleString()} pts</span>
      </div>
    `).join('');
    return `
      ${this.renderHeader({ title: '🏆 Leaderboard', showBack: true, eyebrow: 'Mushi · Contributors' })}
      <div class="mushi-body">
        ${this.leaderboardLoading ? '<p class="mushi-muted">Loading leaderboard…</p>' : ''}
        ${!this.leaderboardLoading && !this.leaderboardEntries?.length ? '<p class="mushi-muted">No contributors yet — be the first!</p>' : ''}
        <div class="mushi-lb-list">${rows}</div>
        ${myRank > 0 ? `<p class="mushi-lb-myrank">You are ranked #${myRank}</p>` : ''}
        <p class="mushi-lb-note">Top contributors this month · Points refresh monthly</p>
      </div>
    `;
  }

  private renderReportDetailStep(): string {
    const report = this.reporterReports.find((r) => r.id === this.selectedReportId);
    const status = report?.status ?? 'unknown';
    const tone = reporterStatusTone(status);
    const when = report?.created_at ? formatRelativeTime(report.created_at) : '';
    const comments = this.reporterComments.map((comment) => `
      <div class="mushi-thread-comment ${comment.author_kind}">
        <strong>${escapeHtml(comment.author_kind === 'reporter' ? 'You' : (comment.author_name ?? 'Developer'))}</strong>
        <p>${escapeHtml(comment.body)}</p>
      </div>
    `).join('');
    return `
      ${this.renderHeader({ title: 'Report thread', showBack: true, eyebrow: 'Mushi · Inbox' })}
      <div class="mushi-body">
        <div class="mushi-thread-summary">
          <div class="mushi-thread-summary-meta">
            <span class="mushi-report-status mushi-status-${tone}">${escapeHtml(reporterStatusLabel(status))}</span>
            ${when ? `<span class="mushi-report-when">Reported ${escapeHtml(when)}</span>` : ''}
          </div>
          <p>${escapeHtml(report?.summary ?? report?.description ?? 'Report details')}</p>
        </div>
        <div class="mushi-thread">
          ${this.reporterLoading ? '<p class="mushi-muted">Loading thread…</p>' : comments || '<p class="mushi-muted">No developer replies yet.</p>'}
        </div>
        ${['fixed', 'resolved', 'verified'].includes(status) ? `
          <div class="mushi-verify-actions" role="group" aria-label="Fix verification">
            <button type="button" class="mushi-intent-btn" data-action="reporter-confirms">Yes, fixed for me</button>
            <button type="button" class="mushi-intent-btn" data-action="reporter-not-fixed">Not fixed yet</button>
          </div>
        ` : ''}
        <textarea class="mushi-textarea" data-role="reporter-reply" rows="3" placeholder="Reply to the developer…"></textarea>
        <button type="button" class="mushi-submit" data-action="reporter-reply">
          <span>Reply</span><span class="mushi-submit-arrow" aria-hidden="true">\u2192</span>
        </button>
      </div>
    `;
  }

  private renderIntentStep(): string {
    const t = this.locale;
    const catId = this.selectedCategory!;
    // For custom categories, use their declared intents; for built-in categories
    // use the i18n-localised intent list.
    const customEntry = this.resolveCustomCategory(catId);
    const intents: string[] = customEntry?.intents
      ?? (t.step2.intents[catId as MushiReportCategory] || []);

    const options = intents.map((intent) => `
      <button type="button" class="mushi-intent-btn" data-intent="${escapeHtml(intent)}">
        ${escapeHtml(intent)}
      </button>
    `).join('');

    const icon = this.categoryIcon(catId);
    const label = this.categoryLabel(catId);

    return `
      ${this.renderHeader({ title: t.step2.heading, showBack: true, step: STEP_NUMBER.intent })}
      <div class="mushi-body">
        <div class="mushi-selected-category">
          <span aria-hidden="true">${icon}</span>
          <span>${escapeHtml(label)}</span>
        </div>
        <div class="mushi-intents">
          ${options}
        </div>
      </div>
      ${this.renderStepIndicator(STEP_NUMBER.intent)}
    `;
  }

  private effectiveMinLength(): number {
    const base = this.config.minDescriptionLength ?? 20;
    // CJK scripts pack more meaning per character. Halve the floor for Japanese,
    // Chinese, and Korean locales so an 8-character Japanese sentence isn't
    // blocked by an English-calibrated minimum.
    const lang = this.config.locale === 'auto'
      ? (typeof navigator !== 'undefined' ? (navigator.language ?? '') : '')
      : (this.config.locale ?? '');
    const isCjk = /^(ja|zh|ko)/i.test(lang);
    return isCjk ? Math.max(4, Math.floor(base / 2)) : base;
  }

  private renderDetailsStep(): string {
    const t = this.locale;
    const minLen = this.effectiveMinLength();

    const screenshotLabel = this.screenshotCapturing
      ? t.step3.screenshotCapturing
      : this.screenshotError
        ? t.step3.screenshotFailed
        : this.screenshotAttached
          ? t.step3.screenshotAttached
          : t.step3.screenshotButton;

    const screenshotClass = [
      'mushi-attach-btn',
      this.screenshotAttached ? 'active' : '',
      this.screenshotError ? 'error' : '',
      this.screenshotCapturing ? 'loading' : '',
    ].filter(Boolean).join(' ');

    const elementLabel = this.elementCapturing
      ? t.step3.elementCapturing
      : this.elementSelected
        ? t.step3.elementSelected
        : t.step3.elementButton;

    const elementClass = [
      'mushi-attach-btn',
      this.elementSelected ? 'active' : '',
      this.elementCapturing ? 'loading' : '',
    ].filter(Boolean).join(' ');

    const exampleChips = t.step3.examplePrompts
      .map((p) => `<button type="button" class="mushi-example-chip" data-example="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
      .join('');

    return `
      ${this.renderHeader({ title: t.step3.heading, showBack: true, step: STEP_NUMBER.details })}
      <div class="mushi-body">
        <div class="mushi-example-chips" aria-label="Example prompts">${exampleChips}</div>
        <div class="mushi-textarea-wrap">
          <textarea
            class="mushi-textarea"
            placeholder="${t.step3.descriptionPlaceholder}"
            rows="4"
            aria-label="${t.step3.heading}"
            autofocus
          ></textarea>
          <div class="mushi-char-counter" data-role="char-counter" aria-hidden="true">
            <span data-role="char-current">0</span>/<span data-role="char-min">${minLen}</span>
          </div>
        </div>
        <div class="mushi-attachments">
          <button type="button" class="${screenshotClass}"
            data-action="screenshot"
            ${this.screenshotCapturing ? 'disabled' : ''}
            aria-label="${escapeHtml(screenshotLabel)}"
          >
            ${this.screenshotCapturing ? '<span class="mushi-spinner" aria-hidden="true"></span>' : '\uD83D\uDCF8'}
            ${escapeHtml(screenshotLabel)}
          </button>
          ${this.screenshotAttached && this.allowScreenshotRemove
            ? '<button type="button" class="mushi-attach-btn danger" data-action="remove-screenshot" aria-label="Remove screenshot">\u2715 Remove</button>'
            : ''}
          ${this.screenshotAttached
            ? '<button type="button" class="mushi-attach-btn" data-action="annotate-screenshot" aria-label="Mark up screenshot">\u270F Mark up</button><div class="mushi-annotate-host" data-role="annotate-host"></div>'
            : ''}
          <button type="button" class="${elementClass}"
            data-action="element"
            ${this.elementCapturing ? 'disabled' : ''}
            aria-label="${escapeHtml(elementLabel)}"
          >
            ${this.elementCapturing ? '<span class="mushi-spinner" aria-hidden="true"></span>' : '\uD83C\uDFAF'}
            ${escapeHtml(elementLabel)}
          </button>
        </div>
        <div class="mushi-error" style="display:none" role="alert"></div>
      </div>
      <div class="mushi-footer">
        <span class="mushi-footer-hint" aria-hidden="true">\u2318 + ENTER \u2192 send</span>
        <button type="button" class="mushi-submit" data-action="submit"${this.submitting ? ' disabled' : ''}>
          <span>${this.submitting ? t.widget.submitting : t.widget.submit}</span>
          <span class="mushi-submit-arrow" aria-hidden="true">\u2192</span>
        </button>
      </div>
      ${this.renderStepIndicator(STEP_NUMBER.details)}
    `;
  }

  /**
   * Editorial success state: 朱印-style red stamp ring with the kanji
   * 受 ("received") at its centre, the localised "thank you" string
   * in serif below, and a mono ledger receipt ("REPORT · HH:MM:SS").
   * The ring + label animations are defined in styles.ts so this stays
   * pure markup and `prefers-reduced-motion` flips them to the final
   * frame instantly.
   */
  private renderSuccessStep(): string {
    const t = this.locale;
    const stamp = this.submittedAt ?? new Date();
    const time = stamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    return `
      ${this.renderHeader({ title: t.widget.title, eyebrow: 'Mushi \u00B7 Receipt' })}
      <div class="mushi-body">
        <div class="mushi-success">
          <div class="mushi-success-stamp" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><circle cx="50" cy="50" r="44"/></svg>
            <span class="mushi-success-stamp-label">\u53D7</span>
          </div>
          <div class="mushi-success-headline">${t.widget.submitted}</div>
          <div class="mushi-success-meta">REPORT \u00B7 ${time}</div>
          ${this.renderSuccessReceipt()}
          ${this.rewardsState ? this.renderSuccessRewards() : ''}
          ${this.config.betaMode?.enabled ? this.renderBetaSuccessFooter() : ''}
        </div>
      </div>
    `;
  }

  /**
   * Two-way receipt block. Until the host's `onSubmit` resolves with a
   * server-confirmed report id, we show a discreet "delivering..." pill so
   * the user knows their submission is still in flight. Once we have the
   * id, we surface a short monospaced id + a copy button + an optional
   * "Track on Mushi" deep link to `dashboardUrl/reports/<id>` so the user
   * can watch the status walk through queued -> classified -> fixed in
   * real time (Peak-End rule: the last impression sticks). If we never
   * get an id (offline retry queue), we say so explicitly rather than
   * pretending everything is fine.
   */
  private renderSuccessReceipt(): string {
    if (this.lastSubmitQueuedOffline) {
      return `
        <div class="mushi-success-receipt" role="status">
          <div class="mushi-success-receipt-row mushi-success-receipt-warn">
            <span class="mushi-success-receipt-label">Queued offline</span>
            <span class="mushi-success-receipt-hint">We&rsquo;ll send it the moment you&rsquo;re back online.</span>
          </div>
        </div>
      `;
    }

    if (!this.lastReportId) {
      return `
        <div class="mushi-success-receipt" role="status">
          <div class="mushi-success-receipt-row">
            <span class="mushi-success-receipt-spinner" aria-hidden="true"></span>
            <span class="mushi-success-receipt-hint">Delivering to the team\u2026</span>
          </div>
          ${this.renderSlaLine()}
        </div>
      `;
    }

    const idShort = `#${this.lastReportId.slice(0, 8)}`;
    const dashboard = (this.config.dashboardUrl ?? '').replace(/\/$/, '');
    const trackHref = dashboard ? `${dashboard}/reports/${encodeURIComponent(this.lastReportId)}` : '';

    return `
      <div class="mushi-success-receipt" role="status">
        <div class="mushi-success-receipt-row">
          <span class="mushi-success-receipt-label">Receipt</span>
          <button
            type="button"
            class="mushi-success-receipt-id"
            data-action="copy-report-id"
            data-copy-id="${escapeHtml(this.lastReportId)}"
            title="Copy report id ${escapeHtml(this.lastReportId)}"
            aria-label="Copy report id ${escapeHtml(this.lastReportId)}"
          >${escapeHtml(idShort)}<span class="mushi-success-receipt-copy" aria-hidden="true">\u2398</span></button>
        </div>
        ${trackHref ? `
          <a
            class="mushi-success-receipt-track"
            href="${escapeHtml(trackHref)}"
            target="_blank"
            rel="noopener noreferrer"
          >Track on Mushi <span aria-hidden="true">\u2197</span></a>
        ` : ''}
        ${this.renderSlaLine()}
      </div>
    `;
  }

  private renderSlaLine(): string {
    const sla = (this.config.responseSlaLabel ?? '').trim();
    if (sla) {
      return `<div class="mushi-success-sla">${escapeHtml(sla)}</div>`;
    }
    // Default copy is intentionally vague but reassuring -- under-promise,
    // over-deliver. Hosts that want a hard SLA set it via responseSlaLabel.
    return `<div class="mushi-success-sla mushi-success-sla-default">A human will look at this within a working day.</div>`;
  }

  /**
   * Reciprocity footer on the success step: closes the feedback loop by
   * attributing where the report goes, sets a response expectation, and
   * reinforces the "beta tester" identity (Peak-End Rule — the last thing
   * the user sees shapes their entire impression of the interaction).
   */
  private renderBetaSuccessFooter(): string {
    const beta = this.config.betaMode!;
    const email = beta.contactEmail ? escapeHtml(beta.contactEmail) : null;
    const appName = escapeHtml(beta.appName ?? 'the team');
    return `
      <div class="mushi-beta-success-footer" role="note" aria-label="Beta feedback acknowledgement">
        ${email
          ? `<div class="mushi-beta-success-line">\uD83D\uDCEC Sent to ${email}</div>`
          : `<div class="mushi-beta-success-line">\uD83D\uDCEC Sent to ${appName}</div>`
        }
        <div class="mushi-beta-success-line mushi-beta-success-dim">We aim to review within 48h · thank you for helping build this</div>
      </div>
    `;
  }

  private tierColor(slug: string): string {
    const colors: Record<string, string> = {
      free: '#6b7280',
      explorer: '#3b82f6',
      contributor: '#8b5cf6',
      champion: '#f59e0b',
    };
    return colors[slug] ?? '#6c47ff';
  }

  /** Compact rewards nudge rendered at the bottom of the category-step body. */
  private renderRewardsNudge(): string {
    const { tier, nextTier, totalPoints, pointsForReport } = this.rewardsState!;
    const tierName = tier?.displayName ?? 'Free';
    const tierSlug = tier?.slug ?? 'free';
    const color = this.tierColor(tierSlug);

    let pct = 100;
    let nextLabel = '';
    if (nextTier) {
      const base = tier?.pointsThreshold ?? 0;
      const ceiling = nextTier.pointsThreshold;
      pct = ceiling > base ? Math.round(Math.min(1, (totalPoints - base) / (ceiling - base)) * 100) : 100;
      const remaining = Math.max(0, ceiling - totalPoints);
      nextLabel = `${remaining.toLocaleString()} pts to ${escapeHtml(nextTier.displayName)}`;
    }

    return `
      <div class="mushi-rewards-nudge" aria-label="Rewards progress">
        <div class="mushi-rewards-row">
          <span class="mushi-tier-pip" style="background:${color}" aria-hidden="true"></span>
          <span class="mushi-rewards-tier-name">${escapeHtml(tierName)}</span>
          <span class="mushi-rewards-pts-count">${totalPoints.toLocaleString()} pts</span>
          <span class="mushi-rewards-pts-earn">+${pointsForReport} pts for a report</span>
        </div>
        ${nextTier ? `
          <div class="mushi-tier-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to ${escapeHtml(nextTier.displayName)}">
            <div class="mushi-tier-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="mushi-rewards-next-label">${nextLabel}</div>
        ` : ''}
      </div>
    `;
  }

  /** Points earned + tier progress shown on the success step. */
  private renderSuccessRewards(): string {
    const { tier, nextTier, totalPoints, pointsForReport } = this.rewardsState!;
    const projected = totalPoints + pointsForReport;

    let pctAfter = 100;
    let nextLabel = '';
    if (nextTier) {
      const base = tier?.pointsThreshold ?? 0;
      const ceiling = nextTier.pointsThreshold;
      pctAfter = ceiling > base ? Math.round(Math.min(1, (projected - base) / (ceiling - base)) * 100) : 100;
      const remaining = Math.max(0, ceiling - projected);
      nextLabel = remaining > 0
        ? `${remaining.toLocaleString()} pts to ${escapeHtml(nextTier.displayName)}`
        : `\uD83C\uDF89 ${escapeHtml(nextTier.displayName)} reached!`;
    }

    return `
      <div class="mushi-success-rewards">
        <div class="mushi-success-pts-award">+${pointsForReport} pts</div>
        ${nextTier ? `
          <div class="mushi-tier-bar-track success-bar" role="progressbar" aria-valuenow="${pctAfter}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to ${escapeHtml(nextTier.displayName)}">
            <div class="mushi-tier-bar-fill" style="width:${pctAfter}%"></div>
          </div>
          <div class="mushi-rewards-next-label">${nextLabel}</div>
        ` : ''}
      </div>
    `;
  }

  private attachHandlers(panel: HTMLElement): void {
    const t = this.locale;

    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.close());
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      if (this.step === 'intent') { this.step = 'category'; this.selectedCategory = null; }
      else if (this.step === 'details') {
        if (this.viaFeatureRequest) {
          this.step = 'category';
          this.selectedCategory = null;
          this.selectedIntent = null;
          this.viaFeatureRequest = false;
        } else {
          this.step = 'intent';
          this.selectedIntent = null;
        }
      }
      else if (this.step === 'reports') { this.step = 'category'; }
      else if (this.step === 'report-detail') { this.step = 'reports'; this.selectedReportId = null; }
      else if (this.step === 'leaderboard') { this.step = 'reports'; }
      else if (this.step === 'roadmap') { this.step = 'category'; }
      this.render();
    });

    panel.querySelector('[data-action="reports"]')?.addEventListener('click', () => {
      void this.loadReporterReports();
    });

    panel.querySelector('[data-action="roadmap"]')?.addEventListener('click', () => {
      void this.loadFeatureBoard();
    });

    panel.querySelectorAll('[data-vote-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const requestId = (btn as HTMLElement).dataset.voteId;
        if (requestId) void this.voteFeatureBoard(requestId);
      });
    });

    panel.querySelector('[data-action="feature-request"]')?.addEventListener('click', () => {
      // Feature-request shortcut: pre-fill the wire format and skip the
      // intent step. The user lands directly on the description box so
      // there's only one screen between "I have an idea" and "submitted".
      this.selectedCategory = 'other';
      this.selectedIntent = FEATURE_REQUEST_INTENT;
      this.viaFeatureRequest = true;
      this.step = 'details';
      this.render();
    });

    panel.querySelectorAll('[data-report-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const reportId = (btn as HTMLElement).dataset.reportId;
        if (reportId) void this.loadReporterComments(reportId);
      });
    });

    panel.querySelector('[data-action="open-leaderboard"]')?.addEventListener('click', () => {
      this.step = 'leaderboard';
      this.callbacks.onLeaderboardOpen?.();
      this.render();
    });

    panel.querySelector('[data-action="reporter-reply"]')?.addEventListener('click', () => {
      void this.submitReporterReply(panel);
    });

    panel.querySelector('[data-action="reporter-confirms"]')?.addEventListener('click', () => {
      void this.submitReporterFeedback('confirms');
    });

    panel.querySelector('[data-action="reporter-not-fixed"]')?.addEventListener('click', () => {
      void this.submitReporterReopen();
    });

    // Receipt-copy on the success step. We do the clipboard work
    // inside the widget rather than emitting a callback so the
    // optical feedback (button label flips to "Copied") is instant
    // and the host doesn't have to wire anything to enjoy it.
    panel.querySelector('[data-action="copy-report-id"]')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const id = btn.dataset.copyId;
      if (!id) return;
      const restore = btn.innerHTML;
      const done = () => {
        btn.innerHTML = 'Copied \u2713';
        // Hold the "Copied" state briefly then bounce back to the
        // ledger id so a second copy still feels like an action.
        window.setTimeout(() => {
          if (btn.isConnected) btn.innerHTML = restore;
        }, 1600);
      };
      try {
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(id).then(done).catch(() => done());
        } else {
          done();
        }
      } catch {
        done();
      }
    });

    panel.querySelectorAll('[data-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const catId = (btn as HTMLElement).dataset.category ?? 'other';
        this.selectedCategory = catId;
        // Custom categories with no declared intents go straight to the
        // description step (intent picker would be empty).
        const custom = this.resolveCustomCategory(catId);
        this.step = (custom && (!custom.intents || custom.intents.length === 0)) ? 'details' : 'intent';
        this.render();
      });
    });

    panel.querySelectorAll('[data-intent]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedIntent = (btn as HTMLElement).dataset.intent ?? null;
        this.step = 'details';
        this.render();
      });
    });

    // Wire live char counter so users see their progress as they type.
    const textarea = panel.querySelector('.mushi-textarea') as HTMLTextAreaElement | null;
    const charCurrentEl = panel.querySelector('[data-role="char-current"]') as HTMLElement | null;
    if (textarea && charCurrentEl) {
      const minLen = this.effectiveMinLength();
      const updateCounter = () => {
        const len = textarea.value.trim().length;
        charCurrentEl.textContent = String(len);
        const counterEl = panel.querySelector('[data-role="char-counter"]') as HTMLElement | null;
        if (counterEl) {
          counterEl.style.color = len >= minLen ? 'var(--mushi-ok, #22c55e)' : '';
        }
      };
      textarea.addEventListener('input', updateCounter);
    }

    // Wire example chips — clicking one pre-fills the textarea.
    panel.querySelectorAll('[data-example]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const example = (chip as HTMLElement).dataset.example ?? '';
        if (textarea) {
          textarea.value = example;
          textarea.focus();
          // Trigger counter update.
          textarea.dispatchEvent(new Event('input'));
        }
      });
    });

    panel.querySelector('[data-action="screenshot"]')?.addEventListener('click', () => {
      this.callbacks.onScreenshotRequest();
    });
    panel.querySelector('[data-action="remove-screenshot"]')?.addEventListener('click', () => {
      this.callbacks.onScreenshotRemove?.();
    });
    panel.querySelector('[data-action="annotate-screenshot"]')?.addEventListener('click', () => {
      const host = panel.querySelector('[data-role="annotate-host"]') as HTMLElement | null;
      if (host && this.callbacks.onScreenshotAnnotateRequest) {
        void this.callbacks.onScreenshotAnnotateRequest(host);
      }
    });

    panel.querySelector('[data-action="element"]')?.addEventListener('click', () => {
      this.callbacks.onElementSelectorRequest?.();
    });

    const submitReport = (): void => {
      const textarea = panel.querySelector('.mushi-textarea') as HTMLTextAreaElement | null;
      const description = textarea?.value?.trim() ?? '';
      const errorEl = panel.querySelector('.mushi-error') as HTMLElement | null;

      const minLen = this.effectiveMinLength();
      if (description.length < minLen) {
        if (errorEl) {
          const msg = `${t.step3.tooShort} (${description.length}/${minLen})`;
          errorEl.textContent = msg;
          errorEl.style.display = 'block';
          // Focus the textarea so the user can immediately keep typing.
          textarea?.focus();
        }
        return;
      }

      this.submitting = true;
      this.submittedAt = new Date();
      this.lastReportId = null;
      this.lastSubmitQueuedOffline = false;
      this.render();

      // Kick off the host's submission handler. We treat both
      // sync-void (legacy) and async-outcome (current) shapes:
      // when the host returns an outcome we hold the success step
      // open longer and let the user copy the report id; when the
      // host returns void we use the historic 500 ms transition.
      const outcomeP = (async () => {
        try {
          const catId = this.selectedCategory!;
          const baseCategory = this.resolveBaseCategory(catId);
          // Only set userCategory when the host uses a custom category list
          // and the id differs from the resolved base (avoids redundant duplication).
          const isCustomCat = this.config.categories && this.config.categories.length > 0;
          const ret = this.callbacks.onSubmit({
            category: baseCategory,
            ...(isCustomCat ? { userCategory: catId } : {}),
            description,
            intent: this.selectedIntent ?? undefined,
          });
          if (ret && typeof (ret as Promise<WidgetSubmitOutcome | void>).then === 'function') {
            const outcome = (await ret) as WidgetSubmitOutcome | void;
            return outcome ?? null;
          }
          return null;
        } catch {
          // Submission errors are still surfaced as a success step in
          // the historic SDK — the apiClient retry queue handles the
          // delivery in the background. Mirror that so the receipt
          // copy can degrade to the "queued offline" variant rather
          // than blocking the user with an error wall.
          return { reportId: null, queuedOffline: true } as WidgetSubmitOutcome;
        }
      })();

      // Always flip to the success step quickly so the user gets a
      // confirmation within one breath even if the network is slow.
      // The outcome promise then patches the receipt id in-place
      // once it resolves (success step re-renders).
      this.successTimer = setTimeout(() => {
        this.successTimer = null;
        this.submitting = false;
        this.step = 'success';
        this.render();
        // Don't auto-close as aggressively if we're waiting on a
        // report id — give the user a moment to copy it. Once the
        // outcome lands we kick off a longer auto-close so the deep
        // link stays readable.
        void outcomeP.then((outcome) => {
          if (this.step !== 'success') return;
          if (outcome) {
            this.lastReportId = outcome.reportId ?? null;
            this.lastSubmitQueuedOffline = Boolean(outcome.queuedOffline);
            this.render();
          }
          if (this.autoCloseTimer !== null) {
            clearTimeout(this.autoCloseTimer);
          }
          // 6 s when we have a deep link (long enough to read + copy
          // the id), 2.8 s for the legacy bare-stamp path.
          const closeDelayMs = this.lastReportId && this.config.dashboardUrl ? 6000 : 2800;
          this.autoCloseTimer = setTimeout(() => {
            this.autoCloseTimer = null;
            if (this.step === 'success') this.close();
          }, closeDelayMs);
        });
      }, 500);
    };

    panel.querySelector('[data-action="submit"]')?.addEventListener('click', submitReport);

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
        return;
      }
      // Ctrl/Cmd+Enter submits from anywhere in the panel — primarily to
      // catch the textarea where Enter alone needs to insert a newline.
      // Only the details step has a submit action, so guard on that.
      if (this.step === 'details' && isSubmitShortcut(e)) {
        e.preventDefault();
        submitReport();
      }
    });
  }

  private trapFocus(panel: HTMLElement): void {
    requestAnimationFrame(() => {
      // Prefer the textarea on the details step so users can start typing
      // immediately without an extra Tab. Otherwise focus the first
      // interactive element so keyboard users can navigate the list.
      const textarea = panel.querySelector('textarea') as HTMLElement | null;
      if (textarea) {
        textarea.focus();
        return;
      }
      const focusable = panel.querySelectorAll('button, textarea, [tabindex]');
      if (focusable.length > 0) (focusable[0] as HTMLElement).focus();
    });
  }

  private unreadCount(): number {
    return this.reporterReports.reduce((sum, report) => sum + (report.unread_count ?? 0), 0);
  }

  private async loadFeatureBoard(): Promise<void> {
    this.step = 'roadmap';
    this.reporterLoading = true;
    this.reporterError = null;
    this.render();
    try {
      this.featureBoard = await this.callbacks.onFeatureBoardRequest?.() ?? [];
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not load community ideas.';
    } finally {
      this.reporterLoading = false;
      this.render();
    }
  }

  private async voteFeatureBoard(requestId: string): Promise<void> {
    if (!this.callbacks.onFeatureBoardVote || this.reporterLoading) return;
    this.reporterLoading = true;
    this.render();
    try {
      await this.callbacks.onFeatureBoardVote(requestId);
      this.featureBoard = await this.callbacks.onFeatureBoardRequest?.() ?? this.featureBoard;
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not update vote.';
    } finally {
      this.reporterLoading = false;
      this.render();
    }
  }

  private async submitReporterReopen(): Promise<void> {
    const reportId = this.selectedReportId;
    if (!reportId || this.reporterLoading) return;
    this.reporterLoading = true;
    this.render();
    try {
      if (this.callbacks.onReporterReopen) {
        await this.callbacks.onReporterReopen(reportId, 'Not fixed for me');
      } else {
        await this.callbacks.onReporterFeedback?.(reportId, 'not_fixed', 'Not fixed for me');
      }
      await this.loadReporterReports();
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not reopen report.';
    } finally {
      this.reporterLoading = false;
      this.render();
    }
  }

  private async loadReporterReports(): Promise<void> {
    this.step = 'reports';
    this.reporterLoading = true;
    this.reporterError = null;
    this.render();
    try {
      this.reporterReports = await this.callbacks.onReporterReportsRequest?.() ?? [];
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not load reports.';
    } finally {
      this.reporterLoading = false;
      this.render();
    }
  }

  private async loadReporterComments(reportId: string): Promise<void> {
    this.selectedReportId = reportId;
    this.step = 'report-detail';
    this.reporterLoading = true;
    this.reporterError = null;
    this.render();
    try {
      this.reporterComments = await this.callbacks.onReporterCommentsRequest?.(reportId) ?? [];
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not load thread.';
    } finally {
      this.reporterLoading = false;
      this.render();
    }
  }

  private async submitReporterFeedback(signal: string): Promise<void> {
    const reportId = this.selectedReportId;
    if (!reportId || this.reporterLoading) return;
    this.reporterLoading = true;
    this.render();
    try {
      await this.callbacks.onReporterFeedback?.(reportId, signal);
      await this.loadReporterReports();
      if (reportId) await this.loadReporterComments(reportId);
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not send feedback.';
      this.reporterLoading = false;
      this.render();
    }
  }

  private async submitReporterReply(panel: HTMLElement): Promise<void> {
    const reportId = this.selectedReportId;
    const textarea = panel.querySelector('[data-role="reporter-reply"]') as HTMLTextAreaElement | null;
    const replyButton = panel.querySelector('[data-action="reporter-reply"]') as HTMLButtonElement | null;
    const body = textarea?.value.trim() ?? '';
    // Guard: reject empty bodies AND already-in-flight submits — both prevented
    // double-posts in dogfood when users mashed Enter on a slow link.
    if (!reportId || !body || this.reporterLoading) return;
    this.reporterLoading = true;
    if (replyButton) replyButton.disabled = true;
    this.render();
    try {
      await this.callbacks.onReporterReply?.(reportId, body);
      // Clear the field on success so the next render (driven by
      // loadReporterComments) doesn't repaint the just-sent text and tempt
      // the user into a duplicate submit.
      if (textarea) textarea.value = '';
      await this.loadReporterComments(reportId);
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not send reply.';
      this.reporterLoading = false;
      this.render();
    }
  }

  /* ── Marketing / Playwright recorder (debug GIF capture) ─────────── */

  getRecorderStep(): WidgetStep {
    return this.step;
  }

  getRecorderTrigger(): Element | null {
    return this.shadow.querySelector('.mushi-trigger');
  }

  getRecorderCategoryButton(category: MushiReportCategory): Element | null {
    return this.shadow.querySelector(`[data-category="${category}"]`);
  }

  getRecorderIntentButton(label: string): Element | null {
    return (
      Array.from(this.shadow.querySelectorAll('[data-intent]')).find(
        (el) => (el as HTMLElement).dataset.intent === label,
      ) ?? null
    );
  }

  getRecorderSubmitButton(): Element | null {
    return this.shadow.querySelector('[data-action="submit"]');
  }

  recorderClickTrigger(): void {
    if (this.isOpen) this.close();
    this.open();
  }

  recorderSelectCategory(category: MushiReportCategory): void {
    if (!this.isOpen) this.open();
    if (this.step !== 'category') {
      this.selectedCategory = null;
      this.selectedIntent = null;
      this.step = 'category';
      this.render();
    }
    this.selectedCategory = category;
    this.step = 'intent';
    this.render();
  }

  recorderSelectIntent(label: string): void {
    if (!this.isOpen || this.step !== 'intent') return;
    this.selectedIntent = label;
    this.step = 'details';
    this.render();
  }

  recorderFocusDescription(): void {
    const textarea = this.shadow.querySelector('.mushi-textarea') as HTMLTextAreaElement | null;
    textarea?.focus();
  }

  recorderSubmit(): void {
    const submit = this.shadow.querySelector('[data-action="submit"]') as HTMLButtonElement | null;
    submit?.click();
  }

  recorderOpenMyReports(): void {
    if (!this.isOpen) this.open();
    void this.loadReporterReports();
  }
}
