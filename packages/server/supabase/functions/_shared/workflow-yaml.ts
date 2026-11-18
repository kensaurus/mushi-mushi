/**
 * FILE: packages/server/supabase/functions/_shared/workflow-yaml.ts
 * PURPOSE: Parse a GitHub Actions workflow once per isolate (2026-11-18).
 *
 * GET /v1/admin/ci/overview parsed every workflow file of every app two or three times per
 * request (ci-advisor, ci-cost-rules, recipe-drift), and the CI page asks again every 30 s.
 * This repo's 26 workflows (201 KB) take ~40 ms per pass on a desktop; across all apps, on edge
 * CPU, that pushed the function over its CPU budget: 27 of 773 overview reads in a day ended in
 * 546 WORKER_LIMIT ("CPU Time exceeded" in the function logs).
 *
 * The text is the key, so an edited workflow is simply a new entry. A parse error is cached and
 * rethrown, so callers keep their own try/catch. The parsed value is SHARED between callers:
 * treat it as read-only (every current caller only reads it).
 */

import { parse } from 'npm:yaml@2'

type Entry = { ok: true; value: unknown } | { ok: false; error: unknown }

/** Workflow texts kept per isolate; the oldest unused one goes first. */
const MAX_ENTRIES = 400
const cache = new Map<string, Entry>()

export function parseWorkflowYaml(text: string): unknown {
  let entry = cache.get(text)
  if (entry) {
    // Most recently used goes to the end, so eviction drops the least recently used.
    cache.delete(text)
    cache.set(text, entry)
  } else {
    try {
      entry = { ok: true, value: parse(text) }
    } catch (error) {
      entry = { ok: false, error }
    }
    cache.set(text, entry)
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
  }
  if (entry.ok) return entry.value
  throw entry.error
}

/** @internal Tests only. */
export function workflowYamlCacheSize(): number {
  return cache.size
}
