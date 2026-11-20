import { describe, expect, it } from 'vitest'
import { contentIngestRequest, contentLead } from './contentQualityLead'
import { EMPTY_CONTENT_QUALITY_STATS } from './ContentQualityStatsTypes'

const stats = (over: Partial<typeof EMPTY_CONTENT_QUALITY_STATS>) => ({ ...EMPTY_CONTENT_QUALITY_STATS, hasAnyProject: true, projectId: 'p', ...over })

describe('contentLead', () => {
  it('is null when nothing is open', () => {
    expect(contentLead(stats({}))).toBeNull()
  })

  it('names what is open, what users flagged and failed regenerations, and offers the flagged list', () => {
    const lead = contentLead(stats({ openCount: 12, userFlagOpenCount: 4, failedRegenCount: 1 }))!
    expect(lead.sentence).toBe('12 pieces of content need a look, 4 flagged by your users, 1 regeneration failed. Open one to regenerate it, or dismiss the noise in bulk.')
    expect(lead.tone).toBe('danger')
    expect(lead.metrics.map((m) => [m.label, m.value])).toEqual([
      ['Open', 12],
      ['Flagged by users', 4],
      ['Regeneration failed', 1],
    ])
    expect(lead.next).toBe('flags')
    expect(contentLead(stats({ openCount: 1 }))).toMatchObject({ tone: 'warn', next: null, sentence: expect.stringContaining('1 piece of content needs a look.') })
  })
})

describe('contentIngestRequest', () => {
  it('posts to the ingest route with the project key header and valid JSON', () => {
    const text = contentIngestRequest('https://api.example.com/')
    expect(text).toContain('curl -X POST https://api.example.com/v1/content-quality')
    expect(text).toContain('X-Mushi-Api-Key: $MUSHI_API_KEY')
    const json = /-d '(.+)'/.exec(text)![1]!
    expect(JSON.parse(json)).toMatchObject({ reason: 'user_flag', content_ref: 'lesson-42' })
  })
})
