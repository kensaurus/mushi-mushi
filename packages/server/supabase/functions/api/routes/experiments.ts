// experiments.ts — A/B experiment admin endpoints + SDK assignment endpoint
//
// Admin:
//   GET  /v1/admin/experiments                      — list experiments
//   POST /v1/admin/experiments                      — create experiment
//   GET  /v1/admin/experiments/:id                  — experiment detail + variants
//   PATCH /v1/admin/experiments/:id                 — update experiment
//   DELETE /v1/admin/experiments/:id                — delete draft experiment
//   POST /v1/admin/experiments/:id/variants         — add variant
//   PATCH /v1/admin/experiments/:id/variants/:vid   — update variant
//   DELETE /v1/admin/experiments/:id/variants/:vid  — remove variant
//   POST /v1/admin/experiments/:id/analyze          — run experiment-analyzer
//   POST /v1/admin/experiments/:id/launch           — set status = 'running'
//   POST /v1/admin/experiments/:id/stop             — set status = 'stopped'
//
// SDK (no JWT, api-key auth):
//   POST /v1/sdk/experiment/assign  — assign a reporter token to a variant
//   POST /v1/sdk/experiment/convert — record a conversion event
//
// Phase 5 — Mushi closed-loop evolution

import { Hono } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import type { Variables } from '../types.ts'

function db() { return getServiceClient() }

