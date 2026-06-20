import { describe, expect, it } from 'vitest'
import {
  faviconSourceFromProject,
  formatHeartbeatOrigin,
  heartbeatTone,
  sdkOriginFromSetupProject,
  summarizeProjectHeartbeat,
} from './resolveProjectDomain'
import type { SetupProject } from './useSetupStatus'

describe('faviconSourceFromProject', () => {
  it('merges setup sdk origin with snapshot repo url', () => {
    const source = faviconSourceFromProject(
      {
        project_id: 'p1',
        project_name: 'glot.it',
        project_slug: 'glot-it',
        steps: [
          {
            id: 'sdk_installed',
            diagnostic: { last_sdk_origin: 'https://kensaur.us/glot-it/' },
          },
        ],
      } as unknown as SetupProject,
      {
        primary_repo: { repo_url: 'https://github.com/kensaurus/glot.it' },
        api_keys: [],
      },
    )
    expect(source.sdk_origin).toBe('https://kensaur.us/glot-it/')
    expect(source.repo_url).toBe('https://github.com/kensaurus/glot.it')
  })

  it('falls back to api key origin when setup diagnostic is absent', () => {
    const source = faviconSourceFromProject(
      {
        project_id: 'p2',
        project_name: 'solo boss',
        project_slug: 'solo-boss-cloud',
        steps: [],
      } as unknown as SetupProject,
      {
        api_keys: [{ is_active: true, last_seen_origin: 'https://soloboss.cloud' }],
      },
    )
    expect(source.sdk_origin).toBe('https://soloboss.cloud')
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
