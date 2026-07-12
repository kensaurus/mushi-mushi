/**
 * FILE: packages/server/src/__tests__/tenant-rls-simulation.test.ts
 * PURPOSE: Static contract for tenant RLS migration coverage.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260616060017_tenant_rls_and_org_audit.sql'),
  'utf8',
);

describe('tenant RLS migration', () => {
  it('creates org_audit_events with org-anchored retention', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.org_audit_events');
    expect(MIGRATION).toContain('organization_id uuid NOT NULL');
    expect(MIGRATION).toContain('ON DELETE SET NULL');
  });

  it('adds org_member_select policies for project-scoped tables', () => {
    expect(MIGRATION).toContain("'releases'");
    expect(MIGRATION).toContain("'pdca_runs'");
    expect(MIGRATION).toContain("'skill_pipeline_runs'");
    expect(MIGRATION).toContain('private.is_project_member(project_id)');
  });

  it('indexes hot membership lookup columns', () => {
    expect(MIGRATION).toContain('organization_members_org_user_idx');
    expect(MIGRATION).toContain('projects_organization_id_idx');
  });
});
