/**
 * FILE: apps/admin/src/lib/pageNavIcons.ts
 * PURPOSE: Maps route paths to inline SVG icon components for use in
 *          PageRelatedLinks. Returns undefined when no icon is registered
 *          so callers can fall back to a text arrow.
 *
 * Icons are pure functional components accepting a `size` prop (number, px).
 * No external icon library dependency — keeps the chunk small.
 */

import React from 'react'

type IconProps = { size?: number; className?: string }
type IconComponent = (props: IconProps) => React.ReactElement

function makeIcon(path: string): IconComponent {
  return function Icon({ size = 16, className = '' }: IconProps) {
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        'aria-hidden': true,
        className,
      },
      React.createElement('path', { d: path }),
    )
  }
}

// Minimal icon set for the routes we register links for.
const ICONS: Record<string, IconComponent> = {
  inbox: makeIcon(
    'M2 11V5a1 1 0 011-1h10a1 1 0 011 1v6M2 11h3l1.5 2h3L11 11h3M2 11a1 1 0 000 2h12a1 1 0 000-2',
  ),
  dashboard: makeIcon('M2 12h4V8H2v4zm5 2h4V6H7v8zm5-5h4V9h-4v3z'),
  reports: makeIcon(
    'M4 1h8a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1zm2 4h4m-4 3h4m-4 3h2',
  ),
  fixes: makeIcon(
    'M12 2l2 2-9.5 9.5-2.5.5.5-2.5L12 2zm-3 11l1 1M3 13l1 1',
  ),
  lessons: makeIcon(
    'M8 1C4.7 1 2 3.7 2 7s2.7 6 6 6 6-2.7 6-6-2.7-6-6-6zm0 3v4l2.5 1.5',
  ),
  releases: makeIcon('M8 1l1.5 5.5H15l-4.5 3.3 1.7 5.2L8 12l-4.2 3 1.7-5.2L1 6.5h5.5z'),
  explore: makeIcon(
    'M11 11l3 3m-6-1A5 5 0 105 5a5 5 0 006 10z',
  ),
  iterate: makeIcon('M4 4l8 4-8 4V4zm0 0v8'),
  settings: makeIcon(
    'M8 5a3 3 0 100 6 3 3 0 000-6zm5.3 1.7l-.9-1.6-1.6.5a5.2 5.2 0 00-1.6-.9L9 3H7l-.2 1.7a5.2 5.2 0 00-1.6.9l-1.6-.5-.9 1.6 1.3 1.1a5.2 5.2 0 000 1.8L2.7 10.6l.9 1.6 1.6-.5c.5.4 1 .7 1.6.9L7 14h2l.2-1.7c.6-.2 1.1-.5 1.6-.9l1.6.5.9-1.6-1.3-1.1c.1-.3.1-.6.1-.9s0-.6-.1-.9l1.3-1.1z',
  ),
  sdk: makeIcon('M6 3L2 8l4 5m4-10l4 5-4 5'),
  mcp: makeIcon(
    'M13 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V3a1 1 0 00-1-1zM5 6h6m-6 4h4',
  ),
  rewards: makeIcon('M8 1l1.5 3 3.5.5-2.5 2.5.6 3.5L8 9l-3.1 1.5.6-3.5L3 4.5 6.5 4z'),
}

/** Returns an icon component for a given route path, or undefined if none registered. */
export function navIconForPath(to: string): IconComponent | undefined {
  const key = to.replace(/^\/+|\/+$/g, '').split('/')[0]
  return key ? ICONS[key] : undefined
}
