/**
 * FILE: content-quality-admin-safety.test.ts
 * PURPOSE: Lock the MUSHI-MUSHI-SERVER-1A fix. The admin Content Quality
 *          endpoints (GET /v1/admin/content-quality and the :id detail/regen/
 *          resolve routes) were throwing
 *            TypeError: Cannot read properties of undefined (reading 'id')
 *          on production. The crash came from dereferencing a project-access
 *          lookup that returned no row (an IDOR-style guess, or a project the
 *          caller doesn't own) before checking it for null.
 *
 *          The hardened handlers must:
 *            1. Resolve the per-issue/project access with `.maybeSingle()`.
 *            2. Guard the result (`if (!access)` / `if (!access.allowed)`)
 *               BEFORE using it, returning 403/404 — never read `.id`/`.allowed`
 *               off an undefined value.
 *            3. Treat missing issue AND denied access identically as 404 so
 *               callers can't enumerate other tenants' issue ids.
 *
 *          Source-level contract (no Deno/Supabase boot required), matching the
 *          style of project-scoping-contract.test.ts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(
  __dirname,
  '../../supabase/functions/api/routes/content-quality.ts',
);

const src = readFileSync(SRC, 'utf8');

/** Extract a balanced-ish slice of a named function for focused assertions. */
function sliceFn(name: string): string {
  const start = src.indexOf(`function ${name}`);
  expect(start, `${name} should be defined`).toBeGreaterThanOrEqual(0);
  // Grab a generous window — enough to cover the small helper bodies here.
  return src.slice(start, start + 1400);
}

describe('content-quality admin safety (MUSHI-MUSHI-SERVER-1A)', () => {
  it('loadAccessibleIssue looks up the issue with maybeSingle (no throw on missing row)', () => {
    const fn = sliceFn('loadAccessibleIssue');
    expect(fn).toContain('.maybeSingle()');
  });

  it('loadAccessibleIssue 404s on a missing issue before dereferencing it', () => {
    const fn = sliceFn('loadAccessibleIssue');
    // The missing-issue guard must run before any `issue.*` access.
    expect(fn).toMatch(/if \(error \|\| !issue\)\s*return \{ ok: false, response: notFound\(\) \}/);
  });

  it('loadAccessibleIssue 404s (not 403) on denied access — no tenant enumeration', () => {
    const fn = sliceFn('loadAccessibleIssue');
    expect(fn).toMatch(/if \(!access\.allowed\)\s*return \{ ok: false, response: notFound\(\) \}/);
  });

  it('admin list handler guards project access before querying issues', () => {
    // The inline owner/member check must use maybeSingle + null guards.
    expect(src).toContain(".eq('owner_id', userId)");
    expect(src).toMatch(/if \(!access\)\s*\{/);
    expect(src).toMatch(/if \(!member\)\s*return/);
  });

  it('never dereferences a project-access result before its null guard', () => {
    // The access/member lookups are boolean gates only. Reading `.id`/`.allowed`
    // off them (instead of off the guarded `issue`) was the original crash.
    expect(src).not.toContain('access.id');
    expect(src).not.toContain('member.id');
  });

  it('every issue-id read is guarded by a prior error/null check', () => {
    // `existing`, `raced`, and `newIssue` are the only objects we read `.id`
    // from; each must be created via a guarded query. We assert the guards
    // exist rather than the absence of `.id` (the ingest path legitimately
    // returns ids).
    expect(src).toMatch(/if \(existing\)/);
    expect(src).toMatch(/if \(raced\)/);
    expect(src).toMatch(/if \(error \|\| !newIssue\)/);
  });
});
