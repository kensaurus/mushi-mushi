import { describe, expect, it } from 'vitest'
import { capCandidates, collapseGroups, collapseRevertSql, goneNote, parseAuditCheck, planBacklog, recheckReport, verdictCommits } from './work-recheck.js'

/** The description shape the server writes for a code-audit finding (_shared/work-modes.ts). */
const desc = (summary: string) =>
  `What the user sees: the chip overflows.\nFix: truncate it.\nDone when: it fits.\n\nReproduced by the worker with no model: pattern check, ${summary}\nFound by the code-read audit of /home on the local worker lane glot-audit.`

describe('parseAuditCheck', () => {
  it('reads back the check the audit filed', () => {
    expect(parseAuditCheck(desc('/inline-flex min-w-0 truncate/ is present in app/_components/chip.tsx near line 111'))).toEqual({
      kind: 'pattern',
      regex: 'inline-flex min-w-0 truncate',
      ignoreCase: false,
      expect: 'present',
      file: 'app/_components/chip.tsx',
      line: 111,
    })
    expect(parseAuditCheck(desc('/aria-label/i is absent in src/a.tsx'))).toMatchObject({ regex: 'aria-label', ignoreCase: true, expect: 'absent', line: null })
  })

  it('keeps slashes inside the pattern, and never one from earlier text', () => {
    expect(parseAuditCheck(desc('/href="\\/features"/ is present in app/nav.tsx near line 4'))?.regex).toBe('href="\\/features"')
    const withUrl = `See https://example.com/a/b for details. Reproduced by the worker with no model: pattern check, /role="status"/ is absent in app/x.tsx near line 2`
    expect(parseAuditCheck(withUrl)?.regex).toBe('role="status"')
  })

  it('refuses a missing, cut-short, unsafe or out-of-tree check', () => {
    expect(parseAuditCheck(null)).toBeNull()
    expect(parseAuditCheck('A user wrote: /x/ is absent in README.md')).toBeNull()
    expect(parseAuditCheck(desc(`/${'a'.repeat(290)}/ is present in src/a.tsx`))).toBeNull()
    expect(parseAuditCheck(desc('/(a+)+$/ is present in src/a.tsx'))).toBeNull()
    expect(parseAuditCheck(desc('/x/ is present in ../etc/passwd'))).toBeNull()
  })
})

describe('recheckReport', () => {
  const report = { source: 'code_audit', description: desc('/ChevronRight/ is present in app/rows.tsx near line 3') }
  const file = (text: string | null) => () => text

  it('closes nothing that a person reported', () => {
    expect(recheckReport({ ...report, source: 'widget' }, '/wt', file(''))).toEqual({ gone: false, reason: null })
  })

  it('is gone only when the file is there and the check no longer holds', () => {
    expect(recheckReport(report, '/wt', file('a\nb\n<ChevronRight />\nd')).gone).toBe(false)
    const gone = recheckReport(report, '/wt', file('a\nb\n<ChevronDown />\nd'))
    expect(gone.gone).toBe(true)
    expect(gone.reason).toContain('no longer reproduces')
  })

  it('leaves a moved file or an unreadable check to the agent', () => {
    const moved = recheckReport(report, '/wt', file(null))
    expect(moved.gone).toBe(false)
    expect(moved.reason).toContain('not in the base branch')
    expect(recheckReport({ source: 'code_audit', description: 'no check here' }, '/wt', file('x')).gone).toBe(false)
  })

  it('never calls a problem gone when the code only moved further down the file', () => {
    const far = Array.from({ length: 20 }, (_, i) => (i === 15 ? '<ChevronRight />' : 'x')).join('\n')
    // 13 lines from the cited line 3: outside the audit window, but still in the file (2026-11-12: 93 such false "gone").
    const moved = recheckReport(report, '/wt', file(far))
    expect(moved.gone).toBe(false)
    expect(moved.reason).toContain('moved')
  })

  it('an absent check is gone once the wanted text is back near the cited line', () => {
    const absent = { source: 'code_audit', description: desc('/role="status"/ is absent in app/loading.tsx near line 2') }
    expect(recheckReport(absent, '/wt', file('<div>\n<p role="status">\n</div>')).gone).toBe(true)
    expect(recheckReport(absent, '/wt', file('<div>\n<p>\n</div>')).gone).toBe(false)
  })
})

