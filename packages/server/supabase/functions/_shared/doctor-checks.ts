/**
 * FILE: packages/server/supabase/functions/_shared/doctor-checks.ts
 * PURPOSE: The pure parts of the server doctor (GET /v1/admin/doctor): the
 *          check shape, a human label for each check, and the instance
 *          checks a self-host needs (AI key, cron URL, screenshots bucket,
 *          console address, observability). api/routes/doctor.ts reads the
 *          inputs; `mushi selfhost doctor` and the console render the result.
 *
 * Statuses:
 *   pass  working
 *   info  optional and not set up; never a problem, never a non-zero exit
 *   warn  degraded; something needs a look
 *   fail  broken; a pipeline step does not run
 */

export type DoctorStatus = 'pass' | 'info' | 'warn' | 'fail'

export interface DoctorCheck {
  /** Stable id (`codebase_index:<project id>` for the per-app rows). */
  name: string
  status: DoctorStatus
  /** Plain-English name of the check, for the console and the CLI. */
  label?: string
  summary: string
  /** One-line fix. */
  hint?: string
  /** Console path that fixes it, when the console can. */
  fixHref?: string
  /** Per-app rows: which app. */
  projectId?: string
  appName?: string | null
}

/** Human names, keyed by check id (the part of `name` before a `:`). */
export const DOCTOR_LABELS: Readonly<Record<string, string>> = {
  recovery_token: 'Background job token',
  recovery_cron: 'Stuck-report recovery job',
  stranded_reports: 'Reports waiting for triage',
  dead_letter: 'Failed queue items',
  codebase_index: 'Code index',
  observability: 'Tracing and error tracking',
  llm_key: 'AI key for diagnoses',
  runtime_url: 'Cron jobs call this server',
  screenshots_bucket: 'Screenshots storage',
  console_url: 'Console address for links',
}

export function doctorCheckId(name: string): string {
  const i = name.indexOf(':')
  return i === -1 ? name : name.slice(0, i)
}

