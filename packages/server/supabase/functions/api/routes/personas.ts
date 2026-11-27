/**
 * FILE: packages/server/supabase/functions/api/routes/personas.ts
 * PURPOSE: Project personas and test accounts (ADR 0073, Plan 025 P3), served
 *          by `api-ext` (`api` forwards these paths).
 *
 *   GET    /v1/admin/projects/:pid/personas         — the app's personas (each with its brief and its
 *                                                     last tests), the presets, the test-account
 *                                                     setting and the AI budget runs reserve from
 *   POST   /v1/admin/projects/:pid/personas         — add one: { preset } or the fields (a preset fills the rest)
 *   PATCH  /v1/admin/projects/:pid/personas/:id     — change fields
 *   DELETE /v1/admin/projects/:pid/personas/:id     — archive it (past tests keep it)
 *   PUT    /v1/admin/projects/:pid/test-accounts    — console only, owner or admin: whether first-time
 *                                                     user tests may sign up (off | mushi | hook), the
 *                                                     hook's address, and a new signing secret (shown once)
 *
 * Reads take an mcp:read key or a console session; persona writes an mcp:write
 * key or a console session of a non-viewer. Writes go through the service
 * client (members only have SELECT on project_personas).
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { isOperatorUser } from '../../_shared/operator-gate.ts'
import { readLlmBudgetState } from '../../_shared/llm-budget.ts'
import { heldUsd } from '../../_shared/llm-reservations.ts'
import { testAccountMode, TEST_ACCOUNT_MODES, type TestAccountMode } from '../../_shared/fresh-eyes-queue.ts'
import {
  claimPersona,
  isPersonaId,
  parsePersonaInput,
  personaBrief,
  personaColumns,
  personaFromRow,
  PERSONA_PRESETS,
  PERSONAS_PER_PROJECT_MAX,
  type PersonaInput,
  type PersonaRow,
} from '../../_shared/personas.ts'
import { hookUrl, newHookSecret } from '../../_shared/test-account-hook.ts'
import { hookSecretName } from '../../_shared/test-account-hook-io.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'

type Ctx = Context<{ Variables: Variables }>
type Db = ReturnType<typeof getServiceClient>

const COLUMNS = 'id, project_id, name, preset, goal, locale, device, expertise, accessibility, patience_steps, cost_cap_usd, notes, created_at, updated_at, archived_at'
/** Tests per persona the studio shows (its sparkline). */
const RUNS_PER_PERSONA = 12

/** A persona as the console and MCP read it: the fields, the brief the visitor reads, and what a run plays. */
function view(r: PersonaRow) {
  const p = personaFromRow(r)
  return { ...p, brief: personaBrief(p), plays: claimPersona(p), createdAt: r.created_at, updatedAt: r.updated_at }
}

