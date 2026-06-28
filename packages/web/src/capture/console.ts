/* eslint-disable no-console */
import type { MushiConsoleEntry } from '@mushi-mushi/core';

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

      const entry: MushiConsoleEntry = {
        level,
        message,
        timestamp: Date.now(),
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
    },
  };
}
