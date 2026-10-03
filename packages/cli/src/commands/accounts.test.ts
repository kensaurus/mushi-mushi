import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerAccountsCommands } from './accounts.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const ORG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ACC = '22222222-3333-4444-8555-666666666666'
const DOM = '33333333-4444-4555-8666-777777777777'

const register = {
  organizationId: ORG,
  canEdit: true,
  accounts: [{ id: ACC, provider: 'apple', name: 'Kenji Ltd', ownerEmail: 'k@example.com', twoFactorDeclared: true, recoveryContact: null, adminCount: 1, autoRenew: null }],
  domains: [{ id: DOM, domain: 'glot.it', autoRenew: false, projectIds: [] }],
  findings: [{ ruleId: 'account_single_owner', severity: 'warn', message: 'Apple Developer account "Kenji Ltd" has one person' }],
}

describe('mushi accounts list', () => {
  it('reads the current organization and prints accounts, domains and what to fix', async () => {
    const run = await runCli(registerAccountsCommands, ['accounts', 'list'], () => okReply(register))
    expect(run.calls[0]).toMatchObject({ method: 'GET', path: '/v1/admin/orgs/current/accounts' })
    expect(run.stdout).toContain('Kenji Ltd')
    expect(run.stdout).toContain('glot.it')
    expect(run.stdout).toContain('auto-renew no')
    expect(run.stdout).toContain('account_single_owner')
  })

  it('explains the account-level key when the key is bound to one project', async () => {
    const run = await runCli(registerAccountsCommands, ['accounts', 'list'], () => errorReply(403, 'PORTFOLIO_NEEDS_ACCOUNT_KEY', 'bound key'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('account-level key')
  })
})

describe('mushi accounts export', () => {
  it('prints the Markdown download, or writes it with --out', async () => {
    const md = '# Accounts and resilience register — Kenji\n'
    const reply = () => ({ body: md, contentType: 'text/markdown; charset=utf-8' })
    const run = await runCli(registerAccountsCommands, ['accounts', 'export', '--org', ORG], reply)
    expect(run.calls[0]!.path).toBe(`/v1/admin/orgs/${ORG}/accounts/export`)
    expect(run.stdout).toContain('# Accounts and resilience register')

    const out = join(mkdtempSync(join(tmpdir(), 'mushi-accounts-')), 'register.md')
    const written = await runCli(registerAccountsCommands, ['accounts', 'export', '--out', out], reply)
    expect(written.exitCode).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe(md)
  })
})

describe('mushi accounts add / edit', () => {
  it('POSTs a new account with the api field names', async () => {
    const run = await runCli(
      registerAccountsCommands,
      ['accounts', 'add', '--provider', 'apple', '--name', 'Kenji Ltd', '--two-factor', 'yes', '--admins', '2', '--auto-renew', 'unknown'],
      () => okReply({ id: ACC }),
    )
    expect(run.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/admin/orgs/current/accounts',
      body: { provider: 'apple', displayName: 'Kenji Ltd', twoFactorDeclared: true, adminCount: 2, autoRenew: null },
    })
    expect(run.stdout).toContain(ACC)
  })

  it('refuses a new account without --provider and --name, or with an unknown provider, before calling the API', async () => {
    const missing = await runCli(registerAccountsCommands, ['accounts', 'add', '--name', 'x'])
    expect(missing.calls).toHaveLength(0)
    expect(missing.error?.code).toBe('E_INVALID_INPUT')
    const bad = await runCli(registerAccountsCommands, ['accounts', 'add', '--provider', 'heroku', '--name', 'x'])
    expect(bad.calls).toHaveLength(0)
    expect(bad.error?.message).toContain('--provider')
  })

  it('PATCHes only the flags given; an empty value clears a text field', async () => {
    const run = await runCli(registerAccountsCommands, ['accounts', 'edit', ACC, '--recovery-contact', '', '--two-factor', 'no'], () => okReply({ id: ACC }))
    expect(run.calls[0]).toMatchObject({ method: 'PATCH', path: `/v1/admin/orgs/current/accounts/${ACC}`, body: { recoveryContact: null, twoFactorDeclared: false } })
  })

  it('refuses an edit with nothing to change', async () => {
    const run = await runCli(registerAccountsCommands, ['accounts', 'edit', ACC])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })

  it('shows the api refusal of a secret-shaped value', async () => {
    const run = await runCli(registerAccountsCommands, ['accounts', 'edit', ACC, '--recovery-contact', 'AKIA0000'], () => errorReply(400, 'SECRET_DETECTED', 'recoveryContact looks like a key or token.'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('SECRET_DETECTED')
  })
})

describe('mushi accounts remove / domain', () => {
  it('removes an account only with --yes', async () => {
    const refused = await runCli(registerAccountsCommands, ['accounts', 'remove', ACC])
    expect(refused.calls).toHaveLength(0)
    expect(refused.error?.message).toContain('--yes')
    const run = await runCli(registerAccountsCommands, ['accounts', 'remove', ACC, '--yes'], () => okReply({ deleted: true }))
    expect(run.calls[0]).toMatchObject({ method: 'DELETE', path: `/v1/admin/orgs/current/accounts/${ACC}` })
  })

  it('declares a domain auto-renew as true, false or null', async () => {
    const run = await runCli(registerAccountsCommands, ['accounts', 'domain', DOM, '--auto-renew', 'yes'], () => okReply({ id: DOM }))
    expect(run.calls[0]).toMatchObject({ method: 'PATCH', path: `/v1/admin/orgs/current/domains/${DOM}`, body: { autoRenew: true } })
    const unknown = await runCli(registerAccountsCommands, ['accounts', 'domain', DOM, '--auto-renew', 'unknown'], () => okReply({ id: DOM }))
    expect(unknown.calls[0]!.body).toEqual({ autoRenew: null })
    const bad = await runCli(registerAccountsCommands, ['accounts', 'domain', DOM, '--auto-renew', 'maybe'])
    expect(bad.calls).toHaveLength(0)
  })
})
