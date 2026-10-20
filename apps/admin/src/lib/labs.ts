/**
 * FILE: apps/admin/src/lib/labs.ts
 * PURPOSE: Per-feature opt-in for the pages that are not part of the core
 *          bug → diagnosis → fix loop (console audit 2026-10-20, Phase 1).
 *          Replaces the global Quick / Beginner / Advanced switch: the
 *          sidebar always shows the same nine pages, and each Lab adds its
 *          page to a "Labs" group when switched on in Settings › Labs.
 *          Modelled on Supabase Studio's Feature Previews (per feature, with
 *          a route to try it), not on an "expert mode".
 *
 *          Every page stays reachable by URL and from ⌘K whether or not its
 *          Lab is on; the toggle only decides what the sidebar lists.
 */

import { useCallback, useSyncExternalStore } from 'react'

export interface LabFeature {
  id: string
  label: string
  /** One sentence, from the user's side: what they get, not how it is built. */
  description: string
  /** Sidebar route the Lab adds when enabled (first) and any routes it covers. */
  paths: readonly string[]
  /** Group heading in Settings › Labs. */
  group: 'bugs' | 'fixing' | 'checks' | 'team' | 'automation'
}

export const LAB_FEATURES: readonly LabFeature[] = [
  { id: 'to-do', label: 'To-do list', description: 'One card per decision waiting on you, across bugs, fixes and setup.', paths: ['/inbox'], group: 'bugs' },
  { id: 'bug-clusters', label: 'Bug clusters', description: 'Bugs grouped by shared cause, so one fix can close several reports.', paths: ['/graph'], group: 'bugs' },
  { id: 'voice-reports', label: 'Voice reports', description: 'File a bug or a fix request by talking, from your phone or the console.', paths: ['/voice'], group: 'bugs' },
  { id: 'spam-abuse', label: 'Spam & abuse', description: 'Devices and tokens that flood the queue or game tester rewards.', paths: ['/anti-gaming'], group: 'bugs' },
  { id: 'pull-requests', label: 'Pull requests', description: 'Every fix branch and pull request in your repo with its CI status.', paths: ['/repo'], group: 'fixing' },
  { id: 'code-map', label: 'Code map', description: 'A map of your indexed repository you can ask questions about.', paths: ['/explore'], group: 'fixing' },
  { id: 'ux-runs', label: 'UX runs', description: 'A coding agent works through your screens; you see what improved.', paths: ['/ux-runs'], group: 'fixing' },
  { id: 'improvement-runs', label: 'Improvement runs', description: 'One AI drafts a change and a second AI critiques it until it passes.', paths: ['/iterate'], group: 'fixing' },
  { id: 'editor-agents', label: 'Editor agents', description: 'Status and catalog of the MCP connection your editor uses.', paths: ['/mcp'], group: 'automation' },
  { id: 'agent-skills', label: 'Agent skills', description: 'Browse agent skills and run skill pipelines on a report.', paths: ['/skills'], group: 'automation' },
  { id: 'ai-prompts', label: 'AI prompts', description: 'Edit and compare the prompts that turn reports into fixes.', paths: ['/prompt-lab'], group: 'checks' },
  { id: 'experiments', label: 'Experiments', description: 'A/B experiments on your app with winner detection.', paths: ['/experiments'], group: 'checks' },
  { id: 'research', label: 'Research', description: 'Web research attached to a report, through your Firecrawl key.', paths: ['/research'], group: 'checks' },
  { id: 'releases', label: 'Releases', description: 'Draft and publish release notes from merged fixes.', paths: ['/releases'], group: 'team' },
  { id: 'reporter-updates', label: 'Reporter updates', description: 'Messages your bug reporters see in the widget.', paths: ['/notifications'], group: 'team' },
  { id: 'plugins', label: 'Plugins', description: 'Send Mushi events to PagerDuty, Linear, Zapier or your own endpoint.', paths: ['/marketplace'], group: 'automation' },
  { id: 'processing-jobs', label: 'Processing jobs', description: 'The triage and fix job queue, with retries and dead letters.', paths: ['/queue'], group: 'automation' },
  { id: 'tester-rewards', label: 'Tester rewards', description: 'Points, tiers and payouts for people who report bugs.', paths: ['/rewards'], group: 'team' },
  { id: 'sql-query', label: 'SQL query', description: 'Ask your Mushi data a question in plain words or SQL.', paths: ['/query'], group: 'team' },
] as const

export const LAB_GROUP_LABEL: Record<LabFeature['group'], string> = {
  bugs: 'Bugs',
  fixing: 'Fixing',
  checks: 'Checks and AI quality',
  team: 'Team and reporters',
  automation: 'Automation',
}

const STORAGE_KEY = 'mushi:labs'
const EVENT = 'mushi:labs-change'
const KNOWN = new Set(LAB_FEATURES.map((f) => f.id))

let cached: ReadonlySet<string> | null = null

function read(): ReadonlySet<string> {
  if (cached) return cached
  let ids: string[] = []
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === 'string' && KNOWN.has(v))
  } catch {
    ids = []
  }
  cached = new Set(ids)
  return cached
}

function write(next: ReadonlySet<string>): void {
  cached = next
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      window.dispatchEvent(new CustomEvent(EVENT))
    }
  } catch {
    /* private mode: memory only */
  }
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cached = null
      listener()
    }
  }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}



function setLabEnabled(id: string, enabled: boolean): void {
  if (!KNOWN.has(id)) return
  const next = new Set(read())
  if (enabled) next.add(id)
  else next.delete(id)
  write(next)
}

/** The Lab that owns a route, if any. */
export function labForPath(pathname: string): LabFeature | null {
  return LAB_FEATURES.find((f) => f.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) ?? null
}


export function useLabs(): {
  enabled: ReadonlySet<string>
  isEnabled: (id: string) => boolean
  setEnabled: (id: string, enabled: boolean) => void
} {
  const enabled = useSyncExternalStore(subscribe, read, read)
  const isEnabled = useCallback((id: string) => enabled.has(id), [enabled])
  return { enabled, isEnabled, setEnabled: setLabEnabled }
}
