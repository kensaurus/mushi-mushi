/**
 * FILE: packages/server/src/__tests__/self-org-exclusive.test.ts
 * PURPOSE: The company-funnel project must be the only project in its
 *          organization. end_users are keyed by (organization_id,
 *          external_user_id), so a second app in that org mixes console
 *          users with the other apps' people. Migration
 *          20260922000018 moved the hosted project once; this one moves it
 *          again when the org has been shared and rejects the next insert.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261029130000_self_project_exclusive_org.sql'),
  'utf8',
)
const cliAuth = readFileSync(
  resolve(__dirname, '../../supabase/functions/api/routes/cli-auth.ts'),
  'utf8',
)

describe('self project exclusive org', () => {
  it('rejects a project write that would share the company-funnel org', () => {
    expect(sql).toContain('create or replace function public.enforce_self_project_exclusive_org()')
    expect(sql).toContain("raise exception 'SELF_ORG_SHARED'")
    expect(sql).toContain("errcode = '23514'")
    expect(sql).toContain('trg_projects_self_org_exclusive')
    expect(sql).toContain("if tg_op = 'UPDATE' and new.organization_id is not distinct from old.organization_id then")
    expect(sql).toContain('return new;')
  })

  it('repairs the hosted funnel project and an org we reserved for it, not a self-hosted team', () => {
    expect(sql).toContain("'67a6453c-375d-41d7-833a-b33471159442'")
    expect(sql).toContain("coalesce(v_slug, '') <> 'mushi-company'")
    expect(sql).toContain("coalesce(v_slug, '') not like 'mushi-self%'")
    expect(sql).toContain('<= 1 then')
    expect(sql).toContain("'mushi-self'")
    expect(sql).toContain("'pro'")
    expect(sql).toContain("'complimentary'")
    expect(sql).toContain('insert into public.organization_members (organization_id, user_id, role)')
  })

  it('keeps funnel people on the moved project and leaves every other app in place', () => {
    expect(sql).toContain('on conflict (organization_id, external_user_id) do nothing')
    expect(sql).toContain('update public.product_events pe')
    expect(sql).toContain('update public.end_user_sessions s')
    expect(sql).toContain('where pe.project_id = v_self')
    expect(sql).not.toContain('delete from public.projects')
    expect(sql).not.toContain('delete from public.end_users')
  })

  it('turns the database refusal into a conflict on the CLI project create path', () => {
    expect(cliAuth).toContain('isSelfOrgSharedDbError(error)')
    expect(cliAuth).toContain('SELF_ORG_SHARED_MESSAGE')
  })
})
