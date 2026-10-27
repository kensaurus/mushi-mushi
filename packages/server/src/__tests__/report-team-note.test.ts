/**
 * FILE: report-team-note.test.ts
 * PURPOSE: CLI `--note`, MCP notes and MCP transition_status reasons become a
 *          team note on the report (the console's "Triage note"): internal,
 *          never shown or sent to the reporter, attributed to the project
 *          owner. They used to go to a `report_notes` table no migration ever
 *          created, with the error swallowed (2026-10-26).
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))

import { postTeamNote } from '../../supabase/functions/_shared/reporter-comms.ts'

type Row = Record<string, unknown>

function fakeDb(opts: { ownerId?: string | null; projectError?: string; insertError?: string }) {
  const inserted: Row[] = []
  const db = {
    from(table: string) {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts.projectError
                  ? { data: null, error: { message: opts.projectError } }
                  : { data: opts.ownerId === undefined ? { owner_id: 'owner-1' } : opts.ownerId ? { owner_id: opts.ownerId } : null, error: null },
            }),
          }),
        }
      }
      if (table === 'report_comments') {
        return {
          insert: async (row: Row) => {
            if (opts.insertError) return { error: { message: opts.insertError } }
            inserted.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { db: db as unknown as Parameters<typeof postTeamNote>[0], inserted }
}

describe('postTeamNote', () => {
  it('writes an internal admin note attributed to the project owner', async () => {
    const { db, inserted } = fakeDb({})
    const r = await postTeamNote(db, { projectId: 'p1', reportId: 'r1', body: '  Closed: owner task tracked as BL-074.  ', authorName: 'CLI / MCP note' })
    expect(r).toEqual({ ok: true })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      report_id: 'r1',
      project_id: 'p1',
      author_kind: 'admin',
      author_user_id: 'owner-1',
      author_name: 'CLI / MCP note',
      body: 'Closed: owner task tracked as BL-074.',
      visible_to_reporter: false,
    })
  })

  it('reports a failed insert instead of swallowing it', async () => {
    const { db } = fakeDb({ insertError: 'permission denied' })
    expect(await postTeamNote(db, { projectId: 'p1', reportId: 'r1', body: 'x', authorName: 'a' })).toEqual({ ok: false, error: 'permission denied' })
  })

  it('refuses an empty note and a project without an owner', async () => {
    expect(await postTeamNote(fakeDb({}).db, { projectId: 'p1', reportId: 'r1', body: '   ', authorName: 'a' })).toEqual({ ok: false, error: 'empty note' })
    expect(await postTeamNote(fakeDb({ ownerId: null }).db, { projectId: 'p1', reportId: 'r1', body: 'x', authorName: 'a' })).toEqual({ ok: false, error: 'project has no owner_id' })
    expect(await postTeamNote(fakeDb({ projectError: 'boom' }).db, { projectId: 'p1', reportId: 'r1', body: 'x', authorName: 'a' })).toEqual({ ok: false, error: 'boom' })
  })

  it('caps a note at 4000 characters', async () => {
    const { db, inserted } = fakeDb({})
    await postTeamNote(db, { projectId: 'p1', reportId: 'r1', body: 'a'.repeat(5000), authorName: 'a' })
    expect(String(inserted[0].body)).toHaveLength(4000)
  })
})
