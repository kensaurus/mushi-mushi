import { describe, expect, it } from 'vitest'
import { buildSelfhostSteps, selfhostStepCommand } from './selfhost.js'

const TOKEN = 'a'.repeat(64)

function steps(opts: Parameters<typeof buildSelfhostSteps>[0], printOnly = false) {
  const built = buildSelfhostSteps(opts, printOnly, TOKEN)
  if (!built.ok) throw new Error(built.error)
  return built.steps
}

describe('buildSelfhostSteps', () => {
  it('passes every flag value as a single argv element', () => {
    const all = steps({
      projectRef: 'abcd1234',
      anthropicKey: 'sk-ant-api03-Key_value',
      adminBaseUrl: 'https://admin.example.com/console',
    })
    for (const step of all) {
      expect(Array.isArray(step.args)).toBe(true)
      for (const arg of step.args) expect(typeof arg).toBe('string')
    }
    const args = all.map((s) => s.args)
    expect(args).toContainEqual(['link', '--project-ref', 'abcd1234'])
    expect(args).toContainEqual(['secrets', 'set', 'ANTHROPIC_API_KEY=sk-ant-api03-Key_value'])
    expect(args).toContainEqual(['secrets', 'set', 'ADMIN_BASE_URL=https://admin.example.com/console'])
    expect(args).toContainEqual(['secrets', 'set', `MUSHI_INTERNAL_CALLER_SECRET=${TOKEN}`])
  })

  it('tolerates only the storage bucket step failing, without a shell `|| true`', () => {
    const all = steps({})
    const tolerated = all.filter((s) => s.mayFail)
    expect(tolerated.map((s) => s.args)).toEqual([['storage', 'create', 'screenshots', '--public']])
    expect(all.flatMap((s) => s.args)).not.toContain('||')
    expect(selfhostStepCommand(tolerated[0]!)).toBe('supabase storage create screenshots --public || true')
  })

  it('skips function deploys with skipDeploy', () => {
    expect(steps({ skipDeploy: true }).some((s) => s.args[0] === 'functions')).toBe(false)
    expect(steps({}).filter((s) => s.args[0] === 'functions')).toHaveLength(6)
  })

  it('prints placeholders, never the real key or token, in --print-commands mode', () => {
    const printed = steps({ anthropicKey: 'sk-ant-real' }, true).map(selfhostStepCommand)
    expect(printed).toContain('supabase secrets set ANTHROPIC_API_KEY=sk-ant-...')
    expect(printed).toContain('supabase secrets set MUSHI_INTERNAL_CALLER_SECRET=<openssl rand -hex 32>')
    expect(printed.join('\n')).not.toContain('sk-ant-real')
    expect(printed.join('\n')).not.toContain(TOKEN)
  })

  it.each([
    [{ projectRef: 'abc; rm -rf ~' }, '--project-ref'],
    [{ anthropicKey: 'key$(whoami)' }, '--anthropic-key'],
    [{ adminBaseUrl: 'https://x.example/"&calc' }, '--admin-base-url'],
    [{ adminBaseUrl: 'file:///etc/passwd' }, '--admin-base-url'],
  ])('refuses %o', (opts, flag) => {
    const built = buildSelfhostSteps(opts, false, TOKEN)
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.error).toContain(flag)
  })
})
