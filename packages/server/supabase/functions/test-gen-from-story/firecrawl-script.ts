/**
 * FILE: packages/server/supabase/functions/test-gen-from-story/firecrawl-script.ts
 * PURPOSE: Turn the model's Firecrawl YAML into the JSON qa-story-runner executes.
 *
 * OVERVIEW:
 * - Accepts YAML, JSON, or a fenced block.
 * - Keeps only the action types the generator prompt lists.
 * - Drops `script` and any other field the runner was not asked to store.
 * - Returns null when the document cannot be run, so the caller keeps the
 *   Playwright spec as a local story.
 *
 * DEPENDENCIES:
 * - `npm:yaml@2` (the `yaml` package under vitest)
 *
 * USAGE:
 * - `storedQaStoryScript` in `story-script.ts` is the only caller.
 *
 * NOTES:
 * - Does not embed the Playwright spec. That is added later so this 12k cap
 *   applies to the actions document only.
 * - `executeJavascript` is not a listed type, so a model-written `script` is
 *   never stored for the scheduled runner.
 */

import { parse as parseYaml } from 'npm:yaml@2';

interface SpecExtras {
  assertContains?: string[];
  waitFor?: number;
  htmlOnly?: boolean;
  directFetch?: boolean;
}

export function usableFirecrawlScript(raw: string | null | undefined): string | null {
  const parsed = parseActionsDocument(raw);
  if (Array.isArray(parsed)) return actionsToScript(parsed, {});
  if (!parsed || typeof parsed !== 'object') return null;
  const spec = parsed as Record<string, unknown>;
  const listed = readStringList(spec.assertContains);
  if (listed === null) return null;
  if (spec.waitFor !== undefined && !validWait(spec.waitFor)) return null;
  const extra: SpecExtras = {
    assertContains: listed && listed.length > 0 ? listed : undefined,
    waitFor: typeof spec.waitFor === 'number' ? spec.waitFor : undefined,
    htmlOnly: spec.htmlOnly === true ? true : undefined,
    directFetch: spec.directFetch === true ? true : undefined,
  };
  if (spec.actions === undefined) {
    if ((extra.htmlOnly || extra.directFetch) && extra.assertContains?.length) {
      return serializeSpec([], extra);
    }
    const one = sanitizeAction(spec);
    return one ? serializeSpec([one], extra) : null;
  }
  return Array.isArray(spec.actions) ? actionsToScript(spec.actions, extra) : null;
}

function actionsToScript(raw: unknown[], extra: SpecExtras): string | null {
  if (raw.length > 40) return null;
  const actions: Record<string, unknown>[] = [];
  for (const item of raw) {
    const action = sanitizeAction(item);
    if (!action) return null;
    actions.push(action);
  }
  return serializeSpec(actions, extra);
}

function serializeSpec(actions: Record<string, unknown>[], extra: SpecExtras): string | null {
  if (
    actions.length === 0 &&
    !(extra.assertContains?.length && (extra.htmlOnly || extra.directFetch))
  ) {
    return null;
  }
  const spec: Record<string, unknown> = {};
  if (actions.length > 0) spec.actions = actions;
  if (extra.assertContains?.length) spec.assertContains = extra.assertContains;
  if (extra.waitFor !== undefined) spec.waitFor = extra.waitFor;
  if (extra.htmlOnly) spec.htmlOnly = true;
  if (extra.directFetch) spec.directFetch = true;
  const json = JSON.stringify(spec);
  return json.length > 12_000 ? null : json;
}

function bounded(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > max) return null;
  return value;
}

const ACTION_TYPES = new Set(['wait', 'click', 'write', 'press', 'scroll', 'screenshot', 'scrape']);

function sanitizeAction(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.type !== 'string' || !ACTION_TYPES.has(rec.type)) return null;
  const selector = bounded(rec.selector, 500);
  const text = bounded(rec.text, 500);
  const key = bounded(rec.key, 40);
  if (selector === null || text === null || key === null) return null;
  const out: Record<string, unknown> = { type: rec.type };
  if (selector) out.selector = selector;
  if (text) out.text = text;
  if (key) out.key = key;
  if (rec.milliseconds !== undefined) {
    if (
      typeof rec.milliseconds !== 'number' ||
      !Number.isFinite(rec.milliseconds) ||
      rec.milliseconds < 0 ||
      rec.milliseconds > 30_000
    ) {
      return null;
    }
    out.milliseconds = rec.milliseconds;
  }
  if (rec.direction !== undefined && rec.direction !== 'up' && rec.direction !== 'down')
    return null;
  if (rec.direction === 'up' || rec.direction === 'down') out.direction = rec.direction;
  if (rec.fullPage !== undefined && typeof rec.fullPage !== 'boolean') return null;
  if (typeof rec.fullPage === 'boolean') out.fullPage = rec.fullPage;
  if (rec.type === 'click' && !out.selector) return null;
  if (rec.type === 'write' && !out.text) return null;
  if (rec.type === 'press' && !out.key) return null;
  if (rec.type === 'wait' && typeof out.milliseconds !== 'number') out.milliseconds = 1000;
  return out;
}

function readStringList(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  const items = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(items) || items.length > 8) return null;
  const out: string[] = [];
  for (const item of items) {
    const text = bounded(typeof item === 'string' ? item.trim() : item, 200);
    if (!text) return null;
    out.push(text);
  }
  return out;
}

function validWait(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 60_000;
}

function parseActionsDocument(raw: string | null | undefined): unknown {
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 20_000) return null;
  const fenced = /```(?:yaml|yml|json)?[^\n]*\n([\s\S]*?)```/i.exec(raw.trim());
  const body = (fenced?.[1] ?? raw).trim();
  if (!body) return null;
  try {
    return parseYaml(body);
  } catch {
    return null;
  }
}
