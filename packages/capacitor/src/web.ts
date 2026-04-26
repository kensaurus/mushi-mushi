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
  MushiCapacitorPlugin,
  MushiCapacitorPluginConfig,
  MushiCapacitorReport,
} from './definitions';

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

  async configure(options: MushiCapacitorPluginConfig): Promise<void> {
    this.pluginConfig = options;
    this.apiClient = createApiClient({
      projectId: options.projectId,
      apiKey: options.apiKey,
      apiEndpoint: options.endpoint ?? 'https://api.mushimushi.dev',
    });
  }

  async report(payload: MushiCapacitorReport): Promise<{ accepted: boolean }> {
    const cfg = this.pluginConfig;
    const client = this.apiClient;
    if (!cfg || !client) return { accepted: false };

    const environment = captureEnvironment();
    const report: MushiReport = {
      id: crypto.randomUUID(),
      projectId: cfg.projectId,
      description: payload.description,
      category: ((payload.category as MushiReportCategory | undefined) ?? 'bug') as MushiReportCategory,
      createdAt: new Date().toISOString(),
      metadata: payload.metadata ?? {},
      environment,
      reporterToken: getReporterToken(),
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
    // Browser fallback: html2canvas / native APIs aren't available without a
    // dependency we don't want to ship by default. Returns null and lets the
    // native iOS/Android side handle this in production.
    return { image: null };
  }

  async showWidget(): Promise<void> {
    // Web fallback: the host app should render its own report form using the
    // standard web SDK. We just emit a no-op event so devs can detect this.
    this.notifyListeners('widgetRequested', {});
  }

  async setUser(): Promise<void> {
    // Native-only bridge. Browser previews should pass user context through
    // the standard web SDK instead.
  }

  async setMetadata(): Promise<void> {
    // Native-only bridge. Browser previews should pass metadata through the
    // standard web SDK instead.
  }

  async flushQueue(): Promise<{ delivered: number }> {
    // The web `createApiClient` retries internally, so there's no separate
    // queue to flush. Return zero to keep the contract.
    return { delivered: 0 };
  }
}
