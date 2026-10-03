/**
 * FILE: packages/cli/src/commands/accounts.ts
 * PURPOSE: `mushi accounts …` — console parity for the accounts and
 *          resilience register on the Portfolio page:
 *            list | export                    → GET /v1/admin/orgs/:orgId/accounts[/export]
 *            add | edit <id> | remove <id>    → POST / PATCH / DELETE …/accounts[/:id]
 *            domain <id>                      → PATCH /v1/admin/orgs/:orgId/domains/:id
 *          Names and contacts only: the api refuses anything shaped like a
 *          key or token. Needs an account-level key; changes need the key
 *          owner to be a team owner or admin. `remove` needs --yes.
 */

import type { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import { apiCall, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { dieOrgError, oneLine, orgSegment, requireYes } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

const PROVIDERS = ['apple', 'google_play', 'aws', 'supabase', 'vercel', 'registrar', 'stripe', 'github', 'cloudflare', 'other'] as const

interface RegisterAccount {
  id: string
  provider: string
  name: string
  ownerEmail: string | null
  twoFactorDeclared: boolean | null
  recoveryContact: string | null
  adminCount: number
  autoRenew: boolean | null
}

interface RegisterData {
  organizationId: string
  canEdit: boolean
  accounts: RegisterAccount[]
  domains: Array<{ id: string; domain: string; autoRenew: boolean | null; projectIds: string[] }>
  findings: Array<{ ruleId: string; severity: string; message: string; suggestedFix?: string }>
}

const ORG_FLAG = '--org <id>'
const ORG_DESC = 'Organization UUID (default: your only organization)'

const tri = (v: boolean | null): string => (v === null ? 'unknown' : v ? 'yes' : 'no')

/** `yes | no | unknown` → true | false | null, the way the console's tri-state selects send it. */
function parseTri(raw: string, flag: string): boolean | null {
  const v = raw.trim().toLowerCase()
  if (v === 'yes' || v === 'true' || v === 'on') return true
  if (v === 'no' || v === 'false' || v === 'off') return false
  if (v === 'unknown' || v === 'null') return null
  throw new MushiCliError('E_INVALID_INPUT', `${flag} must be yes, no or unknown`)
}

interface AccountFlags {
  provider?: string
  name?: string
  ownerEmail?: string
  twoFactor?: string
  recoveryContact?: string
  admins?: string
  autoRenew?: string
}

/** The fields a flag set, in the api's names. An empty string clears a text field. */
function accountBody(opts: AccountFlags): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (opts.provider !== undefined) {
    if (!(PROVIDERS as readonly string[]).includes(opts.provider)) {
      throw new MushiCliError('E_INVALID_INPUT', `--provider must be one of ${PROVIDERS.join(', ')}`)
    }
    body.provider = opts.provider
  }
  if (opts.name !== undefined) body.displayName = opts.name
  if (opts.ownerEmail !== undefined) body.ownerEmail = opts.ownerEmail || null
  if (opts.twoFactor !== undefined) body.twoFactorDeclared = parseTri(opts.twoFactor, '--two-factor')
  if (opts.recoveryContact !== undefined) body.recoveryContact = opts.recoveryContact || null
  if (opts.admins !== undefined) {
    const n = Number(opts.admins)
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new MushiCliError('E_INVALID_INPUT', '--admins must be a whole number from 1 to 100')
    body.adminCount = n
  }
  if (opts.autoRenew !== undefined) body.autoRenew = parseTri(opts.autoRenew, '--auto-renew')
  return body
}

function renderRegister(data: RegisterData): string[] {
  const lines: string[] = []
  if (data.accounts.length === 0) lines.push('No accounts recorded yet. Add one with: mushi accounts add --provider apple --name "Your team"')
  else {
    lines.push('Accounts:')
    for (const a of data.accounts) {
      lines.push(`  ${a.provider.padEnd(12)} ${oneLine(a.name, 36).padEnd(36)} admins ${a.adminCount} · 2FA ${tri(a.twoFactorDeclared)} · recovery ${a.recoveryContact ? 'set' : 'none'}  (${a.id})`)
    }
  }
  if (data.domains.length > 0) {
    lines.push('Domains your apps use:')
    for (const d of data.domains) lines.push(`  ${oneLine(d.domain, 40).padEnd(40)} auto-renew ${tri(d.autoRenew)}  (${d.id})`)
  }
  if (data.findings.length > 0) {
    lines.push('To fix:')
    for (const f of data.findings) lines.push(`  ${f.severity.toUpperCase().padEnd(5)} ${f.ruleId} — ${oneLine(f.message, 110)}`)
  }
  if (!data.canEdit) lines.push('Read-only: only team owners and admins change the register.')
  return lines
}

export function registerAccountsCommands(program: Command): void {
  const accounts = program
    .command('accounts')
    .description('The accounts and resilience register: who can get into each store, cloud and registrar account (needs an account-level key)')

  accounts
    .command('list')
    .description('Accounts, the domains your apps use, and what to fix')
    .option(ORG_FLAG, ORG_DESC)
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<RegisterData>(`/v1/admin/orgs/${orgSegment(opts.org)}/accounts`, config)
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderRegister(result.data)) console.log(line)
    })

  accounts
    .command('export')
    .description('The register as Markdown, to keep with your recovery notes')
    .option(ORG_FLAG, ORG_DESC)
    .option('--out <file>', 'Write to this file instead of stdout')
    .action(async (opts: { org?: string; out?: string }) => {
      const config = requireConfig()
      const result = await apiCall<string>(`/v1/admin/orgs/${orgSegment(opts.org)}/accounts/export`, config, {}, { text: true })
      if (!result.ok) dieOrgError(result)
      if (opts.out) {
        writeFileSync(opts.out, result.data)
        console.log(`Wrote ${opts.out}.`)
        return
      }
      process.stdout.write(result.data.endsWith('\n') ? result.data : `${result.data}\n`)
    })

  const withAccountFlags = (cmd: Command): Command => cmd
    .option('--provider <provider>', PROVIDERS.join(' | '))
    .option('--name <name>', 'The account name, as the provider shows it')
    .option('--owner-email <email>', 'Who owns it (empty to clear)')
    .option('--two-factor <state>', 'yes | no | unknown')
    .option('--recovery-contact <who>', 'A person who can recover it, never a recovery code (empty to clear)')
    .option('--admins <n>', 'How many people can sign in as an admin')
    .option('--auto-renew <state>', 'yes | no | unknown')
    .option(ORG_FLAG, ORG_DESC)
    .option('--json', 'Machine-readable JSON output')

  withAccountFlags(accounts.command('add').description('Record an account (team owners and admins)'))
    .action(async (opts: AccountFlags & { org?: string; json?: boolean }) => {
      if (!opts.provider || !opts.name) throw new MushiCliError('E_INVALID_INPUT', 'A new account needs --provider and --name.')
      const body = accountBody(opts)
      const config = requireConfig()
      const result = await apiCall<{ id: string }>(`/v1/admin/orgs/${orgSegment(opts.org)}/accounts`, config, { method: 'POST', body: JSON.stringify(body) })
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Recorded ${opts.provider} account "${oneLine(opts.name, 60)}" (${result.data.id}).`)
    })

  withAccountFlags(accounts.command('edit <accountId>').description('Change a recorded account (team owners and admins)'))
    .action(async (accountId: string, opts: AccountFlags & { org?: string; json?: boolean }) => {
      const id = requireUuid(accountId, 'account id')
      const body = accountBody(opts)
      if (Object.keys(body).length === 0) throw new MushiCliError('E_INVALID_INPUT', 'Nothing to change: pass at least one flag, such as --recovery-contact.')
      const config = requireConfig()
      const result = await apiCall<{ id: string }>(`/v1/admin/orgs/${orgSegment(opts.org)}/accounts/${id}`, config, { method: 'PATCH', body: JSON.stringify(body) })
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Saved ${id}.`)
    })

  accounts
    .command('remove <accountId>')
    .description('Take an account off the register (nothing changes at the provider)')
    .option('--yes', 'Confirm the removal')
    .option(ORG_FLAG, ORG_DESC)
    .action(async (accountId: string, opts: { yes?: boolean; org?: string }) => {
      const id = requireUuid(accountId, 'account id')
      requireYes(opts.yes, 'This removes the account from the register.')
      const config = requireConfig()
      const result = await apiCall<{ deleted: boolean }>(`/v1/admin/orgs/${orgSegment(opts.org)}/accounts/${id}`, config, { method: 'DELETE' })
      if (!result.ok) dieOrgError(result)
      console.log(`Removed ${id} from the register.`)
    })

  accounts
    .command('domain <domainId>')
    .description("Declare whether a domain renews automatically (what you declare; nothing is checked at the registrar)")
    .requiredOption('--auto-renew <state>', 'yes | no | unknown')
    .option(ORG_FLAG, ORG_DESC)
    .action(async (domainId: string, opts: { autoRenew: string; org?: string }) => {
      const id = requireUuid(domainId, 'domain id')
      const autoRenew = parseTri(opts.autoRenew, '--auto-renew')
      const config = requireConfig()
      const result = await apiCall<{ id: string }>(`/v1/admin/orgs/${orgSegment(opts.org)}/domains/${id}`, config, { method: 'PATCH', body: JSON.stringify({ autoRenew }) })
      if (!result.ok) dieOrgError(result)
      console.log(`Auto-renew for ${id}: ${tri(autoRenew)}.`)
    })
}
