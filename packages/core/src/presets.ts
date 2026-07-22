// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
//
// Preset expansion + config validation.
//
// A `preset` is an opinionated posture bundle that expands into the nested
// `widget` / `capture` / `proactive` option objects so hosts can pick a tier
// instead of hand-assembling a dozen flags. Explicit config ALWAYS wins over
// the preset defaults (per-sub-object shallow merge with the user's values
// spread last). Expansion is a pure, side-effect-free transform.
//
// Precedence (highest wins): explicit config → preset → env → SDK default.
// `resolveEnvConfig` only ever contributes `projectId` / `apiKey` /
// `apiEndpoint`, never the nested objects a preset touches, so applying
// `expandPreset` to the already env-merged config still yields env < preset <
// explicit for every preset-managed field.

import type { MushiConfig } from './types';

// Keep in sync with the `MushiPreset` union in `types.ts`.
const KNOWN_PRESETS: readonly NonNullable<MushiConfig['preset']>[] = [
  'production-calm',
  'beta-loud',
  'internal-debug',
  'manual-only',
  'minimal',
  'standard',
  'full',
];

// Keep in sync with the top-level keys of `MushiConfig` in `types.ts`.
const KNOWN_CONFIG_KEYS: readonly string[] = [
  'projectId',
  'apiKey',
  'apiEndpoint',
  'timeout',
  'maxRetries',
  'circuitBreaker',
  'preset',
  'runtimeConfig',
  'sentry',
  'widget',
  'capture',
  'privacy',
  'proactive',
  'preFilter',
  'integrations',
  'offline',
  'rewards',
  'assistant',
  'debug',
  'enabled',
  'appVersion',
  'sampleRate',
  'beforeSend',
  'beforeSendFeedback',
  'onCrashedLastRun',
];

type PresetDefaults = Pick<MushiConfig, 'widget' | 'capture' | 'proactive'>;

/**
 * Resolve the nested option defaults for a preset. Returns `undefined` for the
 * `standard` posture (which is a no-op — it keeps today's SDK defaults), for a
 * missing preset, and — defensively — for any value not in the union (a typo
 * from a plain-JS caller), so the caller returns the config untouched instead
 * of throwing on `preset.widget`.
 */
function presetDefaults(preset: MushiConfig['preset']): PresetDefaults | undefined {
  switch (preset) {
    case 'manual-only':
      return {
        widget: { trigger: 'manual', outdatedBanner: 'console-only' },
        capture: { console: true, network: true, performance: false, screenshot: 'on-report', elementSelector: false },
        proactive: { rageClick: false, longTask: false, apiCascade: false, errorBoundary: false },
      };
    case 'beta-loud':
      return {
        widget: { trigger: 'auto', outdatedBanner: 'banner' },
        capture: { console: true, network: true, performance: true, screenshot: 'auto', elementSelector: true },
        proactive: { rageClick: true, longTask: true, apiCascade: true, errorBoundary: true },
      };
    case 'internal-debug':
      return {
        widget: { trigger: 'auto', outdatedBanner: 'banner', brandFooter: true },
        capture: { console: true, network: true, performance: true, screenshot: 'auto', elementSelector: true },
        proactive: {
          rageClick: true,
          longTask: true,
          apiCascade: true,
          errorBoundary: true,
          cooldown: { maxProactivePerSession: 10, dismissCooldownHours: 0, suppressAfterDismissals: 99 },
        },
      };
    case 'production-calm':
      return {
        widget: { trigger: 'auto', outdatedBanner: 'console-only' },
        capture: { console: true, network: true, performance: false, screenshot: 'on-report', elementSelector: false },
        proactive: { rageClick: false, longTask: false, apiCascade: false, errorBoundary: false },
      };
    // Lean posture: widget on, console capture only, screenshot on-report,
    // no network/performance/replay, no proactive nudges.
    case 'minimal':
      return {
        widget: { trigger: 'auto' },
        capture: {
          console: true,
          network: false,
          performance: false,
          screenshot: 'on-report',
          replay: 'off',
          elementSelector: false,
        },
        proactive: { rageClick: false, longTask: false, apiCascade: false, errorBoundary: false },
      };
    // Everything-on posture: full capture (incl. self-contained `lite` replay)
    // and every proactive trigger.
    case 'full':
      return {
        widget: { trigger: 'auto' },
        capture: {
          console: true,
          network: true,
          performance: true,
          screenshot: 'auto',
          replay: 'lite',
          elementSelector: true,
        },
        proactive: { rageClick: true, longTask: true, apiCascade: true, errorBoundary: true },
      };
    // 'standard' and anything unrecognised → no expansion.
    default:
      return undefined;
  }
}

