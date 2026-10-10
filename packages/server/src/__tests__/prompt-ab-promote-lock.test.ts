/**
 * promote_prompt_candidate swapped the active prompt in one transaction, but
 * two concurrent promotions for one project + stage could both commit and
 * leave two active rows. 20261010180600 serialises them with an advisory lock
 * and adds a partial unique index: one active row per (project, stage).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261010180600_promote_prompt_candidate_lock.sql'),
  'utf8',
).replace(/--[^\n]*/g, '')

describe('20261010180600_promote_prompt_candidate_lock', () => {
  it('locks the project + stage before the first update', () => {
    const lock = sql.search(/perform pg_advisory_xact_lock\(\s*hashtext\('promote_prompt_candidate'\),\s*hashtext\(coalesce\(p_project_id::text, 'global'\) \|\| ':' \|\| p_stage\)\s*\)/)
    const firstUpdate = sql.search(/update prompt_versions/)
    expect(lock).toBeGreaterThan(-1)
    expect(firstUpdate).toBeGreaterThan(lock)
  })

  it('allows one active row per project + stage, globals included', () => {
    expect(sql).toMatch(
      /create unique index if not exists uq_prompt_versions_one_active\s+on public\.prompt_versions \(coalesce\(project_id::text, 'global'\), stage\)\s+where is_active;/,
    )
  })

  it('keeps the swap and the not-found guard, service-role only', () => {
    expect(sql).toMatch(/set\s+is_active = false[\s\S]+and\s+version\s+!= p_candidate_version;/)
    expect(sql).toMatch(/set\s+is_active\s+= true,\s+is_candidate\s+= false,/)
    expect(sql).toMatch(/if not found then\s+raise exception/)
    expect(sql).toMatch(/security definer\s+set search_path = public/)
    expect(sql).toMatch(/revoke execute on function public\.promote_prompt_candidate\(uuid, text, text\) from public, anon, authenticated;/)
    expect(sql).toMatch(/grant\s+execute on function public\.promote_prompt_candidate\(uuid, text, text\) to service_role;/)
  })
})
