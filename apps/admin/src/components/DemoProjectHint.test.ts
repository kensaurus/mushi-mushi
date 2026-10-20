import { describe, expect, it } from 'vitest'
import { pickDemoProject } from './DemoProjectHint'

const p = (id: string, name: string, reports: number) => ({ project_id: id, project_name: name, report_count: reports })

describe('pickDemoProject (audit 2026-10-20, Phase 2 empty states)', () => {
  it('offers the demo app when the active app has no reports', () => {
    expect(pickDemoProject([p('a', 'my-app', 0), p('d', 'mushi-demo', 6)], 'a')?.project_id).toBe('d')
  })
  it('stays quiet when the active app already has reports', () => {
    expect(pickDemoProject([p('a', 'my-app', 3), p('d', 'mushi-demo', 6)], 'a')).toBeNull()
  })
  it('stays quiet when the demo app itself is active or has no data', () => {
    expect(pickDemoProject([p('d', 'mushi-demo', 0)], 'd')).toBeNull()
    expect(pickDemoProject([p('a', 'my-app', 0), p('d', 'mushi-demo', 0)], 'a')).toBeNull()
  })
})
