import { compressScreenshotDataUrl } from './capture/compress-screenshot';
import {
  type MushiConfig,
  type MushiWidgetConfig,
  type MushiReport,
  type MushiReportCategory,
  type MushiRuntimeSdkConfig,
  type MushiSdkVersionInfo,
  type MushiEventType,
  type MushiEventHandler,
  type MushiSDKInstance,
  type MushiDiagnosticsResult,
  type MushiReporterReport,
  type MushiReporterComment,
  type MushiHallOfFameEntry,
  type MushiTesterReputation,
  type MushiPageContext,
  DEFAULT_API_ENDPOINT,
  MUSHI_INTERNAL_INIT_MARKER,
  createApiClient,
  createPreFilter,
  createOfflineQueue,
  captureEnvironment,
  getReporterToken,
  getDeviceFingerprintHash,
  getSessionId,
  createRateLimiter,
  createPiiScrubber,
  createLogger,
  noopLogger,
  createBreadcrumbBuffer,
  type BreadcrumbBuffer,
  normaliseThrown,
  newUuid,
  resolveEnvConfig,
  parseIdentityToken,
} from '@mushi-mushi/core';

import { MushiWidget } from './widget';
import { exposeMarketingRecorder } from './marketing-recorder';
import {
  initRewards,
  updateRewardsUser,
  enqueue as enqueueActivity,
  getTier as getRewardsTier,
  fetchLeaderboard,
  type RewardsContext,
} from './rewards';
import {
  createConsoleCapture,
  createNetworkCapture,
  createScreenshotCapture,
  createPerformanceCapture,
  createElementSelector,
  createTimelineCapture,
  createDiscoveryCapture,
  type DiscoveryCapture,
} from './capture';
import { createReplayCapture, type ReplayCapture } from './capture/replay';
import {
  createScreenshotAnnotation,
  type AnnotationSession,
  type AnnotationTool,
} from './capture/screenshot-annotation';
import { captureSentryContext, tagSentryScope } from './sentry';
import { setupProactiveTriggers, type ProactiveTriggerCleanup } from './proactive-triggers';
import { createProactiveManager, type ProactiveManager } from './proactive-manager';
import { MUSHI_SDK_PACKAGE, MUSHI_SDK_VERSION } from './version';

let instance: MushiSDKInstance | null = null;

export class Mushi {
  private constructor() {}

  static init(config: MushiConfig): MushiSDKInstance {
    if (instance) {
      createLogger({ scope: 'mushi', level: 'warn', format: 'pretty' })
        .warn('Already initialized — call destroy() first to reinitialize');
      return instance;
    }

    // Merge env-var defaults under any explicit config so developers can
    // use zero-config mode: <MushiProvider> with no props reads from
    // NEXT_PUBLIC_MUSHI_* / VITE_MUSHI_* / MUSHI_* automatically.
    const resolved: MushiConfig = { ...resolveEnvConfig(), ...config };

    if (!resolved.projectId) {
      throw new Error('[mushi] projectId is required — set NEXT_PUBLIC_MUSHI_PROJECT_ID / VITE_MUSHI_PROJECT_ID / MUSHI_PROJECT_ID or pass it explicitly');
    }

    if (!resolved.apiKey) {
      throw new Error('[mushi] apiKey is required — set NEXT_PUBLIC_MUSHI_API_KEY / VITE_MUSHI_API_KEY / MUSHI_API_KEY or pass it explicitly');
    }

    if (resolved.enabled === false) {
      return createNoopInstance();
    }

    instance = createInstance(resolved);
    return instance;
  }

  static getInstance(): MushiSDKInstance | null {
    return instance;
  }

  static destroy(): void {
    instance?.destroy();
    instance = null;
  }

  static diagnose(): Promise<MushiDiagnosticsResult> {
    return instance?.diagnose() ?? diagnoseWithoutInstance();
  }
}

