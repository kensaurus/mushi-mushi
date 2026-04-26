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

export interface MushiCapacitorPluginConfig {
  /** Project UUID from the Mushi admin console. */
  projectId: string;
  /** Public ingest API key (`mush_pk_...`). */
  apiKey: string;
  /**
   * Override the ingest endpoint. Defaults to `https://api.mushimushi.dev`.
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

  /** Listener API — fired on every successful report submission. */
  addListener(
    eventName: 'reportSubmitted',
    listenerFunc: (event: MushiCapacitorReport & { context: unknown }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}
