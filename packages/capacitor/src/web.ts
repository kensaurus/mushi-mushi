import { WebPlugin } from '@capacitor/core';
import {
  captureEnvironment,
  createApiClient,
  getReporterToken,
  type MushiApiClient,
  type MushiReport,
  type MushiReportCategory,
} from '@mushi-mushi/core';

import type {
  MushiCapacitorBreadcrumb,
  MushiCapacitorPlugin,
  MushiCapacitorPluginConfig,
  MushiCapacitorReport,
  MushiCapacitorUser,
} from './definitions';

/** Thrown when a plugin method is called before `configure({ endpoint })` is set. */
class MushiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MushiConfigError';
  }
}

const ENDPOINT_HINT =
  'Call MushiMushi.configure({ endpoint: "https://xyz.supabase.co/functions/v1/api", ... }) first.';

/**
 * Web fallback for the Capacitor plugin. Reuses the canonical
 * `@mushi-mushi/core` API client so behaviour matches the web SDK exactly
 * when the app is run in a browser preview (`ionic serve`).
 *
 * Native iOS/Android implementations override every method via the
 * Capacitor bridge; this class is only used when no native bridge exists.
 */
export class WebMushi extends WebPlugin implements MushiCapacitorPlugin {
  // NOTE: do not name this `config` — `WebPlugin` exposes its own `config`
  // field (`WebPluginConfig | undefined`) and TS rejects the type clash.
  private pluginConfig: MushiCapacitorPluginConfig | null = null;
  private apiClient: MushiApiClient | null = null;
  private currentUser: MushiCapacitorUser | null = null;
  /** Signed end-user identity JWT (set via identifyWithToken); verified server-side. */
  private userToken: string | null = null;

  async configure(options: MushiCapacitorPluginConfig): Promise<void> {
    this.pluginConfig = options;
    if (options.endpoint) {
      this.apiClient = createApiClient({
        projectId: options.projectId,
        apiKey: options.apiKey,
        apiEndpoint: options.endpoint,
        getUserToken: () => this.userToken,
      });
    } else {
      this.apiClient = null;
      console.warn(
        '[MushiMushi] endpoint not set — report() calls will throw. ' + ENDPOINT_HINT,
      );
    }
  }

  async report(payload: MushiCapacitorReport): Promise<{ accepted: boolean }> {
    const cfg = this.pluginConfig;
    if (!cfg) return { accepted: false };

    const client = this.apiClient;
    if (!client) {
      throw new MushiConfigError('Mushi endpoint not configured. ' + ENDPOINT_HINT);
    }

    const environment = captureEnvironment();
    const report: MushiReport = {
      id: crypto.randomUUID(),
      projectId: cfg.projectId,
      description: payload.description,
      category: ((payload.category as MushiReportCategory | undefined) ?? 'bug') as MushiReportCategory,
      createdAt: new Date().toISOString(),
      metadata: {
        ...payload.metadata ?? {},
        ...(this.currentUser ? { user: this.currentUser } : {}),
      },
      environment,
      reporterToken: getReporterToken(cfg.projectId),
    };

    const res = await client.submitReport(report);
    if (res.ok) {
      this.notifyListeners('reportSubmitted', {
        ...payload,
        context: environment,
      });
    }
    return { accepted: res.ok };
  }

