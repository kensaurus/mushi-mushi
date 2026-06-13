/**
 * Public surface for the Mushi Mushi Capacitor plugin.
 *
 * The Capacitor bridge is intentionally thin — actual transport, queue, and
 * categorization live in `@mushi-mushi/core`. The native side only handles
 * shake detection, screenshot capture, and presenting the native bottom
 * sheet (when `useNativeWidget = true`); everything else flows through the
 * shared TS API client so behaviour is identical with the web SDK.
 */

export type MushiTriggerMode = 'shake' | 'button' | 'both' | 'none';
export type MushiTriggerInsetPreset = 'tabBarSafe' | 'dockSafe';

export const triggerInsetPresets: Record<
  MushiTriggerInsetPreset,
  { bottom: number; leading?: number; trailing?: number; start?: number; end?: number }
> = {
  tabBarSafe: { bottom: 72, trailing: 20, end: 20 },
  dockSafe: { bottom: 96, trailing: 20, end: 20 },
};

export interface MushiCapacitorPluginConfig {
  /** Project UUID from the Mushi admin console. */
  projectId: string;
  /** Public ingest API key (`mush_pk_...`). */
  apiKey: string;
  /**
   * Supabase Edge Function URL for the ingest endpoint.
   * Required for reports to be delivered. Example: `https://xyz.supabase.co/functions/v1/api`.
   */
  endpoint?: string;
  /** Defaults to `'shake'`. */
  triggerMode?: MushiTriggerMode;
  /** When `true`, captures a base64 screenshot via the native bridge. */
  captureScreenshot?: boolean;
  /** Minimum description length in the widget. Mirrors the web SDK. */
  minDescriptionLength?: number;
  /**
   * When `true`, presents the native iOS/Android bottom sheet instead of
   * letting your Ionic/web layer render the report form.
   * Defaults to `false` (web widget).
   */
  useNativeWidget?: boolean;
  /** Theme overrides for the native bottom sheet. */
  theme?: { accentColor?: string; dark?: boolean };
  /** Native trigger offset in logical px/dp. Defaults keep the historical bottom-right button. */
  triggerInset?: { bottom?: number; leading?: number; trailing?: number; start?: number; end?: number };
  /** Convenience preset for common mobile shells; explicit `triggerInset` wins when both are provided. */
  triggerInsetPreset?: MushiTriggerInsetPreset;
}

export interface MushiCapacitorReport {
  description: string;
  category?: 'bug' | 'slow' | 'visual' | 'confusing' | string;
  metadata?: Record<string, unknown>;
}

export interface MushiCapacitorUser {
  id?: string;
  email?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

export interface MushiCapacitorWidgetOptions {
  category?: 'bug' | 'slow' | 'visual' | 'confusing' | string;
  metadata?: Record<string, unknown>;
}

export interface MushiCapacitorBreadcrumb {
  timestamp?: number;
  category: 'navigation' | 'ui.tap' | 'console' | 'network' | 'lifecycle' | 'custom';
  level?: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  data?: Record<string, string>;
}

export interface MushiCapacitorPlugin {
  /** Initialize the plugin. Idempotent. */
  configure(options: MushiCapacitorPluginConfig): Promise<void>;

  /** Submit a report immediately, flowing through the offline queue if the
   *  network is unreachable. */
  report(payload: MushiCapacitorReport): Promise<{ accepted: boolean }>;

  /** Capture a screenshot of the active webview as a base64-encoded PNG.
   *  Returns `null` if `captureScreenshot` is disabled or unsupported. */
  captureScreenshot(): Promise<{ image: string | null }>;

  /** Present the native bottom-sheet widget. Resolves when the user
   *  dismisses or submits. */
  showWidget(options?: MushiCapacitorWidgetOptions): Promise<void>;

  /** Attach app/user identity to subsequent native reports. */
  setUser(payload: { user: MushiCapacitorUser | null }): Promise<void>;

  /** Attach or clear a metadata key on subsequent native reports. */
  setMetadata(payload: { key: string; value?: unknown }): Promise<void>;

  /** Force a flush of the offline queue. */
  flushQueue(): Promise<{ delivered: number }>;

  /**
   * Append a breadcrumb to the native ring buffer. Mirrors `Mushi.addBreadcrumb()`
   * from the web SDK — the same 50-entry FIFO is flushed with every report.
   */
  addBreadcrumb(crumb: MushiCapacitorBreadcrumb): Promise<void>;

  /**
   * Return a snapshot of the current native breadcrumb ring buffer, oldest first.
   */
  getBreadcrumbs(): Promise<{ breadcrumbs: MushiCapacitorBreadcrumb[] }>;

  /** Listener API — fired on every successful report submission. */
  addListener(
    eventName: 'reportSubmitted',
    listenerFunc: (event: MushiCapacitorReport & { context: unknown }) => void,
  ): Promise<{ remove: () => Promise<void> }>;

  /** List the reporter's own reports (two-way inbox data API). */
  listMyReports(): Promise<{ reports: Array<Record<string, unknown>> }>;

  /** List comments visible to the reporter on a report. */
  listMyComments(options: { reportId: string }): Promise<{ comments: Array<Record<string, unknown>> }>;

  /** Post a reply or feedback signal on a report. */
  replyToReport(options: {
    reportId: string;
    body?: string;
    feedbackSignal?: string;
  }): Promise<{ comment?: Record<string, unknown>; feedback?: Record<string, unknown> }>;

  /** Reporter-initiated regression reopen. */
  reopenReport(options: { reportId: string; note?: string }): Promise<{ outcome: Record<string, unknown> }>;
}
