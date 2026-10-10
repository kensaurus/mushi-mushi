/**
 * 20260521210000 rewrote the QA Coverage policies for auth_rls_initplan, but
 * first shipped ALTER POLICY qa_stories_all (qa_coverage named it
 * qa_stories_insert_update_delete) and owner/story_id predicates that
 * qa_story_evidence cannot satisfy, so a fresh replay failed. It now renames
 * the policy when needed and keeps the project_members predicates the hosted
 * project runs.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260521210000_round_9_advisor_cleanup.sql'),
  'utf8',
).replace(/--[^\n]*/g, '')

const alters = [...sql.matchAll(/ALTER POLICY (\w+) ON public\.(\w+)\s+(USING|WITH CHECK) \(([\s\S]*?)\n  \);/g)]

describe('20260521210000_round_9_advisor_cleanup QA policies', () => {
  it('renames the qa_coverage write policy before altering qa_stories_all', () => {
    const rename = sql.indexOf('ALTER POLICY qa_stories_insert_update_delete ON public.qa_stories RENAME TO qa_stories_all')
    expect(rename).toBeGreaterThanOrEqual(0)
    expect(sql.indexOf('ALTER POLICY qa_stories_all ON public.qa_stories\n')).toBeGreaterThan(rename)
  })

  it('keeps project_members predicates with auth.uid() as an initplan', () => {
    expect(alters.map((m) => m[1])).toEqual([
      'qa_stories_all',
      'qa_stories_select',
      'qa_story_evidence_select',
      'qa_story_runs_insert',
      'qa_story_runs_select',
    ])
    for (const [, name, , clause, body] of alters) {
      expect(body, name).toContain('project_members')
      expect(body, name).toContain('(SELECT auth.uid())')
      expect(body, name).not.toMatch(/\bowner\b(?!')|story_id/)
      expect(clause, name).toBe(name === 'qa_story_runs_insert' ? 'WITH CHECK' : 'USING')
    }
  })
})
