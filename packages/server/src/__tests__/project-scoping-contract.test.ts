/**
 * FILE: packages/server/src/__tests__/project-scoping-contract.test.ts
 * PURPOSE: Source-level guard for the admin multi-project contract. Routes
 *          that back ProjectSwitcher-aware admin pages must use
 *          `resolveOwnedProject(...)` instead of silently selecting the first
 *          owned project with `.eq('owner_id', userId).limit(1).single()`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = resolve(__dirname, '../../supabase/functions/api');

function readApiFile(relative: string): string {
  return readFileSync(resolve(API_ROOT, relative), 'utf8');
}

describe('admin project scoping contract', () => {
  const settingsResearch = readApiFile('routes/settings-research.ts');
  const enterpriseIntegrations = readApiFile('routes/enterprise-integrations.ts');
  const askMushi = readApiFile('routes/ask-mushi.ts');
  const scopedSources = [settingsResearch, enterpriseIntegrations].join('\n');

  it('uses the shared owned-project resolver on scoped admin route modules', () => {
    expect(scopedSources).toContain('resolveOwnedProject(c, db, userId');
  });

  it('does not fall back to first owned project in scoped admin route modules', () => {
    expect(scopedSources).not.toMatch(
      /\.eq\('owner_id', userId\)[\s\S]{0,120}\.limit\(1\)[\s\S]{0,80}\.single\(\)/,
    );
  });

  it('keeps legacy assist on the same handler as Ask Mushi messages', () => {
    const assistStart = askMushi.indexOf("app.post('/v1/admin/assist'");
    expect(assistStart).toBeGreaterThan(0);
    const assistTail = askMushi.slice(assistStart);
    expect(assistTail).toContain('handleAskMushiMessage');
    expect(assistTail).not.toContain("functionName: 'assist'");
    expect(assistTail).not.toContain('generateText');
  });
});
