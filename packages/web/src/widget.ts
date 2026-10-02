import type {
  MushiReporterUpdates,
  MushiCustomCategory,
  MushiCrossAppReport,
  MushiLeaderboardEntry,
  MushiReportCategory,
  MushiReporterComment,
  MushiReporterReport,
  MushiTesterReputation,
  MushiWidgetConfig,
} from '@mushi-mushi/core';
import { isPlausibleReporterEmail, reporterToastMessage, type ReporterCopy } from '@mushi-mushi/core/reporter-ui';
import { getLocale, type MushiLocale } from './i18n';
import { getWidgetStyles } from './styles';
import { contrastingInk, safeCssColor } from './build-widget-theme';
import { readPageFaviconHref, MUSHI_TIER_COLORS } from '@mushi-mushi/core';
import { FEATURE_REQUEST_INTENT, REPORTER_READ_DEADLINE_MS, bindFaviconFallbacks, isSubmitShortcut, loadAssistantSession, saveAssistantSession, clearAssistantSession, withDeadline } from './widget-helpers';
import type {
  AssistantTurn,
  PendingReply,
  ScreenshotErrorReason,
  WidgetCallbacks,
  WidgetRewardsState,
  WidgetStep,
  WidgetSubmitOutcome,
  WidgetTimelineEvent,
} from './widget-helpers';

// Re-exported so existing `from './widget'` import sites and the package barrel
// keep resolving these public contracts unchanged after the helper split.
export type { WidgetCallbacks, WidgetRewardsState, WidgetSubmitOutcome } from './widget-helpers';
import { pickUpdateToast } from './reporter-inbox';
import { renderBrandFooter, renderOutdatedBanner, renderView, resolveReporterCopy } from './widget-render';
import type { WidgetRenderCtx } from './widget-render';

/** Heuristic: hedging / capability-limit answers should offer a report escape. */
function looksUnsureAssistantAnswer(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /i('m| am) not sure|i don't know|not sure|cannot help|can't help|unable to|don't have enough|outside (my|of) (scope|knowledge)|file a (bug )?report|報告/.test(
      lower
    ) || /わかりません|分かりません|不明|報告して/.test(text)
  );
}

/** Panel regions, in DOM order. `lead` + `body` share the scroll container. */
const REGIONS = ['notice', 'header', 'lead', 'body', 'footer', 'brand'] as const;
type Region = (typeof REGIONS)[number];

/** Form fields whose value, focus and caret survive a region patch. */
const FIELDS = ['description', 'reporter-reply', 'magic-link-email', 'optin-email'] as const;
const BUILTIN: readonly string[] = ['bug', 'slow', 'visual', 'confusing', 'other'];
const FOCUSABLE = 'button:not([disabled]),textarea:not([disabled]),input:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

export class MushiWidget {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  /** Re-inject styles when OS light/dark flips while theme=auto|inherit. */
  private colorSchemeMq: MediaQueryList | null = null;
  private onColorSchemeChange: (() => void) | null = null;
  private config: Required<MushiWidgetConfig>;
  private callbacks: WidgetCallbacks;
  private locale: MushiLocale;
  private rc: ReporterCopy;
  private lang = 'en';
  private isOpen = false;
  private step: WidgetStep = 'report';

  // ─── Persistent DOM (built once; regions are patched, never rebuilt) ───
  private readonly styleEl: HTMLStyleElement;
  private styleKey = '';
  private readonly panel: HTMLDivElement;
  private readonly scroller: HTMLDivElement;
  private readonly regionEls = {} as Record<Region, HTMLElement>;
  private regionHtml: Partial<Record<Region, string>> = {};
  private readonly live: HTMLDivElement;
  private renderedStep: WidgetStep | null = null;
  private triggerEl: HTMLButtonElement | null = null;
  private triggerKey = '';
  private bannerEl: HTMLElement | null = null;
  private bannerKey = '';
  private toastEl: HTMLElement | null = null;
  /** Element focused before open; focus returns here on close (APG dialog). */
  private opener: HTMLElement | null = null;

  // ─── Report screen ─────────────────────────────────────────────
  /** Selected type chip: built-in id, `idea`, a custom category id, or null (none picked). */
  private chip: string | null = null;
  private intent: string | null = null;
  /** Host custom categories revealed under "More…". */
  private showAllCategories = false;
  /** Header overflow menu. */
  private showMoreNav = false;
  private screenshotAttached = false;
  private screenshotCapturing = false;
  private screenshotError = false;
  /** Why the last capture failed; drives the actionable hint under the tools. */
  private screenshotErrorReason: ScreenshotErrorReason | null = null;
  /** The reporter asked for (or marked up) the screenshot — an auto-capture on open doesn't count as saying something. */
  private screenshotByUser = false;
  private previewOpen = false;
  private allowScreenshotRemove = true;
  /** Unusable tools are hidden — a button whose handler no-ops reads as a bug. */
  private screenshotAvailable = true;
  private elementAvailable = true;
  /** Field values survive region patches and are the source of truth for validation. */
  private drafts: Record<string, string> = {};
  /** Data URL of the attached screenshot, rendered as a visible preview. */
  private screenshotPreview: string | null = null;
  private elementSelected = false;
  private elementCapturing = false;
  private elementError = false;
  private submitting = false;
  /** Hint element injected outside the shadow DOM during element selection. */
  private selectorHint: HTMLDivElement | null = null;
  private triggerVisible = true;
  private triggerShrunk = false;
  private triggerHiddenByScroll = false;
  private sdkFreshness: { latest: string | null; current: string; deprecated: boolean; message?: string | null } | null = null;
  /** Brand-footer ref (SDK sets it once hashed) + once-per-instance impression latch. */
  private brandRef: string | null = null;
  private brandImpressionSent = false;

  // ─── Your reports ──────────────────────────────────────────────
  private reporterReports: MushiReporterReport[] = [];
  private featureBoard: Array<Record<string, unknown>> = [];
  private reporterComments: MushiReporterComment[] = [];
  /** Server timeline for the open report, when the host SDK can fetch it. */
  private timeline: WidgetTimelineEvent[] | null = null;
  private pendingReplies: PendingReply[] = [];
  private replySeq = 0;
  private selectedReportId: string | null = null;
  /** One flag per surface: a reply never blanks the thread it was posted from. */
  private listLoading = false;
  private threadLoading = false;
  private actionPending = false;
  private reporterError: string | null = null;
  private threadError: string | null = null;
  private actionError: string | null = null;
  /** Reporter channels the host enabled and the server has configured (§4.1). */
  private channels = { email: false, push: false, emailPrefill: '' };
  private emailOptInOpen = false;
  private emailState: 'idle' | 'saving' | 'saved' | 'invalid' | 'error' = 'idle';
  private pushState: 'idle' | 'asking' | 'on' | 'error' = 'idle';

  private attachedLaunchers: Array<() => void> = [];
  private smartHideCleanup: (() => void) | null = null;
  private smartHideTimer: ReturnType<typeof setTimeout> | null = null;
  /** Captured at submit so the receipt time doesn't drift while it is on screen. */
  private submittedAt: Date | null = null;
  /** Pending success-state timer, cleared by destroy(). */
  private successTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Set on pointerdown inside the panel. A background patch that lands
   * between pointerdown and click replaces the button under the pointer and
   * the browser drops the click. render() defers while this is set (bounded,
   * so a lost pointerup can't freeze the panel).
   */
  private pointerDownAt: number | null = null;
  private renderDeferred = false;
  private readonly onPointerRelease = (): void => {
    this.pointerDownAt = null;
    if (!this.renderDeferred) return;
    this.renderDeferred = false;
    // After the click dispatches (it follows pointerup in the same task).
    setTimeout(() => this.render(), 0);
  };
  private rewardsState: WidgetRewardsState | null = null;
  private leaderboardEntries: Array<{
    display_name: string;
    tier_name: string | null;
    total_points: number;
    points_30d: number;
  }> | null = null;
  private leaderboardLoading = false;
  /** Server-confirmed id for the just-submitted report (receipt + Track it). */
  private lastReportId: string | null = null;
  private lastSubmitQueuedOffline = false;
  private lastSubmitFailureKind: WidgetSubmitOutcome['failureKind'];
  private lastSubmitScreenshotDropped = false;
  /** Whether the user has clicked ✕ on the header banner this session. */
  private bannerDismissed = false;
  private bannerResizeObserver: ResizeObserver | null = null;
  /** Persisted FAB position when draggable is enabled. */
  private fabPos: { x: number; y: number } | null = null;
  /** Cleanup fn for visualViewport keyboard listener. */
  private vvCleanup: (() => void) | null = null;
  /** Host-app user identity from `identify()` — shown as "Reporting as <name>". */
  private identifiedUser: { name?: string; email?: string } | null = null;
  /** Mushi tester session JWT — set after in-widget sign-in or by mushi.ts. */
  private testerJwt: string | null = null;
  private testerInfo: { id: string; public_handle: string | null; display_name: string | null } | null = null;
  private crossAppReports: MushiCrossAppReport[] | null = null;
  private crossAppLoading = false;
  private globalLeaderboard: MushiLeaderboardEntry[] | null = null;
  private globalLeaderboardLoading = false;
  private testerReputation: MushiTesterReputation | null = null;
  private magicLinkSent = false;
  private magicLinkEmail = '';
  private magicLinkError = '';
  private magicLinkSending = false;

  // ─── Assistant ───────────────────────────────────────────────────
  private assistantTurns: AssistantTurn[] = [];
  private assistantThreadId: string | null = null;
  private assistantSending = false;
  private assistantError: string | null = null;

  constructor(config: MushiWidgetConfig = {}, callbacks: WidgetCallbacks) {
    this.config = {
      position: config.position ?? 'bottom-right',
      anchor: config.anchor ?? {},
      theme: config.theme ?? 'auto',
      // Falsy-OR (NOT `??`) on purpose: `triggerText: ''` would render a
      // labelless, glyphless trigger. Treat '' like omitted.
      triggerText: config.triggerText || '🐛',
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
      brandFooter: config.brandFooter ?? false,
      outdatedBanner: config.outdatedBanner ?? 'auto',
      screenshotSensitiveHint: config.screenshotSensitiveHint ?? true,
      betaMode: config.betaMode ?? {},
      minDescriptionLength: config.minDescriptionLength ?? 8,
      dashboardUrl: config.dashboardUrl ?? '',
      responseSlaLabel: config.responseSlaLabel ?? '',
      featureRequestCard: config.featureRequestCard ?? true,
      // Empty = the localized "Idea" chip label.
      featureRequestLabel: config.featureRequestLabel ?? '',
      featureRequestDescription: config.featureRequestDescription ?? '',
      avoidSelectors: config.avoidSelectors ?? [],
      categories: config.categories ?? [],
      accent: config.accent ?? '',
      accentText: config.accentText ?? '',
    };
    this.callbacks = callbacks;
    this.locale = getLocale(this.config.locale === 'auto' ? undefined : this.config.locale);
    this.rc = this.resolveCopy();

    // Same-tab Ask transcript resume (sessionStorage only — no login gate).
    const saved = loadAssistantSession();
    if (saved?.turns.length) {
      this.assistantTurns = saved.turns;
      this.assistantThreadId = saved.threadId;
    }

    this.host = document.createElement('div');
    this.host.id = 'mushi-mushi-widget';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.styleEl = document.createElement('style');
    this.panel = document.createElement('div');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'mushi-title');
    this.scroller = document.createElement('div');
    this.scroller.className = 'mushi-scroll';
    for (const r of REGIONS) {
      const el = document.createElement('div');
      el.className = `mushi-${r}`;
      el.dataset.region = r;
      this.regionEls[r] = el;
    }
    this.scroller.append(this.regionEls.lead, this.regionEls.body);
    this.live = document.createElement('div');
    this.live.className = 'mushi-sr';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.panel.append(this.regionEls.notice, this.regionEls.header, this.scroller, this.regionEls.footer, this.regionEls.brand, this.live);
    this.shadow.append(this.styleEl, this.panel);
    this.bindPanelEvents();
  }

