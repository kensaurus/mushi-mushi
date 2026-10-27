/**
 * FILE: packages/server/supabase/functions/_shared/platform-setup-checks.ts
 * PURPOSE: Platform setup gaps: server secrets only the Mushi operator can set
 *          (console ops plan 2026-10-27, P1). An app owner cannot fix these, so
 *          they never reach the app's Set up page; the super-admin doctor
 *          (api/routes/doctor.ts) shows them. Report 2d5e2bd7: "Add to Slack"
 *          failed for every app because SLACK_CLIENT_ID and SLACK_CLIENT_SECRET
 *          were not set, and nothing said so until someone clicked it.
 *
 *          Kept apart from setup-gaps.ts so `api` (at the 5 MB deploy cap)
 *          imports only this. A secret is reported as present or missing,
 *          never its value.
 *
 * Pure: the caller passes `envHas`, so vitest imports it directly.
 */

export interface PlatformSecretGroup {
  id: string
  /** What stops working while a name is missing, in plain words. */
  feature: string
  names: readonly string[]
}

export const PLATFORM_SECRET_GROUPS: readonly PlatformSecretGroup[] = [
  { id: 'platform_slack_oauth', feature: '"Add to Slack" for every app', names: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'] },
  { id: 'platform_slack_signing', feature: 'Slack buttons and the /mushi command', names: ['SLACK_SIGNING_SECRET'] },
  { id: 'platform_linear_oauth', feature: '"Connect Linear" for every app', names: ['LINEAR_OAUTH_CLIENT_ID', 'LINEAR_OAUTH_CLIENT_SECRET'] },
]

/** Where the operator sets them. */
export const PLATFORM_SECRETS_DOC = 'docs/operators/platform-setup-checks.md'

export interface PlatformGap {
  id: string
  projectId: null
  audience: 'platform'
  status: 'ok' | 'gap'
  title: string
  summary: string
  fixHref: string
  /** Names that are not set. Never values. */
  missing: string[]
}

/** One check per group: which names are not set, and what that breaks. */
export function platformGaps(envHas: (name: string) => boolean): PlatformGap[] {
  return PLATFORM_SECRET_GROUPS.map((g) => {
    const missing = g.names.filter((n) => !envHas(n))
    return {
      id: g.id,
      projectId: null,
      audience: 'platform',
      status: missing.length ? 'gap' : 'ok',
      title: g.names.join(' + '),
      summary: missing.length
        ? `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set on the server, so ${g.feature} fails.`
        : `Set. ${g.feature[0].toUpperCase()}${g.feature.slice(1)} can work.`,
      fixHref: PLATFORM_SECRETS_DOC,
      missing,
    }
  })
}