function createInstance(config: MushiConfig): MushiSDKInstance {
  const bootstrapConfig = applyPresetConfig(config);
  let activeConfig: MushiConfig = bootstrapConfig;
  const log = (config.debug ?? false)
    ? createLogger({ scope: 'mushi', level: 'debug', format: 'pretty' })
    : noopLogger;

  // Signed end-user identity JWT (set via identifyWithToken); forwarded on the
  // X-Mushi-User-Token header and verified server-side. Null when anonymous.
  let userToken: string | null = null;
  // Latest page-context snapshot published by the host (assistant + reports).
  let currentPageContext: MushiPageContext | null = null;

  const apiClient = createApiClient({
    projectId: bootstrapConfig.projectId,
    apiKey: bootstrapConfig.apiKey,
    ...(bootstrapConfig.apiEndpoint ? { apiEndpoint: bootstrapConfig.apiEndpoint } : {}),
    getUserToken: () => userToken,
    sdkPackage: MUSHI_SDK_PACKAGE,
    sdkVersion: MUSHI_SDK_VERSION,
  });

  const preFilter = createPreFilter(bootstrapConfig.preFilter);
  const offlineQueue = createOfflineQueue(bootstrapConfig.offline);
  const rateLimiter = createRateLimiter({ maxBurst: 10, refillRate: 1, refillIntervalMs: 5_000 });
  const piiScrubber = createPiiScrubber();

  // Apply the same scrubber that runs over `description` to the
  // observability surfaces (breadcrumbs, tags, sentry context) right
  // before they leave the SDK. The buffer/sentry layers are kept
  // pristine so `getBreadcrumbs()` returns the host's own values; this
  // pass only mutates the snapshot that goes on the wire.
  function scrubBreadcrumbsForWire<T extends { message?: string; data?: Record<string, unknown> }>(
    crumbs: T[],
  ): T[] {
    return crumbs.map((c) => {
      const next: T = { ...c };
      if (typeof c.message === 'string') {
        next.message = piiScrubber.scrub(c.message);
      }
      if (c.data && typeof c.data === 'object') {
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(c.data)) {
          cleaned[k] = typeof v === 'string' ? piiScrubber.scrub(v) : v;
        }
        next.data = cleaned;
      }
      return next;
    });
  }
  function scrubTagsForWire(
    tags: Record<string, string | number | boolean> | undefined,
  ): Record<string, string | number | boolean> | undefined {
    if (!tags) return undefined;
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(tags)) {
      out[k] = typeof v === 'string' ? piiScrubber.scrub(v) : v;
    }
    return out;
  }

  let consoleCap: ReturnType<typeof createConsoleCapture> | null = null;
  let networkCap: ReturnType<typeof createNetworkCapture> | null = null;
  let perfCap: ReturnType<typeof createPerformanceCapture> | null = null;
  let screenshotCap: ReturnType<typeof createScreenshotCapture> | null = null;
  let elementSelector: ReturnType<typeof createElementSelector> | null = null;
  let discoveryCap: DiscoveryCapture | null = null;
  const timelineCap = createTimelineCapture();
  let replayCap: ReplayCapture | null = null;
  // Monotonic token guarding the async `createReplayCapture()` resolution.
  // Two quick `updateConfig` calls (or a flip to 'off' mid-create) can resolve
  // out of order; we only install the capture whose token is still current.
  let replayGeneration = 0;
  let widget!: MushiWidget;

  // ── Community / tester session ─────────────────────────────────────────
  // The JWT is stored per-origin in localStorage so magic-link re-auth is
  // required when the tester uses the SDK on a different domain (cross-origin
  // isolation). The identity is unified server-side via `tester_id`.
  const TESTER_JWT_KEY = `mushi:tester-jwt:${bootstrapConfig.projectId}`;
  function readTesterJwt(): string | null {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(TESTER_JWT_KEY) : null; }
    catch { return null; }
  }
  function saveTesterJwt(jwt: string): void {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(TESTER_JWT_KEY, jwt); }
    catch { /* storage unavailable */ }
  }
  // Exposed via widget.setTesterSession so other flows can persist the JWT
  void saveTesterJwt; // referenced by loadTesterSession + future magic-link callback
  function clearTesterJwt(): void {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(TESTER_JWT_KEY); }
    catch { /* storage unavailable */ }
  }

  async function loadTesterSession(jwt: string): Promise<void> {
    const statusResult = await apiClient.getTesterStatus(jwt);
    if (!statusResult.ok || !statusResult.data) {
      clearTesterJwt();
      return;
    }
    const status = statusResult.data as {
      is_tester: boolean;
      tester_id?: string | null;
      public_handle?: string | null;
      display_name?: string | null;
    };
    // Fail closed: require a verified tester identity from the server. Never
    // derive the id from the JWT — that leaked token bytes into UI/state and
    // was unstable across token refresh.
    if (!status.is_tester || !status.tester_id) { clearTesterJwt(); return; }
    widget.setTesterSession(jwt, {
      id: status.tester_id,
      public_handle: status.public_handle ?? null,
      display_name: status.display_name ?? null,
    });
    const repResult = await apiClient.getMyReputation(jwt);
    if (repResult.ok && repResult.data) {
      const repData = repResult.data as { reputation?: MushiTesterReputation };
      if (repData.reputation) widget.setTesterReputation(repData.reputation);
    }
  }

  function syncCaptureModules() {
    if (activeConfig.capture?.console !== false) {
      consoleCap ??= createConsoleCapture();
    } else {
      consoleCap?.destroy();
      consoleCap = null;
    }

    if (activeConfig.capture?.network !== false) {
      const networkOptions = {
        apiEndpoint: resolveApiEndpoint(activeConfig),
        ignoreUrls: activeConfig.capture?.ignoreUrls,
        tracePropagation: activeConfig.capture?.tracePropagation,
        sessionId: getSessionId(),
      };
      if (networkCap) {
        networkCap.updateOptions(networkOptions);
      } else {
        networkCap = createNetworkCapture(networkOptions);
      }
    } else {
      networkCap?.destroy();
      networkCap = null;
    }

    if (activeConfig.capture?.performance !== false) {
      perfCap ??= createPerformanceCapture();
    } else {
      perfCap?.destroy();
      perfCap = null;
    }

    if (activeConfig.capture?.screenshot !== 'off') {
      const screenshotOptions = { privacy: activeConfig.privacy };
      if (screenshotCap) {
        screenshotCap.updateOptions(screenshotOptions);
      } else {
        screenshotCap = createScreenshotCapture(screenshotOptions);
      }
    } else {
      screenshotCap = null;
    }
    if (!screenshotCap) pendingScreenshot = null;
    widget.setAllowScreenshotRemove(activeConfig.privacy?.allowUserRemoveScreenshot !== false);

    if (activeConfig.capture?.elementSelector !== false) {
      elementSelector ??= createElementSelector();
    } else {
      elementSelector?.deactivate();
      elementSelector = null;
      pendingElement = null;
    }

    // Mushi v2.1: passive inventory discovery. Default OFF — only stand
    // up when the host explicitly opts in. We deliberately re-create the
    // capturer when the config changes (rather than mutating it) so the
    // route-template list and throttle window are picked up cleanly.
    const discoveryRaw = activeConfig.capture?.discoverInventory;
    const discoveryConfig =
      discoveryRaw === true
        ? {}
        : discoveryRaw && typeof discoveryRaw === 'object'
          ? discoveryRaw
          : null;
    const discoveryEnabled =
      discoveryConfig != null && discoveryConfig.enabled !== false;
    if (discoveryEnabled) {
      discoveryCap?.destroy();
      discoveryCap = createDiscoveryCapture({
        config: discoveryConfig!,
        getRecentNetworkPaths: () => {
          if (!networkCap) return [];
          return networkCap
            .getEntries()
            .map((e) => {
              try {
                const u = new URL(e.url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
                // Only same-origin or otherwise meaningful paths — skip
                // tracking pixels and the Mushi ingest endpoint itself.
                if (u.host && typeof window !== 'undefined' && u.host !== window.location.host) return null;
                return u.pathname;
              } catch {
                return null;
              }
            })
            .filter((p): p is string => p != null && p.length > 0 && p.length < 200);
        },
        getUserId: () => userInfo?.id ?? null,
        getSessionId,
        onEvent: (event) => {
          // Best-effort; never throw, never block.
          void apiClient
            .postDiscoveryEvent({
              ...event,
              sdk_version: MUSHI_SDK_VERSION,
            })
            .catch((err) => {
              log.debug('discovery emit failed', { err: String(err) });
            });
        },
      });
    } else {
      discoveryCap?.destroy();
      discoveryCap = null;
    }

    const replayMode = activeConfig.capture?.replay ?? 'off';
    if (replayMode === 'rrweb' || replayMode === 'lite') {
      const generation = ++replayGeneration;
      void createReplayCapture({
        enabled: true,
        redactSelectors: activeConfig.privacy?.redactSelectors,
      }).then((cap) => {
        // A newer sync (config change / flip to 'off') superseded this create
        // while it was in flight — discard the stale capture rather than
        // installing it over the current one (which would leak + mis-record).
        if (generation !== replayGeneration) {
          cap.destroy();
          return;
        }
        replayCap?.destroy();
        replayCap = cap;
        // Start the rolling buffer immediately so it captures the lead-up to
        // the bug (continuous), not just the window after the widget opens —
        // by the time the user opens the widget the repro has already happened.
        // The MAX_EVENTS / maxMs ring keeps it bounded.
        replayCap.start();
      });
    } else {
      // Invalidate any in-flight create so a late resolution doesn't reinstall.
      replayGeneration++;
      replayCap?.destroy();
      replayCap = null;
    }
  }

  const listeners = new Map<MushiEventType, Set<MushiEventHandler>>();
  function emit(type: MushiEventType, data?: unknown) {
    listeners.get(type)?.forEach((handler) => handler({ type, data }));
  }

  let pendingScreenshot: string | null = null;
  let pendingElement: { tagName: string; id?: string; className?: string; xpath?: string } | null = null;
  let pendingProactiveTrigger: string | null = null;
  let runtimeConfigLoaded = false;
  let userInfo: { id: string; email?: string; name?: string } | null = null;
  const customMetadata: Record<string, unknown> = {};
  // Sticky tags applied to every subsequent report. Cleared by
  // `clearTag()` (single key) or `clearTag()` with no args (all keys).
  // We coerce to scalar values at insert time so the wire format is
  // already canonical when the report serialises.
  const stickyTags: Record<string, string | number | boolean> = {};
  // Breadcrumb ring buffer — Sentry-grade observability surface that
  // works whether or not the host has Sentry installed. Auto-populated
  // by SDK lifecycle events (`init` / `report:opened` / `report:sent`),
  // route changes, console errors, and `[data-testid]` clicks. Hosts
  // can also call `Mushi.addBreadcrumb()` directly.
  const breadcrumbs: BreadcrumbBuffer = createBreadcrumbBuffer({ max: 50 });
  breadcrumbs.add({
    category: 'lifecycle',
    level: 'info',
    message: 'Mushi SDK init',
    data: { projectId: bootstrapConfig.projectId, sdkVersion: MUSHI_SDK_VERSION },
  });
  // Auto-breadcrumb teardown handles. Stored at module scope so
  // `destroy()` can detach them cleanly — leaks here would tail every
  // re-init in HMR'd dev sessions.
  let detachAutoBreadcrumbs: (() => void) | null = null;
  detachAutoBreadcrumbs = installAutoBreadcrumbs(breadcrumbs);

  // Reentrance guard: prevents a user tapping the camera icon while
  // autoCaptureScreenshot is already mid-capture from double-hiding the panel.
  let screenshotCaptureInFlight = false;

  async function takeScreenshotWithoutChrome(): Promise<string | null> {
    if (!screenshotCap || screenshotCaptureInFlight) return null;
    screenshotCaptureInFlight = true;
    const panelWasVisible = widget.getIsOpen();
    if (panelWasVisible) widget.hidePanel();
    const host = document.getElementById('mushi-mushi-widget');
    const prevVisibility = host?.style.visibility ?? '';
    if (host) host.style.visibility = 'hidden';
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    try {
      return await screenshotCap.take();
    } finally {
      screenshotCaptureInFlight = false;
      if (host) host.style.visibility = prevVisibility;
      if (panelWasVisible) widget.showPanel();
    }
  }

  async function autoCaptureScreenshot(when: 'open' | 'submit'): Promise<void> {
    const mode = activeConfig.capture?.screenshot;
    if (!screenshotCap || mode === 'off' || pendingScreenshot) return;
    if (when === 'open' && mode !== 'auto') return;
    if (when === 'submit' && mode !== 'on-report' && mode !== 'auto') return;
    log.debug('Auto-capturing screenshot', { when, mode });
    pendingScreenshot = await takeScreenshotWithoutChrome();
    widget.setScreenshotAttached(pendingScreenshot !== null);
    widget.setScreenshotPreview(pendingScreenshot);
  }

  widget = new MushiWidget(bootstrapConfig.widget, {
    onSubmit: async ({ category, userCategory, description, intent }) => {
      log.info('Report submitted', { category, userCategory, intent });
      proactiveManager?.recordSubmission();
      await autoCaptureScreenshot('submit');
      const outcome = await submitReport(category, description, intent, userCategory);
      // Surface the server-confirmed id back to the widget so the
      // success step renders a real receipt rather than a fake stamp.
      // `undefined` happens when the pre-filter/rate-limiter blocked
      // the report — degrade to the "queued offline" copy so the user
      // still sees acknowledgement instead of a silent close.
      return outcome ?? { reportId: null, queuedOffline: true };
    },
    onOpen: () => {
      log.debug('Widget opened');
      void autoCaptureScreenshot('open');
      // Idempotent safety-net: the buffer already records continuously from
      // syncCaptureModules; this only matters if a host disabled then re-enabled
      // capture between init and open.
      replayCap?.start();
      emit('widget:opened');
    },
    onClose: () => {
      log.debug('Widget closed');
      // Deliberately do NOT stop the rolling buffer here — it must keep
      // recording so the next report still has the lead-up context. Teardown
      // happens in destroy(). The ring buffer stays bounded by MAX_EVENTS/maxMs.
      if (pendingProactiveTrigger) {
        proactiveManager?.recordDismissal();
        emit('proactive:dismissed', { type: pendingProactiveTrigger });
      }
      pendingScreenshot = null;
      pendingElement = null;
      pendingProactiveTrigger = null;
      emit('widget:closed');
    },
    onScreenshotRequest: async () => {
      if (!screenshotCap || activeConfig.capture?.screenshot === 'off') return;
      log.debug('Taking screenshot');
      pendingScreenshot = await takeScreenshotWithoutChrome();
      widget.setScreenshotAttached(pendingScreenshot !== null);
      widget.setScreenshotPreview(pendingScreenshot);
    },
    onScreenshotRemove: () => {
      log.debug('Screenshot attachment removed');
      pendingScreenshot = null;
      widget.setScreenshotAttached(false);
    },
    onScreenshotAnnotateRequest: async (container: HTMLElement) => {
      if (!pendingScreenshot) return;
      // Re-entrancy guard: a second "Mark up" click while the editor is
      // already mounted would stack a second canvas + toolbar on top.
      if (container.childElementCount > 0) return;
      let session: AnnotationSession;
      try {
        session = await createScreenshotAnnotation(pendingScreenshot, container);
      } catch (err) {
        log.warn('Screenshot annotation failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      // Render an interactive tool palette + "Done" control. The previous
      // implementation read `getDataUrl()` and destroyed the session in the
      // same tick, so the user never got to draw — the screenshot was just
      // silently downscaled/recompressed with zero annotations. We keep the
      // session live until the user explicitly confirms.
      const toolbar = document.createElement('div');
      toolbar.className = 'mushi-annotate-toolbar';
      const finish = (commit: boolean) => {
        if (commit) {
          pendingScreenshot = session.getDataUrl();
          widget.setScreenshotAttached(true);
          // Keep the visible preview in sync with the annotated image so the
          // reporter sees exactly what will be submitted (not the pre-markup shot).
          widget.setScreenshotPreview(pendingScreenshot);
        }
        session.destroy();
        toolbar.remove();
      };
      const tools: Array<{ id: AnnotationTool; label: string }> = [
        { id: 'highlight', label: '\u270F\uFE0F Highlight' },
        { id: 'blur', label: '\uD83D\uDD12 Blur' },
        { id: 'arrow', label: '\u2197\uFE0F Arrow' },
      ];
      for (const toolDef of tools) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mushi-attach-btn';
        btn.dataset.tool = toolDef.id;
        btn.textContent = toolDef.label;
        btn.addEventListener('click', () => {
          session.setTool(toolDef.id);
          toolbar
            .querySelectorAll('button[data-tool]')
            .forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
        });
        toolbar.appendChild(btn);
      }
      // `highlight` is the session's default tool — reflect it in the UI.
      toolbar.querySelector('button[data-tool="highlight"]')?.classList.add('active');
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'mushi-attach-btn';
      doneBtn.textContent = '\u2713 Done';
      doneBtn.addEventListener('click', () => finish(true));
      toolbar.appendChild(doneBtn);
      container.insertBefore(toolbar, container.firstChild);
    },
    onElementSelectorRequest: async () => {
      if (!elementSelector || activeConfig.capture?.elementSelector === false) return;
      log.debug('Element selector activated');
      widget.setElementCapturing(true);
      widget.hidePanel();
      try {
        const el = await elementSelector.activate();
        if (el) {
          pendingElement = el;
          widget.setElementSelected(true);
          log.debug('Element selected', { tagName: el.tagName, xpath: el.xpath });
        } else {
          widget.setElementCapturing(false);
        }
      } finally {
        widget.showPanel();
      }
    },
    async onReporterReportsRequest() {
      const result = await apiClient.listReporterReports(getReporterToken());
      if (!result.ok) throw new Error(result.error?.message ?? 'Could not load reports');
      return result.data?.reports ?? [];
    },
    async onReporterCommentsRequest(reportId) {
      const result = await apiClient.listReporterComments(reportId, getReporterToken());
      if (!result.ok) throw new Error(result.error?.message ?? 'Could not load thread');
      return result.data?.comments ?? [];
    },
    async onReporterReply(reportId, body) {
      const result = await apiClient.replyToReporterReport(reportId, getReporterToken(), body);
      if (!result.ok) throw new Error(result.error?.message ?? 'Could not send reply');
    },
    async onReporterFeedback(reportId, signal, note) {
      const result = await apiClient.replyToReporterReport(reportId, getReporterToken(), note ?? '', signal);
      if (!result.ok) throw new Error(result.error?.message ?? 'Could not send feedback');
      return result.data?.feedback ?? null;
    },
    async onReporterReopen(reportId, note) {
      const result = await apiClient.reopenReporterReport(reportId, getReporterToken(), note);
      if (!result.ok) throw new Error(result.error?.message ?? 'Could not reopen report');
      return result.data?.outcome ?? null;
    },
    async onFeatureBoardRequest() {
      const result = await apiClient.listReporterFeatureBoard(getReporterToken());
      if (!result.ok) throw new Error(result.error?.message ?? 'Could not load community ideas');
      return result.data?.tickets ?? [];
    },
    async onFeatureBoardVote(requestId) {
      const result = await apiClient.voteReporterFeatureBoard(requestId, getReporterToken());
      if (!result.ok) throw new Error(result.error?.message ?? 'Could not vote');
      return result.data ?? { voted: true, action: 'added' };
    },
    onLeaderboardOpen() {
      widget.setLeaderboard(null, true);
      void fetchLeaderboard(10).then((entries) => {
        widget.setLeaderboard(entries, false);
      });
    },

    // ── Community callbacks ──────────────────────────────────────────────
    async onMushiSignIn(email: string): Promise<{ ok: boolean; error?: string }> {
      const res = await apiClient.sendMagicLink(email);
      if (!res.ok) throw new Error((res.error as { message?: string })?.message ?? 'Could not send sign-in link');
      return { ok: true };
    },

    async onGlobalLeaderboardOpen() {
      widget.setGlobalLeaderboard(null, true);
      try {
        const jwt = readTesterJwt();
        const res = await apiClient.getPublicLeaderboard(50);
        const rawEntries = res.ok
          ? (res.data as { leaderboard?: Array<{ tester_id: string; rank: number; public_handle: string | null; display_name: string | null; points_30d: number; total_points?: number; badge_slug?: string }> })?.leaderboard ?? []
          : [];
        const entries = rawEntries.map((e) => ({
          tester_id: e.tester_id,
          rank: e.rank,
          public_handle: e.public_handle,
          display_name: e.display_name,
          points_30d: e.points_30d,
          total_points: e.total_points ?? 0,
          badge: e.badge_slug,
        }));
        widget.setGlobalLeaderboard(entries, false);
        if (jwt) {
          const repRes = await apiClient.getMyReputation(jwt);
          if (repRes.ok && repRes.data) {
            const repData = repRes.data as { reputation?: MushiTesterReputation };
            if (repData.reputation) widget.setTesterReputation(repData.reputation);
          }
        }
      } catch {
        // Network error — clear loading so the spinner doesn't spin forever
        widget.setGlobalLeaderboard([], false);
      }
    },

    async onCrossAppReportsOpen() {
      const jwt = readTesterJwt();
      if (!jwt) { widget.setCrossAppReports([], false); return; }
      try {
        const res = await apiClient.getCrossAppReports(jwt);
        const reports = res.ok ? (res.data as { reports?: Parameters<typeof widget.setCrossAppReports>[0] })?.reports ?? [] : [];
        widget.setCrossAppReports(reports, false);
      } catch {
        // Network error — clear loading so the spinner doesn't spin forever
        widget.setCrossAppReports([], false);
      }
    },

    onTesterSignOut(): void {
      clearTesterJwt();
    },

    // ── Assistant tab (P5) ───────────────────────────────────────────────
    assistantEnabled: bootstrapConfig.assistant?.enabled === true,
    ...(bootstrapConfig.assistant?.label ? { assistantLabel: bootstrapConfig.assistant.label } : {}),
    ...(bootstrapConfig.assistant?.greeting ? { assistantGreeting: bootstrapConfig.assistant.greeting } : {}),
    ...(bootstrapConfig.assistant?.suggestions ? { assistantSuggestions: bootstrapConfig.assistant.suggestions } : {}),
    async onAssistantAsk(message: string, threadId: string | null) {
      const res = await apiClient.askAssistant({
        message,
        threadId,
        context: currentPageContext,
      });
      return res.ok ? (res.data ?? null) : null;
    },
  }, MUSHI_SDK_VERSION);
  syncCaptureModules();

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => widget.mount());
    } else {
      widget.mount();
    }
  }

  // Restore tester session if we have a cached JWT
  const cachedJwt = readTesterJwt();
  if (cachedJwt) {
    void loadTesterSession(cachedJwt).catch(() => clearTesterJwt());
  }

  // --- Proactive triggers + fatigue prevention ---
  let proactiveTriggers: ProactiveTriggerCleanup | null = null;
  let proactiveManager: ProactiveManager | null = null;

  const proactiveCfg = activeConfig.proactive;
  const hasAnyProactive = proactiveCfg
    && (proactiveCfg.rageClick !== false
      || proactiveCfg.longTask !== false
      || proactiveCfg.apiCascade !== false
      || proactiveCfg.errorBoundary === true
      || Boolean(proactiveCfg.pageDwell)
      || Boolean(proactiveCfg.firstSession));

  if (hasAnyProactive && typeof document !== 'undefined') {
    proactiveManager = createProactiveManager(proactiveCfg?.cooldown);

    proactiveTriggers = setupProactiveTriggers(
      {
        onTrigger: (type, context) => {
          if (!proactiveManager!.shouldShow(type)) {
            log.debug('Proactive trigger suppressed by fatigue prevention', { type });
            return;
          }
          log.info('Proactive trigger fired', { type, context });
          pendingProactiveTrigger = type;
          emit('proactive:triggered', { type, context });
          // First-session welcome bypasses the category step and just
          // pulses the bug button — the user hasn't expressed intent yet,
          // so opening the full reporter would be aggressive.
          if (type === 'first_session') {
            widget.pulseTrigger?.();
          } else {
            widget.open();
          }
        },
      },
      {
        rageClick: proactiveCfg?.rageClick,
        longTask: proactiveCfg?.longTask,
        apiCascade: proactiveCfg?.apiCascade,
        apiEndpoint: resolveApiEndpoint(activeConfig),
        errorBoundary: proactiveCfg?.errorBoundary,
        pageDwell: proactiveCfg?.pageDwell,
        firstSession: proactiveCfg?.firstSession,
        projectId: bootstrapConfig.projectId,
      },
    );

    log.debug('Proactive triggers enabled', {
      rageClick: proactiveCfg?.rageClick !== false,
      longTask: proactiveCfg?.longTask !== false,
      apiCascade: proactiveCfg?.apiCascade !== false,
      errorBoundary: proactiveCfg?.errorBoundary === true,
      pageDwell: Boolean(proactiveCfg?.pageDwell),
      firstSession: Boolean(proactiveCfg?.firstSession),
    });
  }

  offlineQueue.startAutoSync(apiClient);
  offlineQueue.flush(apiClient).then((result) => {
    if (result.sent > 0) log.info('Synced offline reports', { sent: result.sent });
  });

  function applyRuntimeConfig(runtime: MushiRuntimeSdkConfig) {
    runtimeConfigLoaded = true;
    if (runtime.enabled === false) {
      activeConfig = bootstrapConfig;
      clearCachedRuntimeConfig(config.projectId);
      syncCaptureModules();
      widget.updateConfig(activeConfig.widget);
      log.debug('Runtime SDK config disabled; using bootstrap config', { version: runtime.version });
      return;
    }
    activeConfig = mergeRuntimeConfig(activeConfig, runtime);
    syncCaptureModules();
    if (runtime.widget) widget.updateConfig(activeConfig.widget);
    log.debug('Applied runtime SDK config', { version: runtime.version });
  }

  if (shouldUseRuntimeConfig(config)) {
    const cached = readCachedRuntimeConfig(config.projectId);
    // Apply cached config synchronously before first paint so the
    // console-managed trigger/banner is correct on the very first render
    // instead of flashing the bootstrap default then snapping.
    if (cached) applyRuntimeConfig(cached);
    apiClient.getSdkConfig().then((result) => {
      if (result.ok && result.data) {
        cacheRuntimeConfig(config.projectId, result.data);
        applyRuntimeConfig(result.data);
      } else if (result.error) {
        log.debug('Runtime SDK config unavailable', result.error);
      }
    }).catch((err) => {
      log.debug('Runtime SDK config fetch failed', { error: err instanceof Error ? err.message : String(err) });
    });
  } else {
    log.debug('Runtime SDK config disabled via runtimeConfig:false; using static bootstrap config');
  }

  void checkSdkFreshness();

  log.info('Initialized', { projectId: config.projectId });

  async function checkSdkFreshness(): Promise<void> {
    if (activeConfig.widget?.outdatedBanner === 'off') return;
    const cached = readCachedSdkVersion(MUSHI_SDK_PACKAGE);
    if (cached) applySdkFreshness(cached);
    const result = await apiClient.getLatestSdkVersion(MUSHI_SDK_PACKAGE);
    if (!result.ok || !result.data) return;
    cacheSdkVersion(MUSHI_SDK_PACKAGE, result.data);
    applySdkFreshness(result.data);
  }

  function applySdkFreshness(info: MushiSdkVersionInfo): void {
    const latest = info.latest;
    const outdated = Boolean(latest && isVersionOlder(MUSHI_SDK_VERSION, latest));
    if (!outdated && !info.deprecated) return;
    const message = info.deprecationMessage ?? (outdated ? `Update ${MUSHI_SDK_PACKAGE} to ${latest}.` : null);
    log.warn('Mushi SDK is outdated', {
      package: MUSHI_SDK_PACKAGE,
      current: MUSHI_SDK_VERSION,
      latest,
      deprecated: info.deprecated,
      message,
    });
    if (activeConfig.widget?.outdatedBanner !== 'console-only') {
      widget.setSdkFreshness({
        latest,
        current: MUSHI_SDK_VERSION,
        deprecated: info.deprecated,
        message,
      });
    }
  }

  async function submitReport(
    category: MushiReportCategory,
    description: string,
    intent?: string,
    userCategory?: string,
  ): Promise<{ reportId: string | null; queuedOffline?: boolean } | undefined> {
    const filterResult = preFilter.check(description);
    if (!filterResult.passed) {
      log.info('Report blocked by pre-filter', { reason: filterResult.reason });
      return undefined;
    }

    const wasm = config.preFilter?.wasmClassifier;
    if (wasm) {
      try {
        const verdict = await wasm.classify({
          description,
          category,
          url: typeof location !== 'undefined' ? location.href : undefined,
          hasScreenshot: pendingScreenshot !== null,
          hasSelectedElement: pendingElement !== null,
          hasNetworkErrors: networkCap?.getEntries()?.some((e) => e.status >= 400 || !!e.error) ?? false,
          hasConsoleErrors: consoleCap?.getEntries()?.some((e) => e.level === 'error') ?? false,
          proactiveTrigger: pendingProactiveTrigger ?? undefined,
        });
        if (verdict.verdict === 'block') {
          log.info('Report blocked by on-device classifier', {
            modelId: verdict.modelId,
            confidence: verdict.confidence,
            reason: verdict.reason,
          });
          return undefined;
        }
        log.debug('On-device classifier verdict', { ...verdict });
      } catch (err) {
        log.warn('On-device classifier threw — falling through to server', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!rateLimiter.tryConsume()) {
      log.warn('Report throttled — rate limit exceeded');
      return undefined;
    }

    const scrubbedDescription = piiScrubber.scrub(preFilter.truncate(description));

    const sentryCtx = config.sentry ? captureSentryContext(config.sentry) : undefined;
    const fingerprintHash = await getDeviceFingerprintHash().catch(() => null);
    const consoleLogs = activeConfig.capture?.console === false ? undefined : consoleCap?.getEntries();
    const networkLogs = activeConfig.capture?.network === false ? undefined : networkCap?.getEntries();

    // Snapshot breadcrumbs *before* we add the lifecycle "submitting"
    // beat — we want the report's timeline to end with the user-action
    // event, not with our own bookkeeping. We then add the submit
    // breadcrumb so it shows up on the *next* report (typical pattern
    // in production: a user files two reports in close succession,
    // and the second carries a "previous report submitted" hint).
    const reportBreadcrumbs = scrubBreadcrumbsForWire(breadcrumbs.getAll());
    const stickyTagSnapshot = scrubTagsForWire(
      Object.keys(stickyTags).length > 0 ? { ...stickyTags } : undefined,
    );
    const sentryCtxScrubbed = sentryCtx
      ? {
          ...sentryCtx,
          ...(sentryCtx.breadcrumbs
            ? { breadcrumbs: scrubBreadcrumbsForWire(sentryCtx.breadcrumbs) }
            : {}),
          ...(sentryCtx.tags ? { tags: scrubTagsForWire(sentryCtx.tags) } : {}),
        }
      : undefined;

    const screenshotForWire = pendingScreenshot
      ? (await compressScreenshotDataUrl(pendingScreenshot).catch(() => null))
      : null;
    if (pendingScreenshot && !screenshotForWire) {
      log.warn('Screenshot dropped — could not compress under wire budget');
    }

    const report: MushiReport = {
      id: newUuid(),
      projectId: config.projectId,
      category,
      ...(userCategory ? { userCategory } : {}),
      description: scrubbedDescription,
      userIntent: intent,
      environment: captureEnvironment(),
      consoleLogs,
      networkLogs,
      performanceMetrics: activeConfig.capture?.performance === false ? undefined : perfCap?.getMetrics(),
      timeline: timelineCap.getEntries({ consoleLogs, networkLogs }),
      screenshotDataUrl: screenshotForWire ?? undefined,
      selectedElement: pendingElement ?? undefined,
      ...(replayCap
        ? { replayEvents: replayCap.flush() as MushiReport['replayEvents'] }
        : {}),
      metadata: {
        ...customMetadata,
        ...(userInfo ? { user: userInfo } : {}),
        ...(sentryCtx?.release ? { sentryRelease: sentryCtx.release } : {}),
      },
      sessionId: getSessionId(),
      reporterToken: getReporterToken(),
      ...(fingerprintHash ? { fingerprintHash } : {}),
      appVersion: config.integrations?.vercel?.analyticsId,
      sdkPackage: MUSHI_SDK_PACKAGE,
      sdkVersion: MUSHI_SDK_VERSION,
      proactiveTrigger: pendingProactiveTrigger ?? undefined,
      // Top-level Sentry-grade observability fields. Breadcrumbs are
      // surfaced separately from `consoleLogs` because they're the
      // higher-signal "what just happened" trail (vs. the high-volume
      // raw console mirror), and the admin /reports drawer shows them
      // in different panes.
      ...(reportBreadcrumbs.length > 0 ? { breadcrumbs: reportBreadcrumbs } : {}),
      ...(stickyTagSnapshot ? { tags: stickyTagSnapshot } : {}),
      ...(sentryCtxScrubbed ? { sentryContext: sentryCtxScrubbed } : {}),
      sentryEventId: sentryCtx?.eventId,
      sentryReplayId: sentryCtx?.replayId,
      createdAt: new Date().toISOString(),
    };

    breadcrumbs.add({
      category: 'lifecycle',
      level: 'info',
      message: `Mushi report submitting (${category})`,
      data: { reportId: report.id, category },
    });

    if (config.integrations?.custom) {
      const builder = {
        addMetadata(key: string, value: unknown) {
          (report.metadata as Record<string, unknown>)[key] = value;
        },
        setCategory(cat: MushiReportCategory) {
          report.category = cat;
        },
        setDescription(desc: string) {
          report.description = desc;
        },
      };
      config.integrations.custom(builder);
    }

    // Sentry-spec-1.0 `beforeSendFeedback` hook (introduced in v1.4):
    // last chance for the host app to mutate or drop the report.
    // Errors and timeouts ship the *unmodified* report so a buggy hook
    // never silently swallows user feedback. Returning `null` drops
    // the report — emits no `report:sent` and no `report:failed`.
    let finalReport: MushiReport = report;
    if (config.beforeSendFeedback) {
      try {
        const hookResult = await Promise.race([
          Promise.resolve(config.beforeSendFeedback(report)),
          // 2s timeout — async hooks must not block the user's "submit"
          // for longer than the network would. Falls back to original.
          new Promise<MushiReport>((resolve) =>
            setTimeout(() => resolve(report), 2000),
          ),
        ]);
        if (hookResult === null) {
          log.info('Report dropped by beforeSendFeedback hook', { reportId: report.id });
          return;
        }
        finalReport = hookResult;
      } catch (err) {
        log.warn('beforeSendFeedback hook threw — sending unmodified report', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    emit('report:submitted', { reportId: finalReport.id });

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await offlineQueue.enqueue(finalReport);
      log.info('Offline — report queued', { reportId: finalReport.id });
      emit('report:queued', { reportId: finalReport.id });
      // Propagates back to the widget so the success step renders
      // "Queued offline" rather than implying the report already landed.
      return { reportId: null, queuedOffline: true };
    }

    let result = await apiClient.submitReport(finalReport);
    // Progressive degradation for an oversized payload. The size guard rejects
    // before any network call, so a `PAYLOAD_TOO_LARGE` result never shrinks on
    // a plain retry — shed the heaviest optional evidence (replay buffer first,
    // then the screenshot) and try once more before giving up. Enqueuing an
    // unshrinkable report would poison the offline queue forever.
    if (!result.ok && result.error?.code === 'PAYLOAD_TOO_LARGE') {
      if (Array.isArray(finalReport.replayEvents) && finalReport.replayEvents.length > 0) {
        log.warn('Report too large — dropping replay buffer and retrying', {
          reportId: finalReport.id,
        });
        finalReport = { ...finalReport, replayEvents: undefined };
        result = await apiClient.submitReport(finalReport);
      }
      if (!result.ok && result.error?.code === 'PAYLOAD_TOO_LARGE' && finalReport.screenshotDataUrl) {
        log.warn('Report still too large — dropping screenshot and retrying', {
          reportId: finalReport.id,
        });
        finalReport = { ...finalReport, screenshotDataUrl: undefined };
        result = await apiClient.submitReport(finalReport);
      }
    }
    if (result.ok) {
      log.info('Report sent', { reportId: result.data?.reportId });
      emit('report:sent', { reportId: result.data?.reportId });
      // If the server response includes a Cursor agent dispatch (classify-report
      // triggered a cursor_cloud fix via the autofix_agent setting), emit
      // `report:dispatched` so the host page can show a toast notification.
      if ((result.data as Record<string, unknown> | undefined)?.cursorAgentId) {
        const d = result.data as { reportId?: string; cursorAgentId?: string; fixId?: string };
        emit('report:dispatched', { reportId: d.reportId, agentId: d.cursorAgentId, fixId: d.fixId });
      }
      breadcrumbs.add({
        category: 'lifecycle',
        level: 'info',
        message: `Mushi report sent (${result.data?.reportId ?? report.id})`,
      });
      // Award points for the report submission. This is client-side so
      // the activity batch is flushed on the next tick with the correct
      // user_id already set via identify(). The server awards 50 pts by
      // default (configurable via the rewards rules dashboard).
      enqueueActivity({
        action: 'report_submit',
        metadata: { category, reportId: result.data?.reportId ?? report.id },
      });
      // Bidirectional Sentry linkage. After a successful submit we tag
      // Sentry's current scope so any subsequent Sentry events show
      // the Mushi correlation (`mushi.report_id` tag) and the issue
      // page picks up a `mushi_report` context block. Wrapped in
      // `try/catch` because Sentry's globals can be in a half-bootstrap
      // state immediately after page load.
      try {
        if (config.sentry && result.data?.reportId) {
          tagSentryScope(result.data.reportId);
        }
      } catch {
        // Swallow — never break a successful submit because Sentry's
        // scope API moved between point releases.
      }
    } else if (
      result.error?.code === 'PAYLOAD_TOO_LARGE' ||
      result.error?.code === 'SERIALIZE_FAILED'
    ) {
      // Unshrinkable even after shedding replay + screenshot (or unserialisable
      // entirely — e.g. circular ref). Drop it rather than enqueue: a
      // re-measured multi-MB body would wedge the offline queue on every sync
      // tick (the queue classifier also treats these codes as permanent as a
      // second line of defence).
      log.warn('Report exceeds size limit after degradation — dropping', {
        reportId: finalReport.id,
        error: result.error,
      });
      emit('report:failed', { reportId: finalReport.id, error: result.error });
      breadcrumbs.add({
        category: 'lifecycle',
        level: 'error',
        message: `Mushi report dropped — payload too large (${finalReport.id})`,
      });
    } else {
      log.warn('Report failed, queuing for retry', { reportId: finalReport.id, error: result.error });
      await offlineQueue.enqueue(finalReport);
      emit('report:failed', { reportId: finalReport.id, error: result.error });
      breadcrumbs.add({
        category: 'lifecycle',
        level: 'warning',
        message: `Mushi report queued for retry (${finalReport.id})`,
      });
    }

    pendingScreenshot = null;
    pendingElement = null;
    pendingProactiveTrigger = null;
    // Returning the server-confirmed id lets the widget render the
    // two-way receipt (Receipt #abc12345 + Track on Mushi link).
    // When the submit failed and was queued for retry, return the
    // queued-offline outcome so the widget can degrade gracefully.
    if (result?.ok) {
      const serverId = (result.data?.reportId as string | undefined) ?? report.id;
      return { reportId: serverId, queuedOffline: false };
    }
    return { reportId: null, queuedOffline: true };
  }

  const sdk: MushiSDKInstance = {
    report(options) {
      widget.open(options);
    },

    on(event: MushiEventType, handler: MushiEventHandler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return () => listeners.get(event)?.delete(handler);
    },

    setUser(user) {
      userInfo = user;
    },

    setMetadata(key, value) {
      customMetadata[key] = value;
    },

    setScreen(screen) {
      timelineCap.setScreen(screen);
    },

    isOpen() {
      return widget.getIsOpen();
    },

    open() {
      widget.open();
    },

    openWith(category: MushiReportCategory | string) {
      widget.open({ category });
    },

    show() {
      widget.showTrigger();
    },

    hide() {
      widget.hideTrigger();
    },

    attachTo(selectorOrElement, options) {
      return widget.attachTo(selectorOrElement, options);
    },

    setTrigger(trigger) {
      widget.setTrigger(trigger);
    },

    openReporter() {
      widget.openReporter();
    },

    close() {
      widget.close();
    },

    updateConfig(runtimeConfig) {
      applyRuntimeConfig(runtimeConfig);
    },

    diagnose() {
      return runDiagnostics({
        apiEndpoint: resolveApiEndpoint(activeConfig),
        widgetMounted: widget.getIsMounted(),
        runtimeConfigLoaded,
        captureScreenshotAvailable: screenshotCap !== null,
        captureNetworkIntercepting: networkCap !== null,
        widgetDiagnostics: widget.getWidgetDiagnostics(),
      });
    },

    destroy() {
      proactiveTriggers?.destroy();
      proactiveManager?.reset();
      widget.destroy();
      consoleCap?.destroy();
      networkCap?.destroy();
      perfCap?.destroy();
      elementSelector?.deactivate();
      timelineCap.destroy();
      discoveryCap?.destroy();
      discoveryCap = null;
      // Replay capture holds rrweb MutationObservers/listeners (or the lite
      // click listener) that keep firing after teardown if not destroyed.
      replayCap?.destroy();
      replayCap = null;
      offlineQueue.stopAutoSync();
      detachAutoBreadcrumbs?.();
      detachAutoBreadcrumbs = null;
      breadcrumbs.clear();
      listeners.clear();
      instance = null;
      log.debug('Destroyed');
    },

    // Wave G4 — unified `captureEvent` API for programmatic/adapter-driven
    // reports. Skips the widget, runs the same PII scrub + rate limit +
    // offline-queue path as `submit()`, and returns the server report id.
    async captureEvent(input) {
      if (!rateLimiter.tryConsume()) {
        log.warn('captureEvent throttled — rate limit exceeded');
        return null;
      }
      const description = piiScrubber.scrub(preFilter.truncate(input.description));
      const category = input.category ?? 'bug';
      const sentryCtx = config.sentry ? captureSentryContext(config.sentry) : undefined;
      const captureBreadcrumbs = scrubBreadcrumbsForWire(breadcrumbs.getAll());
      // Sticky tags merge with per-call `input.tags` — call-site wins
      // when both supply the same key. Keeps adapters that already
      // pass per-event tags compatible while letting hosts set
      // app-wide defaults via `setTag()`. We then run the same
      // PII scrubber over string values so secrets a host accidentally
      // shoved into a tag (e.g. `Mushi.setTag('email', user.email)`)
      // never hit the wire.
      const mergedTags = scrubTagsForWire(
        Object.keys(stickyTags).length === 0 && !input.tags
          ? undefined
          : { ...stickyTags, ...(input.tags ?? {}) },
      );
      const sentryCtxScrubbed = sentryCtx
        ? {
            ...sentryCtx,
            ...(sentryCtx.breadcrumbs
              ? { breadcrumbs: scrubBreadcrumbsForWire(sentryCtx.breadcrumbs) }
              : {}),
            ...(sentryCtx.tags ? { tags: scrubTagsForWire(sentryCtx.tags) } : {}),
          }
        : undefined;
      const report: MushiReport = {
        id: newUuid(),
        projectId: config.projectId,
        category,
        description,
        environment: captureEnvironment(),
        timeline: timelineCap.getEntries(),
        metadata: {
          ...(input.metadata ?? {}),
          ...(userInfo ? { user: userInfo } : {}),
          ...(input.error ? { error: input.error } : {}),
          ...(input.severity ? { severity: input.severity } : {}),
          ...(input.component ? { component: input.component } : {}),
          ...(input.source ? { source: input.source } : { source: 'captureEvent' }),
        },
        ...(captureBreadcrumbs.length > 0 ? { breadcrumbs: captureBreadcrumbs } : {}),
        ...(mergedTags && Object.keys(mergedTags).length > 0 ? { tags: mergedTags } : {}),
        ...(sentryCtxScrubbed ? { sentryContext: sentryCtxScrubbed } : {}),
        sessionId: getSessionId(),
        reporterToken: getReporterToken(),
        sdkPackage: MUSHI_SDK_PACKAGE,
        sdkVersion: MUSHI_SDK_VERSION,
        sentryEventId: sentryCtx?.eventId,
        sentryReplayId: sentryCtx?.replayId,
        createdAt: new Date().toISOString(),
      };
      emit('report:submitted', { reportId: report.id });
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await offlineQueue.enqueue(report);
        emit('report:queued', { reportId: report.id });
        return null;
      }
      const res = await apiClient.submitReport(report);
      if (res.ok) {
        emit('report:sent', { reportId: res.data?.reportId });
        try {
          if (config.sentry && res.data?.reportId) tagSentryScope(res.data.reportId);
        } catch {
          // Swallow.
        }
        return res.data?.reportId ?? null;
      }
      await offlineQueue.enqueue(report);
      emit('report:failed', { reportId: report.id, error: res.error });
      return null;
    },

    async captureException(error, options) {
      const normalised = normaliseThrown(error);
      // Drop a breadcrumb at the call site so this exception shows up
      // in Mushi's own timeline even if the report itself is rate-limited
      // or rejected by the pre-filter — losing the report shouldn't lose
      // the trace.
      breadcrumbs.add({
        category: 'lifecycle',
        level: 'error',
        message: `Mushi.captureException(${normalised.name}): ${normalised.message}`,
        ...(normalised.stack ? { data: { stack: normalised.stack.slice(0, 500) } } : {}),
      });
      const description =
        options?.description?.trim() ||
        `${normalised.name}: ${normalised.message}` ||
        'Uncaught exception';
      return sdk.captureEvent({
        description,
        category: options?.category ?? 'bug',
        severity: options?.severity ?? 'high',
        ...(options?.component ? { component: options.component } : {}),
        ...(options?.tags ? { tags: options.tags } : {}),
        source: options?.source ?? 'captureException',
        error: {
          name: normalised.name,
          message: normalised.message,
          ...(normalised.stack ? { stack: normalised.stack } : {}),
        },
        metadata: {
          ...(options?.metadata ?? {}),
          ...(normalised.cause ? { cause: normalised.cause } : {}),
        },
      });
    },

    identify(userId, traits) {
      userInfo = { id: userId, ...(traits?.email ? { email: traits.email } : {}), ...(traits?.name ? { name: traits.name } : {}) };
      if (traits) {
        for (const [k, v] of Object.entries(traits)) {
          if (k !== 'email' && k !== 'name') customMetadata[`user.${k}`] = v;
        }
      }
      breadcrumbs.add({
        category: 'lifecycle',
        level: 'info',
        message: `Mushi.identify(${userId})`,
      });

      // Wire rewards program when enabled
      if (activeConfig.rewards?.enabled) {
        const rewardsCtx: RewardsContext = {
          client: apiClient,
          config: activeConfig.rewards,
          projectId: bootstrapConfig.projectId,
          userId,
          traits: traits
            ? { email: traits.email as string | undefined, name: traits.name as string | undefined, provider: traits.provider as string | undefined }
            : undefined,
        };
        if (userInfo.id === userId) {
          // First identify → full init
          initRewards(rewardsCtx);
        } else {
          // Already initialized; just update user context
          updateRewardsUser(userId, rewardsCtx.traits);
        }

        // Fetch reputation to hydrate the in-widget rewards nudge and success
        // points display. Fire-and-forget: never blocks the identify call.
        if (activeConfig.rewards.showInWidget !== false) {
          void apiClient.getMyPoints(userId).then((res) => {
            if (!res.ok) return;
            const d = res.data as {
              total_points?: number;
              tier?: { slug?: string; display_name?: string; points_threshold?: number } | null;
              next_tier?: { display_name?: string; points_threshold?: number } | null;
              report_submit_pts?: number;
            };
            widget.setRewardsState({
              tier: d.tier
                ? { slug: d.tier.slug ?? 'free', displayName: d.tier.display_name ?? 'Free', pointsThreshold: d.tier.points_threshold ?? 0 }
                : null,
              nextTier: d.next_tier
                ? { displayName: d.next_tier.display_name ?? '', pointsThreshold: d.next_tier.points_threshold ?? 0 }
                : null,
              totalPoints: d.total_points ?? 0,
              pointsForReport: d.report_submit_pts ?? 50,
            });
          }).catch(() => { /* non-fatal */ });
        }
      }
    },

    identifyWithToken(token) {
      userToken = token && typeof token === 'string' ? token : null;
      if (userToken) {
        const claims = parseIdentityToken(userToken);
        if (claims?.sub) {
          // Hydrate display identity from the (unverified) claims so the
          // widget can greet the user; the server re-verifies for trust.
          userInfo = {
            id: claims.sub,
            ...(claims.email ? { email: claims.email } : {}),
            ...(claims.name ? { name: claims.name } : {}),
          };
        }
        breadcrumbs.add({ category: 'lifecycle', level: 'info', message: 'Mushi.identifyWithToken()' });
      } else {
        breadcrumbs.add({ category: 'lifecycle', level: 'info', message: 'Mushi.identifyWithToken(null)' });
      }
    },

    publishPageContext(context) {
      currentPageContext = context && context.route ? context : null;
    },

    openAssistant() {
      widget.openAssistantTab();
    },

    addBreadcrumb(crumb) {
      breadcrumbs.add(crumb);
    },

    getBreadcrumbs() {
      return breadcrumbs.getAll();
    },

    setTag(key, value) {
      if (typeof key !== 'string' || key.length === 0) return;
      stickyTags[key] = value;
    },

    setTags(tags) {
      if (!tags || typeof tags !== 'object') return;
      for (const [k, v] of Object.entries(tags)) {
        if (typeof k === 'string' && k.length > 0) {
          stickyTags[k] = v;
        }
      }
    },

    clearTag(key) {
      if (typeof key === 'string' && key.length > 0) {
        delete stickyTags[key];
        return;
      }
      // No-arg variant: clear every sticky tag (used in test teardown
      // and on app-level "logout" handlers).
      for (const k of Object.keys(stickyTags)) delete stickyTags[k];
    },

    // ─── Rewards program (P1) ──────────────────────────────────

    async getReputation() {
      if (!userInfo?.id) return null;
      const res = await apiClient.getMyPoints(userInfo.id);
      if (!res.ok) return null;
      return {
        totalPoints: (res.data as { total_points: number }).total_points ?? 0,
        points30d: (res.data as { points_30d: number }).points_30d ?? 0,
        reputation: 1.0,
        confirmedBugs: 0,
        totalReports: 0,
      };
    },

    async getTier() {
      if (!userInfo?.id) return null;
      return getRewardsTier(userInfo.id);
    },

    recordActivity(action, metadata) {
      if (!activeConfig.rewards?.enabled) return;
      enqueueActivity({ action, metadata });
    },

    pulseTrigger() {
      widget.pulseTrigger?.();
    },

    // ─── Reporter API (cross-platform) ────────────────────────────────

    async listMyReports(): Promise<MushiReporterReport[]> {
      const result = await apiClient.listReporterReports(getReporterToken());
      if (!result.ok) return [];
      return result.data?.reports ?? [];
    },

    async listMyComments(reportId: string): Promise<MushiReporterComment[]> {
      const result = await apiClient.listReporterComments(reportId, getReporterToken());
      if (!result.ok) return [];
      return result.data?.comments ?? [];
    },

    async replyToReport(reportId: string, body: string): Promise<MushiReporterComment | null> {
      const result = await apiClient.replyToReporterReport(reportId, getReporterToken(), body);
      if (!result.ok) return null;
      return result.data?.comment ?? null;
    },

    async submitFeedbackSignal(reportId: string, signal: string, note?: string): Promise<Record<string, unknown> | null> {
      const result = await apiClient.replyToReporterReport(reportId, getReporterToken(), note ?? '', signal);
      if (!result.ok) return null;
      return result.data?.feedback ?? null;
    },

    async reopenReport(reportId: string, note?: string): Promise<Record<string, unknown> | null> {
      const result = await apiClient.reopenReporterReport(reportId, getReporterToken(), note);
      if (!result.ok) return null;
      return result.data?.outcome ?? null;
    },

    openMyReports() {
      widget.recorderOpenMyReports();
    },

    async getHallOfFame(limit = 20): Promise<MushiHallOfFameEntry[]> {
      const result = await apiClient.getHallOfFame(limit);
      if (!result.ok) return [];
      const raw = result.data as { data?: MushiHallOfFameEntry[] } | undefined;
      return raw?.data ?? [];
    },
  };

  if (typeof globalThis !== 'undefined' && (bootstrapConfig.debug ?? false)) {
    exposeMarketingRecorder(widget);
  }

  // Sentry-spec-1.0 `onCrashedLastRun` (introduced in v1.4):
  // detect whether the *previous* tab session ended cleanly. We mark a
  // sentinel in localStorage on init and clear it on `pagehide`. If we
  // see a stale sentinel on the next init, the previous session ended
  // without a clean unload → host app may want to surface "Tell us
  // what went wrong?". We never auto-open the widget; copy + timing
  // are the host's call.
  // Wrapped in try/catch because privacy-mode browsers throw on every
  // localStorage access and we must not break SDK init.
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const SENTINEL_KEY = 'mushi:last-run';
    let crashed: boolean | null = null;
    try {
      const previous = localStorage.getItem(SENTINEL_KEY);
      // First-ever load (or cleared storage): null. Otherwise, an
      // `unfinished` value means the prior tab didn't reach pagehide.
      crashed = previous === null ? null : previous === 'unfinished';
      localStorage.setItem(SENTINEL_KEY, 'unfinished');
    } catch {
      // localStorage unavailable (Safari private mode, file://). Hook
      // gets `null` so the host knows we couldn't determine state.
      crashed = null;
    }
    try {
      // pagehide fires on tab close, navigation, and bfcache freeze.
      // It's the only reliably-fired end-of-session event in 2026 —
      // browsers stopped guaranteeing `beforeunload`/`unload` years
      // ago. Listener is `{ once: false }` because bfcache may resume
      // the same page later and we want a fresh sentinel each time.
      window.addEventListener('pagehide', () => {
        try { localStorage.setItem(SENTINEL_KEY, 'clean'); } catch { /* noop */ }
      });
    } catch { /* noop — addEventListener never actually throws on Window */ }
    if (typeof bootstrapConfig.onCrashedLastRun === 'function') {
      try {
        bootstrapConfig.onCrashedLastRun(crashed as boolean);
      } catch (err) {
        log.warn('onCrashedLastRun hook threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return sdk;
}

function mergeRuntimeConfig(config: MushiConfig, runtime: MushiRuntimeSdkConfig): MushiConfig {
  const nativeTrigger = runtime.native?.triggerMode;
  // The server returns `launcher` for the new field (backwards-compat with
  // the old `trigger` field that only tracked `auto`). Prefer `launcher`.
  const runtimeLauncher = (runtime.widget as Record<string, unknown>)?.launcher as string | undefined;
  const widgetTrigger =
    runtimeLauncher ??
    runtime.widget?.trigger ??
    (nativeTrigger === 'none' || nativeTrigger === 'shake' ? 'manual' : undefined);
  // Never silently regress a host-configured visible widget to `hidden`.
  // The console is authoritative, but only when it *explicitly* asks for
  // `hidden` (launcher/trigger field present and set to hidden). A default
  // or empty runtime payload must not disable a widget the host wired up —
  // this was a primary cause of "the SDK doesn't show up" in dev.
  const explicitHidden = runtimeLauncher === 'hidden' || runtime.widget?.trigger === 'hidden';
  const hostTrigger = config.widget?.trigger;
  const safeWidgetTrigger =
    widgetTrigger === 'hidden' && !explicitHidden && hostTrigger && hostTrigger !== 'hidden'
      ? hostTrigger
      : widgetTrigger;
  // Build bannerConfig from flat runtime fields when present.
  const runtimeWidget = runtime.widget as Record<string, unknown> | undefined;
  const runtimeBannerVariant = runtimeWidget?.bannerVariant as string | undefined;
  const runtimeBannerPosition = runtimeWidget?.bannerPosition as string | undefined;
  const runtimeBannerMessage = runtimeWidget?.bannerMessage as string | null | undefined;
  const runtimeBannerLabel = runtimeWidget?.bannerLabel as string | null | undefined;
  const runtimeBannerBugCta = runtimeWidget?.bannerBugCta as string | null | undefined;
  const runtimeBannerFeatureCta = runtimeWidget?.bannerFeatureCta as boolean | undefined;
  const derivedBannerConfig =
    runtimeBannerVariant ||
    runtimeBannerPosition ||
    runtimeBannerMessage != null ||
    runtimeBannerLabel != null ||
    runtimeBannerBugCta != null ||
    runtimeBannerFeatureCta != null
      ? {
          ...(config.widget?.bannerConfig ?? {}),
          ...(runtimeBannerVariant ? { variant: runtimeBannerVariant as 'neon' | 'brand' | 'subtle' } : {}),
          ...(runtimeBannerPosition ? { position: runtimeBannerPosition as 'top' | 'bottom' } : {}),
          ...(runtimeBannerMessage != null ? { message: runtimeBannerMessage } : {}),
          // Dashboard sends an empty string to hide the pill (the runtime
          // payload has no way to express the local-config `label: false`).
          ...(runtimeBannerLabel != null
            ? { label: runtimeBannerLabel === '' ? (false as const) : runtimeBannerLabel }
            : {}),
          ...(runtimeBannerBugCta != null ? { bugCta: runtimeBannerBugCta ?? undefined } : {}),
          ...(runtimeBannerFeatureCta != null ? { featureCta: runtimeBannerFeatureCta } : {}),
        }
      : undefined;
  return {
    ...config,
    widget: {
      ...config.widget,
      ...runtime.widget,
      ...(safeWidgetTrigger ? { trigger: safeWidgetTrigger as MushiWidgetConfig['trigger'] } : {}),
      ...(derivedBannerConfig ? { bannerConfig: derivedBannerConfig } : {}),
      // betaMode is local-only: set by the host app, not the dashboard.
      // Restore it after the runtime spread so it is never silently cleared.
      ...(config.widget?.betaMode ? { betaMode: config.widget.betaMode } : {}),
    },
    capture: {
      ...config.capture,
      ...runtime.capture,
    },
    privacy: {
      ...config.privacy,
    },
  };
}

function applyPresetConfig(config: MushiConfig): MushiConfig {
  if (!config.preset) return config;
  const preset = presetDefaults(config.preset);
  return {
    ...config,
    widget: {
      ...preset.widget,
      ...config.widget,
    },
    capture: {
      ...preset.capture,
      ...config.capture,
    },
    proactive: {
      ...preset.proactive,
      ...config.proactive,
      cooldown: {
        ...preset.proactive?.cooldown,
        ...config.proactive?.cooldown,
      },
    },
  };
}

function presetDefaults(preset: NonNullable<MushiConfig['preset']>): Pick<MushiConfig, 'widget' | 'capture' | 'proactive'> {
  switch (preset) {
    case 'manual-only':
      return {
        widget: { trigger: 'manual', outdatedBanner: 'console-only' },
        capture: { console: true, network: true, performance: false, screenshot: 'on-report', elementSelector: false },
        proactive: { rageClick: false, longTask: false, apiCascade: false, errorBoundary: false },
      };
    case 'beta-loud':
      return {
        widget: { trigger: 'auto', outdatedBanner: 'banner' },
        capture: { console: true, network: true, performance: true, screenshot: 'auto', elementSelector: true },
        proactive: { rageClick: true, longTask: true, apiCascade: true, errorBoundary: true },
      };
    case 'internal-debug':
      return {
        widget: { trigger: 'auto', outdatedBanner: 'banner', brandFooter: true },
        capture: { console: true, network: true, performance: true, screenshot: 'auto', elementSelector: true },
        proactive: {
          rageClick: true,
          longTask: true,
          apiCascade: true,
          errorBoundary: true,
          cooldown: { maxProactivePerSession: 10, dismissCooldownHours: 0, suppressAfterDismissals: 99 },
        },
      };
    case 'production-calm':
      return {
        widget: { trigger: 'auto', outdatedBanner: 'console-only' },
        capture: { console: true, network: true, performance: false, screenshot: 'on-report', elementSelector: false },
        proactive: { rageClick: false, longTask: false, apiCascade: false, errorBoundary: false },
      };
  }
}

function resolveApiEndpoint(config: Pick<MushiConfig, 'apiEndpoint'>): string {
  return config.apiEndpoint ?? DEFAULT_API_ENDPOINT;
}

function shouldUseRuntimeConfig(config: MushiConfig): boolean {
  // Workstream B fix: fetch runtime config everywhere by default — including
  // localhost dev and HTTP origins. The previous behaviour skipped the fetch
  // when the *API endpoint* itself was localhost, which silently dropped
  // console-managed appearance (trigger/banner) on self-hosted dev stacks and
  // forced apps to hand-wire `setTrigger('banner')`. The only opt-out is the
  // explicit `runtimeConfig: false` (fully static/offline deployments); a
  // failed fetch (e.g. dev server down) still degrades gracefully to the
  // cached config + bootstrap defaults.
  return config.runtimeConfig !== false;
}

async function runDiagnostics(options: {
  apiEndpoint: string;
  widgetMounted: boolean;
  runtimeConfigLoaded: boolean;
  captureScreenshotAvailable: boolean;
  captureNetworkIntercepting: boolean;
  widgetDiagnostics?: {
    widgetHostPointerSafe: boolean;
    widgetHostBounds: { width: number; height: number } | null;
    widgetSuppressed: boolean;
    bannerRendered: boolean;
  };
}): Promise<MushiDiagnosticsResult> {
  const endpoint = await probeApiEndpoint(options.apiEndpoint);
  return {
    apiEndpointReachable: endpoint.reachable,
    cspAllowsEndpoint: endpoint.cspAllowed,
    widgetMounted: options.widgetMounted,
    shadowDomAvailable: typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.attachShadow === 'function',
    dialogSupported: typeof HTMLDialogElement !== 'undefined',
    runtimeConfigLoaded: options.runtimeConfigLoaded,
    captureScreenshotAvailable: options.captureScreenshotAvailable,
    captureNetworkIntercepting: options.captureNetworkIntercepting,
    sdkVersion: MUSHI_SDK_VERSION,
    widgetHostPointerSafe: options.widgetDiagnostics?.widgetHostPointerSafe ?? false,
    widgetHostBounds: options.widgetDiagnostics?.widgetHostBounds ?? null,
    widgetSuppressed: options.widgetDiagnostics?.widgetSuppressed ?? false,
    bannerRendered: options.widgetDiagnostics?.bannerRendered ?? false,
  };
}

async function diagnoseWithoutInstance(): Promise<MushiDiagnosticsResult> {
  return {
    apiEndpointReachable: false,
    cspAllowsEndpoint: false,
    widgetMounted: false,
    shadowDomAvailable: typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.attachShadow === 'function',
    dialogSupported: typeof HTMLDialogElement !== 'undefined',
    runtimeConfigLoaded: false,
    captureScreenshotAvailable: false,
    captureNetworkIntercepting: false,
    sdkVersion: MUSHI_SDK_VERSION,
    widgetHostPointerSafe: false,
    widgetHostBounds: null,
    widgetSuppressed: false,
    bannerRendered: false,
  };
}

async function probeApiEndpoint(apiEndpoint: string): Promise<{ reachable: boolean; cspAllowed: boolean }> {
  if (typeof fetch === 'undefined') return { reachable: false, cspAllowed: false };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 3_000) : null;
  try {
    const response = await fetch(`${apiEndpoint.replace(/\/$/, '')}/health`, {
      method: 'GET',
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
      [MUSHI_INTERNAL_INIT_MARKER]: 'diagnose',
    } as RequestInit & { [MUSHI_INTERNAL_INIT_MARKER]?: 'diagnose' });
    return { reachable: response.ok, cspAllowed: true };
  } catch {
    return { reachable: false, cspAllowed: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function runtimeConfigCacheKey(projectId: string): string {
  return `mushi:sdk-config:${projectId}`;
}

function sdkVersionCacheKey(packageName: string): string {
  return `mushi:sdk-version:${packageName}`;
}

function readCachedRuntimeConfig(projectId: string): MushiRuntimeSdkConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(runtimeConfigCacheKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { config?: MushiRuntimeSdkConfig };
    return parsed.config ?? null;
  } catch {
    return null;
  }
}

function cacheRuntimeConfig(projectId: string, config: MushiRuntimeSdkConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(runtimeConfigCacheKey(projectId), JSON.stringify({
      cachedAt: Date.now(),
      config,
    }));
  } catch {
    // Storage can be unavailable in private/restricted contexts.
  }
}

function clearCachedRuntimeConfig(projectId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(runtimeConfigCacheKey(projectId));
  } catch {
    // Storage can be unavailable in private/restricted contexts.
  }
}

function readCachedSdkVersion(packageName: string): MushiSdkVersionInfo | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(sdkVersionCacheKey(packageName));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: number; data?: MushiSdkVersionInfo };
    if (!parsed.data || !parsed.cachedAt || Date.now() - parsed.cachedAt > 86_400_000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function cacheSdkVersion(packageName: string, data: MushiSdkVersionInfo): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(sdkVersionCacheKey(packageName), JSON.stringify({
      cachedAt: Date.now(),
      data,
    }));
  } catch {
    // Storage can be unavailable in private/restricted contexts.
  }
}

function isVersionOlder(current: string, latest: string): boolean {
  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const cur = currentParts[i] ?? 0;
    const next = latestParts[i] ?? 0;
    if (cur < next) return true;
    if (cur > next) return false;
  }
  return false;
}

function parseVersion(version: string): number[] {
  return version
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function createNoopInstance(): MushiSDKInstance {
  return {
    report: () => {},
    on: () => () => {},
    setUser: () => {},
    setMetadata: () => {},
    setScreen: () => {},
    isOpen: () => false,
    open: () => {},
    close: () => {},
    updateConfig: () => {},
    diagnose: diagnoseWithoutInstance,
    openWith: () => {},
    show: () => {},
    hide: () => {},
    attachTo: () => () => {},
    setTrigger: () => {},
    openReporter: () => {},
    destroy: () => {
      instance = null;
    },
    captureEvent: async () => null,
    captureException: async () => null,
    identify: () => {},
    identifyWithToken: () => {},
    publishPageContext: () => {},
    openAssistant: () => {},
    addBreadcrumb: () => {},
    getBreadcrumbs: () => [],
    setTag: () => {},
    setTags: () => {},
    clearTag: () => {},
    getReputation: async () => null,
    getTier: async () => null,
    recordActivity: () => {},
    pulseTrigger: () => {},
    listMyReports: async () => [],
    listMyComments: async () => [],
    replyToReport: async () => null,
    submitFeedbackSignal: async () => null,
    reopenReport: async () => null,
    openMyReports: () => {},
    getHallOfFame: async () => [],
  };
}

/**
 * Auto-breadcrumb installer — attaches passive listeners that turn
 * common host-app signals into Mushi breadcrumbs without the host
 * lifting a finger.
 *
 *   - Route changes via `popstate` and the `history.pushState` /
 *     `replaceState` patches that single-page apps already trigger.
 *   - `console.error` and `console.warn` callsites — distinct from
 *     the existing `console-capture` (which mirrors the *content* of
 *     console for the report's `consoleLogs` array; breadcrumbs
 *     capture only that an error happened, what file/line, and one
 *     short message).
 *   - `[data-testid]` clicks anywhere on the page — testids are the
 *     same identifiers the v2 inventory + Triage LLM grounds against,
 *     so a breadcrumb of `clicked checkout-submit` is dramatically
 *     more useful for triage than `clicked button.btn-primary`.
 *
 * Returns a teardown closure that detaches every listener. We keep
 * the closure in scope of `createInstance` so `Mushi.destroy()` can
 * call it before re-init — without this, dev-mode HMR would tail a
 * fresh listener stack on every reload.
 */
function installAutoBreadcrumbs(buffer: BreadcrumbBuffer): () => void {
  if (typeof window === 'undefined') return () => {};
  const cleanups: Array<() => void> = [];

  // 1) Route changes — covers SSR-hydrated SPAs (Next, Remix, SvelteKit)
  // and old-school history-pushed apps. We patch the prototype methods
  // because most SPA frameworks call them directly instead of dispatching
  // an event the host could subscribe to.
  try {
    const dispatchRouteChange = (kind: 'pushState' | 'replaceState' | 'popstate') => {
      buffer.add({
        category: 'navigation',
        level: 'info',
        message: `${kind}: ${window.location.pathname}`,
        data: { url: window.location.href, kind },
      });
    };
    const onPop = () => dispatchRouteChange('popstate');
    window.addEventListener('popstate', onPop, { passive: true });
    cleanups.push(() => window.removeEventListener('popstate', onPop));

    const origPush = window.history.pushState;
    const origReplace = window.history.replaceState;
    window.history.pushState = function patched(...args: Parameters<History['pushState']>) {
      const ret = origPush.apply(this, args);
      try {
        dispatchRouteChange('pushState');
      } catch {
        // Swallow — never break navigation because the breadcrumb buffer
        // mis-stringified an URL.
      }
      return ret;
    };
    window.history.replaceState = function patched(...args: Parameters<History['replaceState']>) {
      const ret = origReplace.apply(this, args);
      try {
        dispatchRouteChange('replaceState');
      } catch {
        // Swallow.
      }
      return ret;
    };
    cleanups.push(() => {
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
    });
  } catch {
    // History API unavailable (some sandboxed iframes) — skip silently.
  }

  // 2) `console.error` and `console.warn` — wrap *only* these two so
  // we don't add overhead to `console.log` on the hot path. The
  // `console-capture` module already mirrors content; this layer
  // adds a "something went wrong" beat to the breadcrumb timeline.
  try {
    const origError = console.error;
    const origWarn = console.warn;
    console.error = function (...args: unknown[]) {
      try {
        buffer.add({
          category: 'console',
          level: 'error',
          message: args.map(stringifyConsoleArg).join(' '),
        });
      } catch {
        // Swallow.
      }
      return origError.apply(this, args as Parameters<typeof origError>);
    };
    console.warn = function (...args: unknown[]) {
      try {
        buffer.add({
          category: 'console',
          level: 'warning',
          message: args.map(stringifyConsoleArg).join(' '),
        });
      } catch {
        // Swallow.
      }
      return origWarn.apply(this, args as Parameters<typeof origWarn>);
    };
    cleanups.push(() => {
      console.error = origError;
      console.warn = origWarn;
    });
  } catch {
    // Console patching can fail in locked-down environments — non-fatal.
  }

  // 3) `[data-testid]` clicks — capture the testid, the tag name, and
  // the visible text (capped) so a breadcrumb of "clicked submit-cta
  // — Buy now" tells the triage path what the user just touched
  // without leaking arbitrary innerHTML.
  try {
    const onClick = (ev: MouseEvent) => {
      try {
        const target = ev.target;
        if (!(target instanceof Element)) return;
        let cur: Element | null = target;
        let hops = 0;
        while (cur && hops < 10) {
          const tid = cur.getAttribute('data-testid');
          if (tid) {
            const text = (cur.textContent ?? '').trim().slice(0, 80);
            buffer.add({
              category: 'ui.click',
              level: 'info',
              message: `clicked ${tid}${text ? ` — ${text}` : ''}`,
              data: { testid: tid, tag: cur.tagName.toLowerCase() },
            });
            return;
          }
          cur = cur.parentElement;
          hops++;
        }
      } catch {
        // Swallow — listener errors must never propagate.
      }
    };
    document.addEventListener('click', onClick, { passive: true, capture: true });
    cleanups.push(() => document.removeEventListener('click', onClick, true));
  } catch {
    // Swallow.
  }

  return () => {
    for (const c of cleanups) {
      try {
        c();
      } catch {
        // Swallow.
      }
    }
  };
}

/**
 * Coerce arbitrary console arguments to a short string for breadcrumb
 * messages. Errors get their `name + message`; objects get JSON-encoded
 * with a 200-char cap; everything else is `String(...)` truncated to
 * 200 chars. We never invoke a `toString` that throws — failures fall
 * back to the type label.
 */
function stringifyConsoleArg(arg: unknown): string {
  try {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}`;
    }
    if (typeof arg === 'object' && arg !== null) {
      const json = JSON.stringify(arg);
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    }
    const s = String(arg);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return `[${typeof arg}]`;
  }
}