  /** Locale code for core's reporter copy; 'auto' resolves through the browser. */
  private resolveCopy(): ReporterCopy {
    const tag = this.config.locale === 'auto'
      ? (typeof navigator !== 'undefined' ? navigator.language ?? '' : '')
      : this.config.locale;
    this.lang = (tag || 'en').split(/[-_]/)[0].toLowerCase();
    return resolveReporterCopy(this.lang);
  }

  mount(): void {
    if (this.host.isConnected) return;
    this.syncHostChromeState();
    document.body.appendChild(this.host);
    window.addEventListener('pointerup', this.onPointerRelease, true);
    window.addEventListener('pointercancel', this.onPointerRelease, true);
    this.syncAttachedLaunchers();
    this.syncSmartHide();
    this.bindColorSchemeListener();
    this.render();
  }

  getIsMounted(): boolean {
    return this.host.isConnected;
  }

  updateConfig(config: MushiWidgetConfig = {}): void {
    // Detect a meaningful banner change from the async runtime/dashboard config
    // so a banner the user dismissed earlier comes back when the operator
    // turns it back on or pushes new copy.
    const prevTrigger = this.config.trigger;
    const prevBannerConfig = JSON.stringify(this.config.bannerConfig ?? null);
    const defined = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as MushiWidgetConfig;
    this.config = {
      ...this.config,
      ...defined,
      ...(config.triggerText !== undefined ? { triggerText: config.triggerText || '🐛' } : {}),
    } as Required<MushiWidgetConfig>;
    this.locale = getLocale(this.config.locale === 'auto' ? undefined : this.config.locale);
    this.rc = this.resolveCopy();
    const triggerBecameBanner = this.config.trigger === 'banner' && prevTrigger !== 'banner';
    const bannerConfigChanged = JSON.stringify(this.config.bannerConfig ?? null) !== prevBannerConfig;
    if (triggerBecameBanner || bannerConfigChanged) {
      this.bannerDismissed = false;
    }
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

  // ─── Open / close ─────────────────────────────────────────────────────────

  open(options?: { category?: MushiReportCategory | string; featureRequest?: boolean }): void {
    if (this.isOpen) return;
    this.rememberOpener();
    this.isOpen = true;
    this.screenshotAttached = false;
    this.screenshotCapturing = false;
    this.screenshotError = false;
    this.screenshotErrorReason = null;
    this.screenshotPreview = null;
    this.screenshotByUser = false;
    this.previewOpen = false;
    this.elementSelected = false;
    this.elementCapturing = false;
    this.elementError = false;
    this.submitting = false;
    this.submittedAt = null;
    this.removeSelectorHint();
    this.lastReportId = null;
    this.lastSubmitQueuedOffline = false;
    this.lastSubmitFailureKind = undefined;
    this.lastSubmitScreenshotDropped = false;
    this.emailOptInOpen = false;
    this.emailState = 'idle';
    // Drafts only survive patches WITHIN a session.
    this.drafts = {};
    this.intent = null;
    this.step = 'report';
    const cat = options?.category;
    const custom = cat ? this.resolveCustomCategory(cat) : undefined;
    this.chip = options?.featureRequest ? 'idea' : custom ? cat! : cat && cat !== 'other' && BUILTIN.includes(cat) ? cat : null;
    this.showAllCategories = Boolean(custom);
    this.removeToast();
    this.render();
    this.callbacks.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.showAllCategories = false;
    this.showMoreNav = false;
    this.render();
    this.restoreOpenerFocus();
    this.callbacks.onClose();
  }

  /** Open the panel directly on the assistant ("Ask") view. */
  openAssistantTab(): void {
    if (!this.callbacks.assistantEnabled) {
      // Never a silent no-op: fall back to the report screen.
      this.open();
      return;
    }
    this.ensureOpen();
    this.step = 'assistant';
    this.assistantError = null;
    this.render();
  }

  private ensureOpen(): void {
    if (this.isOpen) return;
    this.rememberOpener();
    this.isOpen = true;
    this.callbacks.onOpen();
  }

  /** Send one assistant turn and re-render as the reply arrives. */
  async sendAssistantMessage(message: string): Promise<void> {
    const text = message.trim();
    if (!text || this.assistantSending || !this.callbacks.onAssistantAsk) return;
    this.assistantSending = true;
    this.assistantError = null;
    this.assistantTurns.push({ role: 'user', text });
    this.persistAssistantSession();
    this.render();
    try {
      const reply = await this.callbacks.onAssistantAsk(text, this.assistantThreadId);
      if (reply) {
        if (reply.threadId) this.assistantThreadId = reply.threadId;
        if (reply.kind === 'clarify') {
          this.assistantTurns.push({
            role: 'assistant',
            text: reply.question ?? 'Could you tell me a bit more?',
            ...(reply.options && reply.options.length ? { options: reply.options } : {}),
            offerReport: true,
          });
        } else {
          const answerText = reply.text ?? '…';
          this.assistantTurns.push({
            role: 'assistant',
            text: answerText,
            ...(looksUnsureAssistantAnswer(answerText) ? { offerReport: true } : {}),
          });
        }
        this.persistAssistantSession();
      } else {
        this.assistantError = this.locale.assistant.errors.noResponse;
      }
    } catch {
      this.assistantError = this.locale.assistant.errors.generic;
    } finally {
      this.assistantSending = false;
      this.render();
      this.scroller.scrollTop = this.scroller.scrollHeight;
    }
  }

  /** Persist Ask turns for same-tab reload survival (UX only). */
  private persistAssistantSession(): void {
    saveAssistantSession({ turns: this.assistantTurns, threadId: this.assistantThreadId });
  }

  /** Clear Ask transcript (e.g. host reset). Keeps Ask login-free. */
  clearAssistantTranscript(): void {
    this.assistantTurns = [];
    this.assistantThreadId = null;
    this.assistantError = null;
    clearAssistantSession();
    if (this.step === 'assistant') this.render();
  }

  /**
   * Briefly highlight the trigger (a soft pulse) without opening the panel.
   * No-op when the trigger isn't rendered.
   */
  pulseTrigger(): void {
    if (this.isOpen) return;
    const trigger = this.triggerEl;
    if (!trigger) return;
    trigger.classList.add('mushi-trigger-pulse');
    window.setTimeout(() => trigger.classList.remove('mushi-trigger-pulse'), 2400);
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
    // The capture attempt is over either way; success clears a stale error.
    this.screenshotCapturing = false;
    if (attached) {
      this.screenshotError = false;
      this.screenshotErrorReason = null;
    } else {
      this.screenshotPreview = null;
      this.screenshotByUser = false;
      this.previewOpen = false;
    }
    if (this.isOpen) this.render();
  }

  /** Provide the captured screenshot data URL so the widget can preview it. */
  setScreenshotPreview(dataUrl: string | null): void {
    this.screenshotPreview = dataUrl;
    if (this.isOpen) this.render();
  }

  /** Privacy caption beside the preview: `false` hides it, a string replaces it, else the localized default. */
  private resolveScreenshotHint(): string | null {
    const v = this.config.screenshotSensitiveHint;
    if (v === false) return null;
    if (typeof v === 'string') return v.trim() ? v : null;
    return this.locale.step3.screenshotSensitiveHint;
  }

  setAllowScreenshotRemove(allow: boolean): void {
    this.allowScreenshotRemove = allow;
    if (this.isOpen) this.render();
  }

  /** Show/hide the attachment tools based on what the SDK can actually do. */
  setCaptureAvailability(availability: { screenshot?: boolean; element?: boolean }): void {
    this.screenshotAvailable = availability.screenshot ?? this.screenshotAvailable;
    this.elementAvailable = availability.element ?? this.elementAvailable;
    if (this.isOpen) this.render();
  }

  setElementSelected(selected: boolean): void {
    this.elementSelected = selected;
    this.elementCapturing = false;
    if (selected) this.elementError = false;
    this.removeSelectorHint();
    if (this.isOpen) this.render();
  }

  /** Surface a failed/cancelled element-selection attempt (mirrors setScreenshotError). */
  setElementError(failed: boolean): void {
    this.elementError = failed;
    this.elementCapturing = false;
    this.removeSelectorHint();
    if (this.isOpen) this.render();
  }

  setScreenshotCapturing(capturing: boolean): void {
    this.screenshotCapturing = capturing;
    this.screenshotError = false;
    this.screenshotErrorReason = null;
    if (this.isOpen) this.render();
  }

  /**
   * Flag (or clear) a failed capture. A call without a reason keeps the more
   * specific one an earlier call recorded for the same attempt.
   */
  setScreenshotError(failed: boolean, reason?: ScreenshotErrorReason): void {
    this.screenshotError = failed;
    this.screenshotErrorReason = failed ? (reason ?? this.screenshotErrorReason ?? 'error') : null;
    this.screenshotCapturing = false;
    if (this.isOpen) this.render();
  }

  setElementCapturing(capturing: boolean): void {
    this.elementCapturing = capturing;
    if (capturing) {
      this.elementError = false;
      this.showSelectorHint();
    } else {
      this.removeSelectorHint();
    }
    if (this.isOpen) this.render();
  }

  /** Hide the panel (keep the host) during element selection so page clicks reach the page. */
  hidePanel(): void {
    this.panel.style.display = 'none';
  }

  showPanel(): void {
    this.panel.style.display = '';
  }

  private showSelectorHint(): void {
    this.removeSelectorHint();
    const hint = document.createElement('div');
    hint.id = 'mushi-selector-hint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    hint.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483646;background:rgba(17,17,17,.92);color:#fff;font:12px/1.4 system-ui,sans-serif;padding:8px 16px;border-radius:20px;pointer-events:none;white-space:nowrap;box-shadow:0 2px 12px rgba(0,0,0,.35)';
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

  setSdkFreshness(info: { latest: string | null; current: string; deprecated: boolean; message?: string | null }): void {
    this.sdkFreshness = info;
    if (this.isOpen) this.render();
  }

  setBrandRef(ref: string | null): void {
    if (this.brandRef === ref) return;
    this.brandRef = ref;
    if (this.isOpen) this.render();
  }

  setRewardsState(state: WidgetRewardsState | null): void {
    this.rewardsState = state;
    if (this.isOpen) this.render();
  }

  setLeaderboard(entries: Array<{ display_name: string; tier_name: string | null; total_points: number; points_30d: number; }> | null, loading = false): void {
    this.leaderboardEntries = entries;
    this.leaderboardLoading = loading;
    if (this.isOpen) this.render();
  }

  /**
   * Which opt-in channels to offer (§4.1). The SDK passes the intersection of
   * the host's `notifications` config and the server's configured channels.
   */
  setReporterChannels(channels: { email?: boolean; push?: boolean; emailPrefill?: string }): void {
    this.channels = { email: Boolean(channels.email), push: Boolean(channels.push), emailPrefill: channels.emailPrefill ?? '' };
    if (this.isOpen) this.render();
  }

  // ── Community public setters (called by mushi.ts after API calls) ──────────

  setIdentifiedUser(user: { name?: string; email?: string } | null): void {
    this.identifiedUser = user;
    if (this.isOpen) this.render();
  }

  setTesterSession(jwt: string | null, info: { id: string; public_handle: string | null; display_name: string | null } | null): void {
    this.testerJwt = jwt;
    this.testerInfo = info;
    if (this.isOpen) this.render();
  }

  setGlobalLeaderboard(entries: MushiLeaderboardEntry[] | null, loading = false): void {
    this.globalLeaderboard = entries;
    this.globalLeaderboardLoading = loading;
    if (this.isOpen) this.render();
  }

  setCrossAppReports(reports: MushiCrossAppReport[] | null, loading = false): void {
    this.crossAppReports = reports;
    this.crossAppLoading = loading;
    if (this.isOpen) this.render();
  }

  setTesterReputation(rep: MushiTesterReputation | null): void {
    this.testerReputation = rep;
    if (this.isOpen) this.render();
  }

  destroy(): void {
    window.removeEventListener('pointerup', this.onPointerRelease, true);
    window.removeEventListener('pointercancel', this.onPointerRelease, true);
    if (this.successTimer !== null) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    if (this.smartHideTimer !== null) {
      clearTimeout(this.smartHideTimer);
      this.smartHideTimer = null;
    }
    this.unbindColorSchemeListener();
    this.smartHideCleanup?.();
    this.smartHideCleanup = null;
    this.teardownViewportHandlers();
    this.attachedLaunchers.forEach((cleanup) => cleanup());
    this.attachedLaunchers = [];
    this.removeSelectorHint();
    this.removeToast();
    this.removeBodyNudge();
    this.host.remove();
  }

  /** Live-restyle when OS prefers-color-scheme changes (theme auto/inherit only). */
  private bindColorSchemeListener(): void {
    this.unbindColorSchemeListener();
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const theme = this.config.theme;
    if (theme !== 'auto' && theme !== 'inherit') return;
    this.colorSchemeMq = window.matchMedia('(prefers-color-scheme: dark)');
    this.onColorSchemeChange = () => {
      if (this.host.isConnected) this.render();
    };
    // Some hosts return a MediaQueryList without the EventTarget API — never
    // let live-theme wiring throw on mount.
    if (typeof this.colorSchemeMq.addEventListener === 'function') {
      this.colorSchemeMq.addEventListener('change', this.onColorSchemeChange);
    } else if (typeof this.colorSchemeMq.addListener === 'function') {
      this.colorSchemeMq.addListener(this.onColorSchemeChange);
    }
  }

  private unbindColorSchemeListener(): void {
    if (this.colorSchemeMq && this.onColorSchemeChange) {
      if (typeof this.colorSchemeMq.removeEventListener === 'function') {
        this.colorSchemeMq.removeEventListener('change', this.onColorSchemeChange);
      } else if (typeof this.colorSchemeMq.removeListener === 'function') {
        this.colorSchemeMq.removeListener(this.onColorSchemeChange);
      }
    }
    this.colorSchemeMq = null;
    this.onColorSchemeChange = null;
  }

  /* ── Host chrome contract ────────────────────────────────────────────────
     The host element must never create an invisible full-screen touch blocker.
     We own these inline styles; only the shadow internals opt back into
     pointer events. Idempotent. */
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

  /** True when an element matching `hideOnSelector` is in the host document (invalid selectors are ignored). */
  private isSuppressedByHost(): boolean {
    if (!this.config.hideOnSelector || typeof document === 'undefined') return false;
    try {
      return Boolean(document.querySelector(this.config.hideOnSelector));
    } catch {
      return false;
    }
  }

  /** Host-layer health snapshot for `Mushi.diagnose()`. */
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
    const widgetSuppressed = this.isSuppressedByHost() || this.isRouteHidden() || !this.triggerVisible;
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
      if (smart.onScroll === 'hide') this.triggerHiddenByScroll = true;
      else this.triggerShrunk = true;
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

  /** Height of the banner in px — used as a fallback before first layout. */
  private static readonly BANNER_HEIGHT = 36;

  /** CSS property applied to documentElement so host-app content doesn't slide under the banner. */
  private static readonly BODY_NUDGE_PROP = '--mushi-banner-offset';

  private applyBodyNudge(position: 'top' | 'bottom', heightPx = MushiWidget.BANNER_HEIGHT): void {
    const h = `${heightPx}px`;
    document.documentElement.style.setProperty(MushiWidget.BODY_NUDGE_PROP, h);
    if (position === 'top') {
      if (document.body.dataset.mushiBannerNudged === 'top') {
        document.body.style.paddingTop = h;
      } else if (!document.body.style.paddingTop) {
        document.body.style.paddingTop = h;
        document.body.dataset.mushiBannerNudged = 'top';
      }
    } else {
      if (document.body.dataset.mushiBannerNudged === 'bottom') {
        document.body.style.paddingBottom = h;
      } else if (!document.body.style.paddingBottom) {
        document.body.style.paddingBottom = h;
        document.body.dataset.mushiBannerNudged = 'bottom';
      }
    }
  }

  /** Track the real banner height (safe-area insets, wrapped text) into --mushi-banner-offset. */
  private trackBannerHeight(banner: HTMLElement, position: 'top' | 'bottom'): void {
    const update = () => {
      const h = banner.getBoundingClientRect().height;
      if (h > 0) this.applyBodyNudge(position, h);
    };
    requestAnimationFrame(update);
    if (typeof ResizeObserver !== 'undefined') {
      this.bannerResizeObserver = new ResizeObserver(update);
      this.bannerResizeObserver.observe(banner);
    }
  }

  private removeBodyNudge(): void {
    this.bannerResizeObserver?.disconnect();
    this.bannerResizeObserver = null;
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

  /** Rebuild the banner only when something it shows changed. */
  private syncBanner(): void {
    const key = JSON.stringify([
      this.config.trigger, this.bannerDismissed, this.triggerVisible, this.isRouteHidden(),
      this.isSuppressedByHost(), this.config.bannerConfig, this.config.zIndex, this.lang,
    ]);
    if (key === this.bannerKey && (this.bannerEl?.isConnected ?? true)) return;
    this.bannerKey = key;
    this.bannerEl?.remove();
    this.bannerEl = null;
    this.bannerResizeObserver?.disconnect();
    this.bannerResizeObserver = null;
    this.renderBanner();
  }

  private renderBanner(): void {
    if (this.config.trigger !== 'banner') return;
    // Clear the nudge on every suppression path so hide() / route rules never
    // leave the host page with permanent padding.
    if (this.bannerDismissed || !this.triggerVisible || this.isRouteHidden() || this.isSuppressedByHost()) {
      this.removeBodyNudge();
      return;
    }

    const bc = this.config.bannerConfig ?? {};
    // `subtle` is the default (Plan 018 §1.4); `brand` and `neon` stay opt-in.
    const variant  = bc.variant  ?? 'subtle';
    const position = bc.position ?? 'top';
    const message  = bc.message?.trim() ?? '';
    const richLayout = message.length > 0;
    const bugLabel = bc.bugCta   ?? '🐛 Report a bug';
    const showFeat = bc.featureCta !== false;
    const featLabel = bc.featureCtaLabel ?? 'Request feature';
    const myReports = `📬 ${this.locale.panel.yourReports}`;
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

      appendAction(bugLabel, () => this.open({ category: 'bug' }));
      if (showFeat) {
        appendDivider(true);
        appendAction(featLabel, () => this.open({ featureRequest: true }), true);
      }
      for (const link of bc.links ?? []) {
        const linkLabel = link.label?.trim();
        if (!linkLabel) continue;
        // Only http(s) and same-origin paths render as anchors: a `javascript:`
        // href here would be stored XSS in every embedding site.
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
      appendDivider(true);
      appendAction(myReports, () => this.openReporter(), true);
      banner.appendChild(nav);
      // Dismiss sits outside the actions <nav> so overflow can't clip it.
      banner.appendChild(dismissBtn);
    } else {
      const bugBtn = document.createElement('button');
      bugBtn.className = 'mushi-banner-btn';
      bugBtn.textContent = bugLabel;
      bugBtn.addEventListener('click', () => this.open({ category: 'bug' }));
      banner.appendChild(bugBtn);

      if (showFeat) {
        const featBtn = document.createElement('button');
        featBtn.className = 'mushi-banner-btn';
        featBtn.textContent = featLabel;
        featBtn.addEventListener('click', () => this.open({ featureRequest: true }));
        banner.appendChild(featBtn);
      }

      const myReportsBtn = document.createElement('button');
      myReportsBtn.className = 'mushi-banner-my-reports';
      myReportsBtn.textContent = myReports;
      myReportsBtn.addEventListener('click', () => this.openReporter());
      banner.appendChild(myReportsBtn);
      banner.appendChild(dismissBtn);
    }

    this.shadow.insertBefore(banner, this.panel);
    this.bannerEl = banner;
    // Nudge with the fallback height on the first paint, then re-measure.
    this.applyBodyNudge(position);
    this.trackBannerHeight(banner, position);
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
      const root = document.documentElement;
      const colorScheme = root.getAttribute('data-color-scheme') ||
        root.getAttribute('data-theme') ||
        root.getAttribute('color-scheme') || '';
      if (/dark/i.test(colorScheme)) return 'dark';
      if (/light/i.test(colorScheme)) return 'light';
      if (root.classList.contains('dark')) return 'dark';
      if (root.classList.contains('light')) return 'light';
      try {
        const bg = getComputedStyle(root).backgroundColor;
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const L = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
          return L < 128 ? 'dark' : 'light';
        }
      } catch { /* ignore */ }
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) {
      return 'dark';
    }
    return 'light';
  }

  /** Parse any CSS colour the browser understands into [r, g, b] (null when it can't). */
  private probeRgb(color: string): [number, number, number] | null {
    const s = this.host.style;
    const prev = s.color;
    s.color = color;
    const m = (this.host.isConnected ? getComputedStyle(this.host).color : s.color).match(/(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/);
    s.color = prev;
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  /**
   * Accent resolution (Plan 018 §1.4, first match wins): `widget.accent` →
   * the host's `--mushi-accent` on :root → `accent-color` of <html> →
   * `<meta name="theme-color">` → the foreground ink (''). Page-sourced values
   * must parse as a colour and keep 3:1 against the panel background, or the
   * Send button could vanish into a page-coloured accent.
   */
  private resolveAccent(dark: boolean): { accent: string; accentFg: string } {
    const config = safeCssColor(this.config.accent ?? '');
    const candidates: string[] = [];
    if (!config && typeof document !== 'undefined') {
      try {
        const rootStyle = getComputedStyle(document.documentElement);
        candidates.push(rootStyle.getPropertyValue('--mushi-accent').trim());
        const ac = rootStyle.getPropertyValue('accent-color').trim();
        if (ac && ac !== 'auto') candidates.push(ac);
      } catch { /* detached / no layout */ }
      candidates.push(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')?.trim() ?? '');
    }
    const bg: [number, number, number] = dark ? [18, 18, 18] : [255, 255, 255];
    let accent = config;
    for (const c of candidates) {
      if (accent) break;
      const safe = safeCssColor(c);
      const rgb = safe ? this.probeRgb(safe) : null;
      if (rgb && contrastingInk(rgb, bg).ratio >= 3) accent = safe;
    }
    if (!accent) return { accent: '', accentFg: '' };
    const rgb = this.probeRgb(accent);
    return { accent, accentFg: safeCssColor(this.config.accentText ?? '') || (rgb ? contrastingInk(rgb).ink : '') };
  }

  /** Style + banner + trigger. Each rebuilds only when its inputs changed. */
  private syncChrome(): void {
    const theme = this.getTheme();
    const { accent, accentFg } = this.resolveAccent(theme === 'dark');
    const styleKey = `${theme}|${accent}|${accentFg}`;
    if (styleKey !== this.styleKey) {
      this.styleKey = styleKey;
      this.styleEl.textContent = getWidgetStyles(theme, accent, accentFg);
    }
    this.syncBanner();
    this.syncTrigger();
  }

  private syncTrigger(): void {
    const show = this.shouldRenderTrigger();
    const pos = this.config.position;
    const effective = show ? this.effectiveTrigger() : '';
    const key = JSON.stringify([show, effective, pos, this.triggerShrunk, this.config.triggerText, this.config.zIndex, this.config.draggable, this.lang]);
    if (key !== this.triggerKey || (show && !this.triggerEl?.isConnected)) {
      this.triggerKey = key;
      this.triggerEl?.remove();
      this.triggerEl = show ? this.buildTrigger(effective) : null;
    }
    if (this.triggerEl) {
      this.triggerEl.setAttribute('aria-expanded', String(this.isOpen));
      this.applyInsetVars(this.triggerEl);
    }
  }

  private buildTrigger(effective: string): HTMLButtonElement {
    const trigger = document.createElement('button');
    trigger.className = `mushi-trigger ${this.config.position}${effective === 'edge-tab' ? ' edge-tab' : ''}${this.triggerShrunk ? ' shrunk' : ''}`;
    trigger.textContent = this.config.triggerText;
    trigger.setAttribute('aria-label', this.locale.widget.trigger);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.style.zIndex = String(this.config.zIndex);
    trigger.addEventListener('click', () => {
      if (this.isOpen) this.close();
      else this.open();
    });
    // Keyboard nudge for a draggable FAB.
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
    if (this.config.draggable) this.attachDragHandlers(trigger);
    this.shadow.insertBefore(trigger, this.panel);
    // Apply a persisted drag position once the trigger is in the DOM, measured
    // from its natural CSS position (moveFab re-sets fabPos, clamped).
    if (this.fabPos && this.config.draggable) {
      const savedPos = this.fabPos;
      this.fabPos = { x: 0, y: 0 };
      this.moveFab(trigger, savedPos.x, savedPos.y, false);
    }
    return trigger;
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private render(): void {
    if (this.isOpen && this.pointerDownAt !== null && Date.now() - this.pointerDownAt < 2000) {
      // A pointerup released outside the window may never arrive — flush anyway.
      if (!this.renderDeferred) setTimeout(() => { if (this.renderDeferred) this.render(); }, 2000);
      this.renderDeferred = true;
      return;
    }
    this.renderDeferred = false;
    this.syncChrome();
    this.renderPanel();
  }

  private renderPanel(): void {
    const panel = this.panel;
    panel.className = `mushi-panel ${this.config.position}${this.isOpen ? ' open' : ' closed'}`;
    panel.style.zIndex = String(this.config.zIndex + 1);
    this.applyInsetVars(panel);
    if (!this.isOpen) {
      if (this.renderedStep !== null) {
        for (const r of REGIONS) this.regionEls[r].innerHTML = '';
        this.regionHtml = {};
        this.renderedStep = null;
        this.teardownViewportHandlers();
      }
      return;
    }
    const ctx = this.renderCtx();
    const view = renderView(ctx);
    const next: Record<Region, string> = {
      notice: renderOutdatedBanner(ctx),
      header: view.header,
      lead: view.lead,
      body: view.body,
      footer: view.footer,
      brand: renderBrandFooter(ctx),
    };
    const viewChanged = this.renderedStep !== this.step;
    const opening = this.renderedStep === null;
    // Snapshot what the reporter is doing before any node goes away.
    const active = this.shadow.activeElement as HTMLElement | null;
    const activeKey = active ? focusKey(active) : null;
    this.captureFormDrafts();
    let patched = false;
    for (const r of REGIONS) {
      if (this.regionHtml[r] === next[r]) continue;
      this.regionHtml[r] = next[r];
      this.regionEls[r].innerHTML = next[r];
      patched = true;
    }
    this.renderedStep = this.step;
    if (patched) {
      bindFaviconFallbacks(panel);
      this.restoreFormDrafts();
    }
    if (viewChanged) {
      this.scroller.scrollTop = 0;
      if (!opening) {
        // Cross-fade between surfaces (CSS honours reduced motion).
        panel.classList.remove('mushi-swap');
        void panel.offsetWidth;
        panel.classList.add('mushi-swap');
      }
      this.focusView();
    } else if (active && !active.isConnected && activeKey) {
      // A patch replaced the focused control: put focus on its replacement.
      (panel.querySelector<HTMLElement>(activeKey))?.focus();
    }
    if (opening) this.attachViewportHandlers(panel);
    if (!this.brandImpressionSent && this.config.brandFooter === true) {
      this.brandImpressionSent = true;
      this.callbacks.onBrandFooterImpression?.();
    }
  }

  /** On a new surface: the report textarea, else the title, so screen readers announce where they are. */
  private focusView(): void {
    const target = this.panel.querySelector<HTMLElement>('[data-role="description"]')
      ?? this.panel.querySelector<HTMLElement>('#mushi-title');
    if (!target) return;
    if (target.id === 'mushi-title') target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }

  /** Snapshot field values + caret from the live DOM before a patch. */
  private captureFormDrafts(): void {
    for (const role of FIELDS) {
      const el = this.panel.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-role="${role}"]`);
      if (el) this.drafts[role] = el.value;
    }
    const active = this.shadow.activeElement as HTMLTextAreaElement | null;
    const role = active?.dataset?.role;
    if (role && (FIELDS as readonly string[]).includes(role)) {
      this.drafts._focus = role;
      this.drafts._sel = `${active!.selectionStart ?? 0},${active!.selectionEnd ?? 0}`;
    } else {
      delete this.drafts._focus;
    }
  }

  /** Replay values (and focus + caret) into fields a patch just created. */
  private restoreFormDrafts(): void {
    for (const role of FIELDS) {
      const el = this.panel.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-role="${role}"]`);
      const value = this.drafts[role];
      if (!el || !value || el.value === value) continue;
      el.value = value;
      if (this.drafts._focus === role && this.shadow.activeElement !== el) {
        el.focus();
        const [a, b] = (this.drafts._sel ?? '').split(',').map(Number);
        try { el.setSelectionRange(a, b); } catch { /* some inputs reject it */ }
      }
    }
  }

  /** Queries `avoidSelectors` and returns a top offset clearing all of them, or null. */
  private computeAvoidTopPx(gap = 8): number | null {
    const sels = this.config.avoidSelectors;
    if (!sels?.length) return null;
    let maxBottom = 0;
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > maxBottom && r.width > 0 && r.height > 0) maxBottom = r.bottom;
      } catch { /* invalid selector — skip silently */ }
    }
    return maxBottom > 0 ? Math.ceil(maxBottom) + gap : null;
  }