  async captureScreenshot(): Promise<{ image: string | null }> {
    if (typeof document === 'undefined') {
      return { image: null };
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn('[MushiMushi] captureScreenshot: 2d canvas context unavailable');
        return { image: null };
      }
      // The Canvas API cannot capture cross-origin DOM content; this produces
      // a blank frame for most pages. Apps wanting real screenshots should
      // add html2canvas or dom-to-image-more as a direct dependency and call
      // it before invoking report().
      return { image: canvas.toDataURL('image/png') };
    } catch {
      console.warn('[MushiMushi] captureScreenshot failed; returning null');
      return { image: null };
    }
  }

  async showWidget(): Promise<void> {
    // Web fallback: the host app should render its own report form using the
    // standard web SDK. We just emit a no-op event so devs can detect this.
    this.notifyListeners('widgetRequested', {});
  }

  async setUser(payload: { user: MushiCapacitorUser | null }): Promise<void> {
    this.currentUser = payload.user;
  }

  async identifyWithToken(payload: { token: string | null }): Promise<void> {
    this.userToken = payload.token && typeof payload.token === 'string' ? payload.token : null;
    // Rebuild the API client so the signed token rides on every request via
    // the X-Mushi-User-Token header (verified server-side).
    const cfg = this.pluginConfig;
    if (cfg?.endpoint) {
      this.apiClient = createApiClient({
        projectId: cfg.projectId,
        apiKey: cfg.apiKey,
        apiEndpoint: cfg.endpoint,
        getUserToken: () => this.userToken,
      });
    }
  }

  async setMetadata(): Promise<void> {
    // Native-only bridge. Browser previews should pass metadata through the
    // standard web SDK instead.
  }

  async flushQueue(): Promise<{ delivered: number }> {
    // The web `createApiClient` retries internally — there is no separate
    // offline queue on the web path. Native platforms flush their SQLite
    // queue here; the web fallback always reports zero.
    return { delivered: 0 };
  }

  async addBreadcrumb(_crumb: MushiCapacitorBreadcrumb): Promise<void> {
    // Web fallback: breadcrumbs are managed by the @mushi-mushi/web SDK on
    // the browser side. No-op here so cross-platform calls don't throw.
  }

  async getBreadcrumbs(): Promise<{ breadcrumbs: MushiCapacitorBreadcrumb[] }> {
    return { breadcrumbs: [] };
  }

  async listMyReports(): Promise<{ reports: Array<Record<string, unknown>> }> {
    const client = this.apiClient;
    const cfg = this.pluginConfig;
    if (!client || !cfg) throw new MushiConfigError('Mushi endpoint not configured. ' + ENDPOINT_HINT);
    const result = await client.listReporterReports(getReporterToken(cfg.projectId));
    return { reports: (result.data?.reports ?? []) as unknown as Array<Record<string, unknown>> };
  }

  async listMyComments(options: { reportId: string }): Promise<{ comments: Array<Record<string, unknown>> }> {
    const client = this.apiClient;
    const cfg = this.pluginConfig;
    if (!client || !cfg) throw new MushiConfigError('Mushi endpoint not configured. ' + ENDPOINT_HINT);
    const result = await client.listReporterComments(options.reportId, getReporterToken(cfg.projectId));
    return { comments: (result.data?.comments ?? []) as unknown as Array<Record<string, unknown>> };
  }

  async replyToReport(options: {
    reportId: string;
    body?: string;
    feedbackSignal?: string;
  }): Promise<{ comment?: Record<string, unknown>; feedback?: Record<string, unknown> }> {
    const client = this.apiClient;
    const cfg = this.pluginConfig;
    if (!client || !cfg) throw new MushiConfigError('Mushi endpoint not configured. ' + ENDPOINT_HINT);
    const result = await client.replyToReporterReport(
      options.reportId,
      getReporterToken(cfg.projectId),
      options.body ?? '',
      options.feedbackSignal,
    );
    return {
      comment: result.data?.comment as Record<string, unknown> | undefined,
      feedback: result.data?.feedback as Record<string, unknown> | undefined,
    };
  }

  async reopenReport(options: { reportId: string; note?: string }): Promise<{ outcome: Record<string, unknown> }> {
    const client = this.apiClient;
    const cfg = this.pluginConfig;
    if (!client || !cfg) throw new MushiConfigError('Mushi endpoint not configured. ' + ENDPOINT_HINT);
    const result = await client.reopenReporterReport(options.reportId, getReporterToken(cfg.projectId), options.note);
    return { outcome: (result.data?.outcome ?? {}) as Record<string, unknown> };
  }
}