async function access(c: Ctx, db: Db, write: boolean): Promise<{ projectId: string; userId: string; role: string | null } | Response> {
  const userId = c.get('userId') as string
  const projectId = c.req.param('pid')!
  const a = await callerCanAccessProject(c, db, userId, projectId)
  if (!a.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
  if (write && a.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot change personas.', 403)
  return { projectId, userId, role: a.role }
}

const actor = (c: Ctx) => ({ actorType: c.get('authMethod') === 'apiKey' ? ('api_key' as const) : ('user' as const) })

export function registerPersonaRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:pid/personas', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, false)
    if (a instanceof Response) return a
    const now = new Date()
    const [rows, settings] = await Promise.all([
      db.from('project_personas').select(COLUMNS).eq('project_id', a.projectId).is('archived_at', null).order('created_at', { ascending: true }).limit(PERSONAS_PER_PROJECT_MAX),
      db.from('project_settings').select('fresh_eyes_accounts, fresh_eyes_account_hook_url, fresh_eyes_account_hook_secret_id').eq('project_id', a.projectId).maybeSingle(),
    ])
    if (rows.error) return dbError(c, rows.error)
    const personas = (rows.data ?? []) as PersonaRow[]
    const ids = personas.map((p) => p.id)
    const runsByPersona: Record<string, unknown[]> = {}
    if (ids.length) {
      const { data: runs, error: runErr } = await db
        .from('ux_runs')
        .select('local_run_id, persona_id, status, started_at, finished_at, ttfv_seconds, reached, steps, dry_run, counts')
        .eq('project_id', a.projectId)
        .eq('kind', 'fresh_eyes')
        .in('persona_id', ids)
        .order('started_at', { ascending: false })
        .limit(ids.length * RUNS_PER_PERSONA)
      if (runErr) return dbError(c, runErr)
      for (const r of (runs ?? []) as Array<{ persona_id: string }>) {
        const list = (runsByPersona[r.persona_id] ??= [])
        if (list.length < RUNS_PER_PERSONA) list.push(r)
      }
    }
    const s = (settings.data ?? null) as { fresh_eyes_accounts?: unknown; fresh_eyes_account_hook_url?: string | null; fresh_eyes_account_hook_secret_id?: string | null } | null
    const mode = testAccountMode(s?.fresh_eyes_accounts)
    // The budget runs reserve from; a failed read shows as unknown, never as "no budget".
    let budget: { monthlyUsd: number | null; spentUsd: number; heldUsd: number | null; resetsAt: string } | null = null
    try {
      const state = await readLlmBudgetState(db, a.projectId, now)
      budget = { monthlyUsd: state.budgetUsd, spentUsd: Math.round(state.spendUsd * 100) / 100, heldUsd: await heldUsd(db, a.projectId, now), resetsAt: state.resetsAt }
    } catch {
      budget = null
    }
    const isOperator = isOperatorUser(a.userId)
    const isOwnerOrAdmin = a.role === 'owner' || a.role === 'admin'
    return c.json({
      ok: true,
      data: {
        personas: personas.map((p) => ({ ...view(p), runs: runsByPersona[p.id] ?? [] })),
        presets: PERSONA_PRESETS.map((p) => ({ ...p, brief: personaBrief(p) })),
        limit: PERSONAS_PER_PROJECT_MAX,
        canEdit: a.role !== 'viewer',
        testAccounts: {
          mode,
          hookUrl: s?.fresh_eyes_account_hook_url ?? null,
          hasSecret: !!s?.fresh_eyes_account_hook_secret_id,
          // The setting is changed only from the console, by an owner or admin; `mushi` only by an operator.
          canChange: isOwnerOrAdmin && c.get('authMethod') !== 'apiKey',
          canUseMushi: isOperator,
        },
        budget,
      },
    })
  })

  app.post('/v1/admin/projects/:pid/personas', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, true)
    if (a instanceof Response) return a
    const parsed = parsePersonaInput(await c.req.json().catch(() => null))
    if (!parsed.ok) return jsonError(c, 'VALIDATION_ERROR', parsed.message)
    const input = parsed.value as PersonaInput
    const { count, error: countErr } = await db.from('project_personas').select('id', { count: 'exact', head: true }).eq('project_id', a.projectId).is('archived_at', null)
    if (countErr) return dbError(c, countErr)
    if ((count ?? 0) >= PERSONAS_PER_PROJECT_MAX) return jsonError(c, 'LIMIT_REACHED', `An app keeps at most ${PERSONAS_PER_PROJECT_MAX} personas. Delete one first.`, 409)
    const now = new Date().toISOString()
    const { data, error } = await db
      .from('project_personas')
      .insert({ project_id: a.projectId, created_by: a.userId, created_at: now, updated_at: now, ...personaColumns(input) })
      .select(COLUMNS)
      .single()
    if (error) {
      if ((error as { code?: string }).code === '23505') return jsonError(c, 'NAME_TAKEN', `This app already has a persona called "${input.name}". Pick another name.`, 409)
      return dbError(c, error)
    }
    const row = data as PersonaRow
    await logAudit(db, a.projectId, a.userId, 'persona.created', 'project_persona', row.id, { name: row.name, preset: row.preset }, actor(c))
    return c.json({ ok: true, data: { persona: { ...view(row), runs: [] } } }, 201)
  })

  app.patch('/v1/admin/projects/:pid/personas/:id', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, true)
    if (a instanceof Response) return a
    const id = c.req.param('id')!
    if (!isPersonaId(id)) return jsonError(c, 'VALIDATION_ERROR', 'Bad persona id.')
    const parsed = parsePersonaInput(await c.req.json().catch(() => null), { partial: true })
    if (!parsed.ok) return jsonError(c, 'VALIDATION_ERROR', parsed.message)
    const { data, error } = await db
      .from('project_personas')
      .update({ ...personaColumns(parsed.value), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', a.projectId)
      .is('archived_at', null)
      .select(COLUMNS)
      .maybeSingle()
    if (error) {
      if ((error as { code?: string }).code === '23505') return jsonError(c, 'NAME_TAKEN', 'This app already has a persona with that name. Pick another name.', 409)
      return dbError(c, error)
    }
    if (!data) return jsonError(c, 'NOT_FOUND', 'No such persona in this app.', 404)
    await logAudit(db, a.projectId, a.userId, 'persona.updated', 'project_persona', id, { fields: Object.keys(parsed.value) }, actor(c))
    return c.json({ ok: true, data: { persona: view(data as PersonaRow) } })
  })

  app.delete('/v1/admin/projects/:pid/personas/:id', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, true)
    if (a instanceof Response) return a
    const id = c.req.param('id')!
    if (!isPersonaId(id)) return jsonError(c, 'VALIDATION_ERROR', 'Bad persona id.')
    const now = new Date().toISOString()
    // Archived, not deleted: past tests keep the persona they played.
    const { data, error } = await db.from('project_personas').update({ archived_at: now, updated_at: now }).eq('id', id).eq('project_id', a.projectId).is('archived_at', null).select('id')
    if (error) return dbError(c, error)
    if (!data || (data as unknown[]).length === 0) return jsonError(c, 'NOT_FOUND', 'No such persona in this app.', 404)
    await logAudit(db, a.projectId, a.userId, 'persona.archived', 'project_persona', id, {}, actor(c))
    return c.json({ ok: true, data: { id, archived: true } })
  })

  // ── Test accounts: opt-in per app, console only ───────────────────────────
  app.put('/v1/admin/projects/:pid/test-accounts', jwtAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const a = await callerCanAccessProject(c, db, userId, projectId)
    if (!a.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (a.role !== 'owner' && a.role !== 'admin') return jsonError(c, 'FORBIDDEN', 'Only an owner or admin turns test accounts on or off.', 403)
    const body = (await c.req.json().catch(() => null)) as { mode?: unknown; hookUrl?: unknown; rotateSecret?: unknown } | null
    if (!body || typeof body !== 'object') return jsonError(c, 'VALIDATION_ERROR', 'Send { mode, hookUrl?, rotateSecret? }.')
    const unknownKey = Object.keys(body).find((k) => !['mode', 'hookUrl', 'rotateSecret'].includes(k))
    if (unknownKey) return jsonError(c, 'VALIDATION_ERROR', `Unknown field "${unknownKey.slice(0, 40)}".`)
    if (!(TEST_ACCOUNT_MODES as readonly unknown[]).includes(body.mode)) return jsonError(c, 'VALIDATION_ERROR', `mode is one of ${TEST_ACCOUNT_MODES.join(', ')}.`)
    const mode = body.mode as TestAccountMode
    if (mode === 'mushi' && !isOperatorUser(userId)) {
      return jsonError(c, 'FORBIDDEN', "Accounts in Mushi's own sign-in are only for an app that signs in on this Mushi, and only its operators turn them on. Use your app's own test-account hook instead.", 403)
    }
    if (body.rotateSecret !== undefined && typeof body.rotateSecret !== 'boolean') return jsonError(c, 'VALIDATION_ERROR', 'rotateSecret must be true or false.')

    const { data: current, error: curErr } = await db.from('project_settings').select('fresh_eyes_account_hook_url, fresh_eyes_account_hook_secret_id').eq('project_id', projectId).maybeSingle()
    if (curErr) return dbError(c, curErr)
    const cur = (current ?? null) as { fresh_eyes_account_hook_url: string | null; fresh_eyes_account_hook_secret_id: string | null } | null
    const patch: Record<string, unknown> = { fresh_eyes_accounts: mode }
    let url = cur?.fresh_eyes_account_hook_url ?? null
    if (body.hookUrl !== undefined) {
      if (body.hookUrl === null || body.hookUrl === '') url = null
      else {
        const checked = hookUrl(body.hookUrl)
        if (!checked.ok) return jsonError(c, 'VALIDATION_ERROR', checked.message)
        url = checked.url
      }
      patch.fresh_eyes_account_hook_url = url
    }
    if (mode === 'hook' && !url) return jsonError(c, 'VALIDATION_ERROR', "Give your app's test-account hook address (https://…).")

    // A secret is made the first time the hook is set, or when asked; it is shown once.
    let secret: string | null = null
    if (mode === 'hook' && (body.rotateSecret === true || !cur?.fresh_eyes_account_hook_secret_id)) {
      secret = newHookSecret(crypto.getRandomValues(new Uint8Array(32)))
      const { data: secretId, error: vaultErr } = await db.rpc('vault_store_secret', { secret_name: hookSecretName(projectId), secret_value: secret, p_project_id: projectId })
      if (vaultErr || !secretId) return jsonError(c, 'UPSTREAM_ERROR', 'The signing secret could not be stored, so nothing changed. Try again in a minute.', 502)
      patch.fresh_eyes_account_hook_secret_id = String(secretId)
    }
    const { data: saved, error } = await db.from('project_settings').update(patch).eq('project_id', projectId).select('project_id')
    if (error) return dbError(c, error)
    if (!saved || (saved as unknown[]).length === 0) return jsonError(c, 'NOT_FOUND', 'This app has no settings row yet. Open its settings once, then retry.', 404)
    await logAudit(db, projectId, userId, 'fresh_eyes.test_accounts_set', 'project', projectId, { mode, hook_url: url, secret_rotated: !!secret }, { actorType: 'user' })
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true, data: { mode, hookUrl: url, hasSecret: !!(secret || cur?.fresh_eyes_account_hook_secret_id), ...(secret ? { secret } : {}) } })
  })
}
