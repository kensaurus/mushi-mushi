/**
 * FILE: packages/core/src/analytics-taxonomy.ts
 * PURPOSE: Single source of truth for Mushi's product-analytics vocabulary —
 *          the events Mushi emits about its OWN funnel (dogfooding the SDK on
 *          the landing site, docs, console, CLI and MCP) plus the validation
 *          rules every `Mushi.track()` call obeys, for every project.
 *
 * Naming: `object_verb`, snake_case, past tense for completions, `_view` for
 * exposure, `_click` for intent. Every event carries `$surface`.
 *
 * Mirror: packages/server/supabase/functions/_shared/analytics-taxonomy.generated.ts
 * is generated from this file by `node scripts/gen-analytics-taxonomy.mjs`
 * (CI runs `--check`). Edge functions cannot import workspace packages.
 */

import type { MushiPropertyValue } from './types';

/** Event names: lowercase, start with a letter, 2–64 chars. */
export const EVENT_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** Hard caps applied client- and server-side. */
export const EVENT_PROPERTY_LIMITS = {
  maxKeys: 40,
  maxKeyLength: 64,
  maxValueLength: 256,
  maxBytes: 8192,
  /** Client batch size before an immediate flush. */
  maxClientBatch: 20,
  /** Server-side per-request ceiling. */
  maxServerBatch: 50,
  /** Distinct event names per project before the server returns 422. */
  maxEventNamesPerProject: 200,
} as const;

/** Property keys the SDK reserves for itself. Host apps cannot set these. */
const RESERVED_PROPERTY_PREFIX = '$';

/** Keys that are dropped unless explicitly allowlisted — they smell like PII. */
const PII_PROPERTY_KEY_RE = /(email|phone|password|passwd|token|secret|ssn|address|credit|card|iban)/i;

export const MUSHI_SURFACES = ['web', 'console', 'docs', 'cli', 'mcp', 'server', 'mobile'] as const;
export type MushiSurface = (typeof MUSHI_SURFACES)[number];

/**
 * Mushi's own funnel vocabulary. One entry per line — the generator parses
 * this block line by line, so keep the `name: { surface: '…', required: […] }`
 * shape. An event with more than one emitter lists every surface:
 * `surface: ['console', 'mcp']`.
 */
export const MUSHI_EVENTS = {
  // ── Any surface (SDK `analytics.autoPageviews`) ──────────────────────────
  page_view: { surface: ['web', 'docs', 'console'], required: [] },
  // ── Landing + docs (apps/docs) ───────────────────────────────────────────
  // Every docs route; `route` repeats the reserved `$route` as a host prop so
  // the requirement is checkable. company_funnel_weekly counts visits from
  // this and landing_view.
  docs_page_view: { surface: 'docs', required: ['route'] },
  landing_view: { surface: 'docs', required: [] },
  cta_click: { surface: 'docs', required: ['cta_id', 'location'] },
  quickstart_view: { surface: 'docs', required: [] },
  pricing_view: { surface: 'docs', required: [] },
  connect_demo_click: { surface: 'docs', required: ['href'] },
  signup_click: { surface: 'docs', required: ['href'] },
  // ── Console (apps/admin) ─────────────────────────────────────────────────
  signup_completed: { surface: 'console', required: ['signup_source'] },
  report_opened: { surface: ['console', 'mcp'], required: ['report_id'] },
  fix_context_pulled: { surface: ['console', 'mcp'], required: ['report_id'] },
  fix_dispatched: { surface: ['console', 'mcp'], required: ['report_id', 'agent'] },
  invite_sent: { surface: 'console', required: [] },
  upgrade_clicked: { surface: 'console', required: ['plan'] },
  test_report_sent: { surface: 'console', required: ['project_id'] },
  // ── Server-emitted (edge functions) ──────────────────────────────────────
  project_created: { surface: 'server', required: ['project_id'] },
  key_minted: { surface: 'server', required: ['project_id'] },
  first_report_received: { surface: 'server', required: ['project_id'] },
  fix_merged: { surface: 'server', required: ['project_id'] },
  upgrade_completed: { surface: 'server', required: ['project_id', 'plan'] },
  // ── Growth loop (widget "Bug reports by Mushi" mark) ─────────────────────
  loop_impression: { surface: 'web', required: [] },
  loop_click: { surface: 'web', required: [] },
  loop_signup: { surface: 'console', required: ['ref'] },
} as const;

export type MushiEventName = keyof typeof MUSHI_EVENTS;
export const MUSHI_EVENT_NAMES = Object.keys(MUSHI_EVENTS) as MushiEventName[];

/** The aha event: a project receives its first SDK-originated report. */
export const ACTIVATION_EVENT: MushiEventName = 'first_report_received';
/**
 * Any of these in a week counts as "diagnosis consumed" for the habit metric
 * (docs/plan-gtm.md: report opened, fix context pulled or fix dispatched, from
 * the console or an MCP client). company_funnel_weekly counts the same set.
 */
export const HABIT_EVENTS: readonly MushiEventName[] = ['report_opened', 'fix_context_pulled', 'fix_dispatched'];

// MushiPropertyValue is defined once, in types.ts (the published surface).
export type MushiEventProperties = Record<string, MushiPropertyValue>;

export function isValidEventName(name: unknown): name is string {
  return typeof name === 'string' && EVENT_NAME_RE.test(name);
}

export interface SanitizedProperties {
  properties: MushiEventProperties;
  dropped: string[];
}

/**
 * Enforce the property contract: depth 1, ≤ maxKeys, values ≤ maxValueLength,
 * PII-looking keys dropped unless allowlisted, `$`-prefixed keys dropped unless
 * `allowReserved` (the SDK sets those itself). Never throws.
 */
export function sanitizeEventProperties(
  input: unknown,
  opts: { allowlist?: readonly string[]; allowReserved?: boolean; scrub?: (s: string) => string } = {},
): SanitizedProperties {
  const out: MushiEventProperties = {};
  const dropped: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { properties: out, dropped };
  const allow = new Set(opts.allowlist ?? []);
  let keys = 0;
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (keys >= EVENT_PROPERTY_LIMITS.maxKeys) { dropped.push(rawKey); continue; }
    const key = rawKey.slice(0, EVENT_PROPERTY_LIMITS.maxKeyLength);
    if (key.startsWith(RESERVED_PROPERTY_PREFIX) && !opts.allowReserved) { dropped.push(key); continue; }
    if (PII_PROPERTY_KEY_RE.test(key) && !allow.has(key)) { dropped.push(key); continue; }
    let value: MushiPropertyValue;
    if (rawValue === null || typeof rawValue === 'boolean') value = rawValue;
    else if (typeof rawValue === 'number') value = Number.isFinite(rawValue) ? rawValue : null;
    else if (typeof rawValue === 'string') {
      const s = rawValue.slice(0, EVENT_PROPERTY_LIMITS.maxValueLength);
      value = opts.scrub ? opts.scrub(s) : s;
    } else if (rawValue instanceof Date) value = rawValue.toISOString();
    else { dropped.push(key); continue; } // objects / arrays / functions: depth 1 only
    out[key] = value;
    keys += 1;
  }
  return { properties: out, dropped };
}

/** Approximate serialized size guard (UTF-16 length is a fine upper bound here). */
export function propertiesWithinByteLimit(properties: MushiEventProperties): boolean {
  try {
    return JSON.stringify(properties).length <= EVENT_PROPERTY_LIMITS.maxBytes;
  } catch {
    return false;
  }
}
