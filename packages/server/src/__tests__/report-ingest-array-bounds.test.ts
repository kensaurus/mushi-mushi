/**
 * FILE: packages/server/src/__tests__/report-ingest-array-bounds.test.ts
 * PURPOSE: Every array a public ingest request can send has a length cap.
 *          zod collects one issue per failing element with no limit
 *          (GHSA-mrhx-c7xc-m3w5), so an unbounded array in a request body
 *          lets one POST exhaust the edge function's memory, and `.max()`
 *          alone does not stop it in zod 3 (see `_shared/bounded-array.ts`).
 *          The caps sit well above what the SDKs buffer (web: 50 console,
 *          30 network, 120 timeline; React Native: 100 console, 50 network).
 */

import { describe, expect, it } from 'vitest';
import { reportSubmissionSchema } from '../../supabase/functions/_shared/schemas.ts';
import { inventorySchema } from '../../supabase/functions/_shared/inventory.ts';

const base = {
  projectId: 'proj_bounds',
  category: 'bug',
  description: 'The save button does nothing',
  environment: {
    userAgent: 'Mozilla/5.0',
    platform: 'web',
    language: 'en',
    viewport: { width: 1280, height: 800 },
    url: 'https://example.com/settings',
    referrer: '',
    timestamp: '2026-11-26T00:00:00.000Z',
    timezone: 'UTC',
  },
  reporterToken: 'mushi_0f6e7d8c-1b2a-4c3d-9e8f-7a6b5c4d3e2f', // gitleaks:allow — fake reporter token fixture
  createdAt: '2026-11-26T00:00:00.000Z',
};

const consoleLog = { level: 'error', message: 'boom', timestamp: 1 };
const networkLog = { method: 'GET', url: '/x', status: 500, duration: 10, timestamp: 1 };
const timelineEntry = { ts: 1, kind: 'click', payload: {} };

const times = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

describe('report ingest array caps', () => {
  it('accepts the largest buffers the SDKs send', () => {
    const r = reportSubmissionSchema.safeParse({
      ...base,
      consoleLogs: times(100, consoleLog),
      networkLogs: times(50, networkLog),
      timeline: times(120, timelineEntry),
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ['consoleLogs', consoleLog],
    ['networkLogs', networkLog],
    ['timeline', timelineEntry],
  ])('rejects more than 500 %s', (field, entry) => {
    const r = reportSubmissionSchema.safeParse({ ...base, [field]: times(501, entry) });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === field && i.code === 'too_big')).toBe(true);
  });

  it('stops at the cap instead of collecting one issue per bad element', () => {
    const r = reportSubmissionSchema.safeParse({ ...base, consoleLogs: times(5_000, { level: 'nope' }) });
    expect(r.success).toBe(false);
    // The length check alone fails the field; no per-element issues pile up.
    expect(r.error!.issues.filter((i) => i.path[0] === 'consoleLogs').length).toBeLessThan(10);
  });
});

describe('inventory.yaml array caps', () => {
  const page = { id: 'home', path: '/' };
  const inventory = {
    schema_version: '2.0',
    app: { id: 'bounds', name: 'Bounds', base_url: 'https://example.com' },
    pages: [page],
  };

  it('rejects more than 1000 pages', () => {
    const pages = Array.from({ length: 1001 }, (_, i) => ({ id: `p${i}`, path: `/p${i}` }));
    const r = inventorySchema.safeParse({ ...inventory, pages });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === 'pages' && i.code === 'too_big')).toBe(true);
  });
});
