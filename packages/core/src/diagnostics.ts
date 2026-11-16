/**
 * FILE: packages/core/src/diagnostics.ts
 * PURPOSE: The host app's own diagnostics, read at the moment a report is sent
 *          (`setDiagnosticsProvider`). yen-yen pushed its load log with
 *          `setMetadata` on a timer (2026-11-16); a provider is read when the
 *          reporter presses Send, so the report carries what the app knew then.
 *
 * A slow or throwing provider never blocks or drops a report: it gets
 * `DIAGNOSTICS_TIMEOUT_MS`, any error is swallowed, strings are PII-scrubbed,
 * and the result is capped at `DIAGNOSTICS_MAX_CHARS` of JSON. Keys merge into
 * the report's metadata, so `{ screenLoading: [...] }` lands at
 * `custom_metadata.screenLoading`, where triage reads it.
 */

import { scrubPii } from './pii-scrubber';

type DiagnosticsValue = Record<string, unknown>;

/** Returns the diagnostics to attach (plain JSON values), or null/undefined for none. */
export type MushiDiagnosticsProvider = () =>
  | DiagnosticsValue
  | null
  | undefined
  | Promise<DiagnosticsValue | null | undefined>;

const DIAGNOSTICS_TIMEOUT_MS = 300;
/** @internal Exported for tests only. */
export const DIAGNOSTICS_MAX_CHARS = 16_000;
const MAX_DEPTH = 6;

function scrubDeep(value: unknown, scrub: (s: string) => string, depth: number): unknown {
  if (typeof value === 'string') return scrub(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, scrub, depth + 1)).filter((v) => v !== undefined);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = scrubDeep(v, scrub, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  // Functions, symbols, bigint: not JSON.
  return undefined;
}

/** Whole top-level keys, in order, while the JSON stays under the cap. */
function capSize(value: DiagnosticsValue, maxChars: number): DiagnosticsValue {
  if (JSON.stringify(value).length <= maxChars) return value;
  const out: DiagnosticsValue = { diagnosticsTruncated: true };
  for (const [k, v] of Object.entries(value)) {
    const next = { ...out, [k]: v };
    if (JSON.stringify(next).length > maxChars) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Run the host's provider for one report. Resolves null when there is none, it
 * returns nothing usable, throws, or takes longer than the timeout.
 */
export async function collectDiagnostics(
  provider: MushiDiagnosticsProvider | null | undefined,
  opts: { timeoutMs?: number; maxChars?: number; scrub?: (s: string) => string } = {},
): Promise<DiagnosticsValue | null> {
  if (!provider) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(provider),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), opts.timeoutMs ?? DIAGNOSTICS_TIMEOUT_MS);
      }),
    ]);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const scrubbed = scrubDeep(value, opts.scrub ?? ((s) => scrubPii(s)), 0) as DiagnosticsValue;
    return Object.keys(scrubbed).length > 0 ? capSize(scrubbed, opts.maxChars ?? DIAGNOSTICS_MAX_CHARS) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
