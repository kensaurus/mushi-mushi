/**
 * Feature groups for MCP tool filtering — mirrors Supabase MCP `?features=` pattern.
 *
 * When `features` is omitted → all tools (backward compatible).
 * New installs default to DEFAULT_FEATURE_GROUPS via deeplink / docs.
 */

export const FEATURE_GROUPS = [
  'triage',
  'fixes',
  'inventory',
  'setup',
  'qa',
  'skills',
  'rewards',
  'admin',
  'audit',
  'docs',
  'usage',
  'usage',
  /** Deprecated aliases kept for one release — hidden unless `legacy` or `all`. */
  'legacy',
] as const

export type FeatureGroup = (typeof FEATURE_GROUPS)[number]

/** Lean default for new Cursor installs (~45 tools vs 70 full). */
export const DEFAULT_FEATURE_GROUPS: readonly FeatureGroup[] = [
  'triage',
  'fixes',
  'inventory',
  'setup',
  'docs',
] as const

export const ALL_FEATURE_GROUPS: readonly FeatureGroup[] = FEATURE_GROUPS.filter(
  (g) => g !== 'legacy',
)

/** Map every tool/resource name → feature group. */
export const TOOL_FEATURE_MAP: Record<string, FeatureGroup> = {
  // triage
  get_recent_reports: 'triage',
  get_report_detail: 'triage',
  get_report_timeline: 'triage',
  search_reports: 'triage',
  get_similar_bugs: 'triage',
  get_fix_context: 'triage',
  get_fix_timeline: 'triage',
  get_blast_radius: 'triage',
  get_knowledge_graph: 'triage',
  run_nl_query: 'triage',
  get_report_evidence: 'triage',
  triage_issue: 'triage',
  query_lessons: 'triage',
  list_lessons: 'triage',
  fix_suggest: 'triage',
  graph_neighborhood: 'triage',
  graph_node_status: 'triage',
  get_reporter_thread: 'legacy',

  // inventory
  inventory_get: 'inventory',
  inventory_diff: 'inventory',
  inventory_findings: 'inventory',
  inventory_current: 'admin',

  // setup
  diagnose_connection: 'setup',
  diagnose_setup: 'setup',
  setup_check: 'legacy',
  ingest_setup_check: 'legacy',
  get_activation_status: 'legacy',
  activation_status: 'setup',
  project_integration_health: 'setup',
  setup_repo_for_mushi: 'setup',
  get_two_way_comms_health: 'setup',

  // fixes
  submit_fix_result: 'fixes',
  dispatch_fix: 'fixes',
  trigger_judge: 'fixes',
  test_gen_from_report: 'fixes',
  transition_status: 'fixes',
  merge_fix: 'fixes',
  refresh_ci: 'fixes',
  reopen_report: 'fixes',
  reply_to_reporter: 'fixes',

  // rewards
  list_top_contributors: 'rewards',
  award_bonus_points: 'rewards',
  set_tier: 'rewards',

  // admin / project context
  list_projects: 'admin',
  get_account_overview: 'admin',
  get_project_context: 'admin',
  get_pipeline_logs: 'admin',
  project_dashboard: 'admin',
  project_stats: 'admin',
  project_settings: 'admin',
  privacy_status: 'admin',
  evolution_history: 'admin',

  // usage / billing
  get_usage: 'usage',

  // qa / tdd
  map_user_stories: 'qa',
  get_map_run_status: 'qa',
  generate_tdd_from_story: 'qa',
  improve_qa_story: 'qa',
  run_qa_story: 'qa',
  list_pending_review_stories: 'qa',
  approve_qa_story: 'qa',
  list_qa_story_runs: 'qa',
  get_qa_story_run: 'qa',
  test_notification_channel: 'qa',

  // skills
  list_skills: 'skills',
  get_skill: 'skills',
  start_skill_pipeline: 'skills',
  get_pipeline_run: 'skills',
  checkin_pipeline_step: 'skills',
  list_byok_keys: 'skills',
  add_byok_key: 'skills',

  // audit
  run_fullstack_audit: 'audit',
  get_backend_health: 'audit',

  // docs
  search_mushi_docs: 'docs',
}

/** Tools superseded by another — still registered when legacy/all enabled. */
export const DEPRECATED_TOOL_ALIASES: Record<string, string> = {
  setup_check: 'diagnose_setup',
  ingest_setup_check: 'diagnose_setup',
  get_activation_status: 'activation_status',
  get_reporter_thread: 'get_report_timeline',
}

export type FeatureFilter = 'all' | readonly FeatureGroup[]

export function parseFeaturesParam(raw: string | null | undefined): FeatureFilter {
  if (raw == null || raw.trim() === '') return 'all'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'all' || normalized === '*') return 'all'
  const groups = normalized
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as FeatureGroup[]
  const valid = groups.filter((g) => (FEATURE_GROUPS as readonly string[]).includes(g))
  if (valid.length === 0) return 'all'
  // `legacy` implies nothing extra unless explicitly listed; `all` handled above.
  return valid
}

export function parseFeaturesCsv(raw: string | undefined): FeatureFilter {
  if (!raw?.trim()) return 'all'
  return parseFeaturesParam(raw)
}

export function toolMatchesFeatures(toolName: string, filter: FeatureFilter): boolean {
  if (filter === 'all') return true
  const group = TOOL_FEATURE_MAP[toolName]
  if (!group) return true // unknown tools stay visible (codegen drift guard)
  if (group === 'legacy') {
    return filter.includes('legacy')
  }
  return filter.includes(group)
}

export function featuresQueryString(groups: readonly FeatureGroup[]): string {
  return groups.join(',')
}

export function appendFeaturesToUrl(baseUrl: string, groups: readonly FeatureGroup[]): string {
  const url = new URL(baseUrl)
  url.searchParams.set('features', featuresQueryString(groups))
  return url.toString()
}
