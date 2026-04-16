/**
 * FILE: apps/admin/src/components/icons.tsx
 * PURPOSE: Hand-crafted 16×16 inline SVG icon set for the admin sidebar.
 *          Stroke-based, uses currentColor, no external library dependency.
 *          Each icon is designed for the specific nav concept it represents.
 */

import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

const defaults: Required<Pick<IconProps, 'size'>> = { size: 16 }

function wrap(props: IconProps, children: ReactNode) {
  const s = props.size ?? defaults.size
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconDashboard(p: IconProps) {
  return wrap(p, <>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="3" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="7" width="5" height="7" rx="1" />
  </>)
}

export function IconReports(p: IconProps) {
  return wrap(p, <>
    <path d="M4 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    <line x1="5.5" y1="5" x2="10.5" y2="5" />
    <line x1="5.5" y1="7.5" x2="10.5" y2="7.5" />
    <line x1="5.5" y1="10" x2="8" y2="10" />
  </>)
}

export function IconGraph(p: IconProps) {
  return wrap(p, <>
    <circle cx="5" cy="5" r="1.5" />
    <circle cx="11" cy="4" r="1.5" />
    <circle cx="8" cy="11" r="1.5" />
    <line x1="6.2" y1="5.8" x2="7" y2="9.8" />
    <line x1="9.5" y1="4.8" x2="9" y2="9.8" />
    <line x1="6.5" y1="4.5" x2="9.5" y2="4.2" />
  </>)
}

export function IconJudge(p: IconProps) {
  return wrap(p, <>
    <path d="M8 2l1.8 3.6 4 .6-2.9 2.8.7 4L8 11.2 4.4 13l.7-4-2.9-2.8 4-.6z" />
  </>)
}

export function IconQuery(p: IconProps) {
  return wrap(p, <>
    <circle cx="7" cy="7" r="4" />
    <line x1="10" y1="10" x2="13.5" y2="13.5" />
    <line x1="5.5" y1="7" x2="8.5" y2="7" />
  </>)
}

export function IconFixes(p: IconProps) {
  return wrap(p, <>
    <path d="M10 2.5l3.5 3.5-8 8H2v-3.5z" />
    <line x1="8.5" y1="4" x2="12" y2="7.5" />
  </>)
}

export function IconProjects(p: IconProps) {
  return wrap(p, <>
    <rect x="2" y="4" width="12" height="10" rx="1" />
    <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <line x1="2" y1="8" x2="14" y2="8" />
  </>)
}

export function IconIntegrations(p: IconProps) {
  return wrap(p, <>
    <path d="M6 3v3a2 2 0 0 1-2 2H3" />
    <path d="M10 3v3a2 2 0 0 0 2 2h1" />
    <path d="M6 13v-3a2 2 0 0 0-2-2H3" />
    <path d="M10 13v-3a2 2 0 0 1 2-2h1" />
  </>)
}

export function IconQueue(p: IconProps) {
  return wrap(p, <>
    <rect x="3" y="3" width="10" height="3" rx="0.5" />
    <rect x="3" y="7.5" width="10" height="3" rx="0.5" />
    <line x1="5" y1="12" x2="11" y2="12" />
    <line x1="6" y1="13.5" x2="10" y2="13.5" />
  </>)
}

export function IconSSO(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="6" r="2.5" />
    <path d="M8 8.5v5" />
    <line x1="6.5" y1="11" x2="8" y2="12.5" />
    <line x1="9.5" y1="11" x2="8" y2="12.5" />
  </>)
}

export function IconAudit(p: IconProps) {
  return wrap(p, <>
    <path d="M3 3h10v11H3z" />
    <line x1="5" y1="5.5" x2="7" y2="5.5" />
    <line x1="5" y1="7.5" x2="11" y2="7.5" />
    <line x1="5" y1="9.5" x2="11" y2="9.5" />
    <line x1="5" y1="11.5" x2="9" y2="11.5" />
    <path d="M9 2v2" />
    <path d="M7 2v2" />
  </>)
}

export function IconFineTuning(p: IconProps) {
  return wrap(p, <>
    <line x1="3" y1="4" x2="13" y2="4" />
    <line x1="3" y1="8" x2="13" y2="8" />
    <line x1="3" y1="12" x2="13" y2="12" />
    <circle cx="5.5" cy="4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="7" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </>)
}

export function IconSettings(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" />
  </>)
}

export function IconMenu(p: IconProps) {
  return wrap(p, <>
    <line x1="2" y1="4" x2="14" y2="4" />
    <line x1="2" y1="8" x2="14" y2="8" />
    <line x1="2" y1="12" x2="14" y2="12" />
  </>)
}

export function IconClose(p: IconProps) {
  return wrap(p, <>
    <line x1="4" y1="4" x2="12" y2="12" />
    <line x1="12" y1="4" x2="4" y2="12" />
  </>)
}

export function IconSignOut(p: IconProps) {
  return wrap(p, <>
    <path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3" />
    <polyline points="10,4 14,8 10,12" />
    <line x1="14" y1="8" x2="6" y2="8" />
  </>)
}
