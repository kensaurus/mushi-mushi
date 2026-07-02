/**
 * FILE: packages/server/supabase/functions/_shared/sdk-config.ts
 * PURPOSE: Pure, dependency-free SDK config normalization logic.
 *
 * OVERVIEW:
 *   Single source of truth for the SDK-facing config shape, consumed by both
 *   the runtime `GET /v1/sdk/config` endpoint (routes/public.ts) and the
 *   admin console's `GET/PUT /v1/admin/projects/:id/sdk-config` endpoint
 *   (routes/settings-research.ts) via the re-export in api/helpers.ts.
 *
 *   This used to be forked: routes/public.ts carried a local shadow copy
 *   with explicit-only emission (correct for the SDK runtime merge) while
 *   api/helpers.ts always emitted column defaults (correct-looking for the
 *   admin console, but actually just stale) AND was missing
 *   `reporterNotificationsEnabled` entirely in the public.ts copy — so
 *   turning off reporter notifications in the console never actually
 *   stopped the live SDK from polling. Extracted here, with zero external
 *   imports, specifically so it can be unit-tested without a Deno/network
 *   dependency graph — do not add imports to this file; add a new _shared
 *   module and pass data in instead.
 *
 * DEPENDENCIES: none (intentionally pure).
 */

const SDK_WIDGET_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const SDK_WIDGET_THEMES = ['auto', 'light', 'dark'] as const;
const SDK_SCREENSHOT_MODES = ['on-report', 'auto', 'off'] as const;
const SDK_NATIVE_TRIGGER_MODES = ['shake', 'button', 'both', 'none'] as const;
const SDK_WIDGET_LAUNCHERS = ['auto', 'banner', 'edge-tab', 'manual', 'hidden'] as const;
const SDK_BANNER_VARIANTS = ['neon', 'brand', 'subtle'] as const;
const SDK_BANNER_POSITIONS = ['top', 'bottom'] as const;

export interface SdkConfigRow {
  project_id?: string;
  sdk_config_enabled?: boolean | null;
  sdk_widget_position?: string | null;
  sdk_widget_theme?: string | null;
  sdk_widget_trigger_text?: string | null;
  /** Launcher mode: 'auto' (FAB), 'banner', 'edge-tab', 'manual', 'hidden'. */
  sdk_widget_launcher?: string | null;
  /** Banner strip variant when launcher is 'banner'. */
  sdk_banner_variant?: string | null;
  /** Banner strip position. */
  sdk_banner_position?: string | null;
  /** Banner bug CTA label override. */
  sdk_banner_bug_cta?: string | null;
  /** Whether to show the feature-request CTA in the banner. */
  sdk_banner_feature_cta?: boolean | null;
  /** Rich banner body copy (Beta announcement line). */
  sdk_banner_message?: string | null;
  /** Rich banner pill label (e.g. Beta). */
  sdk_banner_label?: string | null;
  /**
   * Screenshot privacy caption control. NULL = use the SDK default caption,
   * '' (empty) = hide the caption (maps to `false`), any other string = custom
   * caption copy. Surfaces in the widget block as `screenshotSensitiveHint`.
   */
  sdk_screenshot_sensitive_hint?: string | null;
  sdk_capture_console?: boolean | null;
  sdk_capture_network?: boolean | null;
  sdk_capture_performance?: boolean | null;
  sdk_capture_screenshot?: string | null;
  sdk_capture_element_selector?: boolean | null;
  sdk_native_trigger_mode?: string | null;
  sdk_min_description_length?: number | null;
  sdk_config_updated_at?: string | null;
  reporter_notifications_enabled?: boolean | null;
  // Workstream E — page-aware assistant.
  assistant_enabled?: boolean | null;
  assistant_label?: string | null;
  assistant_greeting?: string | null;
  assistant_suggestions?: unknown;
}

function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return isOneOf(value, allowed) ? (value as T[number]) : fallback;
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Single source of truth for the SDK-facing config shape — see file header.
 *
 * Widget/capture fields follow an explicit-only emission rule: a value equal
 * to the column default means "the console never configured this" and is
 * omitted, so the SDK's runtime merge cannot clobber host-wired config. This
 * is what restored host-set `trigger: 'banner'` — an always-emitted default
 * `launcher: 'auto'` used to override it and the top banner vanished. The
 * admin console's `fromRemoteConfig()` already treats every widget/capture
 * field as optional (`remote.widget?.x ?? DEFAULT_SDK_CONFIG.x`), so this is
 * safe for both consumers.
 */
