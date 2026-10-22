import { describe, expect, it } from 'vitest'
import { ciOverviewFixture } from '../components/ci/__fixtures__/ciOverview'
import type { CiOverview } from './ciTypes'
import type { VerifySettingsValues } from './verifyTypes'
import {
  GATE_STATUS_META,
  autoMergeView,
  draftFromSettings,
  gateStatusMeta,
  gatesSummary,
  isMushiVerifyJob,
  normalizeRegression,
  normalizeVerification,
  regressionLabel,
  revertLine,
  runnerLabelError,
  runnerLabelSuggestions,
  serverFieldErrors,
  validateVerifyDraft,
  valuesFromDraft,
  verifySettingsPatch,
} from './verifyView'

const SAVED: VerifySettingsValues = {
  verified_auto_merge: false,
  verified_auto_merge_daily_limit: 5,
  verify_runs_on: ['ubuntu-latest'],
  verify_test_command: null,
  verify_max_files: 3,
  verify_max_lines: 150,
  verify_protected_globs: [],
  verify_second_judge: 'auto',
  verify_second_judge_model: null,
  auto_revert: 'pr',
}

describe('gate status meta', () => {
  it('gives every status a glyph and a word, never colour alone', () => {
    for (const meta of Object.values(GATE_STATUS_META)) {
      expect(meta.glyph.length).toBeGreaterThan(0)
      expect(meta.word.length).toBeGreaterThan(0)
    }
    expect(new Set(Object.values(GATE_STATUS_META).map((m) => m.glyph)).size).toBe(5)
    expect(new Set(Object.values(GATE_STATUS_META).map((m) => m.word)).size).toBe(5)
    expect(gateStatusMeta('not_set_up').word).toBe('Not set up')
    expect(gateStatusMeta('mystery').word).toBe('Unknown')
  })

  it('summarises the checklist', () => {
    expect(gatesSummary([])).toBe('No checks yet')
    expect(gatesSummary([{ status: 'pass' }, { status: 'pass' }])).toBe('All 2 checks passed')
    expect(gatesSummary([{ status: 'pass' }, { status: 'fail' }, { status: 'pending' }])).toBe('1 of 3 checks passed')
  })
})

describe('auto-merge and regressions', () => {
  it('says each auto-merge state in words, with the server detail after', () => {
    expect(autoMergeView('merged', null).word).toBe('Merged by Mushi')
    expect(autoMergeView('skipped', 'Daily limit of 5 reached.').sentence).toBe(
      'Every check passed, but Mushi did not merge it. Daily limit of 5 reached.',
    )
    expect(autoMergeView('weird', null).word).toBe('Not merged by Mushi')
  })

  it('names signals and revert outcomes', () => {
    expect(regressionLabel('report_reopened')).toBe('The bug report was reopened')
    expect(regressionLabel('x')).toBe('Something broke after the merge')
    expect(revertLine('not_safe')).toContain('revert by hand')
    expect(revertLine('none')).toBeNull()
  })

  it('reads regression rows in camelCase or snake_case', () => {
    expect(normalizeRegression({ id: 'r1', signal: 'report_reopened', revert_state: 'pr_opened', revert_pr_url: 'https://x/pull/2' })).toEqual({
      id: 'r1',
      signal: 'report_reopened',
      detail: null,
      revertState: 'pr_opened',
      revertPrUrl: 'https://x/pull/2',
      createdAt: null,
    })
    expect(normalizeRegression({ signal: 'ci_failed_on_merge', revertState: 'off' }, 3)?.id).toBe('ci_failed_on_merge-3')
    expect(normalizeRegression({})).toBeNull()
  })

  it('treats a body without gates as no verification', () => {
    expect(normalizeVerification(null)).toBeNull()
    expect(normalizeVerification({ headSha: 'abc' })).toBeNull()
    const v = normalizeVerification({
      headSha: 'abc',
      gates: [{ id: 'ci', status: 'pass', label: 'CI is green', detail: '' }, null],
      passed: false,
      regressions: [{ signal: 'report_reopened' }],
    })
    expect(v?.gates).toHaveLength(1)
    expect(v?.autoMerge).toEqual({ state: 'none', detail: null })
    expect(v?.regressions[0]?.revertState).toBe('none')
  })
})

