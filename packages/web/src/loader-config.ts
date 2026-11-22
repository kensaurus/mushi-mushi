// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/web/src/loader-config.ts
 * PURPOSE: Turn the script tag's `data-*` attributes into a `MushiConfig`.
 *          Every attribute is checked: a value the widget does not accept is
 *          dropped with one console warning that names the attribute and the
 *          values it takes. Nothing here throws, so a typo in a pasted tag can
 *          never break the host page.
 */

import { createLogger, type MushiConfig, type MushiWidgetConfig } from '@mushi-mushi/core';
import { getAvailableLocales } from './i18n';

const TRIGGERS = ['auto', 'banner', 'edge-tab', 'attach', 'manual', 'hidden'] as const;
const THEMES = ['auto', 'light', 'dark', 'inherit'] as const;
const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;
const BANNER_VARIANTS = ['neon', 'brand', 'subtle'] as const;
const BANNER_POSITIONS = ['top', 'bottom'] as const;

/** #rgb, #rrggbb, rgb()/rgba(), hsl()/hsla() or oklch(): plain colour syntax only. */
const COLOR = /^(#[\da-f]{3}|#[\da-f]{6}|(rgba?|hsla?|oklch)\([\d\s.,%/+-]*(deg|turn|rad)?[\d\s.,%/+-]*\))$/i;
const COLOR_HINT = '#rgb, #rrggbb, rgb(), hsl() or oklch()';

type Warn = (message: string) => void;

function defaultWarn(message: string): void {
  try {
    // Printed as `[mushi] Ignored data-…`, the same logger Mushi.init warns with.
    createLogger({ scope: 'mushi', level: 'warn', format: 'pretty' }).warn(message);
  } catch {
    /* a console that throws must not break the host page */
  }
}

/**
 * @param ds   The loader <script>'s dataset.
 * @param warn Where warnings go (console.warn by default; tests pass a spy).
 * @returns null when `data-project` or `data-key` is missing.
 */
export function readConfigFromDataset(ds: DOMStringMap, warn: Warn = defaultWarn): MushiConfig | null {
  const projectId = ds.project?.trim();
  const apiKey = ds.key?.trim();
  if (!projectId || !apiKey) return null;

  /** The trimmed value of `data-<name>`, or undefined when absent/blank. */
  const read = (key: string): string | undefined => {
    const v = ds[key]?.trim();
    return v ? v : undefined;
  };
  const attr = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  const reject = (key: string, value: string, accepted: string): undefined => {
    warn(`Ignored ${attr(key)}="${value.slice(0, 60)}". Use ${accepted}.`);
    return undefined;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const v = read(key);
    if (v === undefined) return undefined;
    const lower = v.toLowerCase() as T;
    return allowed.includes(lower) ? lower : reject(key, v, `one of: ${allowed.join(', ')}`);
  };
  const color = (key: string, extra: readonly string[] = []): string | undefined => {
    const v = read(key);
    if (v === undefined) return undefined;
    if (COLOR.test(v) || extra.includes(v.toLowerCase())) return v;
    return reject(key, v, `a colour: ${[COLOR_HINT, ...extra].join(', ')}`);
  };

  const widget: MushiWidgetConfig = {};
  const trigger = oneOf('trigger', TRIGGERS);
  if (trigger) widget.trigger = trigger;
  const theme = oneOf('theme', THEMES);
  if (theme) widget.theme = theme;
  const position = oneOf('position', POSITIONS);
  if (position) widget.position = position;
  const triggerText = read('triggerText');
  if (triggerText) widget.triggerText = triggerText;

  const accent = color('accent');
  if (accent) widget.accent = accent;
  const accentText = color('accentText', ['black', 'white']);
  if (accentText) widget.accentText = accentText;

  const locale = read('locale');
  if (locale) {
    const supported = getAvailableLocales();
    const lower = locale.toLowerCase();
    // A region tag (ja-JP, es-MX) is fine when its language is supported.
    if (lower === 'auto' || supported.includes(lower.split(/[-_]/)[0])) widget.locale = lower === 'auto' ? 'auto' : locale;
    else reject('locale', locale, `one of: auto, ${supported.join(', ')}`);
  }

  const routes = read('hideOnRoutes');
  if (routes) {
    const list = routes.split(',').map((r) => r.trim()).filter(Boolean);
    if (list.length) widget.hideOnRoutes = list;
    else reject('hideOnRoutes', routes, 'comma-separated paths such as /admin/*, /checkout');
  }

  const bannerVariant = oneOf('bannerVariant', BANNER_VARIANTS);
  const bannerPosition = oneOf('bannerPosition', BANNER_POSITIONS);
  if (bannerVariant || bannerPosition) {
    widget.bannerConfig = {
      ...(bannerVariant ? { variant: bannerVariant } : {}),
      ...(bannerPosition ? { position: bannerPosition } : {}),
    };
  }

  const config: MushiConfig = { projectId, apiKey };
  const endpoint = read('endpoint');
  if (endpoint) {
    if (/^https?:\/\/[^\s/]+/i.test(endpoint)) config.apiEndpoint = endpoint;
    else reject('endpoint', endpoint, 'a full http:// or https:// address');
  }
  const debug = read('debug');
  if (debug === 'true') config.debug = true;
  else if (debug !== undefined && debug !== 'false') reject('debug', debug, '"true" or "false"');
  if (Object.keys(widget).length > 0) config.widget = widget;
  return config;
}
