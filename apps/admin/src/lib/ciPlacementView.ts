/**
 * FILE: apps/admin/src/lib/ciPlacementView.ts
 * PURPOSE: Pure helpers for "Where CI runs" on /ci and the CI agreement form
 *          (Plan 022 Phase 7b, ADR 0037): plain words for a placement, which
 *          choices the agreement greys out and why, request status labels,
 *          and the agreement form's text ↔ policy conversion.
 */

import type { CiRunnerPolicy, PlacementRepo, PlacementRequestRow, PlacementTarget, PlacementWatchRow } from './ciPlacementTypes'

const HOSTED_LABEL_RE = /^(?:ubuntu|windows|macos)-[\w.-]+$/i

export function isHostedLabel(label: string): boolean {
  return HOSTED_LABEL_RE.test(label.trim())
}

/** "GitHub-hosted (ubuntu-24.04)" or "Self-hosted: kensaurus-local". */
export function targetLabel(t: PlacementTarget): string {
  return t.kind === 'github_hosted' ? `GitHub-hosted${t.label ? ` (${t.label})` : ''}` : `Self-hosted: ${t.label}`
}

/** Where jobs that follow a variable run now. */
export function currentPlacement(v: PlacementRepo['variables'][number]): { text: string; kind: 'github_hosted' | 'self_hosted' | 'unknown' } {
  if (!v.current) return { text: 'Unknown: Mushi could not read the variable', kind: 'unknown' }
  if (!v.current.exists || !v.current.value) {
    const fb = v.fallbacks[0] ?? null
    if (fb && !isHostedLabel(fb)) return { text: `Self-hosted: ${fb} (no variable set)`, kind: 'self_hosted' }
    return { text: `GitHub-hosted${fb ? ` (${fb})` : ''}: no variable set`, kind: 'github_hosted' }
  }
  return isHostedLabel(v.current.value) ? { text: `GitHub-hosted (${v.current.value})`, kind: 'github_hosted' } : { text: `Self-hosted: ${v.current.value}`, kind: 'self_hosted' }
}

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Why "GitHub-hosted" is not offered for a repo, or null when it is. */
export function hostedDisabledReason(policy: CiRunnerPolicy | null, repo: PlacementRepo): string | null {
  if (!policy?.noPaidHostedOnPrivate) return null
  if (repo.visibility === 'public') return null
  if (policy.hostedAllowedRepos.some((r) => sameRepo(r, repo.repo))) return null
  return `Your CI agreement says no paid GitHub-hosted minutes on private repos${policy.sourceNote ? ` (${policy.sourceNote})` : ''}.`
}

function matches(value: string, pattern: string): boolean {
  return new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i').test(value)
}

/** Runner labels a person may pick: online first; standby labels from the agreement are left out. */
export function labelChoices(policy: CiRunnerPolicy | null, repo: PlacementRepo): Array<{ label: string; online: number; runners: number }> {
  return repo.labels.filter((l) => !isHostedLabel(l.label) && !(policy?.standbyRunners ?? []).some((p) => matches(l.label, p)))
}

