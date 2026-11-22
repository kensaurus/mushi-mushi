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

/** Runtime `banner<Field>` keys, judged one by one against the host's bannerConfig. */
const BANNER_FIELDS = ['variant', 'position', 'message', 'label', 'bugCta', 'featureCta'] as const;

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
  const runtimeWidget = (runtime.widget ?? {}) as Record<string, unknown>;
  // Banner fields: the console fills each one the host's bannerConfig left
  // unset ('' label = no label pill).
  const hostBanner = (host.widget?.bannerConfig ?? {}) as Record<string, unknown>;
  const bannerPatch: Record<string, unknown> = {};
  for (const field of BANNER_FIELDS) {
    const value = runtimeWidget['banner' + field[0].toUpperCase() + field.slice(1)];
    if (value != null && value !== '' || field === 'label' && value === '') {
      if (hostBanner[field] === undefined) bannerPatch[field] = value === '' ? false : value;
    }
  }
  const derivedBannerConfig = Object.keys(bannerPatch).length
    ? ({ ...config.widget?.bannerConfig, ...bannerPatch } as MushiWidgetConfig['bannerConfig'])
    : undefined;
  const definedRuntimeWidget: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(runtimeWidget)) {
    // accentText is chosen for its accent (the server checks the pair for
    // contrast), so it follows whichever accent wins, never alone. Code beats
    // the console for every other key (ADR 0068).
    if (key === 'trigger' || key === 'launcher' || key === 'accentText' || value == null || hostSet(host, key)) continue;
    definedRuntimeWidget[key] = value;
  }
  if (definedRuntimeWidget.accent !== undefined && runtimeWidget.accentText != null) {
    definedRuntimeWidget.accentText = runtimeWidget.accentText;
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
