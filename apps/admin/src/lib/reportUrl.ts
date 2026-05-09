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
 *   import { reportPermalink } from '@/lib/reportUrl'
 *   navigator.clipboard.writeText(reportPermalink(report.id))
 */

/**
 * Returns the fully-qualified shareable URL for a given report ID.
 * Safe to copy-to-clipboard or embed in Slack / Discord notifications.
 *
 * Examples (production, BASE_URL = "/mushi-mushi/admin/"):
 *   reportPermalink("abc-123")
 *   → "https://kensaur.us/mushi-mushi/admin/reports/abc-123"
 *
 * Examples (local dev, BASE_URL = "/"):
 *   reportPermalink("abc-123")
 *   → "http://localhost:6464/reports/abc-123"
 */
export function reportPermalink(reportId: string): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
  return `${window.location.origin}${base}/reports/${encodeURIComponent(reportId)}`
}
