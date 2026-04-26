import {
  type MushiConfig,
  type MushiReport,
  type MushiReportCategory,
  type MushiRuntimeSdkConfig,
  type MushiEventType,
  type MushiEventHandler,
  type MushiSDKInstance,
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
} from './capture';
import { captureSentryContext } from './sentry';
import { setupProactiveTriggers, type ProactiveTriggerCleanup } from './proactive-triggers';
import { createProactiveManager, type ProactiveManager } from './proactive-manager';

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
}

function createInstance(config: MushiConfig): MushiSDKInstance {
  const bootstrapConfig: MushiConfig = config;
  let activeConfig: MushiConfig = config;
  const log = (config.debug ?? false)
    ? createLogger({ scope: 'mushi', level: 'debug', format: 'pretty' })
    : noopLogger;

  const apiClient = createApiClient({
    projectId: config.projectId,
    apiKey: config.apiKey,
    ...(config.apiEndpoint ? { apiEndpoint: config.apiEndpoint } : {}),
  });

  const preFilter = createPreFilter(config.preFilter);
  const offlineQueue = createOfflineQueue(config.offline);
  const rateLimiter = createRateLimiter({ maxBurst: 10, refillRate: 1, refillIntervalMs: 5_000 });
  const piiScrubber = createPiiScrubber();
  let consoleCap: ReturnType<typeof createConsoleCapture> | null = null;
  let networkCap: ReturnType<typeof createNetworkCapture> | null = null;
  let perfCap: ReturnType<typeof createPerformanceCapture> | null = null;
  let screenshotCap: ReturnType<typeof createScreenshotCapture> | null = null;
  let elementSelector: ReturnType<typeof createElementSelector> | null = null;

  function syncCaptureModules() {
    if (activeConfig.capture?.console !== false) {
      consoleCap ??= createConsoleCapture();
    } else {
      consoleCap?.destroy();
      consoleCap = null;
    }

    if (activeConfig.capture?.network !== false) {
      networkCap ??= createNetworkCapture();
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

    screenshotCap = activeConfig.capture?.screenshot !== 'off'
      ? (screenshotCap ?? createScreenshotCapture())
      : null;
    if (!screenshotCap) pendingScreenshot = null;

    if (activeConfig.capture?.elementSelector !== false) {
      elementSelector ??= createElementSelector();
    } else {
      elementSelector?.deactivate();
      elementSelector = null;
      pendingElement = null;
    }
  }

  const listeners = new Map<MushiEventType, Set<MushiEventHandler>>();
  function emit(type: MushiEventType, data?: unknown) {
    listeners.get(type)?.forEach((handler) => handler({ type, data }));
  }

  let pendingScreenshot: string | null = null;
  let pendingElement: { tagName: string; id?: string; className?: string; xpath?: string } | null = null;
  let pendingProactiveTrigger: string | null = null;
  let userInfo: { id: string; email?: string; name?: string } | null = null;
  const customMetadata: Record<string, unknown> = {};
  syncCaptureModules();

  const widget = new MushiWidget(config.widget, {
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
  });

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

  const proactiveCfg = config.proactive;
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

  if (config.runtimeConfig !== false) {
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
  }

  log.info('Initialized', { projectId: config.projectId });

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

    const report: MushiReport = {
      id: crypto.randomUUID?.() ?? `mushi_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      projectId: config.projectId,
      category,
      description: scrubbedDescription,
      userIntent: intent,
      environment: captureEnvironment(),
      consoleLogs: activeConfig.capture?.console === false ? undefined : consoleCap?.getEntries(),
      networkLogs: activeConfig.capture?.network === false ? undefined : networkCap?.getEntries(),
      performanceMetrics: activeConfig.capture?.performance === false ? undefined : perfCap?.getMetrics(),
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

    isOpen() {
      return widget.getIsOpen();
    },

    open() {
      widget.open();
    },

    close() {
      widget.close();
    },

    updateConfig(runtimeConfig) {
      applyRuntimeConfig(runtimeConfig);
    },

    destroy() {
      proactiveTriggers?.destroy();
      proactiveManager?.reset();
      widget.destroy();
      consoleCap?.destroy();
      networkCap?.destroy();
      perfCap?.destroy();
      elementSelector?.deactivate();
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
  return {
    ...config,
    widget: {
      ...config.widget,
      ...runtime.widget,
    },
    capture: {
      ...config.capture,
      ...runtime.capture,
    },
  };
}

function runtimeConfigCacheKey(projectId: string): string {
  return `mushi:sdk-config:${projectId}`;
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

function createNoopInstance(): MushiSDKInstance {
  return {
    report: () => {},
    on: () => () => {},
    setUser: () => {},
    setMetadata: () => {},
    isOpen: () => false,
    open: () => {},
    close: () => {},
    updateConfig: () => {},
    destroy: () => {
      instance = null;
    },
    captureEvent: async () => null,
    identify: () => {},
  };
}
