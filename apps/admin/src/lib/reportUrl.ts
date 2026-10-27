/**
 * FILE: apps/admin/src/lib/reportUrl.ts
 * PURPOSE: Build shareable absolute URLs to admin report-detail pages.
 *
 * WHY THIS EXISTS
 * ---------------
 * The admin SPA is served from a non-root path in production
 * (`/mushi-mushi/admin/` on kensaur.us). `window.location.origin` alone
 * always yields the bare domain, so naively writing
 *   `${window.location.origin}/reports/${id}`
 * produces `https://kensaur.us/reports/<id>` — a 404 at the apex because
 * S3 has no key at `reports/<id>/index.html`.
 *
 * `import.meta.env.BASE_URL` is injected by Vite at build time using the
 * `VITE_BASE_PATH` env var (see vite.config.ts). On kensaur.us it becomes
 * `/mushi-mushi/admin/`. Locally it is `/`. The resulting URL is therefore
 * always correct regardless of deployment prefix.
 *
 * USAGE
 *   import { reportPermalink, reportDetailPath, skillTriagePermalink } from '@/lib/reportUrl'
 *   navigate(reportDetailPath(report.id, activeProjectId))
 *   navigator.clipboard.writeText(reportPermalink(report.id, activeProjectId))
 *   navigator.clipboard.writeText(skillTriagePermalink(report.id, projectId, skillSlug))
 */

import { isValidProjectId } from './activeProject'
import { scopedHref } from './humanPageHints'
import { appUrl } from './appPath'

/** In-app router path for a report detail view, preserving project scope. */
export function reportDetailPath(reportId: string, projectId?: string | null): string {
  const base = `/reports/${encodeURIComponent(reportId)}`
  if (projectId && isValidProjectId(projectId)) return scopedHref(base, projectId)
  return base
}

/**
 * Returns the fully-qualified shareable URL for a given report ID.
 * Safe to copy-to-clipboard or embed in Slack / Discord notifications.
 */
export function reportPermalink(reportId: string, projectId?: string | null): string {
  return appUrl(reportDetailPath(reportId, projectId))
}

/**
 * Absolute triage URL for one recommended skill on a report.
 * Keeps `?project=` when the id is valid: the console pins the project from
 * the URL before local storage, and a link without it opens under whatever
 * app the recipient had open (the report-detail 404 calls that mismatch out).
 * The skill slug is set as a query parameter, never concatenated, so a slug
 * cannot inject extra parameters.
 */
export function skillTriagePermalink(
  reportId: string,
  projectId: string | null | undefined,
  skillSlug: string,
): string {
  const path = reportDetailPath(reportId, projectId)
  const q = path.indexOf('?')
  const pathname = q === -1 ? path : path.slice(0, q)
  const params = new URLSearchParams(q === -1 ? '' : path.slice(q + 1))
  const slug = skillSlug.trim()
  if (slug) params.set('skill', slug)
  const merged = params.toString()
  return appUrl(merged ? `${pathname}?${merged}` : pathname)
}

/**
 * Returns the fully-qualified URL for the current admin view, including
 * filters in the query string and any hash anchor.
 */
export function currentAdminViewUrl(): string {
  if (typeof window === 'undefined') return ''
  return window.location.href
}
