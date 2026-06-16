/**
 * FILE: packages/server/src/__tests__/project-access-org-scope.test.ts
 * PURPOSE: Contract tests for org-scoped project enumeration helpers.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHARED_ROOT = resolve(__dirname, '../../supabase/functions');

function read(relative: string): string {
  return readFileSync(resolve(SHARED_ROOT, relative), 'utf8');
}

describe('accessibleProjectIdsInOrganization', () => {
  const projectAccess = read('_shared/project-access.ts');
  const shared = read('api/shared.ts');

  it('exports org-scoped helper with membership gate', () => {
    expect(projectAccess).toContain('export async function accessibleProjectIdsInOrganization');
    expect(projectAccess).toContain("from('organization_members')");
    expect(projectAccess).toContain('if (!membership) return []');
  });

  it('enumerateAccessibleProjectIds honours org header but not project header', () => {
    expect(shared).toContain('Never** honours `X-Mushi-Project-Id`');
    expect(shared).toContain('Optionally** honours `X-Mushi-Org-Id`');
    expect(shared).toContain('_accessibleProjectIdsInOrganization(db, userId, requestedOrg)');
    expect(shared).toContain('requestedOrganizationId(c)');
    expect(shared).toContain('export async function resolveAccessibleOrg');
    expect(shared).toContain('export async function assertTargetProjectAccess');
    expect(shared).toContain('export async function intersectOrgAndProjectScope');
  });
});
