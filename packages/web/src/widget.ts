import type {
  MushiCustomCategory,
  MushiCrossAppReport,
  MushiLeaderboardEntry,
  MushiReportCategory,
  MushiReporterComment,
  MushiReporterReport,
  MushiTesterReputation,
  MushiWidgetConfig,
} from '@mushi-mushi/core';
import { getLocale, type MushiLocale } from './i18n';
import { getWidgetStyles } from './styles';
import { MUSHI_SDK_VERSION } from './version';
import { CATEGORY_ICONS, FEATURE_REQUEST_INTENT, isSubmitShortcut } from './widget-helpers';
import type {
  WidgetCallbacks,
  WidgetRewardsState,
  WidgetStep,
  WidgetSubmitOutcome,
} from './widget-helpers';

// Re-exported so existing `from './widget'` import sites and the package barrel
// keep resolving these public contracts unchanged after the helper split.
export type { WidgetCallbacks, WidgetRewardsState, WidgetSubmitOutcome } from './widget-helpers';
import { renderBrandFooter, renderOutdatedBanner, renderStep } from './widget-render';
import type { WidgetRenderCtx } from './widget-render';

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
  /** Persisted FAB position when draggable is enabled. */
  private fabPos: { x: number; y: number } | null = null;
  /** Cleanup fn for visualViewport keyboard listener. */
  private vvCleanup: (() => void) | null = null;
  /** Mushi tester session JWT — set after in-widget sign-in or by mushi.ts. */
  private testerJwt: string | null = null;
  /** Tester identity (public_handle, display_name). */
  private testerInfo: { id: string; public_handle: string | null; display_name: string | null } | null = null;
  /** Cross-app reports for the signed-in tester. */
  private crossAppReports: MushiCrossAppReport[] | null = null;
  private crossAppLoading = false;
  /** Global leaderboard entries (from mushi_testers, not org-scoped). */
  private globalLeaderboard: MushiLeaderboardEntry[] | null = null;
  private globalLeaderboardLoading = false;
  /** Reputation for the signed-in tester. */
  private testerReputation: MushiTesterReputation | null = null;
  /** Whether an in-widget magic-link email was just sent. */
  private magicLinkSent = false;
  private magicLinkEmail = '';
  private magicLinkError = '';
  private magicLinkSending = false; // double-submit guard

  constructor(config: MushiWidgetConfig = {}, callbacks: WidgetCallbacks, private readonly sdkVersion = MUSHI_SDK_VERSION) {
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
      featureRequestLabel: config.featureRequestLabel || 'Feature request',
      featureRequestDescription: config.featureRequestDescription || 'Suggest something new — even rough ideas help us prioritise',
      avoidSelectors: config.avoidSelectors ?? [],
      categories: config.categories ?? [],
      accent: config.accent ?? '',
      accentText: config.accentText ?? '',
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
      ...(config.featureRequestLabel !== undefined ? { featureRequestLabel: config.featureRequestLabel || 'Feature request' } : {}),
      ...(config.featureRequestDescription !== undefined ? { featureRequestDescription: config.featureRequestDescription || 'Suggest something new — even rough ideas help us prioritise' } : {}),
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

  // ── Community public setters (called by mushi.ts after API calls) ──────────

  setTesterSession(jwt: string | null, info: { id: string; public_handle: string | null; display_name: string | null } | null): void {
    this.testerJwt = jwt;
    this.testerInfo = info;
    if (this.isOpen) this.render();
  }

  setGlobalLeaderboard(entries: MushiLeaderboardEntry[] | null, loading = false): void {
    this.globalLeaderboard = entries;
    this.globalLeaderboardLoading = loading;
    if (this.isOpen && (this.step === 'leaderboard' || this.step === 'account')) this.render();
  }

  setCrossAppReports(reports: MushiCrossAppReport[] | null, loading = false): void {
    this.crossAppReports = reports;
    this.crossAppLoading = loading;
    if (this.isOpen && this.step === 'cross-app-reports') this.render();
  }

  setTesterReputation(rep: MushiTesterReputation | null): void {
    this.testerReputation = rep;
    if (this.isOpen && (this.step === 'account' || this.step === 'leaderboard')) this.render();
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
    this.teardownViewportHandlers();
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
    const featLabel = bc.featureCtaLabel ?? 'Request feature';
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
    const t = this.config.theme;
    if (t === 'light' || t === 'dark') return t;
    if (t === 'inherit') {
      // 1. Check <html> color-scheme attribute / computed style
      const root = document.documentElement;
      const colorScheme = root.getAttribute('data-color-scheme') ||
        root.getAttribute('data-theme') ||
        root.getAttribute('color-scheme') || '';
      if (/dark/i.test(colorScheme)) return 'dark';
      if (/light/i.test(colorScheme)) return 'light';
      // 2. Check <html> class
      if (root.classList.contains('dark')) return 'dark';
      if (root.classList.contains('light')) return 'light';
      // 3. Check computed background luminance
      try {
        const bg = getComputedStyle(root).backgroundColor;
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const L = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
          return L < 128 ? 'dark' : 'light';
        }
      } catch { /* ignore */ }
      // 4. Fallback to OS preference
    }
    // 'auto' or unresolved 'inherit'
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
    style.textContent = getWidgetStyles(theme, this.config.accent ?? '', this.config.accentText ?? '');
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

      // Keyboard arrow-key nudge for a11y
      trigger.addEventListener('keydown', (e) => {
        const draggableConfig = this.config.draggable;
        if (!draggableConfig) return;
        const STEP = 8;
        const axis = typeof draggableConfig === 'object' ? (draggableConfig.axis ?? 'both') : 'both';
        let dx = 0, dy = 0;
        if (axis !== 'y') {
          if (e.key === 'ArrowLeft') dx = -STEP;
          else if (e.key === 'ArrowRight') dx = STEP;
        }
        if (axis !== 'x') {
          if (e.key === 'ArrowUp') dy = -STEP;
          else if (e.key === 'ArrowDown') dy = STEP;
        }
        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          const cur = this.fabPos ?? { x: 0, y: 0 };
          this.moveFab(trigger, cur.x + dx, cur.y + dy, false);
        }
      });

      if (this.config.draggable) {
        this.attachDragHandlers(trigger);
      }

      this.shadow.appendChild(trigger);
      // Apply persisted drag position AFTER trigger is in the DOM so
      // getBoundingClientRect() returns correct bounds and the position
      // is clamped to the current viewport (stored positions from different
      // viewport sizes are auto-corrected on first render).
      // IMPORTANT: temporarily zero out this.fabPos so moveFab's baseLeft
      // derivation treats the trigger as starting from its natural CSS position
      // (no offset applied yet).  moveFab will re-set this.fabPos to the
      // clamped value before returning.
      if (this.fabPos && this.config.draggable) {
        const savedPos = this.fabPos;
        this.fabPos = { x: 0, y: 0 };
        this.moveFab(trigger, savedPos.x, savedPos.y, false);
      }
    }

    const panel = document.createElement('div');
    panel.className = `mushi-panel ${pos}${this.isOpen ? ' open' : ' closed'}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t.widget.title);
    panel.style.zIndex = String(this.config.zIndex + 1);
    this.applyInsetVars(panel);

    if (this.isOpen) {
      const ctx = this.renderCtx();
      panel.innerHTML = `${renderOutdatedBanner(ctx)}${renderStep(ctx)}${renderBrandFooter(ctx)}`;
      this.shadow.appendChild(panel);
      this.attachHandlers(panel);
      this.trapFocus(panel);
      this.attachViewportHandlers(panel);
    } else {
      this.teardownViewportHandlers();
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

  // ─── Draggable FAB ──────────────────────────────────────────────────────────

  /** Storage key for the FAB position, scoped to projectId when available. */
  private fabStorageKey(): string {
    const id = (this.config as unknown as Record<string, unknown>)['projectId'] ?? '';
    return `mushi_fab_pos${id ? `_${id}` : ''}`;
  }

  /** Move the FAB to the given translated offset (relative to the inset origin),
   *  clamping inside viewport safe area, and optionally snap to nearest edge.
   *
   *  The FAB's CSS anchor can be any corner (bottom-right, bottom-left, …) so we
   *  must derive the *base* position (CSS anchor with zero drag offset) to compute
   *  correct clamp bounds and snap targets.  We do this by subtracting the
   *  already-applied drag offset from the live getBoundingClientRect() value. */
  private moveFab(trigger: HTMLElement, x: number, y: number, snap: boolean): void {
    const axis = (() => {
      const d = this.config.draggable;
      if (!d) return 'both';
      return typeof d === 'object' ? (d.axis ?? 'both') : 'both';
    })();

    const W = window.innerWidth;
    const H = window.innerHeight;
    const btnW = trigger.offsetWidth || 52;
    const btnH = trigger.offsetHeight || 52;
    const safeL = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sai-left') || '0') || 0;
    const safeR = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sai-right') || '0') || 0;
    const safeT = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sai-top') || '0') || 0;
    const safeB = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sai-bottom') || '0') || 0;
    const margin = 8;

    // Derive the CSS base position (without drag offset) so bounds / snap are
    // correct regardless of which corner the FAB is anchored to.
    const rect = trigger.getBoundingClientRect();
    const prevDragX = this.fabPos?.x ?? 0;
    const prevDragY = this.fabPos?.y ?? 0;
    const baseLeft = rect.left - prevDragX;
    const baseTop  = rect.top  - prevDragY;

    // Clamp so button stays within the viewport safe-area on all four sides.
    const minX = (safeL + margin) - baseLeft;
    const maxX = (W - safeR - margin - btnW) - baseLeft;
    const minY = (safeT + margin) - baseTop;
    const maxY = (H - safeB - margin - btnH) - baseTop;

    const newX = axis === 'y' ? 0 : Math.max(minX, Math.min(maxX, x));
    const newY = axis === 'x' ? 0 : Math.max(minY, Math.min(maxY, y));

    // Optional snap: snap FAB to the nearest left or right edge
    let finalX = newX;
    if (snap) {
      const d = this.config.draggable;
      const shouldSnap = d === true || (typeof d === 'object' && (d.snapToEdge ?? true));
      if (shouldSnap && axis !== 'y') {
        // Snap to nearest horizontal edge — use base position for the offset so
        // the snap target is correct regardless of which side the FAB is anchored.
        const center = rect.left + btnW / 2;
        finalX = center < W / 2
          ? (safeL + margin) - baseLeft              // snap to left edge
          : (W - safeR - margin - btnW) - baseLeft;  // snap to right edge
      }
    }

    this.fabPos = { x: finalX, y: newY };
    trigger.style.setProperty('--mushi-drag-x', `${finalX}px`);
    trigger.style.setProperty('--mushi-drag-y', `${newY}px`);
    trigger.style.setProperty('--mushi-drag-active', '1');

    // Persist
    const d = this.config.draggable;
    const shouldPersist = d === true || (typeof d === 'object' && (d.persist ?? true));
    if (shouldPersist) {
      try {
        localStorage.setItem(this.fabStorageKey(), JSON.stringify(this.fabPos));
      } catch { /* quota — ignore */ }
    }
  }

  /** Load previously persisted FAB position. */
  private loadFabPos(): void {
    const d = this.config.draggable;
    if (!d) return;
    const shouldPersist = d === true || (typeof d === 'object' && (d.persist ?? true));
    if (!shouldPersist) return;
    try {
      const raw = localStorage.getItem(this.fabStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          this.fabPos = parsed;
        }
      }
    } catch { /* ignore */ }
  }

  /** Attach Pointer Events-based drag to the trigger element. */
  private attachDragHandlers(trigger: HTMLElement): void {
    // Load persisted position on first mount
    if (this.fabPos === null) this.loadFabPos();

    let startX = 0, startY = 0;
    let originX = 0, originY = 0;
    let dragging = false;
    let moved = false;

    const onPointerDown = (e: PointerEvent) => {
      // Only handle primary pointer (not right-click / stylus hover)
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      trigger.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      const cur = this.fabPos ?? { x: 0, y: 0 };
      originX = cur.x;
      originY = cur.y;
      dragging = true;
      moved = false;
    };

    const DRAG_THRESHOLD = 6; // px movement before we consider it a drag

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        moved = true;
        trigger.classList.add('dragging');
        trigger.setAttribute('aria-grabbed', 'true');
      }
      if (moved) {
        e.preventDefault();
        this.moveFab(trigger, originX + dx, originY + dy, false);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      trigger.classList.remove('dragging');
      trigger.removeAttribute('aria-grabbed');
      if (moved) {
        // Snap on release
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        this.moveFab(trigger, originX + dx, originY + dy, true);
        // Suppress the click that follows a drag
        const suppressClick = (ev: Event) => {
          ev.stopImmediatePropagation();
          trigger.removeEventListener('click', suppressClick, { capture: true });
        };
        trigger.addEventListener('click', suppressClick, { capture: true });
      }
      moved = false;
    };

    trigger.addEventListener('pointerdown', onPointerDown);
    trigger.addEventListener('pointermove', onPointerMove);
    trigger.addEventListener('pointerup', onPointerUp);
    trigger.addEventListener('pointercancel', onPointerUp);
  }

  // ─── Keyboard / visualViewport ──────────────────────────────────────────────

  /** Lift the panel above the software keyboard using visualViewport. */
  private attachViewportHandlers(panel: HTMLElement): void {
    this.teardownViewportHandlers();
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const keyboardInset = window.innerHeight - vv.height - vv.offsetTop;
      if (keyboardInset > 50) {
        // Keyboard is visible — lift panel above it
        panel.style.setProperty('--mushi-keyboard-inset', `${Math.round(keyboardInset)}px`);
        panel.classList.add('keyboard-open');
        // Also scroll the focused textarea into view
        const ta = panel.querySelector<HTMLElement>('textarea, input[type="text"]');
        ta?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        panel.style.setProperty('--mushi-keyboard-inset', '0px');
        panel.classList.remove('keyboard-open');
      }
    };

    vv.addEventListener('resize', update, { passive: true });
    vv.addEventListener('scroll', update, { passive: true });
    // Also update on textarea focus/blur
    const onFocus = () => requestAnimationFrame(update);
    panel.addEventListener('focusin', onFocus);

    this.vvCleanup = () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      panel.removeEventListener('focusin', onFocus);
    };
  }

  private teardownViewportHandlers(): void {
    this.vvCleanup?.();
    this.vvCleanup = null;
  }

  /**
   * Minimum description length, lowered for CJK locales where each character
   * carries more meaning. Used by both the view layer (via renderCtx) and the
   * details-step input validation in attachHandlers.
   */
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

  /** Tier accent colour for the rewards UI. */
  private tierColor(slug: string): string {
    const colors: Record<string, string> = {
      free: '#6b7280',
      explorer: '#3b82f6',
      contributor: '#8b5cf6',
      champion: '#f59e0b',
    };
    return colors[slug] ?? '#6c47ff';
  }

  /**
   * Build the read-only snapshot + bound helper closures the stateless view
   * layer (widget-render.ts) renders from. Rebuilt once per render() pass so
   * the HTML always reflects current state.
   */
  private renderCtx(): WidgetRenderCtx {
    return {
      config: this.config,
      rewardsState: this.rewardsState,
      lastReportId: this.lastReportId,
      reporterLoading: this.reporterLoading,
      locale: this.locale,
      testerReputation: this.testerReputation,
      testerInfo: this.testerInfo,
      screenshotCapturing: this.screenshotCapturing,
      screenshotAttached: this.screenshotAttached,
      reporterError: this.reporterError,
      magicLinkError: this.magicLinkError,
      elementCapturing: this.elementCapturing,
      submitting: this.submitting,
      sdkFreshness: this.sdkFreshness,
      screenshotError: this.screenshotError,
      reporterReports: this.reporterReports,
      magicLinkSending: this.magicLinkSending,
      magicLinkEmail: this.magicLinkEmail,
      globalLeaderboardLoading: this.globalLeaderboardLoading,
      globalLeaderboard: this.globalLeaderboard,
      elementSelected: this.elementSelected,
      crossAppLoading: this.crossAppLoading,
      callbacks: this.callbacks,
      testerJwt: this.testerJwt,
      submittedAt: this.submittedAt,
      step: this.step,
      selectedReportId: this.selectedReportId,
      selectedCategory: this.selectedCategory,
      sdkVersion: this.sdkVersion,
      reporterComments: this.reporterComments,
      magicLinkSent: this.magicLinkSent,
      leaderboardLoading: this.leaderboardLoading,
      leaderboardEntries: this.leaderboardEntries,
      lastSubmitQueuedOffline: this.lastSubmitQueuedOffline,
      featureBoard: this.featureBoard,
      crossAppReports: this.crossAppReports,
      allowScreenshotRemove: this.allowScreenshotRemove,
      unreadCount: () => this.unreadCount(),
      tierColor: (slug) => this.tierColor(slug),
      resolveCustomCategory: (id) => this.resolveCustomCategory(id),
      effectiveMinLength: () => this.effectiveMinLength(),
      categoryLabel: (id) => this.categoryLabel(id),
      categoryIcon: (id) => this.categoryIcon(id),
    };
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
      this.callbacks.onGlobalLeaderboardOpen?.();
      this.render();
    });

    // Community: open account step
    panel.querySelector('[data-action="open-account"]')?.addEventListener('click', () => {
      this.step = 'account';
      this.render();
    });

    // Community: navigate within account step
    panel.querySelector('[data-action="open-cross-app-reports"]')?.addEventListener('click', () => {
      this.step = 'cross-app-reports';
      this.crossAppLoading = true;
      this.crossAppReports = null;
      this.render();
      if (this.callbacks.onCrossAppReportsOpen) {
        this.callbacks.onCrossAppReportsOpen();
      } else {
        // No callback wired: clear loading so panel doesn't show a permanent spinner
        this.crossAppLoading = false;
        this.crossAppReports = [];
        this.render();
      }
    });

    panel.querySelector('[data-action="open-global-leaderboard"]')?.addEventListener('click', () => {
      this.step = 'leaderboard';
      this.globalLeaderboard = null;
      this.globalLeaderboardLoading = true;
      this.render();
      if (this.callbacks.onGlobalLeaderboardOpen) {
        this.callbacks.onGlobalLeaderboardOpen();
      } else {
        // No callback wired: clear loading so panel doesn't spin forever
        this.globalLeaderboardLoading = false;
        this.globalLeaderboard = [];
        this.render();
      }
    });

    // Community: magic-link sign-in
    panel.querySelector('[data-action="send-magic-link"]')?.addEventListener('click', () => {
      void this.handleMagicLinkSend(panel);
    });

    panel.querySelector('[data-action="resend-magic-link"]')?.addEventListener('click', () => {
      this.magicLinkSent = false;
      this.magicLinkError = '';
      this.render();
    });

    panel.querySelector('[data-action="sign-out-tester"]')?.addEventListener('click', () => {
      this.testerJwt = null;
      this.testerInfo = null;
      this.testerReputation = null;
      this.crossAppReports = null;
      this.magicLinkSent = false;
      this.magicLinkEmail = '';
      this.step = 'category';
      // Notify host to clear persisted JWT from storage
      this.callbacks.onTesterSignOut?.();
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

  /* ── Community: magic-link sign-in ───────────────────────────────── */

  private async handleMagicLinkSend(panel: HTMLElement): Promise<void> {
    if (this.magicLinkSending) return; // double-submit guard
    const emailInput = panel.querySelector('[data-role="magic-link-email"]') as HTMLInputElement | null;
    const email = (emailInput?.value ?? this.magicLinkEmail).trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.magicLinkError = 'Please enter a valid email address.';
      this.render();
      return;
    }
    this.magicLinkEmail = email;
    this.magicLinkError = '';
    this.magicLinkSending = true;
    this.render();
    try {
      await this.callbacks.onMushiSignIn?.(email);
      this.magicLinkSent = true;
    } catch (err) {
      this.magicLinkError = err instanceof Error ? err.message : 'Could not send sign-in link. Try again.';
    } finally {
      this.magicLinkSending = false;
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
