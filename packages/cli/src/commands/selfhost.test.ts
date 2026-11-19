import { createHmac } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildComposeEnv,
  buildRuntimeConfigSql,
  buildSelfhostSteps,
  linkedTargetFlag,
  llmProviderOfKey,
  mintSupabaseJwt,
  SELFHOST_PLAN_SQL,
  selfhostConfigPatch,
  selfhostStepCommand,
  supabaseCliMajor,
  type SelfhostPlanInput,
} from './selfhost.js'

const TOKEN = 'a'.repeat(64)
const TMP = join('tmp', 'mushi-selfhost-test')
const URL_ = 'https://abcdefghijklmnopqrst.supabase.co'

function steps(input: Partial<SelfhostPlanInput>, printOnly = false) {
  const built = buildSelfhostSteps({ supabaseUrl: URL_, cliMajor: 3, ...input }, printOnly, TOKEN, TMP)
  if (!built.ok) throw new Error(built.error)
  return built.steps
}

const fileText = (all: ReturnType<typeof steps>) =>
  all.flatMap((s) => s.files ?? []).map((f) => f.content).join('\n')

describe('buildSelfhostSteps', () => {
  it('passes every value as a single argv element and keeps secrets out of argv', () => {
    const all = steps({
      projectRef: 'abcd1234',
      anthropicKey: 'sk-ant-api03-Key_value',
      openaiKey: 'sk-proj-Other_key',
      consoleUrl: 'https://admin.example.com/console',
    })
    for (const step of all) for (const arg of step.args) expect(typeof arg).toBe('string')
    const args = all.map((s) => s.args)
    expect(args).toContainEqual(['link', '--project-ref', 'abcd1234'])
    const argv = args.flat().join(' ')
    expect(argv).not.toContain('sk-ant-api03-Key_value')
    expect(argv).not.toContain('sk-proj-Other_key')
    expect(argv).not.toContain(TOKEN)

    const secrets = all.find((s) => s.args[0] === 'secrets')!
    expect(secrets.args).toEqual(['secrets', 'set', '--env-file', join(TMP, 'mushi-secrets.env')])
    expect(secrets.files?.[0]?.content.split('\n')).toEqual([
      `MUSHI_INTERNAL_CALLER_SECRET=${TOKEN}`,
      'ANTHROPIC_API_KEY=sk-ant-api03-Key_value',
      'OPENAI_API_KEY=sk-proj-Other_key',
      'ADMIN_BASE_URL=https://admin.example.com/console',
      '',
    ])
  })

  it('targets the linked project, not the local database, for db push and db query', () => {
    const v3 = steps({}).filter((s) => s.args[0] === 'db').map((s) => s.args.slice(0, 3))
    expect(v3).toEqual([
      ['db', 'push', '--remote'],
      ['db', 'query', '--remote'],
    ])
    const v2 = steps({ cliMajor: 2 }).filter((s) => s.args[0] === 'db').map((s) => s.args[2])
    expect(v2).toEqual(['--linked', '--linked'])
  })

  it('seeds the runtime config with this project and the same secret as the function secret', () => {
    const all = steps({})
    const seed = all.find((s) => s.args[1] === 'query')!
    expect(seed.critical).toBe(true)
    expect(seed.args).toEqual(['db', 'query', '--remote', '--file', join(TMP, 'mushi-runtime-config.sql')])
    expect(seed.files?.[0]?.content).toBe(buildRuntimeConfigSql(URL_, TOKEN))
  })

  it('makes every step that can leave cron and functions out of sync critical, and nothing is tolerated', () => {
    const all = steps({ projectRef: 'abcd1234' })
    const critical = all.filter((s) => s.critical).map((s) => s.args.slice(0, 2).join(' '))
    expect(critical).toEqual(['link --project-ref', 'db push', 'secrets set', 'db query'])
    expect(all.some((s) => s.args.includes('storage'))).toBe(false)
    expect(all.flatMap((s) => s.args)).not.toContain('||')
  })

  it('deploys every function in one call, letting config.toml decide verify_jwt', () => {
    expect(steps({}).filter((s) => s.args[0] === 'functions').map((s) => s.args)).toEqual([
      ['functions', 'deploy'],
    ])
    expect(steps({ skipDeploy: true }).some((s) => s.args[0] === 'functions')).toBe(false)
  })

  it('prints placeholders, never a real key or token, in --print-commands mode', () => {
    const all = steps({ anthropicKey: 'sk-ant-real', openaiKey: 'sk-real' }, true)
    const printed = all.map(selfhostStepCommand).join('\n') + fileText(all)
    expect(printed).not.toContain('sk-ant-real')
    expect(printed).not.toContain('sk-real')
    expect(printed).not.toContain(TOKEN)
    expect(fileText(all)).toContain('MUSHI_INTERNAL_CALLER_SECRET=<YOUR_INTERNAL_CALLER_SECRET>')
    expect(fileText(all)).toContain("('internal_caller_token', '<YOUR_INTERNAL_CALLER_SECRET>')")
  })

  it.each([
    [{ projectRef: 'abc; rm -rf ~' }, '--project-ref'],
    [{ anthropicKey: 'key$(whoami)' }, '--anthropic-key'],
    [{ openaiKey: 'sk-x\nEVIL=1' }, '--openai-key'],
    [{ consoleUrl: 'https://x.example/"&calc' }, '--console-url'],
    [{ consoleUrl: 'file:///etc/passwd' }, '--console-url'],
    [{ supabaseUrl: "https://x.example/'; drop table x; --" }, '--supabase-url'],
  ])('refuses %o', (input, flag) => {
    const built = buildSelfhostSteps({ supabaseUrl: URL_, ...input }, false, TOKEN, TMP)
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.error).toContain(flag)
  })

  it('refuses to deploy to the Mushi Mushi Cloud project', () => {
    for (const input of [
      { projectRef: 'dxptnwrhwsqckaftyymj' },
      { supabaseUrl: 'https://dxptnwrhwsqckaftyymj.supabase.co' },
    ]) {
      const built = buildSelfhostSteps({ supabaseUrl: URL_, ...input }, false, TOKEN, TMP)
      expect(built.ok).toBe(false)
      if (!built.ok) expect(built.error).toContain('Mushi Mushi Cloud')
    }
  })

  it('refuses a short or odd internal caller secret from the environment', () => {
    expect(buildSelfhostSteps({ supabaseUrl: URL_ }, false, 'short', TMP).ok).toBe(false)
    expect(buildSelfhostSteps({ supabaseUrl: URL_ }, false, `${'b'.repeat(40)}\nX=1`, TMP).ok).toBe(false)
  })
})

