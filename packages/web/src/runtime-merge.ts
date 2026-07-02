/**
 * Runtime config merge — host init config overlaid with console /sdk/config.
 * Extracted from mushi.ts for unit testing merge precedence (banner trigger,
 * capture flags, explicit-only widget keys).
 */

import type { MushiConfig, MushiRuntimeSdkConfig, MushiWidgetConfig } from '@mushi-mushi/core';

/**
 * Merge the console's runtime capture flags over the host's, key by key.
 * Only keys the server explicitly sent (non-undefined) are applied.
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

export function mergeRuntimeConfig(config: MushiConfig, runtime: MushiRuntimeSdkConfig): MushiConfig {
  const nativeTrigger = runtime.native?.triggerMode;
  const runtimeLauncher = (runtime.widget as Record<string, unknown>)?.launcher as string | undefined;
  const hostTrigger = config.widget?.trigger;
  const rawRuntimeTrigger = runtimeLauncher ?? runtime.widget?.trigger;
  const runtimeTrigger =
    rawRuntimeTrigger === 'auto' && hostTrigger && hostTrigger !== 'auto'
      ? undefined
      : rawRuntimeTrigger;
  const widgetTrigger =
    runtimeTrigger ??
    (nativeTrigger === 'none' || nativeTrigger === 'shake' ? 'manual' : undefined);
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
  const derivedBannerConfig =
    runtimeBannerVariant ||
    runtimeBannerPosition ||
    runtimeBannerMessage != null ||
    runtimeBannerLabel != null ||
    runtimeBannerBugCta != null ||
    runtimeBannerFeatureCta != null
      ? {
          ...(config.widget?.bannerConfig ?? {}),
          ...(runtimeBannerVariant ? { variant: runtimeBannerVariant as 'neon' | 'brand' | 'subtle' } : {}),
          ...(runtimeBannerPosition ? { position: runtimeBannerPosition as 'top' | 'bottom' } : {}),
          ...(runtimeBannerMessage != null ? { message: runtimeBannerMessage } : {}),
          ...(runtimeBannerLabel != null
            ? { label: runtimeBannerLabel === '' ? (false as const) : runtimeBannerLabel }
            : {}),
          ...(runtimeBannerBugCta != null ? { bugCta: runtimeBannerBugCta ?? undefined } : {}),
          ...(runtimeBannerFeatureCta != null ? { featureCta: runtimeBannerFeatureCta } : {}),
        }
      : undefined;
  const definedRuntimeWidget: Record<string, unknown> = {};
  if (runtime.widget) {
    for (const [key, value] of Object.entries(runtime.widget)) {
      if (key === 'trigger' || key === 'launcher') continue;
      if (value !== undefined && value !== null) definedRuntimeWidget[key] = value;
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
