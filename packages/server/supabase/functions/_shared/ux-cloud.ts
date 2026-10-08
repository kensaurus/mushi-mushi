/**
 * FILE: packages/server/supabase/functions/_shared/ux-cloud.ts
 * PURPOSE: Pure pieces of "Start a cloud UX run" (Plan 021 Phase 4).
 *
 * OVERVIEW:
 * - Edge functions cannot run a browser, so a cloud run executes on the
 *   host's own CI: the console asks GitHub to fire a `repository_dispatch`
 *   event and the host's `.github/workflows/mushi-ux.yml` (template:
 *   docs/templates/mushi-ux.yml) runs `mushi-ux run --sync` there.
 * - `repository_dispatch` needs only Contents: write, which the Mushi GitHub
 *   App already has; `workflow_dispatch` would need Actions: write.
 * - Every value in the payload reaches a workflow, so each one is validated
 *   here against a closed shape: no free text crosses this boundary.
 * - Only `cursor-cloud` is offered: `actions/checkout` leaves a token with
 *   contents:write in .git/config, which an agent running on the runner
 *   could read (ADR 0006). A cloud agent edits on Cursor's side instead.
 */

import { z } from 'npm:zod@3'

const UX_WORKFLOW_FILE = 'mushi-ux.yml'
export const UX_WORKFLOW_PATH = `.github/workflows/${UX_WORKFLOW_FILE}`
export const UX_DISPATCH_EVENT = 'mushi-ux-run'
export const UX_TEMPLATE_URL = 'https://github.com/kensaurus/mushi-mushi/blob/master/docs/templates/mushi-ux.yml'

/** Cursor model ids, optionally with `?param=value&…` (e.g. `grok-4.7?reasoning_effort=xhigh`). */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}(\?[A-Za-z0-9_.-]+=[A-Za-z0-9_.-]*(&[A-Za-z0-9_.-]+=[A-Za-z0-9_.-]*)*)?$/
/** Comma-separated start paths. No spaces, quotes or shell characters. */
const PATHS_RE = /^\/[A-Za-z0-9/_.~-]{0,120}(,\/[A-Za-z0-9/_.~-]{0,120}){0,4}$/

export const CloudRunInput = z
  .object({
    agent: z.literal('cursor-cloud').default('cursor-cloud'),
    model: z.string().max(200).regex(MODEL_RE, 'Unrecognised model id').optional(),
    max_surfaces: z.number().int().min(1).max(20).default(5),
    iterations: z.number().int().min(1).max(3).default(2),
    paths: z.string().max(620).regex(PATHS_RE, 'Paths must start with / and be comma-separated').optional(),
    /** A skill name from the skills repo (kensaurus/skills by default). */
    skill: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/, 'Unrecognised skill name').optional(),
  })
  .strict()
export type CloudRunInput = z.infer<typeof CloudRunInput>

export interface UxRepoRow {
  repo_url: string | null
  role: string | null
  is_primary: boolean | null
  default_branch: string | null
  github_app_installation_id: number | null
}

/** The repo whose screens a UX run looks at: a front end before anything else. */
export function pickUxRepo(rows: UxRepoRow[], legacyRepoUrl: string | null): {
  repoUrl: string
  defaultBranch: string | null
  installationId: number | null
} | null {
  const usable = rows.filter((r) => r.repo_url)
  const rank = (r: UxRepoRow) => {
    const role = ['frontend', 'monorepo', 'mobile'].indexOf(r.role ?? '')
    return (role < 0 ? 10 : role) * 2 + (r.is_primary ? 0 : 1)
  }
  const best = [...usable].sort((a, b) => rank(a) - rank(b))[0]
  if (best) {
    return { repoUrl: best.repo_url!, defaultBranch: best.default_branch, installationId: best.github_app_installation_id }
  }
  return legacyRepoUrl ? { repoUrl: legacyRepoUrl, defaultBranch: null, installationId: null } : null
}

/** `client_payload` for the dispatch: at most 10 top-level keys (GitHub's cap). */
export function clientPayload(input: CloudRunInput): Record<string, string | number> {
  return {
    agent: input.agent,
    model: input.model ?? '',
    max_surfaces: input.max_surfaces,
    iterations: input.iterations,
    paths: input.paths ?? '',
    skill: input.skill ?? '',
  }
}

/** What to run by hand when Mushi cannot fire the event itself. */
export function fallbackCommand(owner: string, repo: string, input: CloudRunInput): string {
  const fields = [
    `-f agent=${input.agent}`,
    input.model ? `-f model='${input.model}'` : null,
    `-f max_surfaces=${input.max_surfaces}`,
    `-f iterations=${input.iterations}`,
    input.paths ? `-f paths='${input.paths}'` : null,
    input.skill ? `-f skill=${input.skill}` : null,
  ].filter(Boolean)
  return `gh workflow run ${UX_WORKFLOW_FILE} --repo ${owner}/${repo} ${fields.join(' ')}`
}
