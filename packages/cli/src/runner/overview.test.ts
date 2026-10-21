import { describe, expect, it } from 'vitest'
import { fmtSeconds, renderOverview, type CiOverview } from './overview.js'

const NOW = new Date('2026-10-21T12:00:00Z')

// The shape of packages/server/supabase/functions/_shared/ci-overview-types.ts.
const OVERVIEW: CiOverview = {
  generatedAt: '2026-10-21T12:00:00Z',
  refreshedAt: null,
  window: { days: 7, from: '2026-10-14T12:00:00Z' },
  permissions: { jobs: 'ok', runners: 'missing' },
  hosts: [{
    hostId: 'a'.repeat(64),
    hostname: 'nuc',
    platform: 'linux',
    cpuCount: 8,
    memTotalMb: 16384,
    lastHeartbeatAt: '2026-10-21T11:57:00Z',
    stale: false,
    mushiVersion: '0.33.0',
    metrics: { load1: 6.4, memUsedMb: 14000, swapUsedMb: 2048, swapTotalMb: 4096, diskFreeGb: 80 },
    runners: [{ name: 'nuc-glot', repo: 'kensaurus/glot.it', service: 'x.service', active: true, restarts: 0, memCurrentMb: 5800, memMaxMb: 6144, oomKills: 2 }],
  }, {
    // snake_case rows still render (an older server passed columns through)
    hostname: 'old-nuc',
    platform: 'wsl2',
    last_heartbeat_at: '2026-10-20T12:00:00Z',
    stale: true,
    metrics: { mem_used_mb: 1024 },
    runners: [],
  }],
  runners: [
    { projectId: 'p', repo: 'kensaurus/glot.it', name: 'nuc-glot', status: 'online', busy: true, labels: [], kind: 'self_hosted', hostId: null, lastJobAt: '2026-10-21T11:50:00Z', jobs24h: 9, infraFailures7d: 2 },
    { projectId: 'p', repo: 'kensaurus/api', name: 'old-box', status: 'offline', busy: false, labels: [], kind: 'self_hosted', hostId: null, lastJobAt: null, jobs24h: 0, infraFailures7d: 0 },
  ],
  stats: { queueP50s: 12, queueP95s: 480, durationP50s: 240, durationP95s: 660, passRate: 0.87, infraFailures: 3, codeFailures: 2 },
  advice: [
    { id: 'oom', severity: 'high', title: 'nuc-glot ran out of memory twice', detail: 'Jobs peaked at 6.0 GB of a 6 GB cap.', evidence: '2 OOM kills in 7 days', fix: 'Raise the cap or split the build.' },
    { id: 'queue', severity: 'medium', title: 'Jobs wait 8 min for a runner', detail: '', evidence: 'p95 480 s', fix: 'Add a second runner.' },
    { id: 'cache', severity: 'low', title: 'No dependency cache', detail: '', evidence: '', fix: '' },
    { id: 'cancel', severity: 'low', title: 'No cancel-in-progress', detail: '', evidence: '', fix: '' },
  ],
}

describe('renderOverview', () => {
  const text = renderOverview(OVERVIEW, NOW).join('\n')

  it('shows machines and runners with memory and OOM kills', () => {
    expect(text).toContain('CI over the last 7 day(s)')
    expect(text).toContain('nuc (linux, 8 CPU, 16.0 GB · last heartbeat 3 min ago · load 6.4 · memory 13.7 GB of 16.0 GB · swap 2.0 GB used · 80 GB disk free)')
    expect(text).toMatch(/BUSY\s+nuc-glot\s+kensaurus\/glot\.it\s+\(memory 5\.7 GB of 6\.0 GB · 2 out-of-memory kill\(s\) · last job 10 min ago\)/)
    expect(text).toMatch(/OFFLINE\s+old-box/)
    expect(text).toContain('old-nuc (wsl2 · last heartbeat 24.0 h ago (stale: is the machine off?) · memory 1.0 GB of ?)')
  })

  it('says queue and run times and infra vs code failures in plain words', () => {
    expect(text).toContain('half of jobs started within 12 s, 95% within 8 min')
    expect(text).toContain('half finished within 4 min, 95% within 11 min')
    expect(text).toContain('3 where the test machine stopped (your fix was not tested), 2 in your code. Pass rate 87%.')
    expect(text).toContain('needs the Administration: read permission')
  })

  it('shows the top three pieces of advice with their fix', () => {
    expect(text).toContain('HIGH   nuc-glot ran out of memory twice')
    expect(text).toContain('MEDIUM Jobs wait 8 min for a runner')
    expect(text).toContain('Fix: Raise the cap or split the build.')
    expect(text).toContain('…and 1 more')
    expect(text).not.toContain('No cancel-in-progress')
  })

  it('explains an empty overview', () => {
    const empty = renderOverview({ window: 7, hosts: [], runners: [], stats: null, advice: [] }, NOW).join('\n')
    expect(empty).toContain('No machine has sent a heartbeat')
    expect(empty).toContain('No runner seen')
    expect(empty).toContain('No advice')
    expect(empty).toContain('within unknown')
  })

  it('formats seconds', () => {
    expect(fmtSeconds(45)).toBe('45 s')
    expect(fmtSeconds(600)).toBe('10 min')
    expect(fmtSeconds(3 * 3600)).toBe('3.0 h')
    expect(fmtSeconds(null)).toBe('unknown')
  })
})
