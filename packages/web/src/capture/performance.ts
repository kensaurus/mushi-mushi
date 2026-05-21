import type { MushiPerformanceMetrics } from '@mushi-mushi/core';

export interface PerformanceCapture {
  getMetrics(): MushiPerformanceMetrics;
  destroy(): void;
}

/**
 * INP `durationThreshold` recommended by the spec — interactions shorter
 * than this are below human perception and inflate noise. 40 ms is the
 * official web-vitals default.
 */
const INP_DURATION_THRESHOLD_MS = 40;

/**
 * Build a stable, short selector for an element so the triage UI can
 * surface "the slow click was on <button.checkout>" rather than just
 * "1200 ms INP". Mirrors the web-vitals attribution-build heuristic
 * (tag + #id + .firstClass). Does not read `value`, `aria-label`, or
 * text content; however `el.id` and `el.classList` can contain
 * application-defined identifiers (e.g. `user-123`, `order-456`).
 * Keep this in mind when reviewing collected reports for PII exposure.
 */
function describeElement(target: EventTarget | null | undefined): string | undefined {
  if (!target || !(target as Element).tagName) return undefined;
  const el = target as Element;
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = el.classList && el.classList.length > 0 ? `.${el.classList[0]}` : '';
  return `${tag}${id}${cls}`;
}

export function createPerformanceCapture(): PerformanceCapture {
  const metrics: MushiPerformanceMetrics = {};
  const observers: PerformanceObserver[] = [];

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const paintObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            metrics.fcp = entry.startTime;
          }
        }
      });
      paintObserver.observe({ type: 'paint', buffered: true });
      observers.push(paintObserver);
    } catch {
      // paint observer not supported
    }

    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          metrics.lcp = entries[entries.length - 1]!.startTime;
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(lcpObserver);
    } catch {
      // LCP not supported
    }

    try {
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) {
            clsValue += (entry as PerformanceEntry & { value?: number }).value ?? 0;
            metrics.cls = clsValue;
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
      observers.push(clsObserver);
    } catch {
      // CLS not supported
    }

    try {
      let longTaskCount = 0;
      const longTaskObserver = new PerformanceObserver((list) => {
        longTaskCount += list.getEntries().length;
        metrics.longTasks = longTaskCount;
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      observers.push(longTaskObserver);
    } catch {
      // longtask not supported
    }

    // ---------------------------------------------------------------
    // Interaction to Next Paint (INP) — a Google Core Web Vital since
    // March 2024 (replaced First Input Delay). We track the worst
    // observed interaction since SDK init and attach lightweight
    // attribution (event type, target selector, sub-phase timings) so
    // the report reads "1200ms click on <button.checkout>" rather than
    // a bare number. Implementation follows the official `web-vitals`
    // library's onINP algorithm:
    //   1. Group `event` entries by `interactionId`.
    //   2. Take the max-duration entry per interaction.
    //   3. Track the longest interaction overall.
    // For sites with very few interactions (typical bug-report
    // sessions: 1–10 clicks) the longest interaction IS the INP per
    // the spec's 75th-percentile rule. Extending to a full P75 buffer
    // would add ~2KB for negligible accuracy on this workload.
    // SOURCE: https://web.dev/articles/inp
    // ---------------------------------------------------------------
    try {
      const seenInteractions = new Map<number, number>();
      const inpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEventTiming[]) {
          const interactionId = entry.interactionId;
          if (!interactionId) continue;
          const prev = seenInteractions.get(interactionId) ?? 0;
          if (entry.duration > prev) {
            seenInteractions.set(interactionId, entry.duration);
          }
          if (entry.duration > (metrics.inp ?? 0)) {
            metrics.inp = entry.duration;
            // Sub-phase timings let consumers pinpoint whether INP was
            // dominated by input delay (e.g. a long task on the main
            // thread blocking the input), processing (slow handler), or
            // presentation (heavy paint). The web-vitals attribution
            // build computes these the same way.
            const inputDelay = entry.processingStart - entry.startTime;
            const processingDuration = entry.processingEnd - entry.processingStart;
            const presentationDelay =
              entry.startTime + entry.duration - entry.processingEnd;
            metrics.inpAttribution = {
              eventType: entry.name,
              targetSelector: describeElement(entry.target),
              inputDelay: Math.max(0, inputDelay),
              processingDuration: Math.max(0, processingDuration),
              presentationDelay: Math.max(0, presentationDelay),
            };
          }
        }
      });
      inpObserver.observe({
        type: 'event',
        // `durationThreshold` filters out fast (< 40 ms) interactions
        // that sit below human perception. Spec-recommended floor.
        durationThreshold: INP_DURATION_THRESHOLD_MS,
        buffered: true,
      } as PerformanceObserverInit);
      observers.push(inpObserver);
    } catch {
      // event-timing not supported (Safari < 16.4 falls into this branch).
      // Consumers fall back to FID via a separate first-input observer.
    }

    try {
      const fidObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEventTiming[]) {
          // first-input fires once. Use it as a fallback on browsers
          // that don't support event-timing INP observation (Safari
          // < 16.4). Always recorded — INP supersedes when present.
          if (metrics.fid === undefined) {
            metrics.fid = entry.processingStart - entry.startTime;
          }
        }
      });
      fidObserver.observe({ type: 'first-input', buffered: true });
      observers.push(fidObserver);
    } catch {
      // first-input not supported either — caller will see no FID/INP.
    }
  }

  // Navigation timing for TTFB
  if (typeof performance !== 'undefined' && performance.getEntriesByType) {
    try {
      const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (navEntries.length > 0 && navEntries[0]) {
        metrics.ttfb = navEntries[0].responseStart - navEntries[0].requestStart;
      }
    } catch {
      // navigation timing not available
    }
  }

  return {
    getMetrics() {
      return { ...metrics };
    },
    destroy() {
      for (const obs of observers) {
        obs.disconnect();
      }
      observers.length = 0;
    },
  };
}
