/**
 * FILE: packages/server/src/__tests__/report-ingest-react-native.test.ts
 * PURPOSE: The report a React Native app sends must pass both ingest
 *          checks. On 2026-10-26 yen-yen's Android app (RN 0.24.x) got 400
 *          on every POST /v1/reports: the RN fingerprint digest `rnfp_…`
 *          failed the `fingerprintHash` pattern, so no RN report had landed
 *          since the digest shipped in June. The fixture below is the
 *          payload `packages/react-native/src/provider.tsx` submitReport()
 *          builds (0.24.0 – 0.24.3), field for field.
 */

import { describe, expect, it } from 'vitest';
import { reportSubmissionSchema } from '../../supabase/functions/_shared/schemas.ts';
import { ApiReportBodySchema } from '../../supabase/functions/_shared/validate.ts';
import { rejectionIssues } from '../../supabase/functions/_shared/report-rejection.ts';

const rn024Report = {
  id: '6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f',
  projectId: 'proj_yenyen',
  category: 'other',
  userCategory: 'feature',
  description: 'The send button does nothing after I pick a contact',
  environment: {
    userAgent: 'android',
    platform: 'android',
    language: 'ja_JP',
    viewport: { width: 411.43, height: 914.29 },
    url: '/send',
    referrer: '',
    timestamp: '2026-10-26T07:03:34.000Z',
    timezone: 'Asia/Tokyo',
  },
  consoleLogs: [{ level: 'warn', message: 'VirtualizedList: missing keys', timestamp: 1761462214000 }],
  networkLogs: [
    { method: 'GET', url: 'https://api.example.com/v1/contacts', status: 200, duration: 182, timestamp: 1761462210000 },
    // A failed fetch: the capture records status null, the provider sends 0.
    { method: 'POST', url: 'https://api.example.com/v1/send', status: 0, duration: 30012, error: 'TypeError: Network request failed', timestamp: 1761462212000 },
  ],
  metadata: {
    user: { id: 'u_42', email: 'someone@example.com', name: 'Someone' },
    userId: 'u_42',
    userEmail: 'someone@example.com',
    userName: 'Someone',
    screenName: 'Send',
    screenRoute: '/send',
  },
  sessionId: 'sess_rn_1',
  reporterToken: 'mushi_0f6e7d8c-1b2a-4c3d-9e8f-7a6b5c4d3e2f', // gitleaks:allow — fake reporter token in the RN payload fixture
  // capture/fingerprint.ts: FNV-style digest, `rnfp_` + 8 hex.
  fingerprintHash: 'rnfp_1c9e04a7',
  appVersion: '2.14.0',
  sdkPackage: '@mushi-mushi/react-native',
  sdkVersion: '0.24.3',
  breadcrumbs: [
    { timestamp: 1761462200000, category: 'lifecycle', level: 'info', message: 'Mushi SDK ready', data: { platform: 'android' } },
    { timestamp: 1761462205000, category: 'navigation', level: 'info', message: 'Navigated to /send', data: { route: '/send' } },
    { timestamp: 1761462214000, category: 'lifecycle', level: 'info', message: 'Report submitted', data: { category: 'other' } },
  ],
  timeline: [
    { ts: 1761462200000, kind: 'log', payload: { message: 'Mushi SDK ready', level: 'info', platform: 'android' } },
    { ts: 1761462205000, kind: 'route', payload: { message: 'Navigated to /send', level: 'info', route: '/send' } },
    { ts: 1761462214000, kind: 'log', payload: { message: 'Report submitted', level: 'info', category: 'other' } },
  ],
  createdAt: '2026-10-26T07:03:34.000Z',
};

describe('React Native 0.24.x report ingest', () => {
  it('passes the route body check', () => {
    const r = ApiReportBodySchema.safeParse(rn024Report);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('passes the submission schema, every field at once (not only the first issue)', () => {
    const r = reportSubmissionSchema.safeParse(rn024Report);
    expect(r.success ? [] : rejectionIssues(r.error.issues)).toEqual([]);
  });

  it('accepts each SDK fingerprint form and nothing else', () => {
    const ok = (fingerprintHash: string) => reportSubmissionSchema.safeParse({ ...rn024Report, fingerprintHash }).success;
    expect(ok('rnfp_1c9e04a7')).toBe(true);
    expect(ok('fbk_0a1b2c3d')).toBe(true);
    expect(ok('f'.repeat(64))).toBe(true);
    expect(ok('rnfp_xyz')).toBe(false);
    expect(ok('rnfp_1c9e04a7; drop')).toBe(false);
  });
});

describe('rejectionIssues', () => {
  it('keeps field paths and codes, never values or host keys', () => {
    const r = reportSubmissionSchema.safeParse({ ...rn024Report, category: 'someone@example.com', fingerprintHash: 'nope', breadcrumbs: [{ ...rn024Report.breadcrumbs[0], level: 'loud' }] });
    expect(r.success).toBe(false);
    const issues = rejectionIssues(r.success ? [] : r.error.issues);
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: 'category', code: 'invalid_enum_value' },
        { path: 'fingerprintHash', code: 'invalid_string' },
        { path: 'breadcrumbs.#.level', code: 'invalid_enum_value' },
      ]),
    );
    expect(JSON.stringify(issues)).not.toContain('example.com');
    expect(rejectionIssues([{ path: ['metadata', 'someone@example.com'], code: 'custom' }])).toEqual([{ path: 'metadata.*', code: 'custom' }]);
  });
});