describe('buildRuntimeConfigSql', () => {
  it('upserts all three keys the cron helpers read and keeps the screenshots bucket private', () => {
    const sql = buildRuntimeConfigSql(URL_, TOKEN)
    expect(sql).toContain(`('supabase_url', '${URL_}')`)
    expect(sql).toContain(`('service_role_key', '${TOKEN}')`)
    expect(sql).toContain(`('internal_caller_token', '${TOKEN}')`)
    expect(sql).toContain('on conflict (key) do update set value = excluded.value')
    expect(sql).toMatch(/values \('screenshots', 'screenshots', false,/)
    expect(sql).toContain('on conflict (id) do nothing')
  })

  it('lifts the Cloud free-plan limits on the self-hosted instance', () => {
    const sql = buildRuntimeConfigSql(URL_, TOKEN)
    expect(sql).toContain(SELFHOST_PLAN_SQL)
    // Every row: a new org can land on free_cloud or the `hobby` column default.
    expect(SELFHOST_PLAN_SQL).toContain('where true;')
    expect(SELFHOST_PLAN_SQL).not.toMatch(/where id =/)
    expect(SELFHOST_PLAN_SQL).toContain('included_diagnoses_per_month = null')
    expect(SELFHOST_PLAN_SQL).toContain('max_projects = null')
    // NULL retention falls back to 7 days in retention-policy.ts, so it must be a number.
    expect(SELFHOST_PLAN_SQL).toContain('retention_days = greatest(coalesce(retention_days, 0), 3650)')
    // These start background jobs: left to the operator.
    expect(SELFHOST_PLAN_SQL).not.toContain('inventory_v2')
    expect(SELFHOST_PLAN_SQL).not.toContain('soc2')
  })

  it('escapes quotes', () => {
    expect(buildRuntimeConfigSql("https://x'y", TOKEN)).toContain("'https://x''y'")
  })
})

describe('helpers', () => {
  it('reads the CLI major version', () => {
    expect(supabaseCliMajor('3.1.4')).toBe(3)
    expect(supabaseCliMajor('supabase 2.67.1')).toBe(2)
    expect(supabaseCliMajor(null)).toBeUndefined()
    expect(linkedTargetFlag(undefined)).toBe('--remote')
  })

  it('tells the providers apart by key prefix', () => {
    expect(llmProviderOfKey('sk-ant-api03-x')).toBe('anthropic')
    expect(llmProviderOfKey('sk-proj-x')).toBe('openai')
  })

  it('never re-points a CLI config that holds a key for another endpoint', () => {
    const ep = `${URL_}/functions/v1/api`
    expect(selfhostConfigPatch({ apiKey: 'mushi_x', endpoint: 'https://cloud.example/api' }, ep, undefined)).toBeNull()
    expect(selfhostConfigPatch({ apiKey: 'mushi_x' }, ep, undefined)).toBeNull()
    expect(selfhostConfigPatch({ apiKey: 'mushi_x', endpoint: ep }, ep, 'https://c.example')).toEqual({
      endpoint: ep,
      consoleUrl: 'https://c.example',
    })
    expect(selfhostConfigPatch({}, ep, undefined)).toEqual({ endpoint: ep })
  })
})

describe('selfhost secrets', () => {
  it('mints HS256 anon and service_role JWTs that verify against the secret', () => {
    const secret = 'c'.repeat(64)
    for (const role of ['anon', 'service_role'] as const) {
      const jwt = mintSupabaseJwt(role, secret, 1_700_000_000)
      const [h, p, sig] = jwt.split('.')
      expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' })
      const payload = JSON.parse(Buffer.from(p!, 'base64url').toString())
      expect(payload).toMatchObject({ role, iss: 'supabase', iat: 1_700_000_000 })
      expect(payload.exp).toBeGreaterThan(payload.iat)
      expect(sig).toBe(createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'))
    }
  })

  it('writes every compose secret from fresh randomness, with the JWTs signed by JWT_SECRET', () => {
    let n = 0
    const env = buildComposeEnv((bytes) => `${++n}`.padStart(bytes * 2, 'f'), 1_700_000_000)
    const vars = Object.fromEntries(
      env
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    )
    for (const k of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'MUSHI_INTERNAL_CALLER_SECRET']) {
      expect(vars[k]?.length).toBeGreaterThanOrEqual(32)
    }
    expect(new Set([vars.POSTGRES_PASSWORD, vars.JWT_SECRET, vars.MUSHI_INTERNAL_CALLER_SECRET]).size).toBe(3)
    expect(vars.SUPABASE_ANON_KEY).toBe(mintSupabaseJwt('anon', vars.JWT_SECRET!, 1_700_000_000))
    expect(vars.SUPABASE_SERVICE_ROLE_KEY).toBe(mintSupabaseJwt('service_role', vars.JWT_SECRET!, 1_700_000_000))
    expect(vars.ANTHROPIC_API_KEY).toBe('')
    expect(vars.MUSHI_PUBLIC_URL).toBe('http://localhost')
  })
})
