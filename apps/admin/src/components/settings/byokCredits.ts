/**
 * FILE: byokCredits.ts
 * PURPOSE: Words for GET /v1/admin/byok/credits: what a key has left, where
 *          the provider says, and what Mushi spent through each provider in
 *          the last 30 days.
 */

export type ProviderCredits =
  | {
      kind: 'credits'
      remaining: number | null
      unit: 'credits' | 'usd'
      limit: number | null
      used: number | null
      periodEnd: string | null
      source: string
    }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; message: string }

export interface KeyCredits {
  id: string
  provider: string
  hint: string | null
  openRouter: boolean
  credits: ProviderCredits
}

export interface ProviderSpend {
  provider: string
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  byokCalls: number
}

export interface ByokCreditsResponse {
  keys: KeyCredits[]
  spend30d: ProviderSpend[]
  since: string
}

const count = new Intl.NumberFormat('en-US')

function amount(n: number, unit: 'credits' | 'usd'): string {
  return unit === 'usd' ? `$${n.toFixed(2)}` : `${count.format(Math.round(n))} credits`
}

function day(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export interface CreditsLine {
  text: string
  tone: 'ok' | 'low' | 'muted' | 'error'
}

/** One line under a key: what it has left, or why the provider cannot say. */
export function creditsLine(c: ProviderCredits): CreditsLine {
  if (c.kind === 'unavailable') return { text: c.reason, tone: 'muted' }
  if (c.kind === 'error') return { text: `Could not read the balance: ${c.message}`, tone: 'error' }
  if (c.remaining === null) {
    const used = c.used !== null ? `, ${amount(c.used, c.unit)} used` : ''
    return { text: `No spending cap on this key${used}.`, tone: 'ok' }
  }
  const of = c.limit !== null ? ` of ${amount(c.limit, c.unit)}` : ''
  const resets = day(c.periodEnd)
  const low = c.limit !== null && c.limit > 0 && c.remaining / c.limit < 0.1
  return {
    text: `${amount(c.remaining, c.unit)} left${of}${resets ? `, resets ${resets}` : ''}.`,
    tone: c.remaining <= 0 || low ? 'low' : 'ok',
  }
}

/** One line per provider: what Mushi recorded spending through it in 30 days. */
export function spendLine(s: ProviderSpend | undefined): string {
  if (!s || s.calls === 0) return 'No AI calls recorded through this service in the last 30 days.'
  const tokens = count.format(s.inputTokens + s.outputTokens)
  const calls = `${count.format(s.calls)} ${s.calls === 1 ? 'call' : 'calls'}`
  return `Last 30 days: $${s.costUsd.toFixed(2)} across ${calls} (${tokens} tokens), ${count.format(s.byokCalls)} on your keys.`
}
