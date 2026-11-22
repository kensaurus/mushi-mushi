// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
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
 *              src="https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/mushi.loader.global.js"
 *              data-project="proj_xxx"
 *              data-key="mushi_xxx"
 *              data-trigger="banner"></script>
 *
 *          The URL is the published npm file served by jsDelivr, pinned to
 *          the major version. There is no Mushi-hosted CDN host.
 *
 *          and this module — bundled as an IIFE — reads the credentials and
 *          appearance hints off its own <script> tag's data-* attributes
 *          (checked in loader-config.ts: data-accent, data-accent-text,
 *          data-locale, data-hide-on-routes, …; bad values are dropped with a
 *          console warning) and calls Mushi.init() exactly once. Everything else (the console
 *          runtime config, banner/FAB/panel) flows through the normal
 *          Mushi.init() path, so the loader stays a thin shim with zero
 *          divergent behaviour from the npm package.
 *
 *          Build: emitted as `dist/mushi.loader.global.js` (IIFE) via tsup so it can
 *          be served from a CDN and executed directly in the browser.
 */

import { Mushi } from './mushi';
import { readConfigFromDataset } from './loader-config';

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
