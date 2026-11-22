/**
 * FILE: packages/server/src/__tests__/code-audit-patterns.test.ts
 * PURPOSE: ADR 0063's pure rules, from the 2026-11-21 backlog (550 open
 *          code_audit reports, ~312 of them a handful of problems filed once
 *          per screen, 120 with a fix PR closed unmerged and sent back to the
 *          queue):
 *            - the server's taxonomy is the worker's, byte for byte;
 *            - a finding carries its confidence and root, and both are checked;
 *            - the open cap, the score and the daily recheck clock;
 *            - an automated duplicate merges into an open report, a person's never;
 *            - a rejected fix of Mushi's own finding leaves the queue, never to `new`;
 *            - open counts say how many came from people.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => l }
  return { log: l }
})

import * as cli from '../../../cli/src/worker/audit-patterns.ts'
import * as srv from '../../supabase/functions/_shared/audit-taxonomy.ts'
import { AUTO_MERGE_MIN_SIMILARITY, pickDuplicateParent, withDuplicateCounted } from '../../supabase/functions/_shared/duplicate-merge.ts'
import { closedUnmergedReportStatus } from '../../supabase/functions/_shared/fix-loop-status.ts'
import { openText } from '../../supabase/functions/_shared/operator-digest.ts'
import { AUTOMATED_REPORT_SOURCES, isAutomatedReportSource } from '../../supabase/functions/_shared/report-sources.ts'
import {
  appendAffectedScreen,
  auditConfidenceRefusal,
  auditFindingScore,
  auditRecheckDue,
  codeAuditOpenCap,
  CODE_AUDIT_OPEN_STATUSES,
  DEFAULT_CODE_AUDIT_OPEN_CAP,
  parseAuditFinding,
} from '../../supabase/functions/_shared/work-modes.ts'

describe('one taxonomy on both sides', () => {
  it('the server table is the worker table, category by category, pattern by pattern', () => {
    const shape = (t: ReadonlyArray<{ category: string; re: RegExp }>) => t.map((x) => [x.category, x.re.source, x.re.flags])
    expect(shape(srv.AUDIT_TAXONOMY)).toEqual(shape(cli.AUDIT_TAXONOMY))
    expect(srv.AUDIT_CATEGORIES).toEqual(cli.AUDIT_CATEGORIES)
  })

  it('both sides name the same category and key for real findings from the backlog', () => {
    const real = [
      { rule: 'loading-status-missing', title: 'Screen reader hears nothing while the leaderboard loads' },
      { rule: 'error-shown-as-empty', title: 'A failed load says nobody has opened the link' },
      { rule: 'subcent-cost-shows-zero', title: 'Tiny costs show as $0.00' },
      { rule: 'breadcrumb-hover-only-link', title: 'Breadcrumb links show no underline until hover' },
      { rule: 'wrong-horse-tone', title: 'Horse is marked as the high tone' },
    ]
    for (const f of real) {
      expect(srv.auditCategory(f)).toBe(cli.auditCategory(f))
      expect(srv.auditPatternKey(srv.auditCategory(f), 'app/x.tsx', f.rule)).toBe(cli.auditPatternKey(cli.auditCategory(f), 'app/x.tsx', f.rule))
    }
    expect(srv.auditCategory(real[2]!)).toBe('wrong-number')
  })
})

const body = (over: Record<string, unknown> = {}) => ({
  title: 'Screen reader hears nothing while Events loads',
  severity: 'medium',
  file: 'app/events/loading.tsx',
  line: 7,
  rule: 'loading-status-missing',
  evidenceLine: '<div className="flex">',
  userImpact: 'A screen reader user hears nothing while Events loads.',
  fix: 'Wrap it in RouteLoadingShell.',
  doneWhen: 'A screen reader announces that Events is loading.',
  check: { kind: 'pattern', summary: '/aria-live/ is absent in app/events/loading.tsx near line 7' },
  screen: 'app/events/loading.tsx',
  proposedBy: null,
  vetoBy: null,
  ...over,
})

describe('a finding carries its confidence and root', () => {
  it('an older worker sends neither: no confidence, the file is the root', () => {
    const p = parseAuditFinding(body())
    expect(p.ok && p.value).toMatchObject({ confidence: null, rootFile: 'app/events/loading.tsx' })
    expect(p.ok && auditConfidenceRefusal(p.value)).toBeNull()
  })

  it('takes a route-kind root and a confidence from 0 to 1; refuses anything else', () => {
    const p = parseAuditFinding(body({ confidence: 0.834, rootFile: 'app/**/loading.tsx' }))
    expect(p.ok && p.value).toMatchObject({ confidence: 0.83, rootFile: 'app/**/loading.tsx' })
    expect(parseAuditFinding(body({ rootFile: 'components/route-loading-shell.tsx' })).ok).toBe(true)
    for (const rootFile of ['../x.tsx', '/etc/passwd', 'app/**/../x.tsx', '**/x.tsx', 'a/*/b.tsx']) expect(parseAuditFinding(body({ rootFile })).ok, rootFile).toBe(false)
    for (const confidence of [-0.1, 1.5, '0.9', Number.NaN]) expect(parseAuditFinding(body({ confidence })).ok, String(confidence)).toBe(false)
  })

  it('a finding its model rated under 0.6 is refused', () => {
    const p = parseAuditFinding(body({ confidence: 0.59 }))
    expect(p.ok && auditConfidenceRefusal(p.value)).toMatch(/below 0.6/)
  })
})

