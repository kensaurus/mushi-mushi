/**
 * FILE: apps/admin/src/lib/bodyPortal.ts
 * PURPOSE: Render an overlay (modal, drawer, palette backdrop) into <body>.
 *
 *          A `position: fixed` element is fixed to its nearest ancestor with a
 *          transform, filter or backdrop-filter, not to the viewport. Page
 *          shells, KPI tiles and cards animate transforms, so a modal opened
 *          from inside one dimmed only that box: the sidebar and header stayed
 *          bright, as if highlighted (owner report, 2026-10-24).
 */

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

export function toBody(node: ReactNode): ReactNode {
  return typeof document === 'undefined' ? node : createPortal(node, document.body)
}
