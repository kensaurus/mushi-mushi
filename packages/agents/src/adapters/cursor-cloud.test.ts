import { describe, expect, it, vi } from 'vitest'
import { CursorCloudAgent, classifyArtifactPath } from './cursor-cloud.js'
import type { FixContext } from '../types.js'

function makeFixContext(overrides: Partial<FixContext> = {}): FixContext {
  return {
    reportId: 'report-12345678',
    projectId: 'proj-1',
    config: {
      repoUrl: 'https://github.com/example/repo',
      maxLines: 500,
      scopeRestriction: 'none',
    },
    report: {
      category: 'bug',
      severity: 'high',
      description: 'Broken login',
    },
    reproductionSteps: [],
    relevantCode: [],
    ...overrides,
  }
}

describe('classifyArtifactPath', () => {
  it('maps .jpg to image/jpeg (not image/jpg)', () => {
    expect(classifyArtifactPath('/artifacts/screenshot.jpg')).toEqual({
      kind: 'screenshot',
      path: '/artifacts/screenshot.jpg',
      mime: 'image/jpeg',
    })
  })

  it('maps .jpeg to image/jpeg', () => {
    expect(classifyArtifactPath('proof.jpeg').mime).toBe('image/jpeg')
  })

  it('maps .mov to video/quicktime (not video/mov)', () => {
    expect(classifyArtifactPath('/opt/cursor/artifacts/demo.mov')).toEqual({
      kind: 'video',
      path: '/opt/cursor/artifacts/demo.mov',
      mime: 'video/quicktime',
    })
  })

  it('maps .png and .webm to their IANA types', () => {
    expect(classifyArtifactPath('a.png').mime).toBe('image/png')
    expect(classifyArtifactPath('a.webm').mime).toBe('video/webm')
  })
})

describe('CursorCloudAgent.generateFix', () => {
  it('uses official v0 payload (source.repository + target.autoCreatePr)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agents') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as {
          prompt: { text: string }
          source: { repository: string; ref: string }
          target: { autoCreatePr: boolean; branchName: string }
        }
        expect(body.source.repository).toBe('https://github.com/example/repo')
        expect(body.source.ref).toBe('main')
        expect(body.target.autoCreatePr).toBe(false)
        expect(body.target.branchName).toBe('bugfix/MUSHI-report-12345678-cursor-cloud')
        expect(body.prompt.text).toContain('Broken login')
        return new Response(JSON.stringify({ id: 'bc_test', status: 'FINISHED', target: {} }), {
          status: 201,
        })
      }
      if (url.endsWith('/agents/bc_test')) {
        return new Response(JSON.stringify({ id: 'bc_test', status: 'FINISHED', target: {} }), {
          status: 200,
        })
      }
      if (url.endsWith('/artifacts')) {
        return new Response(JSON.stringify({ artifacts: [] }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock)

    const agent = new CursorCloudAgent({
      apiKey: 'crsr_test',
      model: 'composer-2.5',
      autoCreatePR: false,
      maxIterations: 3,
    })

    const result = await agent.generateFix(makeFixContext())

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('fails fast when apiKey is missing', async () => {
    const agent = new CursorCloudAgent({
      apiKey: '',
      model: 'composer-2.5',
      autoCreatePR: true,
      maxIterations: 1,
    })

    const result = await agent.generateFix(makeFixContext())

    expect(result.success).toBe(false)
    expect(result.error).toContain('cursor_api_key_ref')
  })
})
