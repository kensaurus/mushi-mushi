import { describe, expect, it } from 'vitest'
import { CI_NODE_SIZE, buildCiMap, type CiHostNodeData, type CiRunnerNodeData } from './ciMapLayout'
import { GITHUB_HOST_ID, GITHUB_RUNNERS_NAME, UNKNOWN_HOST_ID } from './ciMapContext'
import { FIXTURE_JOBS, FIXTURE_NOW, ciOverviewFixture, emptyCiOverview, oneJobRunnersFixture } from './__fixtures__/ciOverview'
import type { CiJob } from '../../lib/ciTypes'

const map = buildCiMap(ciOverviewFixture(), { now: FIXTURE_NOW })
const node = (id: string) => map.nodes.find((n) => n.id === id)
const edge = (source: string, target: string) => map.edges.find((e) => e.source === source && e.target === target)

describe('buildCiMap', () => {
  it('lays columns out left to right: machines, runners, repos, live jobs', () => {
    const x = (kind: string) => new Set(map.nodes.filter((n) => n.data.kind === kind).map((n) => n.position.x))
    for (const kind of ['host', 'runner', 'repo', 'job']) expect(x(kind).size).toBe(1)
    const [h, r, p, j] = ['host', 'runner', 'repo', 'job'].map((k) => [...x(k)][0])
    expect(h).toBeLessThan(r)
    expect(r).toBeLessThan(p)
    expect(p).toBeLessThan(j)
  })

  it('never overlaps two nodes in a column', () => {
    for (const kind of ['host', 'runner', 'repo', 'job'] as const) {
      const ys = map.nodes.filter((n) => n.data.kind === kind).map((n) => n.position.y).sort((a, b) => a - b)
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(CI_NODE_SIZE[kind].height)
    }
  })

  it('attaches a runner to the machine whose heartbeat lists it', () => {
    expect(edge('host:h-nuc', 'runner:nuc-glot')).toBeDefined()
    expect(edge('host:h-aw', 'runner:aw-1')).toBeDefined()
    const runner = node('runner:nuc-glot')!.data as CiRunnerNodeData
    expect(runner).toMatchObject({ status: 'online', busy: true, restarts: 3, oomKills: 1, memCurrentMb: 9800, memMaxMb: 10240 })
  })

  it('puts runners with no heartbeat on one "Unknown machine"', () => {
    const unknown = node(UNKNOWN_HOST_ID)!.data as CiHostNodeData
    expect(unknown).toMatchObject({ title: 'Unknown machine', variant: 'unknown', runnerCount: 1 })
    expect(edge(UNKNOWN_HOST_ID, 'runner:mystery')).toBeDefined()
  })

  it('collapses GitHub-hosted runners into one runner card, so no edge skips the runner column', () => {
    expect(node('runner:GitHub Actions 2')).toBeUndefined()
    expect((node(GITHUB_HOST_ID)!.data as CiHostNodeData).title).toBe('GitHub-hosted')
    const gh = node(`runner:${GITHUB_RUNNERS_NAME}`)!.data as CiRunnerNodeData
    expect(gh).toMatchObject({ runnerKind: 'github_hosted', repos: ['kensaurus/mushi-mushi'], lastJobAt: '2026-10-21T11:09:00Z' })
    expect(edge(GITHUB_HOST_ID, `runner:${GITHUB_RUNNERS_NAME}`)).toBeDefined()
    expect(edge(`runner:${GITHUB_RUNNERS_NAME}`, 'repo:kensaurus/mushi-mushi')).toBeDefined()
    // Every edge goes one column to the right.
    const col = { host: 0, runner: 1, repo: 2, job: 3 } as const
    for (const e of map.edges) {
      expect(col[node(e.target)!.data.kind] - col[node(e.source)!.data.kind]).toBe(1)
    }
  })

  it("keeps a runner's last job time when GitHub does not list the runner", () => {
    const listless = buildCiMap(ciOverviewFixture({ runners: [], permissions: { jobs: 'ok', runners: 'missing' } }), { now: FIXTURE_NOW })
    const aw = listless.nodes.find((n) => n.id === 'runner:aw-1')!.data as CiRunnerNodeData
    expect(aw.lastJobAt).toBe('2026-10-21T10:30:00Z')
  })

  it('shows only waiting and running jobs, with moving dots into running ones', () => {
    const jobs = map.nodes.filter((n) => n.data.kind === 'job').map((n) => n.id)
    expect(jobs.sort()).toEqual(['job:j1', 'job:j2', 'job:j3', 'job:j4'])
    expect(edge('repo:kensaurus/glot.it', 'job:j1')?.data?.running).toBe(true)
    expect(edge('repo:kensaurus/glot.it', 'job:j2')?.data?.running).toBe(false)
    expect(edge('runner:nuc-glot', 'repo:kensaurus/glot.it')?.data?.running).toBe(true)
  })

  it('caps the live-jobs column', () => {
    const many: CiJob[] = Array.from({ length: 30 }, (_, i) => ({
      ...FIXTURE_JOBS[1],
      id: `q${i}`,
      createdAt: new Date(FIXTURE_NOW - (30 - i) * 60_000).toISOString(),
    }))
    const capped = buildCiMap(ciOverviewFixture({ jobs: many }), { now: FIXTURE_NOW, maxJobs: 20 })
    const jobs = capped.nodes.filter((n) => n.data.kind === 'job')
    expect(jobs).toHaveLength(20)
    // Oldest first: the longest waits make the cut.
    expect(jobs.map((n) => n.id)).toContain('job:q0')
    expect(jobs.map((n) => n.id)).not.toContain('job:q29')
  })

  it('shows one card per one-job runner family, and keeps ordinary runners apart', () => {
    const fam = buildCiMap(oneJobRunnersFixture(), { now: FIXTURE_NOW })
    const runners = fam.nodes.filter((n) => n.data.kind === 'runner').map((n) => n.data as CiRunnerNodeData)
    expect(runners.map((r) => r.name).sort()).toEqual(['alienware-glot-1', 'aw-tsumagoi'])
    const card = runners.find((r) => r.name === 'aw-tsumagoi')!
    expect(card).toMatchObject({
      title: 'aw-tsumagoi · one-job runners',
      oneJob: true,
      members: 3,
      busy: true,
      jobs24h: 3,
      lastJobAt: '2026-10-21T11:56:00Z',
      repos: ['kensaurus/tsumagoi'],
    })
    expect(runners.find((r) => r.name === 'alienware-glot-1')).toMatchObject({ oneJob: false, members: 0, title: 'alienware-glot-1' })
    // The running member makes the family edge carry dots.
    expect(fam.edges.find((e) => e.source === 'runner:aw-tsumagoi' && e.target === 'repo:kensaurus/tsumagoi')?.data?.running).toBe(true)
  })

  it("does not call a family offline because its finished runners are gone", () => {
    const o = oneJobRunnersFixture()
    const idle = buildCiMap({ ...o, jobs: o.jobs.filter((j) => j.id !== 't3'), runners: o.runners.filter((r) => !r.name.endsWith('-7')) }, { now: FIXTURE_NOW })
    const card = idle.nodes.find((n) => n.id === 'runner:aw-tsumagoi')!.data as CiRunnerNodeData
    expect(card).toMatchObject({ busy: false, status: 'unknown', oneJob: true, members: 2 })
  })

  it('returns an empty map for an empty overview', () => {
    const empty = buildCiMap(emptyCiOverview(), { now: FIXTURE_NOW })
    expect(empty.nodes).toEqual([])
    expect(empty.edges).toEqual([])
  })

  it('uses node types registered outside components', () => {
    expect(new Set(map.nodes.map((n) => n.type))).toEqual(new Set(['ci-host', 'ci-runner', 'ci-repo', 'ci-job']))
    expect(new Set(map.edges.map((e) => e.type))).toEqual(new Set(['ciEdge']))
  })
})
