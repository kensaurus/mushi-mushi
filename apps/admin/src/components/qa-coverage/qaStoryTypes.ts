/** Shared QA Coverage story/run types and display constants. */

import { CHIP_TONE } from '../../lib/chipTone'

export interface QaStoryCoverage {
  story_id: string
  project_id: string
  name: string
  enabled: boolean
  browser_provider: string
  last_run_status: string | null
  is_direct_fetch?: boolean
  runs_24h: number
  passed_24h: number
  failed_24h: number
  error_24h: number
  pass_rate_pct: number | null
  last_run_at: string | null
  last_failure_url: string | null
}

export interface QaStoryFull {
  id: string
  project_id: string
  name: string
  prompt: string | null
  script: string | null
  script_lang: string
  browser_provider: string
  schedule_cron: string | null
  enabled: boolean
  byok_provider: string | null
  created_at: string
  updated_at: string
}

export interface QaStoryRun {
  id: string
  story_id: string
  status: string
  latency_ms: number | null
  started_at: string
  finished_at: string | null
  provider: string | null
  provider_session_url: string | null
  summary: string | null
  assertion_failures: Array<{ step: string; expected: string | null; actual: string | null }>
  error_message: string | null
  triggered_by: string | null
  created_at: string
}

export interface QaEvidence {
  id: string
  kind: 'screenshot' | 'console' | 'network' | 'video' | 'trace' | 'dom' | 'har'
  storage_path: string
  mime: string | null
  step_label: string | null
  captured_at: string
  signed_url: string | null
}

export const PROVIDER_BADGE: Record<string, string> = {
  local: 'bg-surface-overlay text-fg-secondary border-edge-subtle',
  browserbase: 'bg-brand/15 text-brand border-brand/20',
  firecrawl_actions: CHIP_TONE.okSubtle,
}

export const PROVIDER_LABEL: Record<string, string> = {
  local: 'Local',
  browserbase: 'Browserbase',
  firecrawl_actions: 'Firecrawl',
}

export const STATUS_TONE: Record<string, string> = {
  passed: 'text-ok',
  failed: 'text-danger',
  error: 'text-danger',
  timeout: 'text-warn',
  skipped: 'text-fg-faint',
  running: 'text-brand',
  pending: 'text-fg-secondary',
}

export const STATUS_BG: Record<string, string> = {
  passed: 'bg-ok/10 border-ok/20 text-ok',
  failed: 'bg-danger/10 border-danger/20 text-danger',
  error: 'bg-danger/10 border-danger/20 text-danger',
  timeout: 'bg-warn/10 border-warn/20 text-warn',
  running: 'bg-brand/10 border-brand/20 text-brand',
  pending: 'bg-surface-overlay border-edge-subtle text-fg-secondary',
}

export const EVIDENCE_BADGE: Record<string, string> = {
  screenshot: 'bg-brand/10 text-brand border-brand/20',
  video: 'bg-brand/10 text-brand border-brand/20',
  console: 'bg-surface-overlay text-fg-secondary border-edge-subtle',
  network: 'bg-surface-overlay text-fg-secondary border-edge-subtle',
  har: 'bg-surface-overlay text-fg-secondary border-edge-subtle',
  trace: 'bg-surface-overlay text-fg-secondary border-edge-subtle',
  dom: 'bg-surface-overlay text-fg-secondary border-edge-subtle',
}

export const ACTIVE_STATUSES = new Set(['pending', 'running'])