export function doctorLabel(name: string): string {
  const id = doctorCheckId(name)
  if (DOCTOR_LABELS[id]) return DOCTOR_LABELS[id]
  return id.replace(/^platform_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Worst status; `info` never counts as a problem. */
export function doctorWorst(checks: ReadonlyArray<{ status: DoctorStatus }>): 'pass' | 'warn' | 'fail' {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'pass'
}

/** Where the self-host docs live (the console and the CLI link here). */
export const SELF_HOST_DOCS = 'https://kensaur.us/mushi-mushi/docs/self-hosting'

/** Re-applies migrations, runtime config, the screenshots bucket and plan limits: both install paths. */
export const REAPPLY_SETUP =
  'Supabase: re-run `npx mushi-mushi selfhost up --skip-deploy`. Compose: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm migrate`.'

/**
 * An AI key: the server's ANTHROPIC_API_KEY / OPENAI_API_KEY, or a key saved
 * on one of the caller's apps (AI keys in Settings). Without one Mushi Mushi
 * still triages with rules, so a missing key is `info`, not a failure.
 * `appKeys` null = the key table could not be read.
 */
export function llmKeyCheck(input: { envAnthropic: boolean; envOpenai: boolean; appKeys: number | null }): DoctorCheck {
  const base = { name: 'llm_key', label: DOCTOR_LABELS.llm_key }
  if (input.envAnthropic || input.envOpenai) {
    const which = [input.envAnthropic && 'Anthropic', input.envOpenai && 'OpenAI'].filter(Boolean).join(' and ')
    return { ...base, status: 'pass', summary: `${which} key set on the server.` }
  }
  if (input.appKeys && input.appKeys > 0) {
    return { ...base, status: 'pass', summary: `Your apps have their own AI key (${input.appKeys}).` }
  }
  return {
    ...base,
    status: 'info',
    summary:
      input.appKeys === null
        ? 'No AI key on the server, and your apps’ keys could not be read. Triage is rule-based until a key is set.'
        : 'No AI key yet: reports get a rule-based category, no plain-English diagnosis or fix draft.',
    hint: 'Add an OpenAI or Anthropic key in Settings → AI keys, or set OPENAI_API_KEY (and OPENROUTER_API_KEY as its fallback) as a function secret. Hosted calls try them in MUSHI_HOSTED_LLM_ORDER.',
    fixHref: '/settings?tab=byok',
  }
}

/**
 * mushi_runtime_config.supabase_url: where every pg_cron job posts. The
 * migrations seed it with Mushi Mushi Cloud's URL, so on a self-host that
 * still points there, no background job ever reaches this server.
 */
export function runtimeUrlCheck(input: {
  mode: 'hosted' | 'self-hosted'
  supabaseUrl: string | null | undefined
  cloudRef: string
  readError?: string | null
}): DoctorCheck {
  const base = { name: 'runtime_url', label: DOCTOR_LABELS.runtime_url }
  const fix = `${REAPPLY_SETUP} Both rewrite mushi_runtime_config.`
  if (input.readError) {
    return { ...base, status: 'warn', summary: `Could not read mushi_runtime_config: ${input.readError}` }
  }
  const url = (input.supabaseUrl ?? '').trim()
  if (!url) {
    return { ...base, status: 'fail', summary: 'mushi_runtime_config.supabase_url is empty, so cron jobs post nowhere.', hint: fix }
  }
  if (input.mode === 'self-hosted' && url.includes(input.cloudRef)) {
    return {
      ...base,
      status: 'fail',
      summary: 'Cron jobs still call Mushi Mushi Cloud, not this server (the migrations seed that URL).',
      hint: fix,
    }
  }
  return { ...base, status: 'pass', summary: `Cron jobs call ${safeOrigin(url)}.` }
}

/** The private `screenshots` bucket reports upload to. */
export function screenshotsBucketCheck(input: { bucket: { public: boolean } | null; readError?: string | null }): DoctorCheck {
  const base = { name: 'screenshots_bucket', label: DOCTOR_LABELS.screenshots_bucket }
  if (input.readError) {
    return { ...base, status: 'warn', summary: `Could not read the screenshots bucket: ${input.readError}` }
  }
  if (!input.bucket) {
    return {
      ...base,
      status: 'fail',
      summary: 'The screenshots bucket is missing, so reports arrive without screenshots.',
      hint: `${REAPPLY_SETUP} Both create the private bucket.`,
    }
  }
  if (input.bucket.public) {
    return {
      ...base,
      status: 'fail',
      summary: 'The screenshots bucket is public: anyone with a link can read your users’ screenshots.',
      hint: 'Make it private in Supabase → Storage → screenshots → Edit bucket (turn off Public).',
    }
  }
  return { ...base, status: 'pass', summary: 'Private screenshots bucket exists.' }
}

/** ADMIN_BASE_URL: the console address put in Slack, Discord and email links. */
export function consoleUrlCheck(input: { adminBaseUrl: string | null | undefined }): DoctorCheck {
  const base = { name: 'console_url', label: DOCTOR_LABELS.console_url }
  const url = (input.adminBaseUrl ?? '').trim()
  if (!url) {
    return {
      ...base,
      status: 'info',
      summary: 'ADMIN_BASE_URL is not set, so report links in Slack, Discord and email have no console address.',
      hint: 'Pass --console-url to `npx mushi-mushi selfhost up`, or set ADMIN_BASE_URL as a function secret.',
    }
  }
  return { ...base, status: 'pass', summary: `Links open ${safeOrigin(url)}.` }
}

/** Langfuse and Sentry are optional; not having them is `info`. */
export function observabilityCheck(input: { langfuse: boolean; sentry: boolean }): DoctorCheck {
  const base = { name: 'observability', label: DOCTOR_LABELS.observability }
  const summary = `Langfuse: ${input.langfuse ? 'on' : 'off'}; Sentry: ${input.sentry ? 'on' : 'off'}.`
  if (input.langfuse && input.sentry) return { ...base, status: 'pass', summary }
  return {
    ...base,
    status: 'info',
    summary: `${summary} Optional: they record AI traces and server errors.`,
    hint: 'Set LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY and SENTRY_DSN_SERVER (or SENTRY_DSN) as function secrets (docs: Self-hosting → Observability).',
  }
}

/** Sentry's server DSN: SENTRY_DSN_SERVER wins, SENTRY_DSN also works (_shared/sentry.ts). */
export function sentryDsnSet(get: (name: string) => string | undefined): boolean {
  return Boolean(get('SENTRY_DSN_SERVER') || get('SENTRY_DSN'))
}

/** Scheme + host only: a URL in a doctor line never carries a path token or query. */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'an invalid URL'
  }
}
