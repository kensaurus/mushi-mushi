import { describe, expect, it } from 'vitest'
import { CI_NODE_SIZE, GITHUB_HOST_ID, UNKNOWN_HOST_ID, buildCiMap, type CiHostNodeData, type CiRunnerNodeData } from './ciMapLayout'
import { FIXTURE_JOBS, FIXTURE_NOW, ciOverviewFixture, emptyCiOverview } from './__fixtures__/ciOverview'
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

  it('collapses GitHub-hosted runners into one node linked to their repos', () => {
    expect(node('runner:GitHub Actions 2')).toBeUndefined()
    expect((node(GITHUB_HOST_ID)!.data as CiHostNodeData).title).toBe('GitHub-hosted')
    expect(edge(GITHUB_HOST_ID, 'repo:kensaurus/mushi-mushi')).toBeDefined()
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
