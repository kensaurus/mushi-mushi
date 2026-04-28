/**
 * @mushi-mushi/web/test-utils
 *
 * Playwright / jsdom helpers for deterministic SDK tests. This module is
 * published as a separate entry-point so production bundles never pay the
 * cost — import it via `import { triggerBug, openReport } from
 * '@mushi-mushi/web/test-utils'`.
 *
 * Design goals:
 *   1. Zero production footprint. Nothing here is imported from `./mushi`,
 *      `./widget`, or any runtime module. We reach for the live SDK via
 *      `Mushi.getInstance()` so the test process sees exactly what the app
 *      bootstrapped — no duplicate SDK singletons, no double-init races.
 *   2. Safe in a test harness even when Mushi is disabled. Every helper
 *      no-ops when `Mushi.getInstance()` returns `null`, so Playwright
 *      specs that conditionally wire Mushi (e.g. cloud vs local targets)
 *      don't have to branch.
 *   3. Flat surface. Tests want 3 verbs: "open the widget", "submit a
 *      report programmatically", "wait until the SDK confirms the POST
 *      landed". Anything beyond that belongs in the app under test.
 */

import { Mushi } from './mushi';
import type {
  MushiDiagnosticsResult,
  MushiReportCategory,
  MushiSDKInstance,
} from '@mushi-mushi/core';

/** Options accepted by `triggerBug`. Mirrors the core report contract but
 *  keeps every field optional so a Playwright test can say
 *  `triggerBug({ description: 'button dead' })` without a category. */
export interface TriggerBugOptions {
  /** Short free-text description of the issue. Defaults to a marker
   *  string so tests that forget to pass a description still produce a
   *  distinguishable report in the admin console. */
  description?: string;
  /** Severity-free category tag. */
  category?: MushiReportCategory;
  /** Arbitrary metadata the test wants to round-trip. Merged on top of
   *  whatever `setMetadata` has already stored. */
  metadata?: Record<string, unknown>;
}

/**
 * Submit a report bypassing the widget UI. Returns the server-assigned
 * `reportId` when the POST lands, or `null` if Mushi isn't initialised in
 * this test context (or the submit failed — the SDK swallows network
 * errors silently by design).
 *
 * Use this from Playwright `page.evaluate(...)` calls to round-trip a
 * report into the backend without needing to drive the widget's DOM. It's
 * the fastest way to assert "a bug report made it from the browser into
 * reports/ in Supabase".
 */
export async function triggerBug(opts: TriggerBugOptions = {}): Promise<string | null> {
  const sdk = Mushi.getInstance();
  if (!sdk) return null;

  const description = opts.description
    ?? `[test-utils] triggerBug marker ${new Date().toISOString()}`;

  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      try { sdk.setMetadata(k, v); } catch { /* ignore */ }
    }
  }

  // `captureEvent` is the documented programmatic-submit API since 0.3.0
  // — it bypasses the widget, resolves with the server-assigned report
  // id, and participates in the same offline queue / pre-filter pipeline
  // as a widget submission.
  return await sdk.captureEvent({
    description,
    source: 'test-utils',
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
  });
}

/**
 * Programmatically open the Mushi widget without submitting anything. Use
 * for interaction tests that want to assert "the widget is mounted and
 * reachable" or to drive a user-like flow via Playwright selectors.
 */
export function openReport(category?: MushiReportCategory): void {
  const sdk = Mushi.getInstance();
  if (!sdk) return;
  sdk.report(category ? { category } : undefined);
}

/** Alias with language that reads better in Playwright smoke tests. */
export function openMushiWidget(category?: MushiReportCategory): void {
  openReport(category);
}

/**
 * Wait until the live SDK instance exists and reports a mounted widget.
 * Throws with the diagnostics payload so CI failures point at CSP / Shadow DOM
 * / capture setup instead of a generic timeout.
 */
export async function expectMushiReady(options: { timeoutMs?: number } = {}): Promise<MushiDiagnosticsResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const started = Date.now();
  let lastDiagnostics: MushiDiagnosticsResult | null = null;

  while (Date.now() - started < timeoutMs) {
    const sdk = Mushi.getInstance();
    if (sdk) {
      lastDiagnostics = await sdk.diagnose();
      if (lastDiagnostics.widgetMounted && lastDiagnostics.shadowDomAvailable) {
        return lastDiagnostics;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(`[mushi:test-utils] SDK not ready: ${JSON.stringify(lastDiagnostics)}`);
}

/**
 * Run an optional action and fail if the SDK fires an api_cascade proactive
 * prompt during the observation window. This catches the exact glot.it class
 * of bug where Mushi reports on its own runtime-config/report endpoints.
 */
export async function expectNoMushiSelfCascade(options: {
  timeoutMs?: number;
  action?: () => void | Promise<void>;
} = {}): Promise<void> {
  const sdk = Mushi.getInstance();
  if (!sdk) return;
  const timeoutMs = options.timeoutMs ?? 1_000;
  let cascade: unknown = null;
  const unsubscribe = sdk.on('proactive:triggered', (event) => {
    const payload = event.data as { type?: string } | undefined;
    if (payload?.type === 'api_cascade') cascade = event.data ?? true;
  });
  try {
    await options.action?.();
    await new Promise((r) => setTimeout(r, timeoutMs));
  } finally {
    unsubscribe();
  }
  if (cascade) {
    throw new Error(`[mushi:test-utils] unexpected api_cascade from SDK self-noise: ${JSON.stringify(cascade)}`);
  }
}

/**
 * Wait until the offline queue drains — useful after `triggerBug` in tests
 * that submit while offline then assert the report eventually syncs.
 * Resolves with the number of queued items remaining (0 = fully drained).
 */
export async function waitForQueueDrain(options: { timeoutMs?: number } = {}): Promise<number> {
  const sdk = Mushi.getInstance();
  if (!sdk) return 0;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const started = Date.now();
  // The SDK instance doesn't publicly expose the queue, but `getQueueSize`
  // has been in the contract since 0.2.x. We tolerate its absence so
  // upgrading doesn't break tests that only need triggerBug/openReport.
  const getQueueSize = (sdk as MushiSDKInstance & { getQueueSize?: () => number }).getQueueSize;
  if (typeof getQueueSize !== 'function') return 0;

  while (Date.now() - started < timeoutMs) {
    const remaining = getQueueSize.call(sdk);
    if (remaining === 0) return 0;
    await new Promise((r) => setTimeout(r, 100));
  }
  return getQueueSize.call(sdk);
}