  /** Bottom offset so a bottom-anchored trigger clears avoided elements (tab bars, fixed CTAs). */
  private computeAvoidBottomPx(gap = 8): number | null {
    const sels = this.config.avoidSelectors;
    if (!sels?.length) return null;
    let maxClearance = 0;
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const clearance = window.innerHeight - r.top + gap;
          if (clearance > maxClearance) maxClearance = clearance;
        }
      } catch { /* invalid selector — skip silently */ }
    }
    return maxClearance > 0 ? Math.ceil(maxClearance) : null;
  }

  private applyInsetVars(el: HTMLElement): void {
    const { anchor } = this.config;
    if (anchor && Object.keys(anchor).length > 0) {
      (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
        const value = anchor[edge];
        if (value !== undefined) el.style.setProperty(`--mushi-${edge}`, value);
      });
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
    }
    el.style.setProperty('--mushi-safe-area', this.config.respectSafeArea ? '1' : '0');

    // Measured clearance from avoidSelectors always wins on the anchored edge.
    const isTopAnchored = anchor?.top !== undefined || this.config.position?.startsWith('top');
    const isBottomAnchored = anchor?.bottom !== undefined || this.config.position?.startsWith('bottom') || !this.config.position;
    if (isTopAnchored) {
      const avoidPx = this.computeAvoidTopPx();
      if (avoidPx !== null) el.style.setProperty('--mushi-top', `${avoidPx}px`);
    }
    if (isBottomAnchored) {
      const avoidBottomPx = this.computeAvoidBottomPx();
      if (avoidBottomPx !== null) el.style.setProperty('--mushi-bottom', `${avoidBottomPx}px`);
    }
  }

  // ─── Draggable FAB ──────────────────────────────────────────────────────────

  /** Storage key for the FAB position, scoped to projectId when available. */
  private fabStorageKey(): string {
    const id = (this.config as unknown as Record<string, unknown>)['projectId'] ?? '';
    return `mushi_fab_pos${id ? `_${id}` : ''}`;
  }

  /**
   * Move the FAB to a translated offset (relative to its CSS anchor), clamped
   * inside the viewport safe area, optionally snapping to the nearest edge.
   * The base position is derived by subtracting the applied drag offset.
   */
  private moveFab(trigger: HTMLElement, x: number, y: number, snap: boolean): void {
    const d = this.config.draggable;
    const axis = d && typeof d === 'object' ? (d.axis ?? 'both') : 'both';
    const W = window.innerWidth;
    const H = window.innerHeight;
    const btnW = trigger.offsetWidth || 52;
    const btnH = trigger.offsetHeight || 52;
    const rootStyle = getComputedStyle(document.documentElement);
    const sai = (side: string) => parseInt(rootStyle.getPropertyValue(`--sai-${side}`) || '0') || 0;
    const safeL = sai('left');
    const safeR = sai('right');
    const safeT = sai('top');
    const safeB = sai('bottom');
    const margin = 8;

    const rect = trigger.getBoundingClientRect();
    const baseLeft = rect.left - (this.fabPos?.x ?? 0);
    const baseTop = rect.top - (this.fabPos?.y ?? 0);
    const minX = (safeL + margin) - baseLeft;
    const maxX = (W - safeR - margin - btnW) - baseLeft;
    const minY = (safeT + margin) - baseTop;
    const maxY = (H - safeB - margin - btnH) - baseTop;
    const newY = axis === 'x' ? 0 : Math.max(minY, Math.min(maxY, y));
    let finalX = axis === 'y' ? 0 : Math.max(minX, Math.min(maxX, x));
    if (snap) {
      const shouldSnap = d === true || (typeof d === 'object' && (d.snapToEdge ?? true));
      if (shouldSnap && axis !== 'y') {
        finalX = rect.left + btnW / 2 < W / 2
          ? (safeL + margin) - baseLeft
          : (W - safeR - margin - btnW) - baseLeft;
      }
    }

    this.fabPos = { x: finalX, y: newY };
    trigger.style.setProperty('--mushi-drag-x', `${finalX}px`);
    trigger.style.setProperty('--mushi-drag-y', `${newY}px`);
    trigger.style.setProperty('--mushi-drag-active', '1');

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
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') this.fabPos = parsed;
      }
    } catch { /* ignore */ }
  }

  /** Attach Pointer Events-based drag to the trigger element. */
  private attachDragHandlers(trigger: HTMLElement): void {
    if (this.fabPos === null) this.loadFabPos();
    let startX = 0, startY = 0;
    let originX = 0, originY = 0;
    let dragging = false;
    let moved = false;
    const DRAG_THRESHOLD = 6;

    trigger.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      trigger.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      const cur = this.fabPos ?? { x: 0, y: 0 };
      originX = cur.x;
      originY = cur.y;
      dragging = true;
      moved = false;
    });
    trigger.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        moved = true;
        trigger.classList.add('dragging');
      }
      if (moved) {
        e.preventDefault();
        this.moveFab(trigger, originX + dx, originY + dy, false);
      }
    });
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      trigger.classList.remove('dragging');
      if (moved) {
        this.moveFab(trigger, originX + e.clientX - startX, originY + e.clientY - startY, true);
        // Suppress the click that follows a drag.
        const suppressClick = (ev: Event) => {
          ev.stopImmediatePropagation();
          trigger.removeEventListener('click', suppressClick, { capture: true });
        };
        trigger.addEventListener('click', suppressClick, { capture: true });
      }
      moved = false;
    };
    trigger.addEventListener('pointerup', onPointerUp);
    trigger.addEventListener('pointercancel', onPointerUp);
  }

  // ─── Keyboard / visualViewport ──────────────────────────────────────────────

  /** Lift the panel above the software keyboard using visualViewport. */
  private attachViewportHandlers(panel: HTMLElement): void {
    this.teardownViewportHandlers();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      const keyboardInset = window.innerHeight - vv.height - vv.offsetTop;
      if (keyboardInset > 50) {
        panel.style.setProperty('--mushi-keyboard-inset', `${Math.round(keyboardInset)}px`);
        panel.classList.add('keyboard-open');
      } else {
        panel.style.setProperty('--mushi-keyboard-inset', '0px');
        panel.classList.remove('keyboard-open');
      }
    };
    vv.addEventListener('resize', update, { passive: true });
    vv.addEventListener('scroll', update, { passive: true });
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
   * Minimum description length (default 8, Plan 018 §1.1), halved for CJK
   * locales where each character carries more meaning.
   */
  private effectiveMinLength(): number {
    const base = this.config.minDescriptionLength ?? 8;
    return /^(ja|zh|ko)$/.test(this.lang) ? Math.max(4, Math.floor(base / 2)) : base;
  }

  /** Enough words, or something the reporter attached on purpose. */
  private canSend(): boolean {
    return (this.drafts.description ?? '').trim().length >= this.effectiveMinLength()
      || this.elementSelected
      || (this.screenshotAttached && this.screenshotByUser);
  }

  private unreadCount(): number {
    return this.reporterReports.reduce((sum, report) => sum + (report.unread_count ?? 0), 0);
  }

  /** Read-only snapshot + helper closures for the stateless view layer. */
  private renderCtx(): WidgetRenderCtx {
    return {
      config: this.config,
      locale: this.locale,
      rc: this.rc,
      lang: this.lang,
      step: this.step,
      callbacks: this.callbacks,
      chip: this.chip,
      intent: this.intent,
      showAllCategories: this.showAllCategories,
      draftLength: (this.drafts.description ?? '').length,
      canSend: this.canSend(),
      submitting: this.submitting,
      screenshotCapturing: this.screenshotCapturing,
      screenshotAttached: this.screenshotAttached,
      screenshotPreview: this.screenshotPreview,
      previewOpen: this.previewOpen,
      screenshotHint: this.resolveScreenshotHint(),
      screenshotAvailable: this.screenshotAvailable,
      elementAvailable: this.elementAvailable,
      screenshotError: this.screenshotError,
      screenshotErrorReason: this.screenshotErrorReason,
      elementSelected: this.elementSelected,
      elementCapturing: this.elementCapturing,
      elementError: this.elementError,
      allowScreenshotRemove: this.allowScreenshotRemove,
      identifiedUser: this.identifiedUser,
      lastReportId: this.lastReportId,
      submittedAt: this.submittedAt,
      lastSubmitQueuedOffline: this.lastSubmitQueuedOffline,
      lastSubmitFailureKind: this.lastSubmitFailureKind,
      lastSubmitScreenshotDropped: this.lastSubmitScreenshotDropped,
      channels: this.channels,
      emailOptInOpen: this.emailOptInOpen,
      emailState: this.emailState,
      pushState: this.pushState,
      reporterReports: this.reporterReports,
      listLoading: this.listLoading,
      reporterError: this.reporterError,
      selectedReportId: this.selectedReportId,
      reporterComments: this.reporterComments,
      timeline: this.timeline,
      pendingReplies: this.pendingReplies,
      threadLoading: this.threadLoading,
      threadError: this.threadError,
      actionPending: this.actionPending,
      actionError: this.actionError,
      unreadCount: this.unreadCount(),
      showMoreNav: this.showMoreNav,
      pageFaviconHref: readPageFaviconHref(),
      sdkFreshness: this.sdkFreshness,
      brandRef: this.brandRef,
      rewardsState: this.rewardsState,
      testerReputation: this.testerReputation,
      testerInfo: this.testerInfo,
      testerJwt: this.testerJwt,
      magicLinkError: this.magicLinkError,
      magicLinkSending: this.magicLinkSending,
      magicLinkEmail: this.magicLinkEmail,
      magicLinkSent: this.magicLinkSent,
      globalLeaderboardLoading: this.globalLeaderboardLoading,
      globalLeaderboard: this.globalLeaderboard,
      leaderboardLoading: this.leaderboardLoading,
      leaderboardEntries: this.leaderboardEntries,
      crossAppLoading: this.crossAppLoading,
      crossAppReports: this.crossAppReports,
      featureBoard: this.featureBoard,
      assistantTurns: this.assistantTurns,
      assistantSending: this.assistantSending,
      assistantError: this.assistantError,
      tierColor: (slug) => (MUSHI_TIER_COLORS as Record<string, string>)[slug] ?? MUSHI_TIER_COLORS.default,
      resolveCustomCategory: (id) => this.resolveCustomCategory(id),
    };
  }

  // ─── Events: one delegated listener per type, bound once ──────────

  private bindPanelEvents(): void {
    const panel = this.panel;
    panel.addEventListener('pointerdown', () => { this.pointerDownAt = Date.now(); });
    panel.addEventListener('click', (e) => {
      const target = e.target as Element;
      // The lazily loaded markup editor owns its own controls.
      if (target.closest('[data-role="annotate-host"]')) return;
      const el = target.closest<HTMLElement>('[data-action],[data-report-id],[data-vote-id]');
      if (!el || el.tagName === 'FORM') return;
      if (el.dataset.voteId) { void this.voteFeatureBoard(el.dataset.voteId); return; }
      const action = el.dataset.action;
      if (!action && el.dataset.reportId) { void this.openThread(el.dataset.reportId); return; }
      if (action) this.handleAction(action, el);
    });
    panel.addEventListener('input', (e) => {
      const el = e.target as HTMLTextAreaElement;
      const role = el.dataset?.role;
      if (!role) return;
      this.drafts[role] = el.value;
      if (el.tagName === 'TEXTAREA' && role !== 'description') autoGrow(el);
      if (role === 'description') this.render();
    });
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = panel.querySelector<HTMLTextAreaElement>('.mushi-assistant-input');
      const value = input?.value ?? '';
      if (input) input.value = '';
      void this.sendAssistantMessage(value);
    });
    panel.addEventListener('keydown', (e) => this.onKeydown(e));
  }

  private onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.showMoreNav) { this.showMoreNav = false; this.render(); return; }
      if (this.step === 'report-detail') { this.goBack(); return; }
      this.close();
      return;
    }
    if (isSubmitShortcut(e) || (e.key === 'Enter' && !e.shiftKey && target.classList.contains('mushi-assistant-input'))) {
      if (this.step === 'report') { e.preventDefault(); this.submitReport(); }
      else if (this.step === 'report-detail' && target.dataset.role === 'reporter-reply') { e.preventDefault(); this.submitReporterReply(); }
      else if (this.step === 'assistant') { e.preventDefault(); this.panel.querySelector('form')?.requestSubmit(); }
      return;
    }
    if (e.key === 'Tab') { this.trapTab(e); return; }
    // Roving radiogroup (APG): arrows move focus and the selection together.
    if (target.getAttribute('role') === 'radio' && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      const radios = Array.from(target.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
      const i = radios.indexOf(target);
      const next = radios[(i + (/Right|Down/.test(e.key) ? 1 : -1) + radios.length) % radios.length];
      if (!next) return;
      e.preventDefault();
      next.click();
      this.panel.querySelector<HTMLElement>(focusKey(next) ?? '')?.focus();
    }
  }

  /** Keep Tab inside the open dialog (APG modal pattern). */
  private trapTab(e: KeyboardEvent): void {
    const items = Array.from(this.panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden]'));
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = this.shadow.activeElement;
    if (e.shiftKey && (active === first || !this.panel.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  private handleAction(action: string, el: HTMLElement): void {
    const value = el.dataset.value ?? '';
    switch (action) {
      case 'close': this.close(); return;
      case 'back': this.goBack(); return;
      case 'brand-footer': this.callbacks.onBrandFooterClick?.(); return;
      case 'toggle-more-nav': this.showMoreNav = !this.showMoreNav; this.render(); return;
      case 'show-all-categories': this.showAllCategories = true; this.render(); return;
      case 'chip': {
        const id = el.dataset.category ?? '';
        // A second tap on the picked chip clears it: the type is optional.
        this.chip = this.chip === id ? null : id;
        this.intent = null;
        this.render();
        return;
      }
      case 'intent': {
        const it = el.dataset.intent ?? null;
        this.intent = this.intent === it ? null : it;
        this.render();
        return;
      }
      case 'screenshot': this.screenshotByUser = true; this.callbacks.onScreenshotRequest(); return;
      case 'screenshot-share-tab': this.screenshotByUser = true; this.callbacks.onScreenshotShareTabRequest?.(); return;
      case 'remove-screenshot': this.callbacks.onScreenshotRemove?.(); return;
      case 'toggle-preview': this.previewOpen = !this.previewOpen; this.render(); return;
      case 'annotate-screenshot': {
        const host = this.panel.querySelector<HTMLElement>('[data-role="annotate-host"]');
        this.screenshotByUser = true;
        if (host && this.callbacks.onScreenshotAnnotateRequest) void this.callbacks.onScreenshotAnnotateRequest(host);
        return;
      }
      case 'element': this.callbacks.onElementSelectorRequest?.(); return;
      case 'submit': this.submitReport(); return;
      case 'done': this.close(); return;
      case 'track-report': if (this.lastReportId) void this.openTrackedReport(this.lastReportId); return;
      case 'copy-report-id': copyId(el); return;
      case 'reports': this.showMoreNav = false; void this.loadReporterReports(); return;
      case 'retry-list': void this.loadReporterReports(); return;
      case 'retry-thread': if (this.selectedReportId) void this.openThread(this.selectedReportId); return;
      case 'reporter-reply': this.submitReporterReply(); return;
      case 'retry-reply': void this.sendPendingReply(Number(value)); return;
      case 'reporter-confirms': void this.submitReporterFeedback('confirms'); return;
      case 'reporter-not-fixed': void this.submitReporterReopen(); return;
      case 'email-optin': this.emailOptInOpen = (el as HTMLInputElement).checked; this.render(); return;
      case 'save-email': void this.saveEmailOptIn(); return;
      case 'notify-me': void this.subscribePush(); return;
      case 'assistant': this.showMoreNav = false; this.openAssistantTab(); return;
      case 'assistant-suggest': void this.sendAssistantMessage(value); return;
      case 'assistant-report': this.step = 'report'; this.render(); return;
      case 'roadmap': this.showMoreNav = false; void this.loadFeatureBoard(); return;
      case 'open-leaderboard':
        this.showMoreNav = false;
        this.step = 'leaderboard';
        this.callbacks.onLeaderboardOpen?.();
        this.callbacks.onGlobalLeaderboardOpen?.();
        this.render();
        return;
      case 'open-account': this.showMoreNav = false; this.step = 'account'; this.render(); return;
      case 'open-cross-app-reports':
        this.step = 'cross-app-reports';
        this.crossAppReports = this.callbacks.onCrossAppReportsOpen ? null : [];
        this.crossAppLoading = Boolean(this.callbacks.onCrossAppReportsOpen);
        this.render();
        this.callbacks.onCrossAppReportsOpen?.();
        return;
      case 'open-global-leaderboard':
        this.step = 'leaderboard';
        this.globalLeaderboard = this.callbacks.onGlobalLeaderboardOpen ? null : [];
        this.globalLeaderboardLoading = Boolean(this.callbacks.onGlobalLeaderboardOpen);
        this.render();
        this.callbacks.onGlobalLeaderboardOpen?.();
        return;
      case 'send-magic-link': void this.handleMagicLinkSend(); return;
      case 'resend-magic-link': this.magicLinkSent = false; this.magicLinkError = ''; this.render(); return;
      case 'sign-out-tester':
        this.testerJwt = null;
        this.testerInfo = null;
        this.testerReputation = null;
        this.crossAppReports = null;
        this.magicLinkSent = false;
        this.magicLinkEmail = '';
        this.step = 'report';
        this.callbacks.onTesterSignOut?.();
        this.render();
        return;
    }
  }

  private goBack(): void {
    const parent: Partial<Record<WidgetStep, WidgetStep>> = {
      'report-detail': 'reports',
      'cross-app-reports': 'account',
    };
    this.step = parent[this.step] ?? 'report';
    if (this.step === 'reports') this.selectedReportId = null;
    if (this.step === 'report') this.showAllCategories = Boolean(this.chip && this.resolveCustomCategory(this.chip));
    this.render();
  }

  // ─── Report submit ─────────────────────────────────────────────────

  private submitReport(): void {
    if (this.submitting) return;
    const live = this.panel.querySelector<HTMLTextAreaElement>('[data-role="description"]');
    if (live) this.drafts.description = live.value;
    if (!this.canSend()) {
      this.announce(this.rc.ui.addWords);
      live?.focus();
      return;
    }
    const description = (this.drafts.description ?? '').trim();
    const chip = this.chip;
    const custom = chip ? this.resolveCustomCategory(chip) : undefined;
    const hostCategories = (this.config.categories?.length ?? 0) > 0;
    const idea = chip === 'idea';
    const category: MushiReportCategory = idea || !chip
      ? 'other'
      : custom ? (custom.baseCategory ?? 'other') : chip as MushiReportCategory;
    // A host custom category id is the documented user_category contract;
    // ideas land as 'feature' so they never read as an "other" bug.
    const userCategory = custom ? chip! : idea ? 'feature' : hostCategories && chip ? chip : undefined;
    const intent = idea ? FEATURE_REQUEST_INTENT : this.intent ?? undefined;

    this.submitting = true;
    this.submittedAt = new Date();
    this.lastReportId = null;
    this.lastSubmitQueuedOffline = false;
    this.lastSubmitFailureKind = undefined;
    this.lastSubmitScreenshotDropped = false;
    this.render();

    // Both sync-void (legacy) and async-outcome host handlers are supported.
    const outcomeP = (async () => {
      try {
        const ret = this.callbacks.onSubmit({
          category,
          ...(userCategory ? { userCategory } : {}),
          description,
          ...(intent ? { intent } : {}),
        });
        if (ret && typeof (ret as Promise<WidgetSubmitOutcome | void>).then === 'function') {
          return ((await ret) as WidgetSubmitOutcome | void) ?? null;
        }
        return null;
      } catch {
        // The retry queue handles delivery in the background; degrade the receipt instead of blocking.
        return { reportId: null, queuedOffline: true } as WidgetSubmitOutcome;
      }
    })();

    // The receipt appears within one breath even on a slow network; the
    // outcome patches it in place. No auto-close: it stays until Done / ✕ / Esc.
    this.successTimer = setTimeout(() => {
      this.successTimer = null;
      this.submitting = false;
      this.step = 'success';
      this.drafts = {};
      this.render();
      this.announce(this.rc.ui.sent);
      void outcomeP.then((outcome) => {
        if (this.step !== 'success' || !outcome) return;
        this.lastReportId = outcome.reportId ?? null;
        this.lastSubmitQueuedOffline = Boolean(outcome.queuedOffline);
        this.lastSubmitFailureKind = outcome.failureKind;
        this.lastSubmitScreenshotDropped = Boolean(outcome.screenshotDropped);
        this.render();
      });
    }, 500);
  }

  // ─── Your reports ──────────────────────────────────────────────────

  private async loadFeatureBoard(): Promise<void> {
    this.step = 'roadmap';
    this.listLoading = true;
    this.reporterError = null;
    this.render();
    try {
      this.featureBoard = await this.callbacks.onFeatureBoardRequest?.() ?? [];
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not load community ideas.';
    } finally {
      this.listLoading = false;
      this.render();
    }
  }

  private async voteFeatureBoard(requestId: string): Promise<void> {
    if (!this.callbacks.onFeatureBoardVote || this.actionPending) return;
    this.actionPending = true;
    this.render();
    try {
      await this.callbacks.onFeatureBoardVote(requestId);
      this.featureBoard = await this.callbacks.onFeatureBoardRequest?.() ?? this.featureBoard;
    } catch (err) {
      this.reporterError = err instanceof Error ? err.message : 'Could not update vote.';
    } finally {
      this.actionPending = false;
      this.render();
    }
  }

  /**
   * Run a thread action (feedback / reopen) without leaving or blanking the
   * thread: the action buttons disable, then status + timeline refresh in place.
   */
  private async runThreadAction(fallbackError: string, action: (reportId: string) => Promise<unknown>): Promise<boolean> {
    const reportId = this.selectedReportId;
    if (!reportId || this.actionPending) return false;
    this.actionPending = true;
    this.actionError = null;
    this.render();
    try {
      await action(reportId);
      await this.refreshReporterInboxQuiet();
      await this.openThread(reportId, true);
      return true;
    } catch (err) {
      this.actionError = err instanceof Error ? err.message : fallbackError;
      return false;
    } finally {
      this.actionPending = false;
      this.render();
    }
  }

  private async submitReporterReopen(): Promise<void> {
    await this.runThreadAction('Could not reopen report.', async (reportId) => {
      if (this.callbacks.onReporterReopen) await this.callbacks.onReporterReopen(reportId, 'Not fixed for me');
      else await this.callbacks.onReporterFeedback?.(reportId, 'not_fixed', 'Not fixed for me');
    });
  }

  private async submitReporterFeedback(signal: string): Promise<void> {
    await this.runThreadAction('Could not send feedback.', (reportId) =>
      Promise.resolve(this.callbacks.onReporterFeedback?.(reportId, signal)));
  }

  /** Refresh "Your reports" quietly (badge + list + open row); never disturbs what the reporter is typing. */
  async refreshReporterInboxQuiet(): Promise<void> {
    try {
      const req = this.callbacks.onReporterReportsRequest?.();
      this.reporterReports = req ? await withDeadline(req, REPORTER_READ_DEADLINE_MS) : [];
      if (this.isOpen) this.render();
    } catch {
      // Non-fatal background poll — errors surface only inside the inbox UI.
    }
  }

  private async loadReporterReports(): Promise<void> {
    this.ensureOpen();
    this.step = 'reports';
    this.listLoading = true;
    this.reporterError = null;
    this.render();
    try {
      const req = this.callbacks.onReporterReportsRequest?.();
      this.reporterReports = req ? await withDeadline(req, REPORTER_READ_DEADLINE_MS) : [];
    } catch {
      this.reporterError = this.rc.ui.loadError;
    } finally {
      this.listLoading = false;
      this.render();
    }
  }

  /** "Track it" on the receipt → that report's thread. */
  private async openTrackedReport(reportId: string): Promise<void> {
    await this.loadReporterReports();
    // The reporter may have navigated (or closed) while the list loaded.
    if (this.isOpen && this.step === 'reports') await this.openThread(reportId);
  }

  /**
   * Open (or refresh) a thread. The card paints at once from the list row;
   * only the timeline shows a skeleton. `quiet` keeps what is on screen.
   */
  private async openThread(reportId: string, quiet = false): Promise<void> {
    if (this.selectedReportId !== reportId) {
      // A different thread: drop the other thread's draft, replies and errors.
      delete this.drafts['reporter-reply'];
      this.reporterComments = [];
      this.timeline = null;
      this.pendingReplies = [];
      this.actionError = null;
      quiet = false;
    }
    this.selectedReportId = reportId;
    this.step = 'report-detail';
    this.threadError = null;
    if (!quiet) {
      this.threadLoading = true;
      this.render();
      this.markRead(reportId);
    }
    try {
      // A read that never settles used to leave "Loading thread…" up forever
      // (live, 2026-10-02); the deadline turns it into a retryable error.
      const detail = this.callbacks.onReporterReportRequest?.(reportId);
      const res = detail ? await withDeadline(detail, REPORTER_READ_DEADLINE_MS) : null;
      if (res) {
        if (this.selectedReportId === reportId) {
          this.timeline = res.timeline ?? null;
          if (res.report) this.reporterReports = this.reporterReports.map((r) => (r.id === reportId ? { ...r, ...res.report } : r));
        }
      } else {
        // Servers before the v2 detail route: the comments call.
        const req = this.callbacks.onReporterCommentsRequest?.(reportId);
        const comments = req ? await withDeadline(req, REPORTER_READ_DEADLINE_MS) : [];
        if (this.selectedReportId === reportId) this.reporterComments = comments;
      }
    } catch {
      if (this.selectedReportId === reportId) this.threadError = this.rc.ui.loadError;
    } finally {
      this.threadLoading = false;
      this.render();
    }
  }

  /** Opening a thread marks its updates read so the badge goes down (§2.3). */
  private markRead(reportId: string): void {
    const row = this.reporterReports.find((r) => r.id === reportId);
    if (!row?.unread_count) return;
    row.unread_count = 0;
    void Promise.resolve(this.callbacks.onReporterMarkRead?.(reportId)).catch(() => {});
  }

  /** Optimistic reply: the bubble shows at once as "Sending…", then lands or offers Retry. */
  private submitReporterReply(): void {
    const live = this.panel.querySelector<HTMLTextAreaElement>('[data-role="reporter-reply"]');
    const body = (live?.value ?? '').trim();
    if (!body || !this.selectedReportId) return;
    const id = ++this.replySeq;
    this.pendingReplies.push({ id, body, state: 'sending' });
    delete this.drafts['reporter-reply'];
    if (live) { live.value = ''; autoGrow(live); }
    void this.sendPendingReply(id);
  }

  private async sendPendingReply(id: number): Promise<void> {
    const pending = this.pendingReplies.find((p) => p.id === id);
    const reportId = this.selectedReportId;
    if (!pending || !reportId) return;
    pending.state = 'sending';
    this.render();
    this.announce(this.rc.ui.sending);
    try {
      await withDeadline(Promise.resolve(this.callbacks.onReporterReply?.(reportId, pending.body)), REPORTER_READ_DEADLINE_MS);
      await this.openThread(reportId, true);
      this.pendingReplies = this.pendingReplies.filter((p) => p.id !== id);
      this.render();
      this.announce(this.rc.ui.sent);
    } catch {
      pending.state = 'failed';
      this.render();
      this.announce(this.rc.ui.sendFailed);
    }
  }

  // ─── Opt-in channels (§4.1) ────────────────────────────────────────

  private async saveEmailOptIn(): Promise<void> {
    const email = (this.panel.querySelector<HTMLInputElement>('[data-role="optin-email"]')?.value ?? '').trim();
    if (!isPlausibleReporterEmail(email) || !this.callbacks.onReporterEmailOptIn) {
      this.emailState = 'invalid';
      this.render();
      return;
    }
    this.emailState = 'saving';
    this.render();
    try {
      await this.callbacks.onReporterEmailOptIn(email);
      this.emailState = 'saved';
    } catch {
      this.emailState = 'error';
    }
    this.render();
  }

  private async subscribePush(): Promise<void> {
    if (!this.callbacks.onReporterPushSubscribe || this.pushState === 'asking') return;
    // Called synchronously from the click so the permission prompt keeps its user activation.
    const pending = this.callbacks.onReporterPushSubscribe();
    this.pushState = 'asking';
    this.render();
    try {
      await pending;
      this.pushState = 'on';
    } catch {
      this.pushState = 'error';
    }
    this.render();
  }

  // ─── Toast on next visit (§4.2) ────────────────────────────────────

  /**
   * One toast near the launcher: "The developer replied to your report",
   * "Fixed in v1.4", "3 updates on your reports". Suppressed wherever the
   * launcher is (hidden routes, hideOnSelector, hide()). View opens the thread.
   */
  showUpdatesToast(reports: MushiReporterReport[]): boolean {
    const toast = pickUpdateToast(reports, this.lang, this.rc.ui.toastReplied);
    return toast ? this.showUpdateToast(toast) : false;
  }

  /** The toast from GET /v1/reporter/updates (core's wording), naming the report when there is one. */
  showUpdatesFeedToast(updates: MushiReporterUpdates, reports: MushiReporterReport[]): boolean {
    if (!(updates.unread_total > 0)) return false;
    const ids = new Set(updates.latest.map((u) => u.report_id));
    const reportId = ids.size === 1 ? [...ids][0]! : null;
    const row = reportId ? reports.find((r) => r.id === reportId) : undefined;
    const detail = row?.title ?? row?.summary ?? (reportId ? updates.latest[0]?.preview : undefined);
    return this.showUpdateToast({ text: reporterToastMessage(updates, this.lang), reportId, ...(detail ? { detail } : {}) });
  }

  showUpdateToast(update: { text: string; reportId?: string | null; detail?: string }): boolean {
    if (this.isOpen || !this.triggerVisible || this.triggerHiddenByScroll || this.isMobileSmartHidden() || this.isRouteHidden() || this.isSuppressedByHost()) return false;
    this.removeToast();
    const toast = document.createElement('div');
    toast.className = `mushi-toast ${this.config.trigger === 'banner' ? `banner-${this.config.bannerConfig?.position ?? 'top'}` : this.config.position}`;
    toast.setAttribute('role', 'status');
    toast.style.zIndex = String(this.config.zIndex + 1);
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = update.text;
    text.append(strong);
    if (update.detail) {
      const small = document.createElement('small');
      small.textContent = update.detail;
      text.append(small);
    }
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'mushi-btn';
    view.textContent = this.rc.ui.view;
    view.addEventListener('click', () => {
      this.removeToast();
      const id = update.reportId;
      if (id) void this.loadReporterReports().then(() => { if (this.isOpen && this.step === 'reports') void this.openThread(id); });
      else this.openReporter();
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'mushi-icon-btn';
    dismiss.textContent = '✕';
    dismiss.setAttribute('aria-label', this.locale.widget.close);
    dismiss.addEventListener('click', () => this.removeToast());
    toast.append(text, view, dismiss);
    this.applyInsetVars(toast);
    this.shadow.insertBefore(toast, this.panel);
    this.toastEl = toast;
    return true;
  }

  private removeToast(): void {
    this.toastEl?.remove();
    this.toastEl = null;
  }

  // ─── Focus + announcements ─────────────────────────────────────────

  private rememberOpener(): void {
    const active = document.activeElement as HTMLElement | null;
    this.opener = active === this.host ? (this.shadow.activeElement as HTMLElement | null) : active;
  }

  /** Return focus to whatever opened the dialog; the trigger may have been rebuilt meanwhile. */
  private restoreOpenerFocus(): void {
    const target = this.opener?.isConnected ? this.opener : this.opener?.classList.contains('mushi-trigger') ? this.triggerEl : null;
    this.opener = null;
    if (target && target !== document.body) target.focus({ preventScroll: true });
  }

  /** Polite screen-reader announcement ("Sent", "Reply sent", errors). */
  private announce(text: string): void {
    this.live.textContent = '';
    setTimeout(() => { this.live.textContent = text; }, 30);
  }

  /* ── Community: magic-link sign-in ───────────────────────────────── */

  private async handleMagicLinkSend(): Promise<void> {
    if (this.magicLinkSending) return;
    const email = (this.drafts['magic-link-email'] ?? this.magicLinkEmail).trim();
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

  /** Open the widget on "Your reports" (`sdk.openReporter()`, the banner's link, a toast). */
  openReporter(): void {
    void this.loadReporterReports();
  }

  /* ── Marketing / Playwright recorder (debug GIF capture) ─────────── */

  getRecorderStep(): WidgetStep {
    return this.step;
  }

  /** QA / Playwright: report-screen IA without piercing the shadow root. */
  getRecorderCategoryStepIA(): {
    sectionLabel: string;
    moreToggle: boolean;
    footerStepIndicators: number;
  } {
    return {
      sectionLabel: this.shadow.querySelector('#mushi-title')?.textContent?.trim() ?? '',
      moreToggle: !!this.shadow.querySelector('[data-action="toggle-more-nav"]'),
      footerStepIndicators: 0,
    };
  }

  getRecorderTrigger(): Element | null {
    return this.triggerEl;
  }

  getRecorderCategoryButton(category: MushiReportCategory): Element | null {
    return this.shadow.querySelector(`[data-category="${category}"]`);
  }

  getRecorderIntentButton(label: string): Element | null {
    return Array.from(this.shadow.querySelectorAll<HTMLElement>('[data-intent]')).find((el) => el.dataset.intent === label) ?? null;
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
    this.step = 'report';
    this.chip = category;
    this.intent = null;
    this.render();
  }

  recorderSelectIntent(label: string): void {
    if (!this.isOpen || this.step !== 'report') return;
    this.intent = label;
    this.render();
  }

  recorderFocusDescription(): void {
    this.shadow.querySelector<HTMLTextAreaElement>('[data-role="description"]')?.focus();
  }

  recorderSubmit(): void {
    this.submitReport();
  }

  recorderOpenMyReports(): void {
    void this.loadReporterReports();
  }
}

/** Selector that finds the replacement of a control after a patch. */
function focusKey(el: HTMLElement): string | null {
  const d = el.dataset;
  if (d.role) return `[data-role="${d.role}"]`;
  if (d.category) return `[data-category="${attr(d.category)}"]`;
  if (d.intent) return `[data-intent="${attr(d.intent)}"]`;
  if (d.reportId) return `[data-report-id="${attr(d.reportId)}"]`;
  if (d.action) return `[data-action="${d.action}"]${d.value ? `[data-value="${attr(d.value)}"]` : ''}`;
  return null;
}

/** Escape a value for a double-quoted attribute selector. */
function attr(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}

/** Grow a composer from one line up to four (§2.3). */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 104)}px`;
}

/** Copy the receipt id, flipping the label to "Copied ✓" briefly. */
function copyId(btn: HTMLElement): void {
  const id = btn.dataset.copyId;
  if (!id) return;
  const restore = btn.textContent;
  const done = () => {
    btn.textContent = 'Copied ✓';
    window.setTimeout(() => { if (btn.isConnected) btn.textContent = restore; }, 1600);
  };
  try {
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(id).then(done, done);
    else done();
  } catch {
    done();
  }
}