/**
 * Expand `config.preset` into the nested option objects, with the user's
 * explicit config winning on every key. Pure — returns a new object when a
 * preset applies, or the input untouched for `standard` / no preset / an
 * unknown value.
 *
 * The merge is deliberately per-sub-object (not a generic recursive deep
 * merge) to avoid corrupting array/RegExp fields such as `capture.ignoreUrls`;
 * only `proactive.cooldown` needs a second nested spread.
 */
export function expandPreset(config: MushiConfig): MushiConfig {
  const defaults = presetDefaults(config.preset);
  if (!defaults) return config;
  return {
    ...config,
    widget: {
      ...defaults.widget,
      ...config.widget,
    },
    capture: {
      ...defaults.capture,
      ...config.capture,
    },
    proactive: {
      ...defaults.proactive,
      ...config.proactive,
      cooldown: {
        ...defaults.proactive?.cooldown,
        ...config.proactive?.cooldown,
      },
    },
  };
}

// `process` is declared locally because the core package intentionally omits
// `@types/node` to stay browser-safe (see env-config.ts).
declare const process: { env: Record<string, string | undefined> };

/**
 * `MUSHI_SILENT=1` (or `true`) suppresses all validation warnings, for hosts
 * that intentionally pass extra keys or want a quiet console. Read defensively
 * from both `process.env` and `import.meta.env` (Vite) so neither runtime
 * throws when the other is absent.
 */
function isSilenced(): boolean {
  const truthy = (v: unknown): boolean => v === '1' || v === 'true';
  try {
    if (typeof process !== 'undefined' && process.env && truthy(process.env.MUSHI_SILENT)) return true;
  } catch {
    /* no `process` in this runtime */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any).env;
    if (env && typeof env === 'object' && (truthy(env.MUSHI_SILENT) || truthy(env.VITE_MUSHI_SILENT))) return true;
  } catch {
    /* no `import.meta` in this runtime */
  }
  return false;
}

/**
 * Runtime config sanity check that fails LOUD but never throws — a
 * mis-configured host should see a `console.error` at init, not a crash. Warns
 * on unknown top-level keys (usually a typo or a stale option name) and on an
 * invalid `preset` value. Honours `MUSHI_SILENT`.
 */
export function validateConfig(config: MushiConfig): void {
  try {
    if (isSilenced()) return;
    if (!config || typeof config !== 'object') return;

    const unknownKeys = Object.keys(config).filter((key) => !KNOWN_CONFIG_KEYS.includes(key));
    if (unknownKeys.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[mushi] Unknown config key${unknownKeys.length > 1 ? 's' : ''}: ${unknownKeys
          .map((k) => `\`${k}\``)
          .join(', ')} — check for typos (see MushiConfig). Ignored.`,
      );
    }

    if (config.preset !== undefined && !KNOWN_PRESETS.includes(config.preset)) {
      // eslint-disable-next-line no-console
      console.error(
        `[mushi] Unknown preset \`${String(config.preset)}\` — expected one of ${KNOWN_PRESETS.map(
          (p) => `'${p}'`,
        ).join(', ')}. Preset ignored.`,
      );
    }
  } catch {
    /* validation must never break init */
  }
}
