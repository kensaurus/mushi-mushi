/**
 * FILE: apps/admin/src/lib/releaseBatch.ts
 * PURPOSE: The shape of GET /v1/admin/release-batch (server:
 *          _shared/release-batch.ts) and the plain words the /releases
 *          "Batch" tab uses for it: CI, Opus's verdict, the deploy after the
 *          last merged train, and the tab's one-sentence status.
 */

export type MemberCi = 'green' | 'pending' | 'failing' | 'base_failing' | 'machine' | 'none' | 'unknown'

export interface BatchMember {
  fixAttemptId: string
  prNumber: number
  prUrl: string | null
  title: string | null
  headSha: string | null
  verdict: string | null
  verdictAtHead: boolean
  ci: MemberCi
  ciFailing: string[]
  draft: boolean
  express: boolean
  benched: string | null
  rides: boolean
  why: string
  queueDetail: string | null
}

interface BatchGate {
  id: string
  label: string
  passed: number
  total: number
}

export interface RepoBatch {
  projectId: string
  projectName: string
  repo: string
  mode: 'train' | 'each'
  train: {
    kind: 'open' | 'next'
    prNumber: number | null
    state: string | null
    attempt: number
    detail: string | null
    createdAt: string | null
    ci: MemberCi
    ciFailing: string[]
    leavesAt: string | null
    readyCount: number
    maxMembers: number
    intervalMinutes: number
  }
  members: BatchMember[]
  gates: BatchGate[]
  migrations: { source: 'recipe' | 'default'; globs: string[]; files: Array<{ prNumber: number; path: string }>; complete: boolean; unread: number[] }
  deploy: {
    state: 'live' | 'deployed_since_merge' | 'not_seen' | 'no_merge'
    train: { prNumber: number | null; mergedAt: string; mergeSha: string | null } | null
    seenAt: string | null
    version: string | null
    setupGapHref: string | null
  }
}

export interface ReleaseBatchResponse {
  generatedAt: string
  repos: RepoBatch[]
  /** Reads that failed: 'ci', 'recipe', 'deploys', 'files'. */
  partial: string[]
}

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

export const CI_WORDS: Record<MemberCi, { label: string; tone: Tone }> = {
  green: { label: 'CI green', tone: 'ok' },
  pending: { label: 'CI running', tone: 'info' },
  failing: { label: 'CI failing', tone: 'danger' },
  base_failing: { label: 'Base branch failing', tone: 'warn' },
  machine: { label: 'Test machine stopped', tone: 'warn' },
  none: { label: 'No CI result yet', tone: 'neutral' },
  unknown: { label: 'CI not read', tone: 'neutral' },
}

export function verdictWords(m: Pick<BatchMember, 'verdict' | 'verdictAtHead'>): { label: string; tone: Tone } {
  if (!m.verdict) return { label: 'Not reviewed yet', tone: 'neutral' }
  const v = m.verdict.replace(/_/g, ' ')
  if (!m.verdictAtHead) return { label: `Opus: ${v} (older commit)`, tone: 'warn' }
  if (m.verdict === 'merge') return { label: 'Opus: merge', tone: 'ok' }
  if (m.verdict === 'hold') return { label: 'Opus: hold', tone: 'danger' }
  return { label: `Opus: ${v}`, tone: 'warn' }
}

export const DEPLOY_WORDS: Record<RepoBatch['deploy']['state'], string> = {
  live: 'Live: the merge commit was seen running.',
  deployed_since_merge: 'A deploy was seen after the merge.',
  not_seen: 'No deploy seen since the merge yet.',
  no_merge: 'No train merged in the last 7 days.',
}

export const PARTIAL_WORDS: Record<string, string> = {
  ci: 'CI results',
  recipe: 'the app recipe',
  deploys: 'deploy events',
  files: 'some pull requests’ changed files',
}

export function trainPrUrl(repo: string, prNumber: number | null): string | null {
  return prNumber ? `https://github.com/${repo}/pull/${prNumber}` : null
}

/** How the batch stands across the shown repos, in one sentence. */
export function batchSentence(repos: RepoBatch[]): { sentence: string; tone: Tone } {
  const open = repos.filter((r) => r.train.kind === 'open')
  const riding = repos.reduce((n, r) => n + r.members.filter((m) => m.rides).length, 0)
  const waiting = repos.reduce((n, r) => n + r.members.filter((m) => !m.rides).length, 0)
  const migrations = repos.reduce((n, r) => n + r.migrations.files.length, 0)
  const fix = (n: number) => `${n} fix${n === 1 ? '' : 'es'}`
  const parts: string[] = []
  if (open.length) parts.push(`${open.length} release train${open.length === 1 ? ' is' : 's are'} running`)
  if (riding) parts.push(`${fix(riding)} ${open.length ? 'riding or ready' : 'ready for the next train'}`)
  if (waiting) parts.push(`${fix(waiting)} waiting`)
  if (!parts.length) return { sentence: 'No fixes are waiting to ship.', tone: 'neutral' }
  const tail = migrations ? ` The batch changes the database (${migrations} migration file${migrations === 1 ? '' : 's'}); Mushi does not run them.` : ''
  const s = parts.join(', ')
  return { sentence: `${s[0].toUpperCase()}${s.slice(1)}.${tail}`, tone: migrations ? 'warn' : open.length || riding ? 'ok' : 'info' }
}
