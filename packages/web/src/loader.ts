/**
 * FILE: packages/web/src/loader.ts
 * PURPOSE: Self-initializing entry point for the universal `<script async>`
 *          loader. This is the "no build step" install path surfaced by the
 *          admin console's "Script tag" tab — the answer to "the SDK doesn't
 *          show up on HTTP / non-bundler stacks".
 *
 *          The hosting page drops:
 *
 *            <script async
 *              src="https://cdn.mushi.dev/sdk/v1/mushi.js"
 *              data-project="proj_xxx"
 *              data-key="mushi_xxx"
 *              data-trigger="banner"></script>
 *
 *          and this module — bundled as an IIFE — reads the credentials and
 *          appearance hints off its own <script> tag's data-* attributes and
 *          calls Mushi.init() exactly once. Everything else (the console
 *          runtime config, banner/FAB/panel) flows through the normal
 *          Mushi.init() path, so the loader stays a thin shim with zero
 *          divergent behaviour from the npm package.
 *
 *          Build: emitted as `dist/loader.global.js` (IIFE) via tsup so it can
 *          be served from a CDN and executed directly in the browser.
 */

import { Mushi } from './mushi';
import type { MushiConfig, MushiWidgetConfig } from '@mushi-mushi/core';

type LoaderScript = HTMLScriptElement & { dataset: DOMStringMap };

/**
 * Resolve the <script> element that loaded this bundle. `document.currentScript`
 * is correct for synchronously-executed classic scripts; for `async`/`defer`
 * it can be null by the time module code runs, so we fall back to a
 * `[data-project]`-tagged Mushi script as a best-effort.
 */
function resolveLoaderScript(): LoaderScript | null {
  const current = document.currentScript as LoaderScript | null;
  if (current && current.dataset && current.dataset.project) return current;
  // Fallback: find the (last) script tag carrying Mushi credentials.
  const candidates = Array.from(
    document.querySelectorAll<LoaderScript>('script[data-project][data-key]'),
  );
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function readConfigFromDataset(ds: DOMStringMap): MushiConfig | null {
  const projectId = ds.project?.trim();
  const apiKey = ds.key?.trim();
  if (!projectId || !apiKey) return null;

  const widget: MushiWidgetConfig = {};
  if (ds.trigger) widget.trigger = ds.trigger as MushiWidgetConfig['trigger'];
  if (ds.theme) widget.theme = ds.theme as MushiWidgetConfig['theme'];
  if (ds.position) widget.position = ds.position as MushiWidgetConfig['position'];
  if (ds.triggerText) widget.triggerText = ds.triggerText;
  // Banner-specific tuning.
  const bannerVariant = ds.bannerVariant;
  const bannerPosition = ds.bannerPosition;
  if (bannerVariant || bannerPosition) {
    widget.bannerConfig = {
      ...(bannerVariant ? { variant: bannerVariant as 'neon' | 'brand' | 'subtle' } : {}),
      ...(bannerPosition ? { position: bannerPosition as 'top' | 'bottom' } : {}),
    };
  }

  const config: MushiConfig = { projectId, apiKey };
  if (ds.endpoint) config.apiEndpoint = ds.endpoint;
  if (ds.debug === 'true') config.debug = true;
  if (Object.keys(widget).length > 0) config.widget = widget;
  return config;
}

function bootstrap(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // Guard against double-execution if the tag is included twice.
  const w = window as unknown as { __mushiLoaderInit?: boolean };
  if (w.__mushiLoaderInit) return;

  const script = resolveLoaderScript();
  if (!script) return;
  const config = readConfigFromDataset(script.dataset);
  if (!config) {
    // No credentials → nothing to do. Stay silent in production; the console
    // diagnostics surface the "never connected" state instead.
    return;
  }
  w.__mushiLoaderInit = true;
  try {
    Mushi.init(config);
  } catch {
    // Never let an init failure throw into the host page's script execution.
  }
}

bootstrap();