export function normalizeSdkConfig(row?: SdkConfigRow | null) {
  return {
    enabled: row?.sdk_config_enabled ?? true,
    version: row?.sdk_config_updated_at ?? null,
    widget: {
      ...(isOneOf(row?.sdk_widget_position, SDK_WIDGET_POSITIONS) &&
      row?.sdk_widget_position !== 'bottom-right'
        ? { position: row.sdk_widget_position }
        : {}),
      ...(isOneOf(row?.sdk_widget_theme, SDK_WIDGET_THEMES) && row?.sdk_widget_theme !== 'auto'
        ? { theme: row.sdk_widget_theme }
        : {}),
      ...(row?.sdk_widget_trigger_text ? { triggerText: row.sdk_widget_trigger_text } : {}),
      ...(isOneOf(row?.sdk_widget_launcher, SDK_WIDGET_LAUNCHERS) &&
      row?.sdk_widget_launcher !== 'auto'
        ? { launcher: row.sdk_widget_launcher }
        : {}),
      ...(isOneOf(row?.sdk_banner_variant, SDK_BANNER_VARIANTS) && row?.sdk_banner_variant !== 'brand'
        ? { bannerVariant: row.sdk_banner_variant }
        : {}),
      ...(isOneOf(row?.sdk_banner_position, SDK_BANNER_POSITIONS) && row?.sdk_banner_position !== 'top'
        ? { bannerPosition: row.sdk_banner_position }
        : {}),
      ...(row?.sdk_banner_bug_cta != null ? { bannerBugCta: row.sdk_banner_bug_cta } : {}),
      ...(row?.sdk_banner_feature_cta === false ? { bannerFeatureCta: false } : {}),
      ...(row?.sdk_banner_message != null ? { bannerMessage: row.sdk_banner_message } : {}),
      ...(row?.sdk_banner_label != null ? { bannerLabel: row.sdk_banner_label } : {}),
      // Only surface the hint when the console has set it (non-null), so an
      // unset column never overrides a host-configured value. '' → false
      // (hide caption); any other string → custom caption.
      ...(row?.sdk_screenshot_sensitive_hint != null
        ? {
            screenshotSensitiveHint:
              row.sdk_screenshot_sensitive_hint === '' ? false : row.sdk_screenshot_sensitive_hint,
          }
        : {}),
    },
    // Capture flags are emitted ONLY when they differ from the platform
    // default. The columns are NOT NULL with defaults, so "equals the
    // default" is the only available signal for "the console never
    // configured this". Emitting defaults unconditionally clobbered
    // host-wired features through the SDK's runtime merge (e.g. a host with
    // `capture: { elementSelector: true }` got a dead Select Element button
    // because the untouched console row emitted `false`). Values that differ
    // from the default — including the privacy-critical `screenshot: 'off'`
    // — are always emitted and stay authoritative.
    capture: {
      ...(row?.sdk_capture_console === false ? { console: false } : {}),
      ...(row?.sdk_capture_network === false ? { network: false } : {}),
      ...(row?.sdk_capture_performance === true ? { performance: true } : {}),
      ...(isOneOf(row?.sdk_capture_screenshot, SDK_SCREENSHOT_MODES) &&
      row?.sdk_capture_screenshot !== 'on-report'
        ? { screenshot: row.sdk_capture_screenshot }
        : {}),
      ...(row?.sdk_capture_element_selector === true ? { elementSelector: true } : {}),
    },
    native: {
      triggerMode: oneOf(row?.sdk_native_trigger_mode, SDK_NATIVE_TRIGGER_MODES, 'both'),
      minDescriptionLength: Math.max(0, Math.min(1000, row?.sdk_min_description_length ?? 20)),
    },
    reporterNotificationsEnabled: row?.reporter_notifications_enabled !== false,
    // Workstream E — page-aware assistant. `enabled` gates the "Ask" tab in
    // the widget; greeting/suggestions are display-only. The knowledge
    // corpus and LLM keys never leave the server (POST /v1/sdk/assistant).
    assistant: {
      enabled: row?.assistant_enabled ?? false,
      label:
        typeof row?.assistant_label === 'string' && row.assistant_label.trim()
          ? row.assistant_label.trim().slice(0, 24)
          : 'Ask',
      greeting: typeof row?.assistant_greeting === 'string' ? row.assistant_greeting.slice(0, 400) : null,
      suggestions: Array.isArray(row?.assistant_suggestions)
        ? (row.assistant_suggestions as unknown[])
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim().slice(0, 120))
            .slice(0, 6)
        : [],
    },
  };
}

