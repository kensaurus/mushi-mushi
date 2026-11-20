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

  for (const level of levels) {
    const original = console[level];
    originals[level] = original;

    const wrapper = (...args: unknown[]) => {
      const message = args
        .map((arg) => {
          try {
            return typeof arg === 'string' ? arg : JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ')
        .slice(0, MAX_MESSAGE_LENGTH);

      // Phase 3b: stamp the active network request's correlationId so this log
      // entry can be linked to the fetch/XHR that was in-flight when it was emitted
      // (e.g. from a request interceptor). Not from the caller's own catch block:
      // the ID is popped before it runs. Best-effort; see network.ts.
      const correlationId = getActiveCorrelationId();

      const entry: MushiConsoleEntry = {
        level,
        message,
        timestamp: Date.now(),
        ...(correlationId ? { correlationId } : {}),
      };

      if (level === 'error' && args[0] instanceof Error) {
        entry.stack = (args[0] as Error).stack?.slice(0, 1000);
      }

      entries.push(entry);
      if (entries.length > MAX_ENTRIES) {
        entries.shift();
      }

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
  const push = (entry: MushiConsoleEntry) => {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
  };
  const onError = (event: ErrorEvent) => {
    const err = event.error instanceof Error ? event.error : undefined;
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
    const what = err ? `${err.name}: ${err.message}` : event.message || 'error';
    push({
      level: 'error',
      message: `Uncaught ${what}${where}`.slice(0, MAX_MESSAGE_LENGTH),
      timestamp: Date.now(),
      ...(err?.stack ? { stack: err.stack.slice(0, 1000) } : {}),
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    let what: string;
    if (reason instanceof Error) {
      what = `${reason.name}: ${reason.message}`;
    } else {
      try {
        what = typeof reason === 'string' ? reason : JSON.stringify(reason);
      } catch {
        what = String(reason);
      }
    }
    push({
      level: 'error',
      message: `Unhandled rejection: ${what}`.slice(0, MAX_MESSAGE_LENGTH),
      timestamp: Date.now(),
      ...(reason instanceof Error && reason.stack ? { stack: reason.stack.slice(0, 1000) } : {}),
    });
  };
  const canListen = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (canListen) {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
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
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
      }
    },
  };
}