export const REQUEST_STATUS: Record<PlacementRequestRow['status'], { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger' }> = {
  pending_approval: { label: 'Waiting for approval', tone: 'info' },
  approved: { label: 'Approved: run within the hour', tone: 'warn' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  executing: { label: 'Running', tone: 'info' },
  executed: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
}

export const WATCH_STATUS: Record<PlacementWatchRow['status'], { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger' }> = {
  watching: { label: 'Watching the next jobs', tone: 'info' },
  ok: { label: 'Jobs landed where expected', tone: 'ok' },
  alert: { label: 'A job landed elsewhere or waited long', tone: 'danger' },
  reverted: { label: 'Reverted', tone: 'neutral' },
  expired: { label: 'No matching jobs ran', tone: 'neutral' },
}

/** One line for a request: "LINUX_RUNNER → kensaurus-local" / "LINUX_RUNNER removed". */
export function requestSummary(r: PlacementRequestRow): string {
  const p = r.payload
  return `${p.revertOf ? 'Revert: ' : ''}${p.name} ${p.value === null ? 'removed' : `→ ${p.value}`}`
}

/** Minutes until an approval expires; null when not approved. */
export function minutesLeft(r: PlacementRequestRow, now: number): number | null {
  if (r.status !== 'approved' || !r.expires_at) return null
  return Math.max(0, Math.round((Date.parse(r.expires_at) - now) / 60_000))
}

// ─────────────────────────────────────────────────────────────────────────────
// The CI agreement form
// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyDraft {
  noPaidHostedOnPrivate: boolean
  /** One owner/repo per line. */
  hostedAllowedRepos: string
  /** One per line: "name | owner | repo-a, repo-b". */
  externalControllers: string
  /** One runner name or label per line, `*` for any characters. */
  standbyRunners: string
  sourceNote: string
}

export function draftFromPolicy(p: CiRunnerPolicy | null): PolicyDraft {
  return {
    noPaidHostedOnPrivate: p?.noPaidHostedOnPrivate ?? false,
    hostedAllowedRepos: (p?.hostedAllowedRepos ?? []).join('\n'),
    externalControllers: (p?.externalControllers ?? []).map((c) => `${c.name} | ${c.owner} | ${c.repos.join(', ')}`).join('\n'),
    standbyRunners: (p?.standbyRunners ?? []).join('\n'),
    sourceNote: p?.sourceNote ?? '',
  }
}

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean)

export type PolicyErrors = Partial<Record<keyof PolicyDraft, string>>

export function parsePolicyDraft(d: PolicyDraft): { body: Omit<CiRunnerPolicy, 'organizationId' | 'updatedAt'>; errors: PolicyErrors } {
  const errors: PolicyErrors = {}
  const hosted = lines(d.hostedAllowedRepos)
  const badRepo = hosted.find((r) => !REPO_RE.test(r))
  if (badRepo) errors.hostedAllowedRepos = `“${badRepo}” is not owner/repo.`
  if (hosted.length > 200) errors.hostedAllowedRepos = 'At most 200 repos.'
  const controllers: CiRunnerPolicy['externalControllers'] = []
  for (const [i, line] of lines(d.externalControllers).entries()) {
    const [name, owner, repos] = line.split('|').map((x) => x.trim())
    const list = (repos ?? '').split(',').map((r) => r.trim()).filter(Boolean)
    if (!name || list.length === 0) {
      errors.externalControllers = `Line ${i + 1}: write “name | owner | owner/repo, owner/repo”.`
      break
    }
    const bad = list.find((r) => !REPO_RE.test(r))
    if (bad) {
      errors.externalControllers = `Line ${i + 1}: “${bad}” is not owner/repo.`
      break
    }
    if (name.length > 80 || (owner ?? '').length > 80) {
      errors.externalControllers = `Line ${i + 1}: keep the name and owner under 80 characters.`
      break
    }
    controllers.push({ name, owner: owner ?? '', repos: list, note: null })
  }
  if (controllers.length > 20) errors.externalControllers = 'At most 20 controllers.'
  const standby = lines(d.standbyRunners)
  const badStandby = standby.find((s) => !/^[A-Za-z0-9._*-]{1,100}$/.test(s))
  if (badStandby) errors.standbyRunners = `“${badStandby}” is not a runner name or label (letters, digits, . _ - and *).`
  if (d.sourceNote.length > 300) errors.sourceNote = 'At most 300 characters.'
  return {
    body: {
      noPaidHostedOnPrivate: d.noPaidHostedOnPrivate,
      hostedAllowedRepos: hosted,
      externalControllers: controllers,
      standbyRunners: standby,
      sourceNote: d.sourceNote.trim() || null,
    },
    errors,
  }
}
