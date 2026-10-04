/**
 * FILE: packages/server/src/__tests__/console-group-k-routes.test.ts
 * PURPOSE: Route behaviour behind the console group K fixes (2026-10-04):
 *   - reward webhook delivery reports each endpoint's real status (#221);
 *   - every rewards write goes through the role + plan gate (#220);
 *   - rules GET lists disabled rules (#59); rewards can be switched on (#58);
 *   - velocity-capped tester reports are not stored as spam (#217).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.stubGlobal('Deno', { env: { get: () => undefined, toObject: () => ({}) } })

const { dispatchRewardWebhook } = await import('../../supabase/functions/_shared/reward-webhooks.ts')

const API_ROOT = resolve(__dirname, '../../supabase/functions')
const REWARDS = readFileSync(resolve(API_ROOT, 'api/routes/rewards.ts'), 'utf8')
const MARKETPLACE = readFileSync(resolve(API_ROOT, 'api/routes/tester-marketplace.ts'), 'utf8')

type Hook = { id: string; url: string; events: string[] }

function fakeDb(hooks: Hook[], secrets: Record<string, string | null>) {
  const updates: Array<{ id: string; last_status: number }> = []
  return {
    updates,
    from(table: string) {
      const state: { filters: Record<string, unknown>; patch?: Record<string, unknown> } = { filters: {} }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          state.filters[col] = val
          return chain
        },
        update: (patch: Record<string, unknown>) => {
          state.patch = patch
          return chain
        },
        maybeSingle: async () => {
          const id = state.filters.id as string
          return { data: secrets[id] ? { vault_secret_id: `v-${id}` } : null, error: null }
        },
        then: (res: (v: unknown) => unknown) => {
          if (state.patch) {
            updates.push({ id: state.filters.id as string, last_status: state.patch.last_status as number })
            return Promise.resolve({ data: null, error: null }).then(res)
          }
          return Promise.resolve({ data: table === 'reward_webhooks' ? hooks : [], error: null }).then(res)
        },
      }
      return chain
    },
    rpc: async (_fn: string, args: { secret_id: string }) => ({
      data: secrets[args.secret_id.replace(/^v-/, '')] ?? null,
      error: null,
    }),
  }
}

const payload = {
  event: 'reward.tier_changed' as const,
  end_user_id: 'test-user',
  occurred_at: '2026-10-04T00:00:00Z',
}

describe('dispatchRewardWebhook delivery results (#221)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('boom')) return new Response('nope', { status: 500 })
        if (url.includes('down')) throw new Error('connect ECONNREFUSED')
        return new Response('ok', { status: 200 })
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('Deno', { env: { get: () => undefined, toObject: () => ({}) } })
  })

  it('returns each endpoint status, including failures and skipped deliveries', async () => {
    const db = fakeDb(
      [
        { id: 'ok', url: 'https://good.example/hook', events: ['reward.tier_changed'] },
        { id: 'bad', url: 'https://boom.example/hook', events: [] },
        { id: 'off', url: 'https://down.example/hook', events: ['*'] },
        { id: 'nosecret', url: 'https://good.example/other', events: [] },
      ],
      { ok: 'mushi_whk_a', bad: 'mushi_whk_b', off: 'mushi_whk_c', nosecret: null },
    )
    const results = await dispatchRewardWebhook(db as never, 'org-1', payload)
    expect(results).toEqual([
      { webhookId: 'ok', url: 'https://good.example/hook', status: 200 },
      { webhookId: 'bad', url: 'https://boom.example/hook', status: 500 },
      { webhookId: 'off', url: 'https://down.example/hook', status: 0 },
      { webhookId: 'nosecret', url: 'https://good.example/other', status: 0, skipped: 'no_secret' },
    ])
    // Deliveries run concurrently, so the row updates land in any order.
    expect([...db.updates].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'bad', last_status: 500 },
      { id: 'off', last_status: 0 },
      { id: 'ok', last_status: 200 },
    ])
  })

  it('returns an empty list when the organization has no webhooks', async () => {
    expect(await dispatchRewardWebhook(fakeDb([], {}) as never, 'org-1', payload)).toEqual([])
  })
})

function routeBody(source: string, signature: string, length = 1800): string {
  const start = source.indexOf(signature)
  expect(start, signature).toBeGreaterThan(0)
  return source.slice(start, start + length)
}

describe('rewards route contracts', () => {
  const writes = [
    "app.put('/v1/admin/rewards/rules'",
    "app.put('/v1/admin/rewards/tiers'",
    "app.post('/v1/admin/rewards/presets/apply'",
    "app.post('/v1/admin/rewards/webhooks',",
    "app.delete('/v1/admin/rewards/webhooks/:id'",
    "app.post('/v1/admin/rewards/webhooks/test'",
    "app.post('/v1/admin/rewards/quests'",
    "app.delete('/v1/admin/rewards/quests/:id'",
    "app.post('/v1/admin/rewards/identity-providers'",
    "app.patch('/v1/admin/rewards/identity-providers/:id'",
    "app.delete('/v1/admin/rewards/identity-providers/:id'",
    "app.post('/v1/admin/rewards/bonus-points'",
    "app.post('/v1/admin/rewards/set-tier'",
    "app.post('/v1/admin/rewards/disputes/:id/resolve'",
    "app.put('/v1/admin/rewards/project-status'",
  ]

  it.each(writes)('%s is gated by requireRewardsWriter (#220)', (sig) => {
    expect(routeBody(REWARDS, sig, 400)).toContain('requireRewardsWriter(')
  })

  it('the writer gate checks role and the rewards_program plan flag', () => {
    const gate = routeBody(REWARDS, 'async function requireRewardsWriter', 900)
    expect(gate).toContain("organizationHasPlanFeature(db, resolved.organizationId, 'rewards_program')")
    expect(gate).toContain('rewardsWriteDenial(resolved.role')
  })

  it('rules GET lists disabled rules so they can be re-enabled (#59)', () => {
    const body = REWARDS.slice(
      REWARDS.indexOf("app.get('/v1/admin/rewards/rules'"),
      REWARDS.indexOf("app.put('/v1/admin/rewards/rules'"),
    )
    expect(body).not.toContain(".eq('enabled', true)")
  })

  it('rewards can be switched on per project and the banner points at it (#58)', () => {
    const body = routeBody(REWARDS, "app.put('/v1/admin/rewards/project-status'", 2200)
    expect(body).toContain("upsert({ project_id: projectId, rewards_enabled: enabled }")
    expect(body).toContain('canManageProjectSdkConfig(db, projectId, userId)')
    expect(REWARDS).not.toContain("topPriorityTo = '/settings?tab=dev'")
  })

  it('the webhook test reports per-endpoint failures (#221)', () => {
    const body = routeBody(REWARDS, "app.post('/v1/admin/rewards/webhooks/test'", 1600)
    expect(body).toContain('const deliveries = await dispatchRewardWebhook')
    expect(body).toContain('failed')
  })

  it('contributor search is sanitised before the or() filter (#317)', () => {
    expect(REWARDS).toContain("leaderboardSearchTerm(c.req.query('search'))")
  })
})

describe('tester marketplace route contracts', () => {
  it('velocity-capped submissions are stored pending, never spam (#217)', () => {
    const submit = routeBody(MARKETPLACE, "from('tester_submissions')\n      .insert({", 900)
    expect(submit).toContain("status: 'pending'")
    expect(submit).not.toContain("? 'spam'")
  })

  it('profile save and KYC report failures and store the legal name (#218, #219)', () => {
    const put = routeBody(MARKETPLACE, "app.put('/v1/tester/me'", 2500)
    expect(put).toContain('testerProfileUpdate(body)')
    expect(put).toContain("code: 'handle_taken'")
    const kyc = routeBody(MARKETPLACE, "app.put('/v1/tester/kyc'", 3000)
    expect(kyc).toContain('legal_name: name')
    expect(kyc).not.toContain('return c.json({ error: error.message }, 500)')
  })

  it('withheld redemption review checks every write (#62)', () => {
    const approve = routeBody(MARKETPLACE, "app.post('/v1/admin/tester-redemptions/:id/approve'", 2400)
    expect(approve).toContain('withheldWriteFailed(c, \'approve\'')
    const deny = routeBody(MARKETPLACE, "app.post('/v1/admin/tester-redemptions/:id/deny'", 2000)
    expect(deny.indexOf('awardPointsChecked(supabase')).toBeLessThan(deny.indexOf("failure_reason: 'denied_by_reviewer'"))
    expect(deny).toContain('if (!refund.ok && !refund.idempotentSkip)')
  })

  it('tester delete reports a refused erasure instead of ok (#214)', () => {
    const del = routeBody(MARKETPLACE, "app.post('/v1/tester/delete'", 1200)
    expect(del).toContain("code: 'DELETE_FAILED'")
  })

  it('review queue echoes page and limit for pagination (#222)', () => {
    const q = routeBody(MARKETPLACE, "app.get('/v1/admin/tester-submissions'", 3200)
    expect(q).toContain('data: { items, total: count ?? 0, page, limit }')
  })
})
