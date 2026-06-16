/**
 * FILE: packages/server/src/__tests__/project-enumeration-contract.test.ts
 * PURPOSE: Guard against the chicken-and-egg trap where list/switcher endpoints
 *          honour X-Mushi-Project-Id and hide every project except the pinned
 *          one — leaving users unable to switch back.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = resolve(__dirname, '../../supabase/functions/api');

function readApiFile(relative: string): string {
  return readFileSync(resolve(API_ROOT, relative), 'utf8');
}

describe('project enumeration contract', () => {
  const shared = readApiFile('shared.ts');
  const projectsCrud = readApiFile('routes/projects-crud.ts');
  const onboardingSetup = readApiFile('routes/onboarding-setup.ts');
  const activation = readApiFile('routes/activation.ts');
  const mcpAdmin = readApiFile('routes/mcp-admin.ts');

  it('exports enumerateAccessibleProjectIds for unscoped listing', () => {
    expect(shared).toContain('export async function enumerateAccessibleProjectIds');
    expect(shared).toContain('Never** honours `X-Mushi-Project-Id`');
    expect(shared).toContain('Optionally** honours `X-Mushi-Org-Id`');
  });

  it('GET /v1/admin/projects uses unscoped enumeration', () => {
    const listHandler = projectsCrud.slice(
      projectsCrud.indexOf("app.get('/v1/admin/projects'"),
      projectsCrud.indexOf("app.get('/v1/admin/projects/stats'"),
    );
    expect(listHandler).toContain('enumerateAccessibleProjectIds');
    expect(listHandler).not.toMatch(/await callerProjectIds\(/);
  });

  it('GET /v1/admin/projects/stats uses unscoped enumeration', () => {
    const statsHandler = projectsCrud.slice(
      projectsCrud.indexOf("app.get('/v1/admin/projects/stats'"),
      projectsCrud.indexOf("app.post('/v1/admin/projects'"),
    );
    expect(statsHandler).toContain('enumerateAccessibleProjectIds');
    expect(statsHandler).not.toContain('callerProjectIds');
  });

  it('GET /v1/admin/setup uses unscoped enumeration', () => {
    const setupStart = onboardingSetup.indexOf("app.get('/v1/admin/setup'");
    const setupEnd = onboardingSetup.indexOf('return c.json({', setupStart);
    const setupHandler = onboardingSetup.slice(setupStart, setupEnd);
    expect(setupHandler).toContain('enumerateAccessibleProjectIds');
    expect(setupHandler).not.toMatch(/await callerProjectIds\(/);
  });

  it('activation cockpit setup payload uses unscoped enumeration', () => {
    expect(activation).toContain('enumerateAccessibleProjectIds');
    expect(activation).toContain('buildSetupResponse(db, userId, adminHost, allAccessibleIds)');
  });

  it('MCP project list uses unscoped enumeration for JWT callers', () => {
    const mcpList = mcpAdmin.slice(
      mcpAdmin.indexOf("parent.get('/v1/admin/mcp/projects'"),
      mcpAdmin.indexOf("parent.get('/v1/admin/mcp/projects'", mcpAdmin.indexOf("parent.get('/v1/admin/mcp/projects'") + 1) >= 0
        ? mcpAdmin.indexOf("parent.get('/v1/admin/mcp/projects'", mcpAdmin.indexOf("parent.get('/v1/admin/mcp/projects'") + 1)
        : mcpAdmin.length,
    );
    expect(mcpList).toContain('enumerateAccessibleProjectIds');
  });
});
