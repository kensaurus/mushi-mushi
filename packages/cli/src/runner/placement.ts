/**
 * FILE: packages/cli/src/runner/placement.ts
 * PURPOSE: Terminal views for `mushi runner placement` (Plan 022 Phase 7b,
 *          ADR 0037): where each repo's CI runs (GET /v1/admin/ci/placement)
 *          and the dry run of a change (POST /v1/admin/ci/placement/preview).
 *          Pure: data in, lines out. Tolerant copies of the server shapes in
 *          _shared/ci-placement.ts and api/routes/ci-placement.ts.
 */

interface PlacementTargetView {
  kind: 'github_hosted' | 'self_hosted'
  label: string | null
}

export interface PlacementPreviewView {
  repo: string
  visibility?: string
  variable: string
  action?: string
  current?: { exists: boolean; value: string | null; updatedAt: string | null } | null
  next?: { value: string | null; target: PlacementTargetView }
  now?: { target: PlacementTargetView }
  jobs?: {
    moves?: Array<{ workflow: string; job: string; mainStays?: boolean; dependabotStays?: boolean }>
    stays?: Array<{ workflow: string; job: string; detail: string }>
  }
  target?: { label: string | null; runners: number; online: number; busy: number; waitP95s: number | null } | null
  cost?: { monthCostDelta: number; currency: string; note: string } | null
  policy?: { allowed: boolean; reason: string | null; controller?: { name: string; owner: string } | null }
  warnings?: string[]
  blocked?: { code: string; message: string } | null
}

export interface PlacementView {
  policy?: { noPaidHostedOnPrivate?: boolean; sourceNote?: string | null } | null
  tokenStored?: boolean
  repos?: Array<{
    repo: string
    visibility?: string
    workflowsRead?: boolean
    controller?: { name: string; owner: string } | null
    variables?: Array<{ name: string; jobs: number; fallbacks?: string[]; allowed?: boolean; current?: { exists: boolean; value: string | null } | null }>
    labels?: Array<{ label: string; runners: number; online: number }>
  }>
  requests?: Array<{ id: string; action: string; status: string; requested_at?: string; payload?: { repo?: string; name?: string; value?: string | null } }>
  watches?: Array<{ repo: string; variable: string; status: string; jobs_seen?: number; unexpected?: number; slow?: number }>
}

function targetText(t: PlacementTargetView | undefined | null): string {
  if (!t) return '?'
  if (t.kind === 'github_hosted') return `GitHub-hosted${t.label ? ` (${t.label})` : ''}`
  return `self-hosted “${t.label}”`
}

function money(n: number, currency: string): string {
  const abs = Math.abs(n).toFixed(2)
  const v = currency === 'USD' ? `$${abs}` : `${abs} ${currency}`
  return n < 0 ? `−${v}` : n > 0 ? `+${v}` : v
}

export function renderPlacement(data: PlacementView): string[] {
  const lines: string[] = ['Where CI runs (ADR 0037: Mushi changes only LINUX_RUNNER / RUNNER_<WORKFLOW>, with approval)']
  const p = data.policy
  lines.push(
    p
      ? `  CI agreement: ${p.noPaidHostedOnPrivate ? 'no paid GitHub-hosted minutes on private repos' : 'GitHub-hosted allowed'}${p.sourceNote ? ` (${p.sourceNote})` : ''}`
      : '  CI agreement: not recorded (an owner fills it in: console Settings → CI policy)',
  )
  if (data.tokenStored === false) lines.push('  No GitHub token is stored for this project: Mushi cannot read or change variables.')
  for (const r of data.repos ?? []) {
    lines.push('', `${r.repo}${r.visibility ? ` (${r.visibility})` : ''}`)
    if (r.controller) lines.push(`  Managed by ${r.controller.name}${r.controller.owner ? ` (${r.controller.owner})` : ''}: read-only here.`)
    if (r.workflowsRead === false) lines.push('  Workflow files not read yet.')
    const vars = r.variables ?? []
    if (vars.length === 0 && r.workflowsRead !== false) lines.push('  No job reads a runner variable: every job names its runner in the workflow.')
    for (const v of vars) {
      const cur = v.current ? (v.current.exists ? `= “${v.current.value}”` : 'not set') : 'value unknown'
      const fb = v.fallbacks?.length ? `, else ${v.fallbacks.join(' / ')}` : ''
      lines.push(`  vars.${v.name} ${cur}  (${v.jobs} job${v.jobs === 1 ? '' : 's'}${fb})${v.allowed === false ? '  [Mushi does not change this one]' : ''}`)
    }
    const labels = (r.labels ?? []).filter((l) => l.runners > 0)
    if (labels.length > 0) lines.push(`  Runner labels: ${labels.map((l) => `${l.label} ${l.online}/${l.runners} online`).join(', ')}`)
  }
  const pending = (data.requests ?? []).filter((x) => ['pending_approval', 'approved'].includes(x.status))
  if (pending.length > 0) {
    lines.push('', 'Waiting for an owner or admin in the console:')
    for (const x of pending) lines.push(`  ${x.id.slice(0, 8)}  ${x.status}  ${x.payload?.repo ?? ''} ${x.payload?.name ?? ''} → ${x.payload?.value ?? '(remove)'}`)
  }
  for (const w of data.watches ?? []) {
    if (w.status === 'watching' || w.status === 'alert') {
      lines.push(`  Watching ${w.repo} ${w.variable}: ${w.status}, ${w.jobs_seen ?? 0}/10 jobs${w.unexpected ? `, ${w.unexpected} on another runner` : ''}${w.slow ? `, ${w.slow} waited over 30 min` : ''}`)
    }
  }
  return lines
}

export function renderPreview(p: PlacementPreviewView): string[] {
  const lines: string[] = []
  const cur = p.current ? (p.current.exists ? `“${p.current.value}”` : 'not set') : 'unreadable'
  lines.push(`${p.repo}: vars.${p.variable} ${cur} → ${p.next?.value === null ? 'removed' : `“${p.next?.value}”`}`)
  lines.push(`  Jobs that read it run on: ${targetText(p.now?.target)} → ${targetText(p.next?.target)}`)
  const moves = p.jobs?.moves ?? []
  lines.push(`  Moves (${moves.length}): ${moves.map((m) => `${m.workflow} · ${m.job}`).join(', ') || 'nothing'}`)
  for (const s of (p.jobs?.stays ?? []).slice(0, 10)) lines.push(`  Stays: ${s.workflow} · ${s.job} — ${s.detail}`)
  if (p.target && p.next?.target.kind === 'self_hosted') {
    lines.push(`  Target: ${p.target.online}/${p.target.runners} runner${p.target.runners === 1 ? '' : 's'} online with “${p.target.label}”${p.target.waitP95s != null ? `, wait p95 ${Math.round(p.target.waitP95s)} s` : ''}`)
  }
  if (p.cost) lines.push(`  Cost: ${money(p.cost.monthCostDelta, p.cost.currency)} a month (estimated). ${p.cost.note}`)
  if (p.policy?.controller) lines.push(`  Managed by ${p.policy.controller.name}${p.policy.controller.owner ? ` (${p.policy.controller.owner})` : ''}.`)
  for (const w of p.warnings ?? []) lines.push(`  ! ${w}`)
  if (p.blocked) lines.push(`  Cannot request: ${p.blocked.message} (${p.blocked.code})`)
  else lines.push('  Ready to request: `mushi runner placement request …` asks; an owner or admin approves and runs it in the console.')
  return lines
}
