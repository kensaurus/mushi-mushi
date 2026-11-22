/**
 * FILE: apps/admin/src/lib/publicDemo.ts
 * PURPOSE: The public demo app ("Mushi demo (sample data)", slug `mushi-demo`).
 *          Its key powers the docs site's try-it page and its reports are
 *          fixtures, so it is never an app that "needs you" (Manage apps,
 *          the Apps page). Matched exactly, not by "name contains demo": a
 *          customer's own app called "demo-app" is a real app.
 */

export function isPublicDemo(p: { name: string | null; slug: string | null }): boolean {
  return p.slug === 'mushi-demo' || /\(sample data\)\s*$/i.test(p.name ?? '')
}
