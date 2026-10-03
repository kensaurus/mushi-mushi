/**
 * accountsRegisterView — pure helpers for the accounts and resilience
 * register on /portfolio (Plan 020 §11): wire types, labels, and the form ⇄
 * request mapping. Mirrors server _shared/accounts-register.ts.
 */

export const ACCOUNT_PROVIDERS = ['apple', 'google_play', 'aws', 'supabase', 'vercel', 'registrar', 'stripe', 'github', 'cloudflare', 'other'] as const
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number]

export const PROVIDER_LABEL: Readonly<Record<AccountProvider, string>> = {
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

export interface RegisterAccount {
  id: string
  /** `<provider>:<name>`; findings name it as `account:<externalId>`. */
  externalId: string
  provider: AccountProvider
  name: string
  ownerEmail: string | null
  twoFactorDeclared: boolean | null
  recoveryContact: string | null
  adminCount: number
  autoRenew: boolean | null
}

export interface RegisterDomain {
  id: string
  domain: string
  autoRenew: boolean | null
}

export interface RegisterFinding {
  ruleId: string
  severity: 'info' | 'warn' | 'error'
  resourceKey: string | null
  message: string
  suggestedFix: string
}

export interface AccountsRegisterResponse {
  organizationId: string
  canEdit: boolean
  accounts: RegisterAccount[]
  domains: RegisterDomain[]
  findings: RegisterFinding[]
}

/** A yes / no / not-declared choice as a select value. */
export type TriState = '' | 'yes' | 'no'

export function triFrom(v: boolean | null): TriState {
  return v == null ? '' : v ? 'yes' : 'no'
}

export function triTo(v: TriState): boolean | null {
  return v === '' ? null : v === 'yes'
}

export function triLabel(v: boolean | null): string {
  return v == null ? 'not declared' : v ? 'on' : 'off'
}

export interface AccountForm {
  provider: AccountProvider
  name: string
  ownerEmail: string
  twoFactor: TriState
  adminCount: string
  recoveryContact: string
  autoRenew: TriState
}

export const EMPTY_FORM: AccountForm = { provider: 'apple', name: '', ownerEmail: '', twoFactor: '', adminCount: '1', recoveryContact: '', autoRenew: '' }

export function formFromAccount(a: RegisterAccount): AccountForm {
  return {
    provider: a.provider,
    name: a.name,
    ownerEmail: a.ownerEmail ?? '',
    twoFactor: triFrom(a.twoFactorDeclared),
    adminCount: String(a.adminCount),
    recoveryContact: a.recoveryContact ?? '',
    autoRenew: triFrom(a.autoRenew),
  }
}

/** Form → request body, or the first problem in plain words. Empty text becomes null. */
export function accountPayload(f: AccountForm): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const name = f.name.trim()
  if (!name) return { ok: false, error: 'Give the account a name, for example the team or company it is under.' }
  const email = f.ownerEmail.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'The owner email does not look like an email address.' }
  const admins = Number.parseInt(f.adminCount, 10)
  if (!Number.isInteger(admins) || admins < 1 || admins > 100) return { ok: false, error: 'People with owner or admin access must be a number from 1 to 100.' }
  return {
    ok: true,
    body: {
      provider: f.provider,
      displayName: name,
      ownerEmail: email || null,
      twoFactorDeclared: triTo(f.twoFactor),
      adminCount: admins,
      recoveryContact: f.recoveryContact.trim() || null,
      autoRenew: f.provider === 'registrar' ? triTo(f.autoRenew) : null,
    },
  }
}

/** The findings that belong to one account or domain, by the resource key the server gives them. */
export function findingsFor(item: { externalId: string } | { domain: string }, findings: readonly RegisterFinding[]): RegisterFinding[] {
  const key = 'externalId' in item ? `account:${item.externalId}` : `domain:${item.domain}`
  return findings.filter((f) => f.resourceKey === key)
}
