/**
 * FILE: spendDown.ts
 * PURPOSE: Types and plain words for GET /v1/admin/byok/spend-down (ADR 0028):
 *          what a Cursor key's spend-down mode is doing, in one line.
 */

type SpendDownState = 'off' | 'not_started' | 'active' | 'expired' | 'key_unusable'

export interface SpendDownKeyStatus {
  id: string
  label: string | null
  keyHint: string | null
  scope: 'organization' | 'project'
  status: string
  enabled: boolean
  creditsExpireAt: string | null
  model: string | null
  dailyLimit: number
  windowDays: number
  state: SpendDownState
  startsAt: string | null
  dispatchedToday: number
  remainingToday: number
  projects: Array<{ id: string; name: string }>
  lastRunAt: string | null
  lastSummary: {
    dispatched?: number
    projects?: Array<{ projectId: string; dispatched: number; stopped?: string }>
  } | null
}

export interface SpendDownResponse {
  projectId: string
  keys: SpendDownKeyStatus[]
}

function day(iso: string | null): string {
  if (!iso) return 'an unknown date'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function fixes(n: number): string {
  return `${n} fix${n === 1 ? '' : 'es'}`
}

export function spendDownLine(k: SpendDownKeyStatus): { text: string; tone: 'muted' | 'ok' | 'warn' } {
  switch (k.state) {
    case 'off':
      return { text: 'Spend-down is off.', tone: 'muted' }
    case 'expired':
      return { text: `The credits expired on ${day(k.creditsExpireAt)}, so spend-down stopped.`, tone: 'muted' }
    case 'key_unusable':
      return { text: 'Spend-down is paused: the key failed its last test. Test it again to resume.', tone: 'warn' }
    case 'not_started':
      return {
        text: `Starts ${day(k.startsAt)}: up to ${fixes(k.dailyLimit)} a day until the credits expire on ${day(k.creditsExpireAt)}.`,
        tone: 'muted',
      }
    case 'active':
      if (k.projects.length === 0) {
        return {
          text: 'On, but no app uses this key: each app has its own Cursor key, auto-fix is off, or no repo is linked.',
          tone: 'warn',
        }
      }
      return {
        text: `Spending down: ${k.dispatchedToday} of ${fixes(k.dailyLimit)} today, until ${day(k.creditsExpireAt)}. Pays for ${k.projects.map((p) => p.name).join(', ')}.`,
        tone: 'ok',
      }
  }
}

/** Why the last tick dispatched nothing to some apps, one phrase per app. */
export function spendDownStops(k: SpendDownKeyStatus): string[] {
  const names = new Map(k.projects.map((p) => [p.id, p.name]))
  return (k.lastSummary?.projects ?? [])
    .filter((p) => p.dispatched === 0 && p.stopped)
    .map((p) => `${names.get(p.projectId) ?? 'An app'}: ${p.stopped}`)
}
