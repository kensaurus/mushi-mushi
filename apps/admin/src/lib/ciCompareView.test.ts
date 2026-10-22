/**
 * /ci "Cost and speed" helpers: money and labels, rows per repo, the
 * "why it costs what it costs" facts, and the Settings → CI cost draft
 * (bounds, the machines text with optional watts, the PUT body).
 */
import { describe, expect, it } from 'vitest'
import { ciCompareFixture, costSettingsFixture, ORG_ID } from '../components/ci/__fixtures__/ciCompare'
import {
  costFacts,
  costSettingsBody,
  costText,
  draftFromCostSettings,
  formatDelta,
  formatMoney,
  groupRowsByRepo,
  parseMachines,
  runsOnText,
  validateCostDraft,
} from './ciCompareView'

const BOUNDS = {
  watts: { min: 0, max: 5000 },
  pricePerKwh: { min: 0, max: 1000 },
  wearPerHour: { min: 0, max: 10000 },
  fxPerUsd: { min: 0.0001, max: 100000 },
  includedMinutes: { min: 0, max: 1000000 },
  selfHostedFeePerMinuteUsd: { min: 0, max: 1 },
}

describe('money and labels', () => {
  it('formats money in the settings currency, tiny amounts and deltas', () => {
    expect(formatMoney(61.37)).toBe('$61.37')
    expect(formatMoney(31, 'JPY')).toBe('¥31')
    expect(formatMoney(0.004)).toBe('< $0.01')
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(5, 'NOPE')).toBe('$5.00')
    expect(formatDelta(-54.1)).toBe('−$54.10')
    expect(formatDelta(0.45)).toBe('+$0.45')
  })

  it('says where a row runs', () => {
    const rows = ciCompareFixture().rows
    expect(runsOnText(rows[0])).toEqual({ title: 'GitHub-hosted', detail: 'ubuntu-latest' })
    expect(runsOnText(rows[1])).toEqual({ title: 'Your machine: Alienware', detail: 'aw-tsumagoi · kensaurus-local' })
    expect(runsOnText(rows[3])).toEqual({ title: 'Never picked up', detail: 'Waiting for “kensaurus-local”' })
    expect(runsOnText({ ...rows[0], os: 'macos' }).title).toBe('GitHub-hosted macOS')
  })

  it('explains each cost basis', () => {
    const rows = ciCompareFixture().rows
    expect(costText(rows[2])).toMatchObject({ text: 'Free' })
    expect(costText(rows[0])).toMatchObject({ text: '$61.37' })
    expect(costText({ ...rows[0], monthCost: 0 }).note).toMatch(/included minutes/)
    expect(costText({ ...rows[0], costBasis: 'github_larger_unpriced' }).text).toBe('Not priced')
    expect(costText(rows[3]).text).toBe('—')
  })
})

describe('groupRowsByRepo', () => {
  it('puts the most expensive repo first, GitHub-hosted before your machines', () => {
    const groups = groupRowsByRepo(ciCompareFixture())
    expect(groups.map((g) => g.repo)).toEqual(['kensaurus/tsumagoi', 'kensaurus/glot.it', 'kensaurus/mushi-mushi'])
    expect(groups[0]).toMatchObject({ visibility: 'private', projectName: 'tsumagoi' })
    expect(groups[0].monthCost).toBeCloseTo(62.29, 2)
    expect(groups[0].rows.map((r) => r.runnerClass)).toEqual(['github_hosted', 'self_hosted'])
  })
})