describe('verdictCommits and goneNote', () => {
  it('finds commit ids, not plain numbers or words', () => {
    expect(verdictCommits('already fixed in db4c8383a ("release batch") and 1a2b3c4d; issue 1234567')).toEqual(['db4c8383a', '1a2b3c4d'])
    expect(verdictCommits('nothing here')).toEqual([])
  })

  it('says how it knows and how to undo it', () => {
    const note = goneNote('its own check no longer reproduces', 'origin/main', 'db4c8383a0123')
    expect(note).toContain('without an agent run')
    expect(note).toContain('origin/main at db4c8383a')
    expect(note).toContain('Reopen')
  })
})

/** A tiny clone at the default branch, read the way recheckReport reads a worktree. */
const tree = (files: Record<string, string>) => (p: string) => files[p.split(String.fromCharCode(92)).join('/').replace(/^\/wt\//, '')] ?? null

describe('a shared wrapper holds what an absent check missed (ADR 0063)', () => {
  const files = {
    'components/route-loading-shell.tsx': ['export function RouteLoadingShell({ children }) {', '  return <>{children}<div role="alert" aria-live="assertive" /></>', '}'].join('\n'),
    'app/pricing/loading.tsx': [
      'import { RouteLoadingShell } from "@/components/route-loading-shell"',
      'export default function L() {',
      '  return (',
      '    <RouteLoadingShell>',
      '      <h1 className="sr-only">Pricing</h1>',
      '    </RouteLoadingShell>',
      '  )',
      '}',
    ].join('\n'),
    'app/chat/loading.tsx': ['export default function L() {', '  return (', '    <div className="flex">', '      <h1 className="sr-only">Chat</h1>', '    </div>', '  )', '}'].join('\n'),
  }
  const at = (file: string, line: number) => ({ source: 'code_audit', description: desc(`/aria-busy|aria-live|role="status"/ is absent in ${file} near line ${line}`) })

  // ADR 0065: the shell has aria-live, and its region stays empty until a 10 s timeout. Having the attribute is not the fix.
  it('pricing is never closed by the shell having the pattern: it is re-rooted at the shell', () => {
    expect(recheckReport(at('app/pricing/loading.tsx', 5), '/wt', tree(files))).toEqual({ gone: false, reason: null, root: 'components/route-loading-shell.tsx' })
  })

  it('every screen inside the shell collapses into one parent rooted at the shell', () => {
    const shellFiles = { ...files, 'app/learn/loading.tsx': files['app/pricing/loading.tsx']!.replace('Pricing', 'Learn') }
    const row = (id: string, file: string) => ({
      id,
      source: 'code_audit',
      status: 'classified',
      severity: 'medium',
      title: 'Screen reader hears nothing while it loads',
      custom_metadata: { rule: 'loading-status-missing', file, line: 5 },
      description: `Where: ${file}:5\nThe code there: <h1 className="sr-only">x</h1>\nWhat the user sees: A screen reader hears nothing while it loads.\n\nReproduced by the worker with no model: pattern check, /aria-busy|aria-live|role="status"/ is absent in ${file} near line 5\nFound by the code-read audit of ${file} on the local worker lane glot-audit.`,
    })
    const plan = planBacklog([row('p', 'app/pricing/loading.tsx'), row('l', 'app/learn/loading.tsx')], '/wt', tree(shellFiles))
    expect(plan.gone).toEqual([])
    expect(plan.patterns).toEqual([expect.objectContaining({ key: 'a11y-loading-silent:components/route-loading-shell.tsx', reportIds: ['p', 'l'], screens: ['app/learn/loading.tsx', 'app/pricing/loading.tsx'] })])
  })

  it('chat is still there: nothing wraps it', () => {
    expect(recheckReport(at('app/chat/loading.tsx', 4), '/wt', tree(files))).toEqual({ gone: false, reason: null })
  })
})

describe('planBacklog: what a recheck would close and how the rest collapse', () => {
  const finding = (id: string, file: string, line: number, title: string, check: string, over: Record<string, unknown> = {}) => ({
    id,
    project_id: 'p1',
    source: 'code_audit',
    status: 'classified',
    severity: 'medium',
    title,
    created_at: '2026-10-29T06:00:00Z',
    custom_metadata: { rule: 'loading-status-missing', file, line },
    description: [
      title,
      '',
      `Where: ${file}:${line}`,
      'The code there: <div className="flex">',
      'What the user sees: A screen reader hears nothing while it loads.',
      'Fix: x.',
      'Done when: y.',
      '',
      `Reproduced by the worker with no model: pattern check, ${check}`,
      `Found by the code-read audit of ${file} on the local worker lane glot-audit.`,
    ].join('\n'),
    ...over,
  })
  const files = {
    'app/a/loading.tsx': ['<div className="flex">', '<p />', '</div>'].join('\n'),
    'app/b/loading.tsx': ['<div className="flex">', '<p />', '</div>'].join('\n'),
    'app/c/loading.tsx': ['<div className="flex">', '<p role="status" />', '</div>'].join('\n'),
    'app/d/page.tsx': ['<div className="flex">', '<Price value={0} />', '</div>'].join('\n'),
  }
  const absent = (f: string) => `/role="status"/ is absent in ${f} near line 1`

  it('closes what no longer reproduces, and one route-kind pattern keeps one parent for every loading screen', () => {
    const plan = planBacklog(
      [
        finding('r1', 'app/a/loading.tsx', 1, 'Screen reader hears nothing while A loads', absent('app/a/loading.tsx')),
        finding('r2', 'app/b/loading.tsx', 1, 'Screen reader hears nothing while B loads', absent('app/b/loading.tsx'), { severity: 'high' }),
        finding('r3', 'app/c/loading.tsx', 1, 'Screen reader hears nothing while C loads', absent('app/c/loading.tsx')),
        finding('r4', 'app/d/page.tsx', 2, 'Total shows 0 while the price loads', '/Price value/ is present in app/d/page.tsx near line 2', {
          custom_metadata: { rule: 'zero-total', file: 'app/d/page.tsx', line: 2 },
        }),
        { id: 'w1', source: 'widget', title: 'A person wrote this' },
      ],
      '/wt',
      tree(files),
    )
    expect(plan.checked).toBe(4)
    expect(plan.gone.map((g) => g.reportId)).toEqual(['r3'])
    const loading = plan.patterns.find((p) => p.key === 'a11y-loading-silent:app/**/loading.tsx')
    // The most severe is the parent.
    expect(loading).toMatchObject({ parentId: 'r2', reportIds: ['r2', 'r1'], screens: ['app/a/loading.tsx', 'app/b/loading.tsx'] })
    expect([plan.remaining, plan.collapsed]).toEqual([2, 1])
  })
})

describe('collapseGroups and its revert (mushi work --collapse-backlog)', () => {
  const shell = ['export function RouteLoadingShell({ children }) {', '  return <>{children}<div role="alert" aria-live="assertive" /></>', '}'].join('\n')
  const page = (name: string) =>
    [
      'import { RouteLoadingShell } from "@/components/route-loading-shell"',
      'export default function L() {',
      '  return (',
      '    <RouteLoadingShell>',
      `      <h1 className="sr-only">${name}</h1>`,
      '    </RouteLoadingShell>',
      '  )',
      '}',
    ].join('\n')
  const files = { 'components/route-loading-shell.tsx': shell, 'app/a/loading.tsx': page('A'), 'app/b/loading.tsx': page('B'), 'app/c/loading.tsx': page('C') }
  const row = (id: string, file: string, status: string, severity = 'medium') => ({
    id,
    source: 'code_audit',
    status,
    severity,
    title: `Screen reader hears nothing while ${id} loads`,
    created_at: '2026-10-29T06:00:00Z',
    custom_metadata: { rule: 'loading-status-missing', file, line: 5 },
    description: [
      `Where: ${file}:5`,
      'The code there: <h1 className="sr-only">x</h1>',
      'What the user sees: A screen reader hears nothing while it loads.',
      '',
      `Reproduced by the worker with no model: pattern check, /aria-busy|aria-live|role="status"/ is absent in ${file} near line 5`,
      `Found by the code-read audit of ${file} on the local worker lane glot-audit.`,
    ].join('\n'),
  })

  it('one group per pattern; a report with a live PR is the parent and never a child; the title names the shared root', () => {
    const rows = [row('a', 'app/a/loading.tsx', 'classified', 'high'), row('b', 'app/b/loading.tsx', 'fixing'), row('c', 'app/c/loading.tsx', 'triaged')]
    const groups = collapseGroups(planBacklog(rows, '/wt', tree(files)), rows)
    expect(groups).toEqual([
      {
        parentId: 'b',
        patternKey: 'a11y-loading-silent:components/route-loading-shell.tsx',
        title: 'Screen readers hear nothing while it loads in components/route-loading-shell.tsx (3 screens)',
        screens: expect.arrayContaining([expect.objectContaining({ screen: 'app/a/loading.tsx', file: 'app/a/loading.tsx', line: 5 })]),
        childIds: ['a', 'c'],
      },
    ])
    expect(groups[0]!.screens).toHaveLength(3)
  })

  it('a pattern of one report leaves nothing to close', () => {
    const one = [row('a', 'app/a/loading.tsx', 'classified')]
    expect(collapseGroups(planBacklog(one, '/wt', tree(files)), one)).toEqual([])
  })

  it('the revert is one UPDATE on the tag (collapse and cap) and one DELETE of what it set aside, in a transaction', () => {
    const sql = collapseRevertSql('collapse_2026_11_21')
    expect(sql.match(/^update public\.reports set/gm)).toHaveLength(1)
    for (const col of ['status', 'closed_reason', 'parent_report_id', 'title', 'pattern_key', 'affected_screens', 'custom_metadata']) expect(sql).toMatch(new RegExp(`^  ${col} = `, 'm'))
    expect(sql).toContain("where source = 'code_audit' and (custom_metadata->'collapse'->>'tag' = 'collapse_2026_11_21' or custom_metadata->'cap'->>'tag' = 'collapse_2026_11_21');")
    expect(sql).toContain("delete from public.code_audit_deferred where finding->>'collapse_tag' = 'collapse_2026_11_21';")
    expect(sql.startsWith('begin;') && sql.endsWith('commit;')).toBe(true)
    // A tag can never break out of its quotes.
    expect(collapseRevertSql("collapse_x'; drop table reports; --")).toContain("= 'collapse_xdroptablereports'")
  })

  it('--apply-cap sends every report the collapse leaves open, with the finding it would wait as', () => {
    const rows = [row('a', 'app/a/loading.tsx', 'classified', 'high'), row('b', 'app/b/loading.tsx', 'fixing'), row('c', 'app/c/loading.tsx', 'triaged')]
    const plan = planBacklog(rows, '/wt', tree(files))
    const groups = collapseGroups(plan, rows)
    const out = capCandidates(plan, rows, groups, '/wt', tree(files))
    // a and c close as duplicates of b; b is the one left open.
    expect(out.map((c) => c.reportId)).toEqual(['b'])
    expect(out[0]!.finding).toMatchObject({
      title: 'Screen reader hears nothing while b loads',
      severity: 'medium',
      file: 'app/b/loading.tsx',
      line: 5,
      rule: 'loading-status-missing',
      evidenceLine: '<h1 className="sr-only">x</h1>',
      check: { kind: 'pattern', summary: '/aria-busy|aria-live|role="status"/ is absent in app/b/loading.tsx near line 5' },
      screen: 'app/b/loading.tsx',
      rootFile: 'components/route-loading-shell.tsx',
      confidence: null,
    })
  })

  it('--apply-cap leaves out a report it cannot rebuild a finding for (the server keeps it open)', () => {
    const broken = { ...row('x', 'app/a/loading.tsx', 'classified'), description: 'no structure here' }
    const plan = planBacklog([broken], '/wt', tree(files))
    expect(capCandidates(plan, [broken], [], '/wt', tree(files))).toEqual([])
  })
})
