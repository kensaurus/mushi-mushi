import {
  type MushiConfig,
  type MushiReport,
  type MushiReportCategory,
  type MushiRuntimeSdkConfig,
  type MushiSdkVersionInfo,
  type MushiEventType,
  type MushiEventHandler,
  type MushiSDKInstance,
  type MushiDiagnosticsResult,
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
} from '@mushi-mushi/core';

import { MushiWidget } from './widget';
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
import { captureSentryContext } from './sentry';
import { setupProactiveTriggers, type ProactiveTriggerCleanup } from './proactive-triggers';
import { createProactiveManager, type ProactiveManager } from './proactive-manager';
import { isLocalhostEndpoint } from './internal-requests';
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

    if (!config.projectId) {
      throw new Error('[mushi] projectId is required');
    }

    if (!config.apiKey) {
      throw new Error('[mushi] apiKey is required');
    }

    if (config.enabled === false) {
      return createNoopInstance();
    }

    instance = createInstance(config);
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

  const apiClient = createApiClient({
    projectId: bootstrapConfig.projectId,
    apiKey: bootstrapConfig.apiKey,
    ...(bootstrapConfig.apiEndpoint ? { apiEndpoint: bootstrapConfig.apiEndpoint } : {}),
  });

  const preFilter = createPreFilter(bootstrapConfig.preFilter);
  const offlineQueue = createOfflineQueue(bootstrapConfig.offline);
  const rateLimiter = createRateLimiter({ maxBurst: 10, refillRate: 1, refillIntervalMs: 5_000 });
  const piiScrubber = createPiiScrubber();
  let consoleCap: ReturnType<typeof createConsoleCapture> | null = null;
  let networkCap: ReturnType<typeof createNetworkCapture> | null = null;
  let perfCap: ReturnType<typeof createPerformanceCapture> | null = null;
  let screenshotCap: ReturnType<typeof createScreenshotCapture> | null = null;
  let elementSelector: ReturnType<typeof createElementSelector> | null = null;
  let discoveryCap: DiscoveryCapture | null = null;
  const timelineCap = createTimelineCapture();
  let widget!: MushiWidget;

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
  widget = new MushiWidget(bootstrapConfig.widget, {
    onSubmit: async ({ category, description, intent }) => {
      log.info('Report submitted', { category, intent });
      proactiveManager?.recordSubmission();
      await submitReport(category, description, intent);
    },
    onOpen: () => {
      log.debug('Widget opened');
      emit('widget:opened');
    },
    onClose: () => {
      log.debug('Widget closed');
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
      pendingScreenshot = await screenshotCap.take();
      widget.setScreenshotAttached(pendingScreenshot !== null);
    },
    onScreenshotRemove: () => {
      log.debug('Screenshot attachment removed');
      pendingScreenshot = null;
      widget.setScreenshotAttached(false);
    },
    onElementSelectorRequest: async () => {
      if (!elementSelector || activeConfig.capture?.elementSelector === false) return;
      log.debug('Element selector activated');
      const el = await elementSelector.activate();
      if (el) {
        pendingElement = el;
        widget.setElementSelected(true);
        log.debug('Element selected', { tagName: el.tagName, xpath: el.xpath });
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
  }, MUSHI_SDK_VERSION);
  syncCaptureModules();

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => widget.mount());
    } else {
      widget.mount();
    }
  }

  // --- Proactive triggers + fatigue prevention ---
  let proactiveTriggers: ProactiveTriggerCleanup | null = null;
  let proactiveManager: ProactiveManager | null = null;

  const proactiveCfg = activeConfig.proactive;
  const hasAnyProactive = proactiveCfg
    && (proactiveCfg.rageClick !== false
      || proactiveCfg.longTask !== false
      || proactiveCfg.apiCascade !== false
      || proactiveCfg.errorBoundary === true);

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
          widget.open();
        },
      },
      {
        rageClick: proactiveCfg?.rageClick,
        longTask: proactiveCfg?.longTask,
        apiCascade: proactiveCfg?.apiCascade,
        apiEndpoint: resolveApiEndpoint(activeConfig),
        errorBoundary: proactiveCfg?.errorBoundary,
      },
    );

    log.debug('Proactive triggers enabled', {
      rageClick: proactiveCfg?.rageClick !== false,
      longTask: proactiveCfg?.longTask !== false,
      apiCascade: proactiveCfg?.apiCascade !== false,
      errorBoundary: proactiveCfg?.errorBoundary === true,
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
  } else if (config.runtimeConfig !== false && isLocalhostEndpoint(resolveApiEndpoint(config))) {
    log.debug('Runtime SDK config skipped for localhost apiEndpoint; set runtimeConfig: true to force it');
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

  async function submitReport(category: MushiReportCategory, description: string, intent?: string) {
    const filterResult = preFilter.check(description);
    if (!filterResult.passed) {
      log.info('Report blocked by pre-filter', { reason: filterResult.reason });
      return;
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
          return;
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
      return;
    }

    const scrubbedDescription = piiScrubber.scrub(preFilter.truncate(description));

    const sentryCtx = config.sentry ? captureSentryContext(config.sentry) : undefined;
    const fingerprintHash = await getDeviceFingerprintHash().catch(() => null);
    const consoleLogs = activeConfig.capture?.console === false ? undefined : consoleCap?.getEntries();
    const networkLogs = activeConfig.capture?.network === false ? undefined : networkCap?.getEntries();

    const report: MushiReport = {
      id: crypto.randomUUID?.() ?? `mushi_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      projectId: config.projectId,
      category,
      description: scrubbedDescription,
      userIntent: intent,
      environment: captureEnvironment(),
      consoleLogs,
      networkLogs,
      performanceMetrics: activeConfig.capture?.performance === false ? undefined : perfCap?.getMetrics(),
      timeline: timelineCap.getEntries({ consoleLogs, networkLogs }),
      screenshotDataUrl: pendingScreenshot ?? undefined,
      selectedElement: pendingElement ?? undefined,
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
      sentryEventId: sentryCtx?.eventId,
      sentryReplayId: sentryCtx?.replayId,
      createdAt: new Date().toISOString(),
    };

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

    emit('report:submitted', { reportId: report.id });

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await offlineQueue.enqueue(report);
      log.info('Offline — report queued', { reportId: report.id });
      emit('report:queued', { reportId: report.id });
      return;
    }

    const result = await apiClient.submitReport(report);
    if (result.ok) {
      log.info('Report sent', { reportId: result.data?.reportId });
      emit('report:sent', { reportId: result.data?.reportId });
    } else {
      log.warn('Report failed, queuing for retry', { reportId: report.id, error: result.error });
      await offlineQueue.enqueue(report);
      emit('report:failed', { reportId: report.id, error: result.error });
    }

    pendingScreenshot = null;
    pendingElement = null;
    pendingProactiveTrigger = null;
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

    openWith(category) {
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
      offlineQueue.stopAutoSync();
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
      const report: MushiReport = {
        id: crypto.randomUUID?.() ?? `mushi_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        projectId: config.projectId,
        category,
        description,
        environment: captureEnvironment(),
        timeline: timelineCap.getEntries(),
        metadata: {
          ...(input.metadata ?? {}),
          ...(userInfo ? { user: userInfo } : {}),
          ...(input.tags ? { tags: input.tags } : {}),
          ...(input.error ? { error: input.error } : {}),
          ...(input.severity ? { severity: input.severity } : {}),
          ...(input.component ? { component: input.component } : {}),
          ...(input.source ? { source: input.source } : { source: 'captureEvent' }),
        },
        sessionId: getSessionId(),
        reporterToken: getReporterToken(),
        sdkPackage: MUSHI_SDK_PACKAGE,
        sdkVersion: MUSHI_SDK_VERSION,
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
        return res.data?.reportId ?? null;
      }
      await offlineQueue.enqueue(report);
      emit('report:failed', { reportId: report.id, error: res.error });
      return null;
    },

    identify(userId, traits) {
      userInfo = { id: userId, ...(traits?.email ? { email: traits.email } : {}), ...(traits?.name ? { name: traits.name } : {}) };
      if (traits) {
        for (const [k, v] of Object.entries(traits)) {
          if (k !== 'email' && k !== 'name') customMetadata[`user.${k}`] = v;
        }
      }
    },
  };

  return sdk;
}

function mergeRuntimeConfig(config: MushiConfig, runtime: MushiRuntimeSdkConfig): MushiConfig {
  const nativeTrigger = runtime.native?.triggerMode;
  const widgetTrigger = runtime.widget?.trigger
    ?? (nativeTrigger === 'none' || nativeTrigger === 'shake' ? 'manual' : undefined);
  return {
    ...config,
    widget: {
      ...config.widget,
      ...runtime.widget,
      ...(widgetTrigger ? { trigger: widgetTrigger } : {}),
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
  if (config.runtimeConfig === false) return false;
  if (config.runtimeConfig === true) return true;
  return !isLocalhostEndpoint(resolveApiEndpoint(config));
}

async function runDiagnostics(options: {
  apiEndpoint: string;
  widgetMounted: boolean;
  runtimeConfigLoaded: boolean;
  captureScreenshotAvailable: boolean;
  captureNetworkIntercepting: boolean;
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
    destroy: () => {
      instance = null;
    },
    captureEvent: async () => null,
    identify: () => {},
  };
}
