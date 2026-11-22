/**
 * Runtime config merge — host init config overlaid with console /sdk/config.
 * Extracted from mushi.ts for unit testing merge precedence (banner trigger,
 * capture flags, explicit-only widget keys).
 */

import type { MushiConfig, MushiRuntimeSdkConfig, MushiWidgetConfig } from '@mushi-mushi/core';

/**
 * Merge the console's runtime capture flags over the host's, key by key.
 * Only keys the server explicitly sent (non-undefined) are applied.
 * @internal Exported for tests only.
 */
export function mergeRuntimeCapture(
  host: MushiConfig['capture'],
  runtime: MushiRuntimeSdkConfig['capture'],
): MushiConfig['capture'] {
  const merged: Record<string, unknown> = { ...host };
  if (runtime) {
    for (const [key, value] of Object.entries(runtime)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged as MushiConfig['capture'];
}

/**
 * One rule for every widget appearance key (ADR 0068, 2026-11-22): a value
 * the host app set in code wins; the console's runtime value fills only what
 * the code left unset; then the SDK default. "Set in code" is judged against
 * `host` (the original init config), never against `config`, so a cached
 * runtime payload applied earlier cannot masquerade as a host value. Pass the
 * bootstrap config as `host` when merging repeatedly.
 *
 * The launcher (`trigger` / `launcher`) keeps its own rules below; the banner
 * fields are judged one by one against `host.widget.bannerConfig`.
 */
function hostSet(host: MushiConfig, key: string): boolean {
  return (host.widget as Record<string, unknown> | undefined)?.[key] !== undefined;
}

/**
 * Host triggers where the app draws its own launcher: `manual` (the app calls
 * `open()`) and `attach` (the app's own element). A console launcher on top of
 * them draws a second button (Help Her Take Photo's web build, 2026-10-09), so
 * only an explicit console `hidden` still applies.
 */
const HOST_OWNED_TRIGGERS: readonly string[] = ['manual', 'attach'];

export function mergeRuntimeConfig(
  config: MushiConfig,
  runtime: MushiRuntimeSdkConfig,
  host: MushiConfig = config,
): MushiConfig {
  const nativeTrigger = runtime.native?.triggerMode;
  const runtimeLauncher = (runtime.widget as Record<string, unknown>)?.launcher as string | undefined;
  const hostTrigger = config.widget?.trigger;
  const originalHostTrigger = host.widget?.trigger;
  const rawRuntimeTrigger = runtimeLauncher ?? runtime.widget?.trigger;
  const hostOwnsLauncher =
    (originalHostTrigger !== undefined && HOST_OWNED_TRIGGERS.includes(originalHostTrigger)) &&
    rawRuntimeTrigger !== 'hidden';
  const runtimeTrigger =
    hostOwnsLauncher || (rawRuntimeTrigger === 'auto' && hostTrigger && hostTrigger !== 'auto')
      ? undefined
      : rawRuntimeTrigger;
  const widgetTrigger = hostOwnsLauncher
    ? undefined
    : runtimeTrigger ?? (nativeTrigger === 'none' || nativeTrigger === 'shake' ? 'manual' : undefined);
  const explicitHidden = runtimeLauncher === 'hidden' || runtime.widget?.trigger === 'hidden';
  const safeWidgetTrigger =
    widgetTrigger === 'hidden' && !explicitHidden && hostTrigger && hostTrigger !== 'hidden'
      ? hostTrigger
      : widgetTrigger;
  const runtimeWidget = runtime.widget as Record<string, unknown> | undefined;
  const runtimeBannerVariant = runtimeWidget?.bannerVariant as string | undefined;
  const runtimeBannerPosition = runtimeWidget?.bannerPosition as string | undefined;
  const runtimeBannerMessage = runtimeWidget?.bannerMessage as string | null | undefined;
  const runtimeBannerLabel = runtimeWidget?.bannerLabel as string | null | undefined;
  const runtimeBannerBugCta = runtimeWidget?.bannerBugCta as string | null | undefined;
  const runtimeBannerFeatureCta = runtimeWidget?.bannerFeatureCta as boolean | undefined;
  // Banner fields: the console fills each one the host's bannerConfig left unset.
  const hostBanner = (host.widget?.bannerConfig ?? {}) as Record<string, unknown>;
  const fill = (field: string, present: boolean) => present && hostBanner[field] === undefined;
  const bannerPatch = {
    ...(fill('variant', Boolean(runtimeBannerVariant)) ? { variant: runtimeBannerVariant as 'neon' | 'brand' | 'subtle' } : {}),
    ...(fill('position', Boolean(runtimeBannerPosition)) ? { position: runtimeBannerPosition as 'top' | 'bottom' } : {}),
    ...(fill('message', runtimeBannerMessage != null) ? { message: runtimeBannerMessage as string } : {}),
    ...(fill('label', runtimeBannerLabel != null)
      ? { label: runtimeBannerLabel === '' ? (false as const) : (runtimeBannerLabel as string) }
      : {}),
    ...(fill('bugCta', runtimeBannerBugCta != null) ? { bugCta: runtimeBannerBugCta ?? undefined } : {}),
    ...(fill('featureCta', runtimeBannerFeatureCta != null) ? { featureCta: runtimeBannerFeatureCta } : {}),
  };
  const derivedBannerConfig =
    Object.keys(bannerPatch).length > 0 ? { ...(config.widget?.bannerConfig ?? {}), ...bannerPatch } : undefined;
  const definedRuntimeWidget: Record<string, unknown> = {};
  if (runtime.widget) {
    for (const [key, value] of Object.entries(runtime.widget)) {
      if (key === 'trigger' || key === 'launcher') continue;
      if (value === undefined || value === null) continue;
      // The text colour is chosen for its accent (the server checks the pair
      // for contrast), so it follows whichever accent wins, never alone.
      if (key === 'accentText') continue;
      if (hostSet(host, key)) continue; // code beats the console (ADR 0068)
      definedRuntimeWidget[key] = value;
    }
    const runtimeAccentText = (runtime.widget as Record<string, unknown>).accentText;
    if (definedRuntimeWidget.accent !== undefined && runtimeAccentText != null) {
      definedRuntimeWidget.accentText = runtimeAccentText;
    }
  }
  return {
    ...config,
    widget: {
      ...config.widget,
      ...definedRuntimeWidget,
      ...(safeWidgetTrigger ? { trigger: safeWidgetTrigger as MushiWidgetConfig['trigger'] } : {}),
      ...(derivedBannerConfig ? { bannerConfig: derivedBannerConfig } : {}),
      ...(config.widget?.betaMode ? { betaMode: config.widget.betaMode } : {}),
    },
    capture: mergeRuntimeCapture(config.capture, runtime.capture),
    privacy: {
      ...config.privacy,
    },
  };
}
