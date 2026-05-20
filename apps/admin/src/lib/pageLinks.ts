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
  inbox: [
    { to: '/reports', label: 'Reports', blurb: 'Full report list with filters' },
    { to: '/dashboard', label: 'Dashboard', blurb: 'Pipeline health at a glance' },
    { to: '/fixes', label: 'Fixes', blurb: 'AI-generated fix pull requests' },
  ],
  dashboard: [
    { to: '/inbox', label: 'Inbox', blurb: 'Actionable items needing a decision' },
    { to: '/reports', label: 'Reports', blurb: 'All reports with full detail' },
    { to: '/iterate', label: 'Iterate', blurb: 'PDCA producer–critic loop' },
  ],
  reports: [
    { to: '/inbox', label: 'Inbox', blurb: 'Prioritised action queue' },
    { to: '/fixes', label: 'Fixes', blurb: 'Fix PRs for resolved reports' },
    { to: '/lessons', label: 'Lessons', blurb: 'Patterns learned from past bugs' },
  ],
  fixes: [
    { to: '/reports', label: 'Reports', blurb: 'Source reports for each fix' },
    { to: '/releases', label: 'Releases', blurb: 'Changelogs with reporter credit' },
    { to: '/inbox', label: 'Inbox', blurb: 'Outstanding items to action' },
  ],
  lessons: [
    { to: '/reports', label: 'Reports', blurb: 'Raw reports that generated lessons' },
    { to: '/iterate', label: 'Iterate', blurb: 'Apply lessons in a PDCA loop' },
    { to: '/explore', label: 'Explore', blurb: 'Codebase Atlas — indexed files' },
  ],
  releases: [
    { to: '/fixes', label: 'Fixes', blurb: 'Fix PRs behind each release' },
    { to: '/rewards', label: 'Rewards', blurb: 'End-user reward toasts on ship' },
    { to: '/dashboard', label: 'Dashboard', blurb: 'Pipeline overview' },
  ],
  explore: [
    { to: '/lessons', label: 'Lessons', blurb: 'Bug patterns learned from the codebase' },
    { to: '/settings', label: 'Settings', blurb: 'Configure codebase indexing' },
    { to: '/reports', label: 'Reports', blurb: 'Reports linked to indexed files' },
  ],
  iterate: [
    { to: '/dashboard', label: 'Dashboard', blurb: 'Baseline metrics for comparison' },
    { to: '/lessons', label: 'Lessons', blurb: 'Apply past learnings' },
    { to: '/settings', label: 'Settings', blurb: 'Iteration persona config' },
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
  mcp: [
    { to: '/sdk', label: 'SDK Setup', blurb: 'Browser-side capture widget' },
    { to: '/settings', label: 'Settings', blurb: 'API keys and project config' },
    { to: '/lessons', label: 'Lessons', blurb: 'MCP injects lessons into AI context' },
  ],
}
