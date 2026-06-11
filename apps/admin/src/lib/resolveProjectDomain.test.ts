import { describe, expect, it } from 'vitest'
import {
  formatHeartbeatOrigin,
  heartbeatTone,
  projectInitials,
  resolveProjectDomain,
  sdkOriginFromSetupProject,
  summarizeProjectHeartbeat,
} from './resolveProjectDomain'
import type { SetupProject } from './useSetupStatus'

describe('resolveProjectDomain', () => {
  it('prefers live SDK origin over slug hints', () => {
    expect(
      resolveProjectDomain({
        project_id: '1',
        project_name: 'glot.it',
        project_slug: 'glot-it',
        sdk_origin: 'https://kensaur.us/glot-it/',
      }),
    ).toBe('kensaur.us')
  })

  it('falls back to slug hints when origin is localhost', () => {
    expect(
      resolveProjectDomain({
        project_id: '2',
        project_name: 'glot.it',
        project_slug: 'glot-it',
        sdk_origin: 'http://localhost:3000',
      }),
    ).toBe('kensaur.us')
  })

  it('falls back to slug hints for yen-yen when origin is absent', () => {
    expect(
      resolveProjectDomain({
        project_id: '3',
        project_name: 'yen-yen',
        project_slug: 'yen-yen',
        sdk_origin: null,
      }),
    ).toBe('kensaur.us')
  })
})

describe('projectInitials', () => {
  it('uses first letters of two word names', () => {
    expect(projectInitials('solo boss')).toBe('SB')
  })
})

describe('sdkOriginFromSetupProject', () => {
  it('reads diagnostic off sdk_installed step', () => {
    const project = {
      steps: [
        {
          id: 'sdk_installed',
          diagnostic: { last_sdk_origin: 'https://app.example.com' },
        },
      ],
    } as unknown as SetupProject
    expect(sdkOriginFromSetupProject(project)).toBe('https://app.example.com')
  })
})

describe('heartbeat helpers', () => {
  it('formats origin host + path', () => {
    expect(formatHeartbeatOrigin('https://kensaur.us/glot-it/')).toBe('kensaur.us/glot-it/')
  })

  it('flags endpoint host mismatch', () => {
    expect(
      heartbeatTone(
        {
          last_sdk_seen_at: new Date().toISOString(),
          last_sdk_origin: 'https://app.example.com',
          last_sdk_endpoint_host: 'api.old.example',
          last_sdk_user_agent: null,
        },
        'api.new.example',
      ),
    ).toBe('mismatch')
  })

  it('summarizes live heartbeat', () => {
    const project = {
      project_id: 'p1',
      project_name: 'glot.it',
      project_slug: 'glot-it',
      steps: [
        {
          id: 'sdk_installed',
          diagnostic: {
            last_sdk_seen_at: new Date().toISOString(),
            last_sdk_origin: 'https://kensaur.us/glot-it/',
            last_sdk_endpoint_host: 'api.mushimushi.dev',
            last_sdk_user_agent: null,
          },
        },
      ],
    } as unknown as SetupProject
    const summary = summarizeProjectHeartbeat(project, 'api.mushimushi.dev')
    expect(summary.tone).toBe('live')
    expect(summary.origin).toBe('kensaur.us/glot-it/')
    expect(summary.ago).toBe('just now')
  })
})
