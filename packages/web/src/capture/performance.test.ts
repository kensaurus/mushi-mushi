/**
 * FILE: packages/web/src/capture/performance.test.ts
 * PURPOSE: Unit tests for the SDK's PerformanceObserver-based capture
 *          surface — primarily the new INP path (Google Core Web Vital
 *          since March 2024), plus the existing FCP/LCP/CLS/longTask
 *          observers. The tests fake `PerformanceObserver` so they can
 *          run in jsdom (which doesn't ship one) and synthesise event
 *          entries to assert INP attribution math.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPerformanceCapture } from './performance.js';

interface FakeObserverInstance {
  callback: PerformanceObserverCallback;
  options: PerformanceObserverInit | undefined;
  emit(entries: PerformanceEntry[]): void;
  disconnected: boolean;
}

let observers: FakeObserverInstance[] = [];

beforeEach(() => {
  observers = [];

  // jsdom doesn't ship PerformanceObserver — install a fake that records
  // every observe() call so tests can synthesise the entry types each
  // observer was registered for.
  class FakePerformanceObserver implements PerformanceObserver {
    private cb: PerformanceObserverCallback;

    constructor(cb: PerformanceObserverCallback) {
      this.cb = cb;
    }

    observe(opts?: PerformanceObserverInit): void {
      const instance: FakeObserverInstance = {
        callback: this.cb,
        options: opts,
        emit: (entries) => {
          this.cb(
            { getEntries: () => entries } as PerformanceObserverEntryList,
            this,
            { droppedEntriesCount: 0 } as PerformanceObserverCallbackOptions,
          );
        },
        disconnected: false,
      };
      observers.push(instance);
    }

    disconnect(): void {
      const idx = observers.findIndex(o => o.callback === this.cb);
      if (idx >= 0) observers[idx]!.disconnected = true;
    }

    takeRecords(): PerformanceEntryList {
      return [];
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PerformanceObserver = FakePerformanceObserver;
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).PerformanceObserver;
  vi.restoreAllMocks();
});

function findObserverFor(type: string): FakeObserverInstance {
  const obs = observers.find(o => o.options?.type === type);
  if (!obs) throw new Error(`No observer registered for type "${type}". Saw: ${observers.map(o => o.options?.type).join(', ')}`);
  return obs;
}

function makeEventTiming(opts: {
  interactionId: number;
  duration: number;
  startTime?: number;
  processingStart?: number;
  processingEnd?: number;
  name?: string;
  target?: Element | null;
}): PerformanceEventTiming {
  const startTime = opts.startTime ?? 1000;
  const processingStart = opts.processingStart ?? startTime + 5;
  const processingEnd = opts.processingEnd ?? processingStart + 30;
  return {
    name: opts.name ?? 'pointerdown',
    entryType: 'event',
    startTime,
    duration: opts.duration,
    processingStart,
    processingEnd,
    interactionId: opts.interactionId,
    target: opts.target ?? null,
    cancelable: true,
    toJSON: () => ({}),
  } as unknown as PerformanceEventTiming;
}

describe('createPerformanceCapture — INP', () => {
  it('registers an event-timing observer with durationThreshold 40ms (web-vitals spec)', () => {
    createPerformanceCapture();
    const evt = findObserverFor('event');
    expect(evt.options).toMatchObject({
      type: 'event',
      durationThreshold: 40,
      buffered: true,
    });
  });

  it('records the worst observed interaction as INP', () => {
    const cap = createPerformanceCapture();
    const evt = findObserverFor('event');

    evt.emit([
      makeEventTiming({ interactionId: 1, duration: 60 }),
      makeEventTiming({ interactionId: 2, duration: 220 }),
      makeEventTiming({ interactionId: 3, duration: 90 }),
    ]);

    expect(cap.getMetrics().inp).toBe(220);
  });

  it('attaches attribution (event type, target selector, sub-phase timings)', () => {
    const cap = createPerformanceCapture();
    const evt = findObserverFor('event');

    // Fake DOM target so describeElement can build a selector.
    const fakeTarget = {
      tagName: 'BUTTON',
      id: 'submit',
      classList: { length: 1, 0: 'primary', item: (i: number) => i === 0 ? 'primary' : null },
    } as unknown as Element;
    // Make classList[0] indexable (DOMTokenList semantics in jsdom are partial).
    Object.defineProperty(fakeTarget.classList, '0', { value: 'primary', enumerable: true });

    evt.emit([
      makeEventTiming({
        interactionId: 1,
        duration: 1200,
        startTime: 1000,
        processingStart: 1010,
        processingEnd: 1900,
        name: 'pointerdown',
        target: fakeTarget,
      }),
    ]);

    const metrics = cap.getMetrics();
    expect(metrics.inp).toBe(1200);
    expect(metrics.inpAttribution).toMatchObject({
      eventType: 'pointerdown',
      targetSelector: 'button#submit.primary',
      inputDelay: 10,
      processingDuration: 890,
      presentationDelay: 1000 + 1200 - 1900, // 300
    });
  });

  it('ignores entries without an interactionId (per the spec)', () => {
    const cap = createPerformanceCapture();
    const evt = findObserverFor('event');

    evt.emit([makeEventTiming({ interactionId: 0, duration: 9999 })]);
    expect(cap.getMetrics().inp).toBeUndefined();
  });

  it('FID fallback fires on browsers without event-timing support', () => {
    const cap = createPerformanceCapture();
    // Find the first-input observer (always registered as a fallback).
    const fid = findObserverFor('first-input');

    fid.emit([makeEventTiming({ interactionId: 1, duration: 80, startTime: 1000, processingStart: 1042 })]);
    expect(cap.getMetrics().fid).toBe(42);
  });

  it('destroy() disconnects every registered observer', () => {
    const cap = createPerformanceCapture();
    const before = observers.length;
    cap.destroy();
    const disconnectedCount = observers.filter(o => o.disconnected).length;
    expect(disconnectedCount).toBe(before);
  });
});