describe('settings form', () => {
  it('round-trips the saved values and sends only what changed', () => {
    const draft = draftFromSettings(SAVED)
    expect(verifySettingsPatch(valuesFromDraft(draft), SAVED)).toEqual({})
    const next = valuesFromDraft({
      ...draft,
      verified_auto_merge: true,
      verify_runs_on: ['ubuntu-latest', 'nuc'],
      verify_protected_globs: ' supabase/migrations/**\n\n',
      verify_test_command: '  ',
    })
    expect(verifySettingsPatch(next, SAVED)).toEqual({
      verified_auto_merge: true,
      verify_runs_on: ['ubuntu-latest', 'nuc'],
      verify_protected_globs: ['supabase/migrations/**'],
    })
  })

  it('mirrors the server bounds at their edges', () => {
    const ok = draftFromSettings(SAVED)
    expect(validateVerifyDraft(ok)).toEqual({})
    expect(validateVerifyDraft({ ...ok, verified_auto_merge_daily_limit: '50', verify_max_files: '20', verify_max_lines: '10' })).toEqual({})
    const bad = validateVerifyDraft({
      ...ok,
      verified_auto_merge_daily_limit: '51',
      verify_max_files: '0',
      verify_max_lines: '1001',
      verify_test_command: 'pnpm test',
      verify_runs_on: [],
      verify_protected_globs: Array.from({ length: 31 }, (_, i) => `g${i}`).join('\n'),
    })
    expect(bad.verified_auto_merge_daily_limit).toBe('Pick a whole number from 1 to 50.')
    expect(bad.verify_max_files).toBe('Pick a whole number from 1 to 20.')
    expect(bad.verify_max_lines).toBe('Pick a whole number from 10 to 1000.')
    expect(bad.verify_test_command).toContain('{files}')
    expect(bad.verify_runs_on).toContain('at least one')
    expect(bad.verify_protected_globs).toBe('Use at most 30 patterns (31 now).')
    expect(validateVerifyDraft({ ...ok, verify_test_command: `x {files} ${'y'.repeat(300)}` }).verify_test_command).toContain('300 characters')
    expect(validateVerifyDraft({ ...ok, verified_auto_merge_daily_limit: '2.5' }).verified_auto_merge_daily_limit).toBeDefined()
    expect(validateVerifyDraft({ ...ok, verify_runs_on: Array.from({ length: 9 }, (_, i) => `l${i}`) }).verify_runs_on).toContain('at most 8')
  })

  it('checks a runner label before adding it', () => {
    expect(runnerLabelError('alienware-glot-1', [])).toBeNull()
    expect(runnerLabelError('has space', [])).toContain('is not a runner label')
    expect(runnerLabelError('x'.repeat(65), [])).toContain('is not a runner label')
    expect(runnerLabelError('NUC', ['nuc'])).toContain('already in the list')
    expect(runnerLabelError('new', Array.from({ length: 8 }, (_, i) => `l${i}`))).toContain('at most 8')
    expect(runnerLabelError(' ', [])).toBe('Type a runner label first.')
  })

  it('maps zod issues onto form fields', () => {
    expect(
      serverFieldErrors([
        { path: ['verify_max_lines'], message: 'Too big' },
        { path: ['verify_max_lines'], message: 'second' },
        { path: 'verify_runs_on', message: 'Bad label' },
        'junk',
      ]),
    ).toEqual({ verify_max_lines: 'Too big', verify_runs_on: 'Bad label' })
  })
})

describe('runnerLabelSuggestions', () => {
  it("offers self-hosted runners' own labels and names, most used first", () => {
    // nuc-glot (40 jobs): nuc + its name; aw-1 (5); mystery (0). GitHub-hosted and generic labels are left out.
    expect(runnerLabelSuggestions(ciOverviewFixture())).toEqual(['nuc', 'nuc-glot', 'aw-1', 'mystery'])
  })

  it('dedupes case-insensitively, skips picked and invalid labels', () => {
    const overview: Pick<CiOverview, 'runners'> = {
      runners: [
        { projectId: 'p', repo: 'a/b', name: 'alienware-glot-1', status: 'online', busy: false, labels: ['self-hosted', 'LINUX', 'x64', 'Alienware'], kind: 'unknown', hostId: null, lastJobAt: null, jobs24h: 3, infraFailures7d: 0 },
        { projectId: 'p', repo: 'a/c', name: 'alienware-glot-2', status: 'online', busy: false, labels: ['self-hosted', 'alienware'], kind: 'self_hosted', hostId: null, lastJobAt: null, jobs24h: 2, infraFailures7d: 0 },
        { projectId: 'p', repo: 'a/c', name: 'my runner', status: 'online', busy: false, labels: ['self-hosted'], kind: 'self_hosted', hostId: null, lastJobAt: null, jobs24h: 9, infraFailures7d: 0 },
      ],
    }
    expect(runnerLabelSuggestions(overview)).toEqual(['Alienware', 'alienware-glot-1', 'alienware-glot-2'])
    expect(runnerLabelSuggestions(overview, ['ALIENWARE'])).toEqual(['alienware-glot-1', 'alienware-glot-2'])
    expect(runnerLabelSuggestions(null)).toEqual([])
  })
})

describe('isMushiVerifyJob', () => {
  it('matches the job or the workflow name', () => {
    expect(isMushiVerifyJob({ jobName: 'Mushi verify', workflowName: null })).toBe(true)
    expect(isMushiVerifyJob({ jobName: 'verify', workflowName: 'mushi verify ' })).toBe(true)
    expect(isMushiVerifyJob({ jobName: 'build', workflowName: 'CI' })).toBe(false)
  })
})