export function coerceSdkConfigUpdate(body: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const widget = isRecord(body.widget) ? body.widget : {};
  const capture = isRecord(body.capture) ? body.capture : {};
  const native = isRecord(body.native) ? body.native : {};

  if (typeof body.enabled === 'boolean') updates.sdk_config_enabled = body.enabled;
  if (isOneOf(widget.position, SDK_WIDGET_POSITIONS)) updates.sdk_widget_position = widget.position;
  if (isOneOf(widget.theme, SDK_WIDGET_THEMES)) updates.sdk_widget_theme = widget.theme;
  if (typeof widget.triggerText === 'string') {
    const trimmed = widget.triggerText.trim();
    updates.sdk_widget_trigger_text = trimmed ? widget.triggerText.slice(0, 24) : null;
  } else if (widget.triggerText === null) {
    updates.sdk_widget_trigger_text = null;
  }
  if (isOneOf(widget.launcher, SDK_WIDGET_LAUNCHERS)) updates.sdk_widget_launcher = widget.launcher;
  if (isOneOf(widget.bannerVariant, SDK_BANNER_VARIANTS)) updates.sdk_banner_variant = widget.bannerVariant;
  if (isOneOf(widget.bannerPosition, SDK_BANNER_POSITIONS)) updates.sdk_banner_position = widget.bannerPosition;
  if (typeof widget.bannerBugCta === 'string') {
    const trimmed = widget.bannerBugCta.trim();
    updates.sdk_banner_bug_cta = trimmed ? widget.bannerBugCta.slice(0, 60) : null;
  }
  if (typeof widget.bannerFeatureCta === 'boolean') updates.sdk_banner_feature_cta = widget.bannerFeatureCta;
  if (typeof widget.bannerMessage === 'string') {
    const trimmed = widget.bannerMessage.trim();
    updates.sdk_banner_message = trimmed ? trimmed.slice(0, 240) : null;
  } else if (widget.bannerMessage === null) {
    updates.sdk_banner_message = null;
  }
  if (typeof widget.bannerLabel === 'string') {
    const trimmed = widget.bannerLabel.trim();
    updates.sdk_banner_label = trimmed ? trimmed.slice(0, 24) : null;
  } else if (widget.bannerLabel === null) {
    updates.sdk_banner_label = null;
  }
  // screenshotSensitiveHint: boolean | string | null.
  //   true  → NULL  (use the SDK's localized default caption)
  //   false → ''    (hide the caption; normalizeSdkConfig maps '' back to false)
  //   string → custom caption (empty/whitespace falls back to NULL = default)
  //   null  → NULL  (clear the override)
  if (typeof widget.screenshotSensitiveHint === 'boolean') {
    updates.sdk_screenshot_sensitive_hint = widget.screenshotSensitiveHint ? null : '';
  } else if (typeof widget.screenshotSensitiveHint === 'string') {
    const trimmed = widget.screenshotSensitiveHint.trim();
    updates.sdk_screenshot_sensitive_hint = trimmed ? trimmed.slice(0, 200) : null;
  } else if (widget.screenshotSensitiveHint === null) {
    updates.sdk_screenshot_sensitive_hint = null;
  }
  if (typeof capture.console === 'boolean') updates.sdk_capture_console = capture.console;
  if (typeof capture.network === 'boolean') updates.sdk_capture_network = capture.network;
  if (typeof capture.performance === 'boolean')
    updates.sdk_capture_performance = capture.performance;
  if (isOneOf(capture.screenshot, SDK_SCREENSHOT_MODES))
    updates.sdk_capture_screenshot = capture.screenshot;
  if (typeof capture.elementSelector === 'boolean')
    updates.sdk_capture_element_selector = capture.elementSelector;
  if (isOneOf(native.triggerMode, SDK_NATIVE_TRIGGER_MODES))
    updates.sdk_native_trigger_mode = native.triggerMode;
  if (Number.isFinite(native.minDescriptionLength)) {
    updates.sdk_min_description_length = Math.max(
      0,
      Math.min(1000, Math.round(Number(native.minDescriptionLength))),
    );
  }
  updates.sdk_config_updated_at = new Date().toISOString();
  return updates;
}
