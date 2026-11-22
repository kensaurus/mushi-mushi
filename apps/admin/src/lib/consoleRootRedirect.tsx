/**
 * FILE: apps/admin/src/lib/consoleRootRedirect.tsx
 * PURPOSE: Send the console root (`/`, served as `/admin/`) to Home
 *          (/dashboard) without dropping the query or hash.
 *
 * The root sent people to Bugs (/reports) from 2026-10-20 (PR 500, before the
 * per-app Home existed). Home is now the app's overview with "Needs you", so a
 * bare `/admin/` opens there, as sign-in does (console review 2026-11-22).
 *
 * Opening `/admin/?project=<id>` once landed with no query, and the header then
 * wrote the previously stored app into the URL, so the link opened the wrong
 * app: the query and hash are kept.
 *
 * DEPENDENCIES: react-router-dom (`Navigate`, `useLocation`).
 * USAGE: the `/` route in App.tsx.
 */

import { Navigate, useLocation } from 'react-router-dom'

export function ConsoleRootRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: '/dashboard', search, hash }} replace />
}
