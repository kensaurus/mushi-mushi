/**
 * FILE: apps/admin/src/lib/pageNavIcons.ts
 * PURPOSE: Maps route paths to icon components for PageRelatedLinks. Returns
 *          undefined when no icon is registered so callers can fall back to a
 *          text arrow.
 *
 * 2026-09-23: this file used to hold its own hand-drawn set (stroke 1.5, a
 * different dashboard / reports / settings glyph than the sidebar's 1.4-stroke
 * icons). It now resolves through the nav registry, so a page shows the same
 * icon in the sidebar, the rail and every "Related pages" card.
 */

import type { ComponentType } from 'react'
import { navIconForRoute } from './buildNav'

type IconComponent = ComponentType<{ size?: number; className?: string }>

/** Returns the page's sidebar icon for a route path, or undefined if none. */
export function navIconForPath(to: string): IconComponent | undefined {
  return navIconForRoute(to)
}
