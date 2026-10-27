import { describe, expect, it } from 'vitest'
import { groupCiAdvice } from './ciAdvice'
import type { CiAdvice } from './ciTypes'

const REPO = 'kensaurus/tsumagoi'
const drafts = (path: string, repo = REPO, severity: CiAdvice['severity'] = 'low'): CiAdvice => ({
  id: `drafts_not_skipped:${repo}:.github/workflows/${path}`,
  severity,
  title: 'Draft pull requests run the full CI',
  detail: 'Coding agents open their pull requests as drafts and push to them several times.',
  evidence: `${repo}/.github/workflows/${path} runs on pull_request and never checks the draft flag.`,
  fix: 'Add `types: [opened, synchronize, reopened, ready_for_review]` under `pull_request:`.',
  repo,
})

describe('groupCiAdvice', () => {
  it('folds one rule on several workflows into one card with a chip per workflow and the fix once', () => {
    const groups = groupCiAdvice([drafts('ci-pr.yml'), drafts('pricing-parity.yml'), drafts('mushi-freshness.yml')])
    expect(groups).toHaveLength(1)
    const [g] = groups
    expect(g).toMatchObject({ ruleId: 'drafts_not_skipped', title: 'Draft pull requests run the full CI', severity: 'low', count: 3 })
    expect(g.targets.map((t) => t.label)).toEqual(['ci-pr.yml', 'pricing-parity.yml', 'mushi-freshness.yml'])
    expect(g.targets[0].title).toBe(`${REPO}/.github/workflows/ci-pr.yml`)
    expect(g.fixes).toHaveLength(1)
    expect(g.evidence).toHaveLength(3)
  })

  it('keeps the worst severity, names the repo when the workflows span repos, and sorts worst first', () => {
    const oom: CiAdvice = { id: 'oom_kill:h1:aw-tsumagoi', severity: 'high', title: 'aw-tsumagoi ran out of memory', detail: 'd', evidence: 'e', fix: 'f', runner: 'aw-tsumagoi', hostId: 'h1' }
    const groups = groupCiAdvice([drafts('ci.yml'), drafts('ci.yml', 'kensaurus/glot.it', 'medium'), oom])
    expect(groups.map((g) => g.ruleId)).toEqual(['oom_kill', 'drafts_not_skipped'])
    expect(groups[1].severity).toBe('medium')
    expect(groups[1].targets.map((t) => t.label)).toEqual(['tsumagoi · ci.yml', 'glot.it · ci.yml'])
    expect(groups[0].targets).toEqual([{ key: 'runner:aw-tsumagoi', label: 'aw-tsumagoi', title: 'aw-tsumagoi' }])
  })

  it('keeps rules with different titles apart, and repo-only advice as a repo chip', () => {
    const busy = (repo: string): CiAdvice => ({ id: `single_runner_busy:${repo}`, severity: 'medium', title: `${repo} has one runner and a long queue`, detail: 'd', evidence: 'e', fix: 'f', repo })
    const groups = groupCiAdvice([busy(REPO), busy('kensaurus/glot.it')])
    expect(groups).toHaveLength(2)
    expect(groups[0].targets).toEqual([{ key: `repo:${REPO}`, label: 'tsumagoi', title: REPO }])
  })

  it('splits evidence joined with "; " into lines', () => {
    const slow: CiAdvice = {
      id: 'slow_steps',
      severity: 'low',
      title: 'Where your CI spends its time',
      detail: 'd',
      evidence: `${REPO} · build · pnpm install: 3 min (12 runs); ${REPO} · e2e · playwright: 9 min (4 runs)`,
      fix: 'f',
      repo: REPO,
    }
    expect(groupCiAdvice([slow])[0].evidence).toEqual([`${REPO} · build · pnpm install: 3 min (12 runs)`, `${REPO} · e2e · playwright: 9 min (4 runs)`])
  })

  it('is empty for no advice', () => {
    expect(groupCiAdvice([])).toEqual([])
  })

  it('lists one "Open fix PR" target per workflow that carries an autofix, with its saving', () => {
    const P = 'p1'
    const fixable = (path: string, repo = REPO, saving: number | null = 2.5): CiAdvice => ({
      ...drafts(path, repo),
      monthSavingUsd: saving,
      autofix: { kind: 'skip_drafts', projectId: P, repo, workflowPath: `.github/workflows/${path}` },
    })
    const [g] = groupCiAdvice([fixable('ci.yml'), fixable('ci.yml'), drafts('nightly.yml'), fixable('e2e.yml', REPO, null)])
    expect(g.count).toBe(4)
    expect(g.fixable.map((f) => [f.label, f.monthSavingUsd])).toEqual([['ci.yml', 2.5], ['e2e.yml', null]])
    expect(g.fixable[0].autofix).toEqual({ kind: 'skip_drafts', projectId: P, repo: REPO, workflowPath: '.github/workflows/ci.yml' })
    expect(g.fixable[0].evidence).toContain('never checks the draft flag')
    const across = groupCiAdvice([fixable('ci.yml'), fixable('ci.yml', 'kensaurus/glot.it')])[0]
    expect(across.fixable.map((f) => f.label)).toEqual(['tsumagoi · ci.yml', 'glot.it · ci.yml'])
    expect(groupCiAdvice([drafts('ci.yml')])[0].fixable).toEqual([])
  })
})
