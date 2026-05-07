import type { MushiBreadcrumb } from './types';

/**
 * Ring-buffer breadcrumb store. Capped at `max` entries (default 50);
 * once full, every new add evicts the oldest. We deliberately don't
 * use a Map — order matters and is the only thing we ever read, so a
 * plain array we slice-copy on snapshot is the right shape.
 *
 * Design notes:
 *   - `add()` is O(1) amortized; it only does an `unshift` once we hit
 *     `max`. We append-then-shift instead of head-insert to keep the
 *     "oldest first" semantics callers expect from `getAll()`.
 *   - `getAll()` returns a *copy* so callers can't mutate the buffer
 *     after a report is composed. Reports send the snapshot, not the
 *     live ring.
 *   - Long messages are truncated at 500 chars *at insert time*
 *     because a runaway log line shouldn't push useful breadcrumbs
 *     out of the buffer just by virtue of taking the whole entry.
 *   - PII concerns: this buffer is intentionally *not* scrubbed at
 *     insert time — `getBreadcrumbs()` should return the host's own
 *     values verbatim so they're useful for in-app debugging. The
 *     scrubbing pass runs at *report-snapshot time* in
 *     `packages/web/src/mushi.ts`, applying the same `createPiiScrubber()`
 *     used on `description` to every breadcrumb message + every string
 *     field in `data`. That way emails / Stripe keys / JWTs in a
 *     breadcrumb never leave the SDK process.
 */
export interface BreadcrumbBuffer {
  /** Append a single breadcrumb; auto-fills `timestamp` when omitted. */
  add(crumb: Omit<MushiBreadcrumb, 'timestamp'> & { timestamp?: number }): void;
  /** Return a copy of every retained breadcrumb, oldest first. */
  getAll(): MushiBreadcrumb[];
  /** Drop every entry. Useful for tests and `Mushi.destroy()`. */
  clear(): void;
  /** Number of entries currently held. */
  size(): number;
}

export interface BreadcrumbBufferOptions {
  /** Hard cap on retained entries. Default 50. */
  max?: number;
  /** Hard cap on `message` length, in chars. Default 500. */
  maxMessageLength?: number;
}

const DEFAULT_MAX = 50;
const DEFAULT_MAX_MESSAGE = 500;

export function createBreadcrumbBuffer(options: BreadcrumbBufferOptions = {}): BreadcrumbBuffer {
  const max = Math.max(1, options.max ?? DEFAULT_MAX);
  const maxMsg = Math.max(50, options.maxMessageLength ?? DEFAULT_MAX_MESSAGE);
  let entries: MushiBreadcrumb[] = [];

  return {
    add(input) {
      const ts = typeof input.timestamp === 'number' ? input.timestamp : Date.now();
      const message =
        typeof input.message === 'string' && input.message.length > maxMsg
          ? `${input.message.slice(0, maxMsg)}…`
          : input.message;
      const crumb: MushiBreadcrumb = {
        timestamp: ts,
        category: input.category,
        level: input.level ?? 'info',
        message: message ?? '',
        ...(input.data ? { data: input.data } : {}),
      };
      entries.push(crumb);
      // Evict the oldest entries when we're over the cap. Done in a
      // loop instead of `entries = entries.slice(-max)` so we don't
      // allocate a fresh array on every add when the buffer is at the
      // steady-state cap (the common case in long-lived sessions).
      while (entries.length > max) entries.shift();
    },

    getAll() {
      return entries.slice();
    },

    clear() {
      entries = [];
    },

    size() {
      return entries.length;
    },
  };
}
