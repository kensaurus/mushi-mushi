/**
 * FILE: apps/admin/src/lib/selfHostChecklist.ts
 * PURPOSE: The "Self-host setup" checklist in Settings → SDK & connection,
 *          shown only when the server says it is self-hosted (GET /health
 *          `mode`). Each item is one thing a fresh self-host gets wrong, with
 *          its status and the fix:
 *
 *            API answers            GET /health
 *            Deploy stamped         /health `version` is a commit, not "dev"
 *            Database reachable     GET /health/ready
 *            Cron jobs call here    doctor runtime_url
 *            Background jobs run    doctor recovery_token + recovery_cron
 *            Screenshots storage    doctor screenshots_bucket
 *            AI key                 doctor llm_key
 *            Console address        doctor console_url
 *
 *          Pure: the component fetches, this decides.
 */

import type { ServerInstance } from './buildInfo'
import { doctorAction, type DoctorAction, type DoctorCheck, type DoctorReport, type DoctorStatus } from './doctorView'

export type ChecklistStatus = DoctorStatus | 'unknown'

export interface ChecklistItem {
  id: string
  title: string
  status: ChecklistStatus
  detail: string
  hint?: string
  action: DoctorAction | null
}

/** The /health/ready body (api/routes/discovery.ts). */
export interface ReadyBody {
  status?: string
  checks?: { env?: string; missingEnv?: string[]; db?: string; dbError?: string }
}

export interface ChecklistInput {
  apiUrl: string
  /** null = /health did not answer. */
  health: ServerInstance | null
  /** null = /health/ready did not answer at all. */
  ready: ReadyBody | null
  doctor: DoctorReport | null
  doctorError: string | null
}

const RANK: Record<ChecklistStatus, number> = { fail: 0, warn: 1, unknown: 2, info: 3, pass: 4 }

function worst(checks: DoctorCheck[]): DoctorCheck | null {
  return [...checks].sort((a, b) => RANK[a.status] - RANK[b.status])[0] ?? null
}

export function selfHostChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = []

  items.push(
    input.health
      ? { id: 'api', title: 'API answers', status: 'pass', detail: `${input.apiUrl} is up.`, action: null }
      : {
          id: 'api',
          title: 'API answers',
          status: 'fail',
          detail: `${input.apiUrl}/health did not answer.`,
          hint: 'Deploy the functions: npx mushi-mushi selfhost up (it deploys every function).',
          action: null,
        },
  )

  const version = input.health?.version ?? null
  if (input.health) {
    items.push(
      version && version !== 'dev' && version !== 'unknown'
        ? { id: 'deploy', title: 'Deploy stamped', status: 'pass', detail: `Running commit ${version.slice(0, 7)}.`, action: null }
        : {
            id: 'deploy',
            title: 'Deploy stamped',
            status: 'info',
            detail: 'The server reports "dev", so you cannot tell which commit runs.',
            hint: 'Supabase: re-run npx mushi-mushi selfhost up, which stamps the commit. Compose builds are unstamped.',
            action: null,
          },
    )
  }

  const db = input.ready?.checks?.db
  const missingEnv = input.ready?.checks?.missingEnv ?? []
  items.push(
    db === 'ok'
      ? { id: 'database', title: 'Database reachable', status: 'pass', detail: 'The functions can read the database.', action: null }
      : {
          id: 'database',
          title: 'Database reachable',
          status: input.ready ? 'fail' : 'unknown',
          detail: !input.ready
            ? 'The readiness check did not answer.'
            : missingEnv.length
              ? `Missing function env: ${missingEnv.join(', ')}.`
              : `The database did not answer${input.ready.checks?.dbError ? `: ${input.ready.checks.dbError}` : ''}.`,
          hint: 'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY reach the functions (Supabase sets them; Compose passes them).',
          action: null,
        },
  )

  const byId = new Map((input.doctor?.checks ?? []).map((c) => [c.name, c]))
  const fromDoctor = (id: string, title: string, names: string[]): ChecklistItem => {
    if (!input.doctor) {
      return {
        id,
        title,
        status: 'unknown',
        detail: input.doctorError ? `The server checks did not run: ${input.doctorError}` : 'Running the server checks…',
        action: null,
      }
    }
    const found = names.map((n) => byId.get(n)).filter((c): c is DoctorCheck => !!c)
    const c = worst(found)
    if (!c) return { id, title, status: 'unknown', detail: 'This server does not report this check yet; update it.', action: null }
    return { id, title, status: c.status, detail: c.summary, ...(c.hint && c.status !== 'pass' ? { hint: c.hint } : {}), action: doctorAction(c) }
  }

  items.push(fromDoctor('cron_url', 'Cron jobs call this server', ['runtime_url']))
  items.push(fromDoctor('jobs', 'Background jobs run', ['recovery_token', 'recovery_cron']))
  items.push(fromDoctor('screenshots', 'Screenshots storage', ['screenshots_bucket']))
  items.push(fromDoctor('ai_key', 'AI key for diagnoses', ['llm_key']))
  items.push(fromDoctor('console_url', 'Console address for links', ['console_url']))
  return items
}

/** "6 of 8 done": pass and info (optional) count as done; problems and unknown do not. */
export function checklistProgress(items: ReadonlyArray<Pick<ChecklistItem, 'status'>>): { done: number; total: number; problems: number } {
  return {
    done: items.filter((i) => i.status === 'pass' || i.status === 'info').length,
    total: items.length,
    problems: items.filter((i) => i.status === 'fail' || i.status === 'warn').length,
  }
}