describe('costFacts', () => {
  const facts = costFacts(ciCompareFixture())
  const fact = (id: string) => facts.find((f) => f.id === id)!

  it('lists every standing rule, with this window’s evidence where there is some', () => {
    expect(facts.map((f) => f.id)).toEqual(['public_free', 'included_minutes', 'rounding', 'macos', 'reruns', 'pinned', 'always_hosted', 'runner_size', 'expired', 'platform_fee'])
    expect(fact('public_free')).toMatchObject({ applies: true, evidence: 'Public here: kensaurus/mushi-mushi.' })
    expect(fact('included_minutes').evidence).toContain('kensaurus: about 23,352 min a month on private repos, 2,000 included (free), about $128.11 after them.')
    expect(fact('rounding').evidence).toBe('29 jobs under 20 s on paid runners ran 3.2 min and billed 29 min.')
    expect(fact('macos')).toMatchObject({ title: 'macOS minutes cost about 10.3× Linux', applies: false })
    expect(fact('reruns').evidence).toContain('77 re-run jobs on paid GitHub runners (300 min billed); 80 on your machines.')
    expect(fact('pinned').items?.[0]).toMatchObject({ note: '“TBT budgets failed every PR on the shared machine”' })
    expect(fact('always_hosted').items?.[0]).toMatchObject({ note: 'main and Dependabot' })
    expect(fact('runner_size').detail).toContain('2 CPUs and 8 GB on a private repository, 4 CPUs and 16 GB on a public one')
    expect(fact('expired').evidence).toBe('202 jobs expired waiting for a runner.')
    expect(fact('platform_fee').evidence).toContain('$6.50 a month')
  })

  it('says so when nothing applies', () => {
    const empty = costFacts(ciCompareFixture({
      repos: [], rows: [], accounts: [],
      explain: { ...ciCompareFixture().explain, pinned: [], alwaysHosted: [], tinyJobs: { jobs: 0, billedMinutes: 0, rawMinutes: 0 }, reruns: { hostedJobs: 0, hostedBilledMinutes: 0, selfHostedJobs: 0 }, queueExpired: { jobs: 0 }, platformFeeWhatIf: { perMinuteUsd: 0.002, monthCost: 0 } },
    }))
    expect(empty.filter((f) => f.applies)).toEqual([])
    expect(empty.find((f) => f.id === 'pinned')!.evidence).toMatch(/No pinned job/)
  })
})

describe('Settings → CI cost draft', () => {
  it('round-trips settings, machines with their own watts included', () => {
    const s = costSettingsFixture({ machines: [{ name: 'Alienware', runners: ['aw-', 'alienware-'], wattsIdle: 40, wattsLoad: 250 }, { name: 'NUC', runners: ['kensaurus-local-'] }] })
    const d = draftFromCostSettings(s)
    expect(d.machines).toBe('Alienware (40-250 W): aw-, alienware-\nNUC: kensaurus-local-')
    expect(costSettingsBody(ORG_ID, d)).toMatchObject({
      organizationId: ORG_ID,
      currency: 'USD',
      fxPerUsd: 1,
      machines: [{ name: 'Alienware', runners: ['aw-', 'alienware-'], wattsIdle: 40, wattsLoad: 250 }, { name: 'NUC', runners: ['kensaurus-local-'] }],
    })
  })

  it('refuses bad machine lines', () => {
    expect(parseMachines('Alienware aw-').error).toMatch(/Line 1/)
    expect(parseMachines('A:').error).toMatch(/at least one runner/)
    expect(parseMachines('A: x\na: y').error).toMatch(/listed twice/)
    expect(parseMachines('A (200-100 W): x').error).toMatch(/at least the idle/)
    expect(parseMachines(': x').error).toMatch(/Line 1/)
    expect(parseMachines('\n\n').machines).toEqual([])
  })

  it('validates with the server bounds', () => {
    const ok = draftFromCostSettings(costSettingsFixture())
    expect(validateCostDraft(ok, BOUNDS)).toEqual({})
    expect(validateCostDraft({ ...ok, wattsLoad: '10', wattsIdle: '20' }, BOUNDS)).toEqual({ wattsLoad: 'At least the idle draw.' })
    expect(validateCostDraft({ ...ok, currency: 'yen' }, BOUNDS).currency).toMatch(/3-letter/)
    expect(validateCostDraft({ ...ok, currency: 'JPY', fxPerUsd: '' }, BOUNDS).fxPerUsd).toBe('Enter a number.')
    expect(validateCostDraft({ ...ok, pricePerKwh: '1001' }, BOUNDS).pricePerKwh).toMatch(/Between 0 and 1,000/)
    expect(validateCostDraft({ ...ok, includedMinutes: '2.5' }, BOUNDS).includedMinutes).toBe('Whole minutes.')
    expect(validateCostDraft({ ...ok, selfHostedFeePerMinuteUsd: '2' }, BOUNDS).selfHostedFeePerMinuteUsd).toMatch(/Between 0 and 1/)
    expect(validateCostDraft({ ...ok, machines: 'bad' }, BOUNDS).machines).toMatch(/Line 1/)
  })
})
