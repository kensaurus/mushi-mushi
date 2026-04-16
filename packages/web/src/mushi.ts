import {
  type MushiConfig,
  type MushiReport,
  type MushiReportCategory,
  type MushiEventType,
  type MushiEventHandler,
  type MushiSDKInstance,
  createApiClient,
  createPreFilter,
  createOfflineQueue,
  captureEnvironment,
  getReporterToken,
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
  const log = (config.debug ?? false)
    ? createLogger({ scope: 'mushi', level: 'debug', format: 'pretty' })
    : noopLogger;

  const apiClient = createApiClient({
    projectId: config.projectId,
    apiKey: config.apiKey,
    apiEndpoint: config.apiEndpoint ?? 'https://api.mushimushi.dev',
  });

  const preFilter = createPreFilter(config.preFilter);
  const offlineQueue = createOfflineQueue(config.offline);
  const rateLimiter = createRateLimiter({ maxBurst: 10, refillRate: 1, refillIntervalMs: 5_000 });
  const piiScrubber = createPiiScrubber();
  const consoleCap = config.capture?.console !== false ? createConsoleCapture() : null;
  const networkCap = config.capture?.network !== false ? createNetworkCapture() : null;
  const perfCap = config.capture?.performance !== false ? createPerformanceCapture() : null;
  const screenshotCap = config.capture?.screenshot !== 'off' ? createScreenshotCapture() : null;
  const elementSelector = config.capture?.elementSelector !== false ? createElementSelector() : null;

  const listeners = new Map<MushiEventType, Set<MushiEventHandler>>();
  function emit(type: MushiEventType, data?: unknown) {
    listeners.get(type)?.forEach((handler) => handler({ type, data }));
  }

  let userInfo: { id: string; email?: string; name?: string } | null = null;
  const customMetadata: Record<string, unknown> = {};
  let pendingScreenshot: string | null = null;
  let pendingElement: { tagName: string; id?: string; className?: string; xpath?: string } | null = null;
  let pendingProactiveTrigger: string | null = null;

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
      if (!screenshotCap) return;
      log.debug('Taking screenshot');
      pendingScreenshot = await screenshotCap.take();
      widget.setScreenshotAttached(pendingScreenshot !== null);
    },
    onElementSelectorRequest: async () => {
      if (!elementSelector) return;
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

  log.info('Initialized', { projectId: config.projectId });

  async function submitReport(category: MushiReportCategory, description: string, intent?: string) {
    const filterResult = preFilter.check(description);
    if (!filterResult.passed) {
      log.info('Report blocked by pre-filter', { reason: filterResult.reason });
      return;
    }

    if (!rateLimiter.tryConsume()) {
      log.warn('Report throttled — rate limit exceeded');
      return;
    }

    const scrubbedDescription = piiScrubber.scrub(preFilter.truncate(description));

    const sentryCtx = config.sentry ? captureSentryContext(config.sentry) : undefined;

    const report: MushiReport = {
      id: crypto.randomUUID?.() ?? `mushi_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      projectId: config.projectId,
      category,
      description: scrubbedDescription,
      userIntent: intent,
      environment: captureEnvironment(),
      consoleLogs: consoleCap?.getEntries(),
      networkLogs: networkCap?.getEntries(),
      performanceMetrics: perfCap?.getMetrics(),
      screenshotDataUrl: pendingScreenshot ?? undefined,
      selectedElement: pendingElement ?? undefined,
      metadata: {
        ...customMetadata,
        ...(userInfo ? { user: userInfo } : {}),
        ...(sentryCtx?.release ? { sentryRelease: sentryCtx.release } : {}),
      },
      sessionId: getSessionId(),
      reporterToken: getReporterToken(),
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
  };

  return sdk;
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
    destroy: () => {
      instance = null;
    },
  };
}
