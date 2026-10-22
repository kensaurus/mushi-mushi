/**
 * "Where CI runs" helpers (ADR 0037): current placement in words, GitHub-
 * hosted greyed out by the agreement, standby labels never offered, request
 * labels, and the agreement form's text ↔ policy conversion with its checks.
 */
import { describe, expect, it } from 'vitest'
import { placementFixture, policyFixture } from '../components/ci/__fixtures__/ciOverview'
import { currentPlacement, draftFromPolicy, hostedDisabledReason, labelChoices, minutesLeft, parsePolicyDraft, requestSummary, targetLabel } from './ciPlacementView'
import type { PlacementRequestRow } from './ciPlacementTypes'

describe('placement in words', () => {
  it('says where jobs run now, from the variable or its fallback', () => {
    const v = placementFixture().repos[0].variables[0]
    expect(currentPlacement(v)).toEqual({ text: 'GitHub-hosted (ubuntu-24.04): no variable set', kind: 'github_hosted' })
    expect(currentPlacement({ ...v, current: { exists: true, value: 'kensaurus-local', updatedAt: null } })).toEqual({ text: 'Self-hosted: kensaurus-local', kind: 'self_hosted' })
    expect(currentPlacement({ ...v, current: null }).kind).toBe('unknown')
    expect(currentPlacement({ ...v, fallbacks: ['alienware'], current: { exists: false, value: null, updatedAt: null } }).text).toBe('Self-hosted: alienware (no variable set)')
    expect(targetLabel({ kind: 'github_hosted', label: null })).toBe('GitHub-hosted')
  })

  it('greys out GitHub-hosted on a private repo under the agreement, not on public or allowed repos', () => {
    const repo = placementFixture().repos[0]
    expect(hostedDisabledReason(policyFixture(), repo)).toBe('Your CI agreement says no paid GitHub-hosted minutes on private repos (CI-AGREEMENT.md, 2026-10-22).')
    expect(hostedDisabledReason(policyFixture(), { ...repo, visibility: 'public' })).toBeNull()
    expect(hostedDisabledReason(policyFixture(), { ...repo, repo: 'kensaurus/mushi-mushi' })).toBeNull()
    expect(hostedDisabledReason(null, repo)).toBeNull()
    expect(hostedDisabledReason(policyFixture({ noPaidHostedOnPrivate: false }), repo)).toBeNull()
  })

  it('never offers a standby label or a GitHub-hosted label as a self-hosted choice', () => {
    const repo = { ...placementFixture().repos[0], labels: [...placementFixture().repos[0].labels, { label: 'ubuntu-latest', runners: 1, online: 1 }] }
    expect(labelChoices(policyFixture(), repo).map((l) => l.label)).toEqual(['kensaurus-local'])
    expect(labelChoices(null, repo).map((l) => l.label)).toEqual(['kensaurus-local', 'kensaurus-local-yen-yen-1'])
  })

  it('labels requests', () => {
    const r = { status: 'approved', expires_at: '2026-10-22T13:00:00Z', payload: { name: 'LINUX_RUNNER', value: null, revertOf: 'x' } } as unknown as PlacementRequestRow
    expect(requestSummary(r)).toBe('Revert: LINUX_RUNNER removed')
    expect(minutesLeft(r, Date.parse('2026-10-22T12:30:00Z'))).toBe(30)
    expect(minutesLeft({ ...r, status: 'executed' }, 0)).toBeNull()
  })
})

describe('the CI agreement form', () => {
  it('round-trips a policy', () => {
    const d = draftFromPolicy(policyFixture())
    expect(d.externalControllers).toBe('kci dispatcher | sbc-visual | kensaurus/tsumagoi')
    const { body, errors } = parsePolicyDraft(d)
    expect(errors).toEqual({})
    expect(body).toMatchObject({ noPaidHostedOnPrivate: true, hostedAllowedRepos: ['AtPeak-Co-Ltd/pck', 'kensaurus/mushi-mushi'], externalControllers: [{ name: 'kci dispatcher', owner: 'sbc-visual', repos: ['kensaurus/tsumagoi'] }], standbyRunners: ['kensaurus-local-*'], sourceNote: 'CI-AGREEMENT.md, 2026-10-22' })
    expect(draftFromPolicy(null)).toMatchObject({ noPaidHostedOnPrivate: false, hostedAllowedRepos: '' })
  })

  it('explains bad lines', () => {
    const d = draftFromPolicy(null)
    expect(parsePolicyDraft({ ...d, hostedAllowedRepos: 'not a repo' }).errors.hostedAllowedRepos).toMatch(/not owner\/repo/)
    expect(parsePolicyDraft({ ...d, externalControllers: 'dispatcher only' }).errors.externalControllers).toMatch(/Line 1/)
    expect(parsePolicyDraft({ ...d, externalControllers: 'x | y | nope' }).errors.externalControllers).toMatch(/not owner\/repo/)
    expect(parsePolicyDraft({ ...d, standbyRunners: 'bad label!' }).errors.standbyRunners).toMatch(/not a runner name/)
    expect(parsePolicyDraft({ ...d, sourceNote: 'x'.repeat(301) }).errors.sourceNote).toMatch(/300/)
    expect(parsePolicyDraft({ ...d, sourceNote: '  ' }).body.sourceNote).toBeNull()
  })
})
