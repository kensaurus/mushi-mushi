/**
 * FILE: packages/server/src/__tests__/project-create-org-contract.test.ts
 * PURPOSE: Source-level regression guard for Sentry MUSHI-MUSHI-SERVER-M.
 *
 *          Teams v1 added a NOT NULL `organization_id` to `public.projects`
 *          (`20260428000200_organization_backfill.sql`). The
 *          POST /v1/admin/projects handler must therefore (a) resolve the
 *          caller's active org from `X-Mushi-Org-Id` (with a sane fallback to
 *          the user's first owner/admin membership) and (b) always pass
 *          `organization_id` to the projects insert. If either step is dropped
 *          again we get the same Sentry "null value in column
 *          \"organization_id\" of relation \"projects\" violates not-null
 *          constraint" 500 the user hit on 2026-04-28.
 *
 *          We pin the contract at source level (the same pattern as
 *          project-scoping-contract.test.ts) instead of an integration test
 *          because the route lives inside a Deno Edge Function and is not
 *          importable from Node Vitest without a heavy Hono+Supabase fake.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = resolve(__dirname, '../../supabase/functions/api');

function readApiFile(relative: string): string {
  return readFileSync(resolve(API_ROOT, relative), 'utf8');
}

describe('POST /v1/admin/projects org-id contract (Sentry MUSHI-MUSHI-SERVER-M)', () => {
  const route = readApiFile('routes/billing-projects-queue-graph.ts');

  function sliceCreateHandler(): string {
    const start = route.indexOf("app.post('/v1/admin/projects'");
    expect(start).toBeGreaterThan(0);
    // Walk forward to the next `app.` route registration to bound the slice.
    const next = route.indexOf('\n  app.', start + 1);
    return next > start ? route.slice(start, next) : route.slice(start);
  }

  const handler = sliceCreateHandler();

  it('resolves the active organization from X-Mushi-Org-Id', () => {
    expect(handler.toLowerCase()).toContain("c.req.header('x-mushi-org-id')");
  });

  it('looks up the caller in organization_members before inserting', () => {
    expect(handler).toContain("from('organization_members')");
    expect(handler).toContain('user_id');
  });

  it('passes organization_id to the projects insert', () => {
    // Regex tolerates whitespace, comments, and other fields between the
    // `from('projects').insert({` open brace and the `organization_id` key.
    const insertsOrg = /from\('projects'\)[\s\S]*?\.insert\(\{[\s\S]*?organization_id\s*:/.test(
      handler,
    );
    expect(insertsOrg).toBe(true);
  });

  it('fails closed with NO_ORGANIZATION instead of letting the DB raise 23502', () => {
    expect(handler).toContain('NO_ORGANIZATION');
    // The early-return must happen BEFORE the projects insert so we never
    // round-trip a null organization_id to Postgres again.
    const earlyReturnIdx = handler.indexOf('NO_ORGANIZATION');
    const insertIdx = handler.indexOf("from('projects')");
    expect(earlyReturnIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(earlyReturnIdx);
  });

  it('rejects malformed X-Mushi-Org-Id headers with INVALID_ORGANIZATION_ID', () => {
    expect(handler).toContain('INVALID_ORGANIZATION_ID');
  });

  it('rejects member/viewer roles with FORBIDDEN before insert', () => {
    expect(handler).toContain("'owner'");
    expect(handler).toContain("'admin'");
    expect(handler).toContain('FORBIDDEN');
  });
});
