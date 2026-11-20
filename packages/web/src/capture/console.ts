/* eslint-disable no-console */
import type { MushiConsoleEntry } from '@mushi-mushi/core';
import { getActiveCorrelationId } from './network.js';

const MAX_ENTRIES = 50;
const MAX_MESSAGE_LENGTH = 500;

export interface ConsoleCapture {
  getEntries(): MushiConsoleEntry[];
  clear(): void;
  destroy(): void;
}

export function createConsoleCapture(): ConsoleCapture {
  const entries: MushiConsoleEntry[] = [];
  const originals: Partial<Record<string, (...args: unknown[]) => void>> = {};
  const wrappers: Partial<Record<string, (...args: unknown[]) => void>> = {};
  const levels: Array<MushiConsoleEntry['level']> = ['log', 'warn', 'error', 'info', 'debug'];

  // JSON.stringify(new Error('x')) is "{}": an Error keeps its name and message.
  const str = (arg: unknown): string => {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return typeof arg === 'string' ? arg : JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  };
  const record = (level: MushiConsoleEntry['level'], message: string, err: unknown, extra?: Partial<MushiConsoleEntry>) => {
    const entry: MushiConsoleEntry = { level, message: message.slice(0, MAX_MESSAGE_LENGTH), timestamp: Date.now(), ...extra };
    if (err instanceof Error && err.stack) entry.stack = err.stack.slice(0, 1000);
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
  };

  for (const level of levels) {
    const original = console[level];
    originals[level] = original;

    const wrapper = (...args: unknown[]) => {
      // Phase 3b: stamp the active network request's correlationId so this log
      // entry can be linked to the fetch/XHR that was in-flight when it was emitted
      // (e.g. from a request interceptor). Not from the caller's own catch block:
      // the ID is popped before it runs. Best-effort; see network.ts.
      const correlationId = getActiveCorrelationId();
      // The Error is often not the first argument: console.error('save failed', err).
      record(
        level,
        args.map(str).join(' '),
        level === 'error' ? args.find((a) => a instanceof Error) : undefined,
        correlationId ? { correlationId } : undefined,
      );
      original.call(console, ...args);
    };

    wrappers[level] = wrapper;
    console[level] = wrapper as typeof console.log;
  }

  // An exception thrown in an event handler and an unhandled promise
  // rejection never pass through console.*: the browser prints "Uncaught …"
  // itself. They are often the cause of the bug being reported, so record
  // them as error entries too (2026-11-20: a demo Pay handler's TypeError
  // reached neither the report nor the diagnosis).
  const onUncaught = (event: Event) => {
    if (event.type === 'unhandledrejection') {
      const reason: unknown = (event as PromiseRejectionEvent).reason;
      record('error', `Unhandled rejection: ${str(reason)}`, reason);
    } else {
      const e = event as ErrorEvent;
      const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
      record('error', `Uncaught ${str(e.error ?? (e.message || 'error'))}${where}`, e.error);
    }
  };
  const canListen = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (canListen) {
    window.addEventListener('error', onUncaught);
    window.addEventListener('unhandledrejection', onUncaught);
  }

  return {
    getEntries() {
      return [...entries];
    },
    clear() {
      entries.length = 0;
    },
    destroy() {
      for (const level of levels) {
        // Only restore if our wrapper is still installed — prevents clobbering
        // another tool's console instrumentation that may have wrapped after us.
        if (originals[level] && console[level] === wrappers[level]) {
          console[level] = originals[level] as typeof console.log;
        }
      }
      if (canListen) {
        window.removeEventListener('error', onUncaught);
        window.removeEventListener('unhandledrejection', onUncaught);
      }
    },
  };
}
