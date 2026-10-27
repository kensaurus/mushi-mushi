/**
 * FILE: packages/cli/src/runner/audit.ts
 * PURPOSE: `mushi runner audit` findings, pure (Plan 022 Phase 5). Lists the
 *          self-hosted runners registered on a repo and flags the ones to look
 *          at: runners Mushi did not set up (no `mushi-` label and no Mushi
 *          heartbeat), any runner named like the Shai-Hulud 2.0 backdoor
 *          (Nov 2025, it registered a runner called SHA1HULUD on developer
 *          machines), a fork pull request approval setting weaker than "all
 *          external contributors", and workflows using pull_request_target.
 */

export interface GhRunner {
  id: number
  name: string
  os?: string
  status?: string
  busy?: boolean
  labels?: Array<{ name: string } | string>
}

export interface RepoAuditInput {
  repo: string
  /** null when the runner list could not be read (needs Administration: read). */
  runners: GhRunner[] | null
  runnersError: string | null
  /** Runner names Mushi has a heartbeat for; null when Mushi was not asked. */
  heartbeatRunners: Set<string> | null
  forkApproval: string | null
  prTargetWorkflows: string[] | null
  isPublic: boolean | null
}

interface AuditFinding {
  severity: 'critical' | 'warn' | 'info'
  message: string
}

export interface RepoAudit {
  repo: string
  runners: Array<{ id: number; name: string; status: string; busy: boolean; labels: string[]; setUpByMushi: boolean }>
  findings: AuditFinding[]
}

const BACKDOOR_NAME = /sha1[-_ ]?hulud|shai[-_ ]?hulud/i

function labelNames(r: GhRunner): string[] {
  return (r.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean)
}

export function auditRepo(input: RepoAuditInput): RepoAudit {
  const findings: AuditFinding[] = []
  const runners = (input.runners ?? []).map((r) => {
    const labels = labelNames(r)
    const setUpByMushi = labels.some((l) => l.toLowerCase().startsWith('mushi-')) || (input.heartbeatRunners?.has(r.name) ?? false)
    return { id: r.id, name: r.name, status: r.status ?? 'unknown', busy: r.busy === true, labels, setUpByMushi }
  })

  if (input.runners === null) {
    findings.push({ severity: 'info', message: `Could not list runners${input.runnersError ? ` (${input.runnersError})` : ''}. Listing them needs Administration: read on the repo.` })
  }
  for (const r of runners) {
    if (BACKDOOR_NAME.test(r.name) || r.labels.some((l) => BACKDOOR_NAME.test(l))) {
      findings.push({
        severity: 'critical',
        message: `Runner "${r.name}" (id ${r.id}) is named like the Shai-Hulud 2.0 backdoor runner. Remove it (Settings → Actions → Runners), then check the machine it runs on and rotate your GitHub and npm tokens.`,
      })
    } else if (!r.setUpByMushi) {
      findings.push({
        severity: 'warn',
        message: `Runner "${r.name}" (id ${r.id}) was not set up by Mushi (no mushi- label, no Mushi heartbeat). Make sure you know which machine it is.`,
      })
    }
  }
  if (input.isPublic === true && runners.length > 0) {
    findings.push({ severity: 'warn', message: 'This repo is public and has self-hosted runners: a fork pull request can run code on them.' })
  }
  if (input.forkApproval === null) {
    findings.push({ severity: 'info', message: 'Could not read the fork pull request approval setting.' })
  } else if (input.forkApproval !== 'all_external_contributors') {
    findings.push({
      severity: 'warn',
      message: `Fork pull requests run without approval for some outside contributors (${input.forkApproval}). Set "Require approval for all external contributors" in Settings → Actions → General.`,
    })
  }
  if (input.prTargetWorkflows && input.prTargetWorkflows.length > 0) {
    findings.push({
      severity: 'warn',
      message: `pull_request_target runs with your secrets on fork pull requests: ${input.prTargetWorkflows.join(', ')}. Keep these off self-hosted runners and never check out the pull request's code in them.`,
    })
  }
  return { repo: input.repo, runners, findings }
}

/** Workflow file names whose text uses pull_request_target. */
export function workflowsWithPrTarget(files: Array<{ name: string; text: string }>): string[] {
  return files
    .filter((f) => f.text.split('\n').some((line) => {
      const code = line.replace(/#.*$/, '')
      return /\bpull_request_target\b/.test(code)
    }))
    .map((f) => f.name)
}
