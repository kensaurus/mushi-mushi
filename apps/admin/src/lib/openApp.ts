/**
 * FILE: apps/admin/src/lib/openApp.ts
 * PURPOSE: Open one app's page from a page that lists several (the Apps page
 *          cards and rows). The link names the app in `?project=` and drops
 *          `?apps=all`, and the click does what the header switcher's pick
 *          does: store the app and leave "All apps" mode.
 *
 *          Owner, 2026-11-17: every link on a kensaur.us card opened
 *          mushi-mushi's App blueprint. The click only stored the app, the
 *          URL kept the old `?project=` and `?apps=all`, and the switcher
 *          prefers the URL, so the old app won.
 *
 *          The switcher records the team's last-used app itself once the
 *          URL names it, so this does not.
 */

import { ACTIVE_PROJECT_QUERY_PARAM, pickActiveProject } from './activeProject'
import { PROJECT_SCOPE_QUERY_PARAM, setStoredProjectScopeMode } from './projectScope'

/** `to` with `?project=<projectId>` and without `?apps`; its own query and hash survive. */
export function appLink(to: string, projectId: string): string {
  const hashAt = to.indexOf('#')
  const hash = hashAt >= 0 ? to.slice(hashAt) : ''
  const beforeHash = hashAt >= 0 ? to.slice(0, hashAt) : to
  const queryAt = beforeHash.indexOf('?')
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash
  const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '')
  params.set(ACTIVE_PROJECT_QUERY_PARAM, projectId)
  params.delete(PROJECT_SCOPE_QUERY_PARAM)
  return `${path}?${params.toString()}${hash}`
}

/** The person picked this app: store it and leave "All apps" mode, before the link navigates. */
export function openApp(projectId: string): void {
  pickActiveProject(projectId)
  setStoredProjectScopeMode('project')
}