describe('the open cap, the score, the screens and the recheck clock', () => {
  it('the cap defaults to 25 and ignores a value out of range', () => {
    expect(DEFAULT_CODE_AUDIT_OPEN_CAP).toBe(25)
    expect([codeAuditOpenCap(10), codeAuditOpenCap(null), codeAuditOpenCap(0), codeAuditOpenCap(501), codeAuditOpenCap('7')]).toEqual([10, 25, 25, 25, 7])
    // A fix in flight still holds its slot.
    expect(CODE_AUDIT_OPEN_STATUSES).toContain('fixing')
  })

  it('ranks by severity × confidence; no confidence counts as 0.7', () => {
    expect(auditFindingScore({ severity: 'high', confidence: 0.8 })).toBe(2.4)
    expect(auditFindingScore({ severity: 'low', confidence: 1 })).toBe(1)
    expect(auditFindingScore({ severity: 'medium', confidence: null })).toBe(1.4)
  })

  it('counts a screen once per file and line, newest last, at most 50', () => {
    const s = (file: string, line = 1) => ({ screen: file, file, line, title: 't', at: 'now' })
    expect(appendAffectedScreen([s('a'), s('b')], s('a')).map((x) => x.file)).toEqual(['b', 'a'])
    expect(appendAffectedScreen(null, s('a'))).toHaveLength(1)
    expect(appendAffectedScreen(Array.from({ length: 60 }, (_, i) => s(`f${i}`)), s('new'))).toHaveLength(50)
  })

  it('a recheck is due when it never ran or ran 20 hours ago or more', () => {
    const now = new Date('2026-11-21T12:00:00Z')
    expect(auditRecheckDue(null, now)).toBe(true)
    expect(auditRecheckDue('garbage', now)).toBe(true)
    expect(auditRecheckDue('2026-11-20T16:00:00Z', now)).toBe(true)
    expect(auditRecheckDue('2026-11-21T00:00:00Z', now)).toBe(false)
  })
})

describe('grouping that merges', () => {
  const open = (id: string, similarity: number, over: Record<string, unknown> = {}) => ({ id, similarity, status: 'classified', parent_report_id: null, ...over })
  const audit = { id: 'new', source: 'code_audit', status: 'classified', parent_report_id: null }

  it('an automated report becomes the duplicate child of the most similar open report above the floor', () => {
    expect(AUTO_MERGE_MIN_SIMILARITY).toBeGreaterThan(0.82)
    expect(pickDuplicateParent(audit, [open('a', 0.91), open('b', 0.97)], 0.82)?.id).toBe('b')
    // Above the grouping threshold but below the merge floor: grouped only.
    expect(pickDuplicateParent(audit, [open('a', 0.86)], 0.82)).toBeNull()
    // A project that set a stricter threshold keeps it.
    expect(pickDuplicateParent(audit, [open('a', 0.93)], 0.95)).toBeNull()
  })

  it('never a closed parent, a child as parent, itself, or a report that is already a child', () => {
    expect(pickDuplicateParent(audit, [open('a', 0.99, { status: 'fixed' }), open('b', 0.99, { parent_report_id: 'x' }), open('new', 1)], 0.82)).toBeNull()
    expect(pickDuplicateParent({ ...audit, parent_report_id: 'p' }, [open('a', 0.99)], 0.82)).toBeNull()
    expect(pickDuplicateParent({ ...audit, status: 'dismissed' }, [open('a', 0.99)], 0.82)).toBeNull()
  })

  it("a person's report is never closed as a duplicate", () => {
    for (const source of ['widget', 'sdk', 'api', 'sentry', null]) expect(pickDuplicateParent({ ...audit, source }, [open('a', 0.99)], 0.82)).toBeNull()
  })

  it('the parent counts its duplicates', () => {
    expect(withDuplicateCounted({ duplicate_count: 2, duplicate_ids: ['x', 'y'], rule: 'r' }, 'z')).toEqual({ duplicate_count: 3, duplicate_ids: ['x', 'y', 'z'], rule: 'r' })
    expect(withDuplicateCounted(null, 'z')).toEqual({ duplicate_count: 1, duplicate_ids: ['z'] })
  })
})

describe('a rejected fix', () => {
  it("of Mushi's own finding leaves the queue as triaged and counts the rejection", () => {
    const first = closedUnmergedReportStatus({ source: 'code_audit', custom_metadata: { rule: 'r' } }, { pr_url: 'https://github.com/x/y/pull/9' }, '2026-11-21T00:00:00Z')
    expect(first).toEqual({ status: 'triaged', fixRejected: { count: 1, pr_url: 'https://github.com/x/y/pull/9', at: '2026-11-21T00:00:00Z' } })
    const second = closedUnmergedReportStatus({ source: 'site_audit', custom_metadata: { fix_rejected: { count: 1, rechecked: { sha: 'a' } } } }, { pr_url: null }, 'later')
    expect(second.fixRejected).toEqual({ count: 2, pr_url: null, at: 'later' })
  })

  it("of a person's report goes back to classified, never to new", () => {
    for (const source of ['widget', 'sentry', null]) expect(closedUnmergedReportStatus({ source }, { pr_url: null }, 'now')).toEqual({ status: 'classified', fixRejected: null })
  })
})

describe('open counts from people and from checks', () => {
  it('the automated sources are the console source kinds check and task', () => {
    expect(AUTOMATED_REPORT_SOURCES).toContain('code_audit')
    expect(AUTOMATED_REPORT_SOURCES).toContain('sdk_health')
    for (const s of ['widget', 'sdk', 'api', 'sentry', 'cloudwatch', 'store_review']) expect(isAutomatedReportSource(s), s).toBe(false)
  })

  it('the digest says how many open reports came from people', () => {
    expect(openText({ openReports: 12 })).toBe('12 open')
    expect(openText({ openReports: 43, openFromPeople: 3, openAutomated: 40 })).toBe('3 open from people, 40 automated')
  })
})