export function registerExperimentsRoutes(parent: Hono<{ Variables: Variables }>) {
  // Admin routes
  const admin = new Hono<{ Variables: Variables }>()
  admin.use('*', requireAuth, requireProjectAccess)

  admin.get('/', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const status = c.req.query('status')
    let q = db().from('experiments').select('*', { count: 'exact' }).eq('project_id', projectId).order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    const { data, error, count } = await q
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data, total: count })
  })

  admin.post('/', async (c) => {
    const body = await c.req.json()
    const { project_id, name, description, hypothesis, traffic_split, bandit_enabled } = body
    if (!project_id || !name) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id and name required' } }, 400)
    const { data, error } = await db().from('experiments').insert({ project_id, name, description, hypothesis, traffic_split, bandit_enabled }).select().single()
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data }, 201)
  })

  admin.get('/:id', async (c) => {
    const { data, error } = await db().from('experiments').select('*, experiment_variants(*)').eq('id', c.req.param('id')).single()
    if (error) return c.json({ ok: false, error: { code: 'ERROR', message: 'Not found' } }, 404)
    return c.json({ ok: true, data })
  })

  admin.patch('/:id', async (c) => {
    const body = await c.req.json()
    const { error } = await db().from('experiments').update(body).eq('id', c.req.param('id'))
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true })
  })

  admin.delete('/:id', async (c) => {
    await db().from('experiments').delete().eq('id', c.req.param('id')).eq('status', 'draft')
    return c.json({ ok: true })
  })

  admin.post('/:id/variants', async (c) => {
    const body = await c.req.json()
    const { name, description, config, traffic_weight } = body
    const { data, error } = await db().from('experiment_variants').insert({ experiment_id: c.req.param('id'), name, description, config, traffic_weight }).select().single()
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data }, 201)
  })

  admin.patch('/:id/variants/:vid', async (c) => {
    const body = await c.req.json()
    const { error } = await db().from('experiment_variants').update(body).eq('id', c.req.param('vid')).eq('experiment_id', c.req.param('id'))
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true })
  })

  admin.delete('/:id/variants/:vid', async (c) => {
    await db().from('experiment_variants').delete().eq('id', c.req.param('vid')).eq('experiment_id', c.req.param('id'))
    return c.json({ ok: true })
  })

  admin.post('/:id/analyze', async (c) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const res = await fetch(`${supabaseUrl}/functions/v1/experiment-analyzer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ experiment_id: c.req.param('id') }),
    })
    const json = await res.json()
    return c.json(json, res.status)
  })

  admin.post('/:id/launch', async (c) => {
    await db().from('experiments').update({ status: 'running', start_at: new Date().toISOString() }).eq('id', c.req.param('id'))
    return c.json({ ok: true })
  })

  admin.post('/:id/stop', async (c) => {
    await db().from('experiments').update({ status: 'stopped', end_at: new Date().toISOString() }).eq('id', c.req.param('id'))
    return c.json({ ok: true })
  })

  parent.route('/v1/admin/experiments', admin)

  // SDK endpoints (no JWT — api-key auth via X-Mushi-Api-Key)
  const sdk = new Hono<{ Variables: Variables }>()

  // Assign reporter to variant (deterministic by reporter_token hash or bandit)
  sdk.post('/assign', async (c) => {
    const body = await c.req.json()
    const { experiment_id, reporter_token, end_user_id } = body
    if (!experiment_id || !reporter_token) return c.json({ ok: false, error: { code: 'ERROR', message: 'experiment_id and reporter_token required' } }, 400)

    // Check existing assignment
    const { data: existing } = await db()
      .from('experiment_assignments')
      .select('variant_id')
      .eq('experiment_id', experiment_id)
      .eq('reporter_token', reporter_token)
      .maybeSingle()
    if (existing) return c.json({ ok: true, variant_id: existing.variant_id, from_cache: true })

    // Load experiment variants
    const { data: exp } = await db().from('experiments').select('*, experiment_variants(*)').eq('id', experiment_id).single()
    if (!exp || exp.status !== 'running') return c.json({ ok: false, error: { code: 'ERROR', message: 'Experiment not running' } }, 404)

    const variants = (exp.experiment_variants as Array<{ id: string; traffic_weight: number; bandit_alpha: number; bandit_beta: number }>) ?? []
    if (!variants.length) return c.json({ ok: false, error: { code: 'ERROR', message: 'No variants' } }, 404)

    let chosenVariant: typeof variants[0]

    if (exp.bandit_enabled) {
      // Thompson sampling: draw Beta(alpha, beta) for each variant
      const samples = variants.map(v => {
        // Approximate Beta sample: mode + jitter
        const mode = (v.bandit_alpha - 1) / (v.bandit_alpha + v.bandit_beta - 2 + 1e-9)
        return Math.max(0, Math.min(1, mode + (Math.random() - 0.5) * 0.2))
      })
      const maxIdx = samples.indexOf(Math.max(...samples))
      chosenVariant = variants[maxIdx]
    } else {
      // Weighted random assignment (deterministic by hash)
      const hash = [...reporter_token].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffffffff, 0)
      const totalWeight = variants.reduce((s, v) => s + v.traffic_weight, 0)
      let cursor = Math.abs(hash) % 1000 / 1000 * totalWeight
      chosenVariant = variants.at(-1)!
      for (const v of variants) {
        cursor -= v.traffic_weight
        if (cursor <= 0) { chosenVariant = v; break }
      }
    }

    await db().from('experiment_assignments').insert({
      experiment_id, variant_id: chosenVariant.id, reporter_token, end_user_id: end_user_id ?? null,
    }).onConflict('experiment_id, reporter_token').ignore()

    return c.json({ variant_id: chosenVariant.id, from_cache: false })
  })

  // Record a conversion
  sdk.post('/convert', async (c) => {
    const body = await c.req.json()
    const { experiment_id, reporter_token, conversion_value } = body
    if (!experiment_id || !reporter_token) return c.json({ ok: false, error: { code: 'ERROR', message: 'experiment_id and reporter_token required' } }, 400)
    await db().from('experiment_assignments').update({
      converted: true,
      converted_at: new Date().toISOString(),
      conversion_value: conversion_value ?? null,
    }).eq('experiment_id', experiment_id).eq('reporter_token', reporter_token)
    return c.json({ ok: true })
  })

  parent.route('/v1/sdk/experiment', sdk)
}
