/**
 * FILE: packages/server/supabase/functions/_shared/accounts-register.ts
 * PURPOSE: The accounts and resilience register (Plan 020 §11): every account
 *          the portfolio depends on (Apple, Google Play, AWS, Supabase,
 *          Vercel, the domain registrar, Stripe…), who owns it, whether 2FA
 *          is declared on, a recovery contact, and auto-renew — names and
 *          metadata only, never secrets. Pure: row mapping, the two rules
 *          (`account_single_owner`, `registrar_autorenew_off`) and the
 *          Markdown export the owner keeps offline.
 *
 * Everything here is what the owner DECLARED. Mushi cannot see a provider's
 * real 2FA or renewal setting, and the wording says so.
 */

import type { PortfolioRuleFinding } from './portfolio-rules.ts'

export const ACCOUNT_PROVIDERS = ['apple', 'google_play', 'aws', 'supabase', 'vercel', 'registrar', 'stripe', 'github', 'cloudflare', 'other'] as const
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number]

export const ACCOUNT_PROVIDER_LABEL: Readonly<Record<AccountProvider, string>> = {
  apple: 'Apple Developer',
  google_play: 'Google Play Console',
  aws: 'AWS',
  supabase: 'Supabase organization',
  vercel: 'Vercel',
  registrar: 'Domain registrar',
  stripe: 'Stripe',
  github: 'GitHub',
  cloudflare: 'Cloudflare',
  other: 'Other',
}

/** Where to add a second owner, per provider. */
const SECOND_OWNER_STEP: Readonly<Record<AccountProvider, string>> = {
  apple: 'In App Store Connect → Users and Access, invite a second person with the Admin role (only the Account Holder can transfer the account).',
  google_play: 'In Play Console → Users and permissions, invite a second person with Admin (all permissions).',
  aws: 'Add a second IAM Identity Center admin, and store the root account recovery details somewhere a trusted person can reach.',
  supabase: 'In the Supabase dashboard → Organization → Team, invite a second Owner.',
  vercel: 'In Vercel → Team Settings → Members, invite a second Owner.',
  registrar: 'At the registrar, add a second account contact or delegate access, and set an alternate email.',
  stripe: 'In Stripe → Settings → Team and security, invite a second Administrator.',
  github: 'In the GitHub organization → People, give a second person the Owner role.',
  cloudflare: 'In Cloudflare → Manage Account → Members, invite a second Super Administrator.',
  other: "Add a second owner or admin in the provider's team settings.",
}

/** Columns the register reads from portfolio_resources. */
export const REGISTER_COLUMNS = 'id, kind, external_id, display_name, account_provider, owner_email, two_factor_declared, recovery_contact, admin_count, auto_renew, updated_at'

export interface RegisterRow {
  id: string
  kind: string
  external_id: string
  display_name: string | null
  account_provider: string | null
  owner_email: string | null
  two_factor_declared: boolean | null
  recovery_contact: string | null
  admin_count: number | null
  auto_renew: boolean | null
  updated_at: string | null
}

export interface RegisterAccount {
  id: string
  externalId: string
  provider: AccountProvider
  name: string
  ownerEmail: string | null
  twoFactorDeclared: boolean | null
  recoveryContact: string | null
  adminCount: number
  autoRenew: boolean | null
  updatedAt: string | null
}

export interface RegisterDomain {
  id: string
  domain: string
  autoRenew: boolean | null
}

function isProvider(v: unknown): v is AccountProvider {
  return typeof v === 'string' && (ACCOUNT_PROVIDERS as readonly string[]).includes(v)
}

export function registerFromRows(rows: readonly RegisterRow[]): { accounts: RegisterAccount[]; domains: RegisterDomain[] } {
  const accounts: RegisterAccount[] = []
  const domains: RegisterDomain[] = []
  for (const r of rows) {
    if (r.kind === 'account') {
      accounts.push({
        id: r.id,
        externalId: r.external_id,
        provider: isProvider(r.account_provider) ? r.account_provider : 'other',
        name: r.display_name ?? r.external_id,
        ownerEmail: r.owner_email,
        twoFactorDeclared: r.two_factor_declared,
        recoveryContact: r.recovery_contact,
        adminCount: typeof r.admin_count === 'number' && r.admin_count > 0 ? r.admin_count : 1,
        autoRenew: r.auto_renew,
        updatedAt: r.updated_at,
      })
    } else if (r.kind === 'domain') {
      domains.push({ id: r.id, domain: r.external_id, autoRenew: r.auto_renew })
    }
  }
  accounts.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name))
  domains.sort((a, b) => a.domain.localeCompare(b.domain))
  return { accounts, domains }
}

/** The external id an account is stored under: one row per (provider, name) per organization. */
export function accountExternalId(provider: AccountProvider, name: string): string {
  return `${provider}:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`.slice(0, 300)
}

