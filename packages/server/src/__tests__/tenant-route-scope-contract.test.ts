/**
 * FILE: packages/server/src/__tests__/tenant-route-scope-contract.test.ts
 * PURPOSE: Guard tenant scoping contracts for high-risk admin routes.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = resolve(__dirname, '../../supabase/functions/api');

function readApiFile(relative: string): string {
  return readFileSync(resolve(API_ROOT, relative), 'utf8');
}

describe('tenant route scope contract', () => {
  const shared = readApiFile('shared.ts');
  const rewards = readApiFile('routes/rewards.ts');
  const releases = readApiFile('routes/releases.ts');
  const lessons = readApiFile('routes/lessons.ts');
  const skills = readApiFile('routes/skills.ts');
  const pdca = readApiFile('routes/pdca.ts');

  it('exports centralized tenant scope helpers', () => {
    expect(shared).toContain('export async function resolveAccessibleOrg');
    expect(shared).toContain('export async function assertTargetProjectAccess');
    expect(shared).toContain('export async function intersectOrgAndProjectScope');
  });

  it('rewards admin routes validate org membership instead of raw header trust', () => {
    expect(rewards).toContain('resolveAccessibleOrg');
    expect(rewards).not.toMatch(/function getOrgIdFromContext\(/);
  });

  it('releases list/detail routes scope by accessible projects', () => {
    expect(releases).toContain('intersectOrgAndProjectScope');
    expect(releases).toContain('assertTargetProjectAccess');
  });

  it('lessons list and named routes validate project access', () => {
    expect(lessons).toContain('intersectOrgAndProjectScope');
    expect(lessons).toContain('assertTargetProjectAccess');
  });

  it('skills pipeline POST validates body.project_id via assertTargetProjectAccess', () => {
    const postHandler = skills.slice(
      skills.indexOf("r.post('/pipelines'"),
      skills.indexOf('// Rate limit: max 10 active pipeline runs'),
    );
    expect(postHandler).toContain('assertTargetProjectAccess');
  });

  it('pdca queue POST validates body.project_id via assertTargetProjectAccess', () => {
    const postHandler = pdca.slice(
      pdca.indexOf("r.post('/',"),
      pdca.indexOf('const { data, error } = await db()'),
    );
    expect(postHandler).toContain('assertTargetProjectAccess');
  });

  it('pdca assertRunAccess honours API-key project binding', () => {
    expect(pdca).toContain("authMethod === 'apiKey'");
    expect(pdca).toContain('assertCallerProjectScope');
  });
});
