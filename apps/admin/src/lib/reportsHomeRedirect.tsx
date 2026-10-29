/**
 * FILE: apps/admin/src/lib/reportsHomeRedirect.tsx
 * PURPOSE: Send the console root (`/`, served as `/admin/`) to /reports
 *          without dropping the query or hash.
 *
 * Opening `/admin/?project=<id>` used to land on `/reports` with no query.
 * The header then wrote the previously stored app into the URL, so the link
 * opened the wrong app.
 *
 * DEPENDENCIES: react-router-dom (`Navigate`, `useLocation`).
 * USAGE: the `/` route in App.tsx.
 */

import { Navigate, useLocation } from 'react-router-dom'

export function ReportsHomeRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: '/reports', search, hash }} replace />
}
