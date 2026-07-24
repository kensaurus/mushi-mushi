/**
 * FILE: packages/server/src/__tests__/report-ingest-contract.test.ts
 * PURPOSE: SDK↔ingest wire contract (backend architecture audit 2026-07-24,
 *          finding 4). `MushiReport` in @mushi-mushi/core and
 *          `reportSubmissionSchema` in _shared/schemas.ts evolve
 *          independently — core imports neither the server nor
 *          inventory-schema — and the SDKs are published to npm, so silent
 *          drift breaks clients that cannot be redeployed.
 *
 *          Two directions are guarded:
 *          1. Server tightening: a fully-populated `MushiReport` payload must
 *             parse. A new *required* server field, a renamed field, or a
 *             narrowed enum fails here.
 *          2. Core additions: the top-level schema is neither strict nor
 *             passthrough, so unknown keys are silently STRIPPED. Comparing
 *             the parsed key set against the payload key set turns that
 *             silent drop into a failing test ("add the field to
 *             reportSubmissionSchema or it never reaches the DB").
 *
 *          The payload literal is typed against core (`satisfies`), so
 *          removals/renames in core surface in the repo typecheck gate.
 */

import { describe, expect, it } from 'vitest';
import type { MushiReport } from '@mushi-mushi/core';
import { reportSubmissionSchema } from '../../supabase/functions/_shared/schemas.ts';

/** Every field of the wire shape populated — keep in sync with MushiReport. */
const fullReport = {
  id: 'rep_contract_test',
  projectId: '00000000-0000-0000-0000-000000000001',
  category: 'bug',
  userCategory: 'checkout',
  description: 'Contract test description exceeding twenty characters.',
  userIntent: 'I was trying to check out',
  environment: {
    userAgent: 'contract-test/1.0',
    platform: 'Win32',
    language: 'en-US',
    viewport: { width: 1280, height: 720 },
    url: 'https://app.example.com/checkout',
    referrer: 'https://app.example.com/cart',
    timestamp: '2026-07-24T00:00:00.000Z',
    timezone: 'Asia/Tokyo',
    connection: { effectiveType: '4g', downlink: 10, rtt: 50 },
    deviceMemory: 8,
    hardwareConcurrency: 8,
    route: '/checkout',
    nearestTestid: 'checkout-submit',
  },
  consoleLogs: [
    { level: 'error', message: 'boom', timestamp: 1753315200000, stack: 'Error: boom' },
  ],
  networkLogs: [
    {
      method: 'POST',
      url: 'https://api.example.com/pay',
      status: 500,
      duration: 123,
      timestamp: 1753315200000,
      error: 'Internal',
    },
  ],
  performanceMetrics: { fcp: 1, lcp: 2, cls: 0.01, fid: 3, inp: 4, ttfb: 5, longTasks: 1 },
  timeline: [{ ts: 1753315200000, kind: 'click', payload: { testid: 'checkout-submit' } }],
  screenshotDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  selectedElement: { selector: '#pay' },
  replayEvents: [{ type: 2, data: {} }],
  metadata: { user: { id: 'u1', email: 'u1@example.com', name: 'U One', provider: 'auth0' } },
  sessionId: 'sess_1',
  reporterToken: 'rt_contract_test',
  fingerprintHash: 'a'.repeat(64),
  appVersion: '1.2.3',
  sdkPackage: '@mushi-mushi/web',
  sdkVersion: '0.9.0',
  proactiveTrigger: 'rage-click',
  breadcrumbs: [
    {
      timestamp: 1753315200000,
      category: 'ui.click',
      level: 'info',
      message: 'clicked [data-testid=checkout-submit]',
      data: { testid: 'checkout-submit' },
    },
  ],
  tags: { 'checkout-flow': 'redesign-v2', attempt: 2, beta: true },
  sentryContext: {
    sdk: 'v9',
    eventId: 'e'.repeat(32),
    replayId: 'r'.repeat(32),
    traceId: 't'.repeat(32),
    spanId: 's'.repeat(16),
    transactionName: '/checkout',
    release: 'app@1.2.3',
    environment: 'production',
    sessionId: 'sentry_sess',
    user: { id: 'u1', email: 'u1@example.com', username: 'uone', ip_address: '203.0.113.1' },
    tags: { region: 'apac' },
    breadcrumbs: [
      {
        timestamp: 1753315200,
        category: 'fetch',
        level: 'error',
        message: 'POST /pay 500',
        type: 'http',
        data: { status_code: 500 },
      },
    ],
    issueUrl: 'https://sentry.io/organizations/x/issues/1',
  },
  sentryEventId: 'e'.repeat(32),
  sentryReplayId: 'r'.repeat(32),
  queuedAt: '2026-07-24T00:00:00.000Z',
  createdAt: '2026-07-24T00:00:01.000Z',
} satisfies MushiReport;

describe('report ingest contract (core MushiReport ↔ server reportSubmissionSchema)', () => {
  it('a fully-populated MushiReport parses under the server submission schema', () => {
    const result = reportSubmissionSchema.safeParse(fullReport);
    expect(
      result.success,
      result.success ? '' : JSON.stringify(result.error.issues, null, 2),
    ).toBe(true);
  });

  it('no top-level field is silently stripped by the server schema', () => {
    const parsed = reportSubmissionSchema.parse(fullReport);
    const sent = Object.keys(fullReport).sort();
    const kept = Object.keys(parsed).sort();
    const stripped = sent.filter((k) => !kept.includes(k));
    expect(
      stripped,
      `Fields the SDK sends but reportSubmissionSchema drops silently — ` +
        `add them to the schema (or remove from MushiReport): ${stripped.join(', ')}`,
    ).toEqual([]);
  });

  it('category enums stay in lockstep', () => {
    const categories: MushiReport['category'][] = ['bug', 'slow', 'visual', 'confusing', 'other'];
    for (const category of categories) {
      expect(
        reportSubmissionSchema.safeParse({ ...fullReport, category }).success,
        `server rejects core category "${category}"`,
      ).toBe(true);
    }
  });
});
