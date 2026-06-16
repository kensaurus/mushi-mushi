/**
 * FILE: apps/admin/src/lib/tenantUrlSanitize.ts
 * PURPOSE: Strip invalid org/project query params before any API fetch runs.
 *
 * Switchers clean bad `?org=` / `?project=` values in useEffect, but dashboard
 * hooks fire first — WAF can 403 requests whose Referer carries XSS/SQLi text.
 */

import {
  ACTIVE_ORG_QUERY_PARAM,
  isValidOrgId,
} from './activeOrg'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  isValidProjectId,
} from './activeProject'

/** Remove non-UUID tenant params from the current URL (replaceState, no navigation). */
export function sanitizeTenantUrlParams(): boolean {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  let dirty = false

  const org = url.searchParams.get(ACTIVE_ORG_QUERY_PARAM)
  if (org && !isValidOrgId(org)) {
    url.searchParams.delete(ACTIVE_ORG_QUERY_PARAM)
    dirty = true
  }

  const project = url.searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
  if (project && !isValidProjectId(project)) {
    url.searchParams.delete(ACTIVE_PROJECT_QUERY_PARAM)
    dirty = true
  }

  if (!dirty) return false

  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(window.history.state, '', next)
  return true
}
