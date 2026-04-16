import type { MushiPerformanceMetrics } from '@mushi/core';

export interface PerformanceCapture {
  getMetrics(): MushiPerformanceMetrics;
  destroy(): void;
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
