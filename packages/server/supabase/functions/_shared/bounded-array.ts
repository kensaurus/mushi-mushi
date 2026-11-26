/**
 * FILE: packages/server/supabase/functions/_shared/bounded-array.ts
 * PURPOSE: An array schema whose length cap is checked before any element is.
 *
 * `z.array(item).max(n)` is not enough on its own: zod 3 still validates
 * every element after the length check fails and keeps one issue per
 * failing field. 20,000 empty objects against a 3-field item gave 60,001
 * issues with `.max(500)` (measured 2026-11-26, zod 3.25.76). That is the
 * memory exhaustion in GHSA-mrhx-c7xc-m3w5, and there is no patched 3.x.
 *
 * Here a cheap `z.unknown()` array checks the length first. `.pipe()` stops
 * at that first failure, so an oversized body costs one issue. Arrays within
 * the cap get the usual per-element issues.
 */
import { z } from 'npm:zod@3'

export function boundedArray<T extends z.ZodTypeAny>(item: T, max: number) {
  return z.array(z.unknown()).max(max).pipe(z.array(item))
}
