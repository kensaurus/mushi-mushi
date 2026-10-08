/**
 * FILE: apps/admin/src/lib/pageLinks.ts
 * PURPOSE: Route-to-related-links registry used by PageHelp and PageRelatedLinks.
 *
 * Each entry maps a route key (usually the pathname segment after the first /)
 * to an ordered list of PageFlowLink objects that are contextually adjacent to
 * that page. Centralised here so copy.ts and ui.tsx share the same source.
 */

export interface PageFlowLink {
  to: string
  label: string
  /** One-line description shown as a subtitle on the link card. */
  blurb?: string
}

/** Resolves the route key from a full pathname. Strips leading/trailing slashes
 *  and returns the first segment (e.g. "/inbox/" → "inbox"). */
export function resolveFlowPath(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? ''
}

/** Returns the blurb string for a link (falls back to empty string). */
export function flowLinkBlurb(link: PageFlowLink): string {
  return link.blurb ?? ''
}

/** Route-key → related page links. Only the most useful 3–5 per page. */
export const PAGE_FLOW_LINKS: Record<string, PageFlowLink[]> = {
  dashboard: [
    { to: '/inbox', label: 'To-do', blurb: 'What needs a decision now' },
    { to: '/reports', label: 'Bugs', blurb: 'Every report, newest first' },
    { to: '/fixes', label: 'Fixes', blurb: 'Fix attempts and their PRs' },
  ],
  inbox: [
    { to: '/dashboard', label: 'Home', blurb: 'Where the loop is stuck' },
    { to: '/reports', label: 'Bugs', blurb: 'Every report' },
    { to: '/fixes', label: 'Fixes', blurb: 'Fix attempts and their PRs' },
  ],
  reports: [
    { to: '/graph', label: 'Bug clusters', blurb: 'Bugs that share a cause' },
    { to: '/fixes', label: 'Fixes', blurb: 'Fix attempts for these bugs' },
    { to: '/lessons', label: 'Lessons', blurb: 'Rules learned from repeats' },
  ],
  graph: [
    { to: '/reports', label: 'Bugs', blurb: 'The reports in each cluster' },
    { to: '/explore', label: 'Code map', blurb: 'Where the cluster lives in code' },
    { to: '/lessons', label: 'Lessons', blurb: 'Turn a cluster into a rule' },
  ],
  voice: [
    { to: '/reports', label: 'Bugs', blurb: 'Reports filed by voice' },
    { to: '/fixes', label: 'Fixes', blurb: 'Fixes dispatched by voice' },
  ],
  'anti-gaming': [
    { to: '/reports', label: 'Bugs', blurb: 'Reports from flagged devices' },
    { to: '/rewards', label: 'Tester rewards', blurb: 'Points the flags hold back' },
  ],
  fixes: [
    { to: '/repo', label: 'Pull requests', blurb: 'Every open PR, with Merge' },
    { to: '/reports', label: 'Bugs', blurb: 'The report behind each fix' },
    { to: '/judge', label: 'Triage grading', blurb: 'How good the diagnoses are' },
  ],
  repo: [
    { to: '/fixes', label: 'Fixes', blurb: 'Attempts behind each branch' },
    { to: '/releases', label: 'Releases', blurb: 'What a merge shipped' },
    { to: '/integrations/config', label: 'Integrations', blurb: 'GitHub connection' },
  ],
  'ux-runs': [
    { to: '/repo', label: 'Pull requests', blurb: 'Merge a run’s PR' },
    { to: '/design', label: 'Design system', blurb: 'Tokens a run touched' },
    { to: '/reports', label: 'Bugs', blurb: 'Screens filed as bugs' },
  ],
  iterate: [
    { to: '/ux-runs', label: 'UX runs', blurb: 'Screen-by-screen agent runs' },
    { to: '/fixes', label: 'Fixes', blurb: 'Fix attempts' },
  ],
  explore: [
    { to: '/reports', label: 'Bugs', blurb: 'Bugs by file' },
    { to: '/fixes', label: 'Fixes', blurb: 'Fixes touching these files' },
    { to: '/graph', label: 'Bug clusters', blurb: 'Clusters by component' },
  ],
  judge: [
    { to: '/lessons', label: 'Lessons', blurb: 'Low scores become rules' },
    { to: '/prompt-lab', label: 'AI prompts', blurb: 'The prompts being graded' },
    { to: '/reports', label: 'Bugs', blurb: 'The graded reports' },
  ],
  lessons: [
    { to: '/reports', label: 'Bugs', blurb: 'Reports behind each lesson' },
    { to: '/judge', label: 'Triage grading', blurb: 'Where lessons come from' },
    { to: '/graph', label: 'Bug clusters', blurb: 'Clusters to promote' },
  ],
  'prompt-lab': [
    { to: '/judge', label: 'Triage grading', blurb: 'Scores for each prompt' },
    { to: '/lessons', label: 'Lessons', blurb: 'Rules the prompts follow' },
  ],
  recipe: [
    { to: '/fullstack-audit', label: 'Full-stack audit', blurb: 'Every check, with findings' },
    { to: '/design', label: 'Design system', blurb: 'Tokens and drift' },
    { to: '/health', label: 'App health', blurb: 'AI calls and jobs' },
  ],
  'fullstack-audit': [
    { to: '/recipe', label: 'App blueprint', blurb: 'What the app is made of' },
    { to: '/inventory', label: 'User stories', blurb: 'The pages being checked' },
    { to: '/health', label: 'App health', blurb: 'AI calls and jobs' },
  ],
  'qa-coverage': [
    { to: '/reports', label: 'Bugs', blurb: 'Bugs a failing test found' },
    { to: '/inventory', label: 'User stories', blurb: 'Stories the tests cover' },
  ],
  design: [
    { to: '/ux-runs', label: 'UX runs', blurb: 'Fix screens screen by screen' },
    { to: '/recipe', label: 'App blueprint', blurb: 'Where tokens come from' },
  ],
  inventory: [
    { to: '/fullstack-audit', label: 'Full-stack audit', blurb: 'Crawl and contract checks' },
    { to: '/qa-coverage', label: 'Scheduled tests', blurb: 'Tests for each story' },
  ],
  content: [
    { to: '/reports', label: 'Bugs', blurb: 'Reports about content' },
    { to: '/judge', label: 'Triage grading', blurb: 'How content is scored' },
  ],
  health: [
    { to: '/integrations/config', label: 'Integrations', blurb: 'Connections and probes' },
    { to: '/fullstack-audit', label: 'Full-stack audit', blurb: 'Every check, with findings' },
  ],
  releases: [
    { to: '/fixes', label: 'Fixes', blurb: 'Fixes in each release' },
    { to: '/repo', label: 'Pull requests', blurb: 'Merge what ships next' },
    { to: '/notifications', label: 'Reporter updates', blurb: 'What reporters were told' },
  ],
  experiments: [
    { to: '/releases', label: 'Releases', blurb: 'What shipped' },
    { to: '/ux-runs', label: 'UX runs', blurb: 'Variants from a UX run' },
  ],
  research: [
    { to: '/reports', label: 'Bugs', blurb: 'Pin evidence to a bug' },
    { to: '/lessons', label: 'Lessons', blurb: 'Turn evidence into a rule' },
  ],
  integrations: [
    { to: '/mcp', label: 'Editor agents', blurb: 'Connect your editor' },
    { to: '/notifications', label: 'Reporter updates', blurb: 'What reporters see' },
    { to: '/health', label: 'App health', blurb: 'Probe history' },
  ],
  mcp: [
    { to: '/connect', label: 'Connect', blurb: 'One-click editor install' },
    { to: '/skills', label: 'Agent skills', blurb: 'Skills your agent can run' },
    { to: '/integrations/config', label: 'Integrations', blurb: 'Cloud fix agents' },
  ],
  skills: [
    { to: '/mcp', label: 'Editor agents', blurb: 'Run skills from your editor' },
    { to: '/fixes', label: 'Fixes', blurb: 'Fixes a skill produced' },
  ],
  notifications: [
    { to: '/integrations/config#alerts', label: 'Alert routing', blurb: 'Which events reach Slack or Discord' },
    { to: '/releases', label: 'Releases', blurb: 'Tell reporters what shipped' },
    { to: '/reports', label: 'Bugs', blurb: 'The reports behind each update' },
  ],
  marketplace: [
    { to: '/integrations/config', label: 'Integrations', blurb: 'Built-in connections' },
  ],
  queue: [
    { to: '/reports', label: 'Bugs', blurb: 'Reports being processed' },
    { to: '/health', label: 'App health', blurb: 'Scheduled jobs' },
  ],
  settings: [
    { to: '/dashboard', label: 'Dashboard', blurb: 'See the effect of your config' },
    { to: '/explore', label: 'Explore', blurb: 'Browse indexed codebase' },
    { to: '/sdk', label: 'SDK Setup', blurb: 'Embed the capture widget' },
  ],
  sdk: [
    { to: '/settings', label: 'Settings', blurb: 'API keys and project config' },
    { to: '/dashboard', label: 'Dashboard', blurb: 'Verify SDK is sending data' },
    { to: '/mcp', label: 'MCP Setup', blurb: 'Model Context Protocol server' },
  ],
}
