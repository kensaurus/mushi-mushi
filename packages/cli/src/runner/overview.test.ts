import { describe, expect, it } from 'vitest'
import { fmtSeconds, renderOverview, type CiOverview } from './overview.js'

const NOW = new Date('2026-10-21T12:00:00Z')

const OVERVIEW: CiOverview = {
  generatedAt: '2026-10-21T12:00:00Z',
  window: { days: 7 },
  permissions: { actionsRead: true, administrationRead: false },
  hosts: [{
    hostname: 'nuc',
    platform: 'linux',
    cpu_count: 8,
    mem_total_mb: 16384,
    last_heartbeat_at: '2026-10-21T11:57:00Z',
    metrics: { load1: 6.4, mem_used_mb: 14000, swap_used_mb: 2048, swap_total_mb: 4096, disk_free_gb: 80 },
    runners: [{ name: 'nuc-glot', repo: 'kensaurus/glot.it', active: true, mem_current_mb: 5800, mem_max_mb: 6144, oom_kills: 2 }],
  }],
  runners: [
    { name: 'nuc-glot', repo: 'kensaurus/glot.it', status: 'online', busy: true, lastJobAt: '2026-10-21T11:50:00Z' },
    { name: 'old-box', repo: 'kensaurus/api', status: 'offline', busy: false },
  ],
  stats: { queueP50s: 12, queueP95s: 480, durationP50s: 240, durationP95s: 660, passRate: 0.87, infraFailures: 3, codeFailures: 2 },
  advice: [
    { id: 'oom', severity: 'error', title: 'nuc-glot ran out of memory twice', detail: 'Jobs peaked at 6.0 GB of a 6 GB cap.', evidence: {}, fix: 'Raise the cap or split the build.' },
    { id: 'queue', severity: 'warn', title: 'Jobs wait 8 min for a runner', fix: 'Add a second runner.' },
    { id: 'cache', severity: 'info', title: 'No dependency cache' },
    { id: 'cancel', severity: 'info', title: 'No cancel-in-progress' },
  ],
}

describe('renderOverview', () => {
  const text = renderOverview(OVERVIEW, NOW).join('\n')

  it('shows machines and runners with memory and OOM kills', () => {
    expect(text).toContain('CI over the last 7 day(s)')
    expect(text).toContain('nuc (linux, 8 CPU, 16.0 GB · last heartbeat 3 min ago · load 6.4 · memory 13.7 GB of 16.0 GB · swap 2.0 GB used · 80 GB disk free)')
    expect(text).toMatch(/BUSY\s+nuc-glot\s+kensaurus\/glot\.it\s+\(memory 5\.7 GB of 6\.0 GB · 2 out-of-memory kill\(s\) · last job 10 min ago\)/)
    expect(text).toMatch(/OFFLINE\s+old-box/)
  })

  it('says queue and run times and infra vs code failures in plain words', () => {
    expect(text).toContain('half of jobs started within 12 s, 95% within 8 min')
    expect(text).toContain('half finished within 4 min, 95% within 11 min')
    expect(text).toContain('3 where the test machine stopped (your fix was not tested), 2 in your code. Pass rate 87%.')
    expect(text).toContain('needs the Administration: read permission')
  })

  it('shows the top three pieces of advice with their fix', () => {
    expect(text).toContain('ERROR nuc-glot ran out of memory twice')
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