/**
 * `account_single_owner`: one person can sign in and no recovery contact is
 * recorded. `registrar_autorenew_off`: auto-renew declared off for a registrar
 * account or a domain. Organization-level: `projectIds` is empty.
 */
export function accountRegisterRules(accounts: readonly RegisterAccount[], domains: readonly RegisterDomain[]): PortfolioRuleFinding[] {
  const out: PortfolioRuleFinding[] = []
  for (const a of accounts) {
    const label = ACCOUNT_PROVIDER_LABEL[a.provider]
    if (a.adminCount <= 1 && !a.recoveryContact?.trim()) {
      out.push({
        ruleId: 'account_single_owner',
        severity: 'warn',
        projectIds: [],
        resourceKey: `account:${a.externalId}`,
        message: `${label} account "${a.name}" has one person who can sign in${a.ownerEmail ? ` (${a.ownerEmail})` : ''} and no recovery contact. If that person loses access, every app on it is stuck.`,
        evidence: { provider: a.provider, adminCount: a.adminCount, twoFactorDeclared: a.twoFactorDeclared },
        suggestedFix: `${SECOND_OWNER_STEP[a.provider]} Or record a recovery contact (a trusted person who can get in) in the register on /portfolio.`,
      })
    }
    if (a.provider === 'registrar' && a.autoRenew === false) {
      out.push({
        ruleId: 'registrar_autorenew_off',
        severity: 'warn',
        projectIds: [],
        resourceKey: `account:${a.externalId}`,
        message: `Auto-renew is declared off for the registrar account "${a.name}". A missed renewal lets its domains lapse, and every app and email on them goes dark.`,
        evidence: { provider: a.provider },
        suggestedFix: 'Turn on auto-renew for every domain at the registrar and check the card on file is current, then mark auto-renew on in the register.',
      })
    }
  }
  for (const d of domains) {
    if (d.autoRenew !== false) continue
    out.push({
      ruleId: 'registrar_autorenew_off',
      severity: 'warn',
      projectIds: [],
      resourceKey: `domain:${d.domain}`,
      message: `Auto-renew is declared off for ${d.domain}. If the renewal is missed, the domain lapses and the apps and email on it go dark.`,
      evidence: { domain: d.domain },
      suggestedFix: `Turn on auto-renew for ${d.domain} at the registrar and check the card on file is current, then mark it on in the register.`,
    })
  }
  return out
}

function cell(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
  return s || '—'
}

const yesNo = (v: boolean | null) => (v == null ? 'not declared' : v ? 'yes' : 'no')

/** The offline export: a Markdown file the owner stores or hands to a trusted person. */
export function renderRegisterMarkdown(input: {
  organizationName: string | null
  generatedAt: string
  accounts: readonly RegisterAccount[]
  domains: readonly RegisterDomain[]
  findings: readonly PortfolioRuleFinding[]
}): string {
  const lines: string[] = []
  lines.push(`# Accounts and resilience register — ${cell(input.organizationName ?? 'team')}`)
  lines.push('')
  lines.push(`Exported from Mushi on ${input.generatedAt.slice(0, 10)}. Names and metadata only: no passwords, keys or recovery codes are kept in Mushi or in this file. Everything below is what the owner declared; Mushi cannot see a provider's own 2FA or renewal setting.`)
  lines.push('')
  lines.push('## Accounts')
  lines.push('')
  if (input.accounts.length === 0) {
    lines.push('No accounts recorded yet.')
  } else {
    lines.push('| Account | Provider | Owner email | 2FA on | People with owner/admin access | Recovery contact | Auto-renew |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const a of input.accounts) {
      lines.push(`| ${cell(a.name)} | ${ACCOUNT_PROVIDER_LABEL[a.provider]} | ${cell(a.ownerEmail)} | ${yesNo(a.twoFactorDeclared)} | ${a.adminCount} | ${cell(a.recoveryContact)} | ${a.provider === 'registrar' ? yesNo(a.autoRenew) : '—'} |`)
    }
  }
  lines.push('')
  lines.push('## Domains')
  lines.push('')
  if (input.domains.length === 0) {
    lines.push('No domains recorded yet.')
  } else {
    lines.push('| Domain | Auto-renew |')
    lines.push('| --- | --- |')
    for (const d of input.domains) lines.push(`| ${cell(d.domain)} | ${yesNo(d.autoRenew)} |`)
  }
  lines.push('')
  lines.push('## To fix')
  lines.push('')
  if (input.findings.length === 0) {
    lines.push('Nothing: every account has a second person or a recovery contact, and no auto-renew is declared off.')
  } else {
    for (const f of input.findings) {
      lines.push(`- **${f.ruleId}**: ${f.message}`)
      lines.push(`  - Fix: ${f.suggestedFix}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}
