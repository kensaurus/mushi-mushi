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

export function IconHealth(p: IconProps) {
  return wrap(p, <>
    <path d="M2 8h3l1.5-3 3 6 1.5-3H14" />
  </>)
}

export function IconShield(p: IconProps) {
  return wrap(p, <>
    <path d="M8 1.5 3 3.5v4.2c0 3 2.1 5.6 5 6.3 2.9-.7 5-3.3 5-6.3V3.5L8 1.5z" />
    <path d="M6 8.2l1.6 1.6L10.5 7" />
  </>)
}

export function IconBell(p: IconProps) {
  return wrap(p, <>
    <path d="M3.5 11h9l-1-1.5V7a3.5 3.5 0 0 0-7 0v2.5L3.5 11z" />
    <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
  </>)
}

export function IconIntelligence(p: IconProps) {
  return wrap(p, <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    <path d="M5 10V7" />
    <path d="M8 10V5" />
    <path d="M11 10V8.5" />
  </>)
}

export function IconCompliance(p: IconProps) {
  return wrap(p, <>
    <path d="M8 1.5l5 2v4c0 3.5-2.2 6-5 7-2.8-1-5-3.5-5-7v-4l5-2z" />
    <path d="M5.5 8l1.8 1.8L11 6.5" />
  </>)
}

export function IconStorage(p: IconProps) {
  return wrap(p, <>
    <ellipse cx="8" cy="3.5" rx="5.5" ry="1.5" />
    <path d="M2.5 3.5v9c0 .8 2.5 1.5 5.5 1.5s5.5-.7 5.5-1.5v-9" />
    <path d="M2.5 8c0 .8 2.5 1.5 5.5 1.5s5.5-.7 5.5-1.5" />
  </>)
}

export function IconMarketplace(p: IconProps) {
  return wrap(p, <>
    <path d="M2 5.5h12l-1 7.5a1 1 0 0 1-1 .9H4a1 1 0 0 1-1-.9L2 5.5Z" />
    <path d="M5.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5" />
    <path d="M6 9h4" />
  </>)
}

export function IconUser(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
  </>)
}

export function IconSparkle(p: IconProps) {
  return wrap(p, <>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3" />
    <path d="M8 4.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5L4.5 8l2.5-1z" />
  </>)
}

export function IconGlobe(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12" />
    <path d="M8 2c2 2 2.5 3.8 2.5 6S10 12 8 14c-2-2-2.5-3.8-2.5-6S6 4 8 2z" />
  </>)
}

export function IconGauge(p: IconProps) {
  return wrap(p, <>
    <path d="M3 11a5 5 0 0 1 10 0" />
    <path d="M3 11h10" />
    <path d="M8 11l3-3" strokeLinecap="round" />
    <circle cx="8" cy="11" r="0.8" fill="currentColor" stroke="none" />
  </>)
}

export function IconTerminal(p: IconProps) {
  return wrap(p, <>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M5 6.5l2 1.5-2 1.5" strokeLinecap="round" />
    <line x1="8.5" y1="10" x2="11" y2="10" strokeLinecap="round" />
  </>)
}

export function IconNetwork(p: IconProps) {
  return wrap(p, <>
    <circle cx="3.5" cy="8" r="1.5" />
    <circle cx="12.5" cy="4.5" r="1.5" />
    <circle cx="12.5" cy="11.5" r="1.5" />
    <line x1="5" y1="8" x2="11" y2="5" />
    <line x1="5" y1="8" x2="11" y2="11" />
  </>)
}

export function IconChat(p: IconProps) {
  return wrap(p, <>
    <path d="M2.5 4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11H3.5a1 1 0 0 1-1-1z" />
    <line x1="5" y1="6" x2="11" y2="6" />
    <line x1="5" y1="8.5" x2="9" y2="8.5" />
  </>)
}

export function IconCamera(p: IconProps) {
  return wrap(p, <>
    <path d="M2 5.5a1 1 0 0 1 1-1h2l1-1.5h4l1 1.5h2a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    <circle cx="8" cy="8.75" r="2.25" />
  </>)
}

export function IconCopy(p: IconProps) {
  return wrap(p, <>
    <rect x="5" y="5" width="8.5" height="8.5" rx="1" />
    <path d="M11 5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5" />
  </>)
}

export function IconCheck(p: IconProps) {
  return wrap(p, <>
    <polyline points="3,8.5 6.5,12 13,4.5" />
  </>)
}

export function IconLink(p: IconProps) {
  return wrap(p, <>
    <path d="M6.5 9.5L9.5 6.5" />
    <path d="M9 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L12.5 8" />
    <path d="M7 12l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L3.5 8.5" />
  </>)
}

export function IconArrowRight(p: IconProps) {
  return wrap(p, <>
    <line x1="3" y1="8" x2="13" y2="8" strokeLinecap="round" />
    <polyline points="9.5,4.5 13,8 9.5,11.5" strokeLinecap="round" />
  </>)
}

export function IconClock(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="8" r="6" />
    <polyline points="8,4.5 8,8 10.5,9.5" strokeLinecap="round" />
  </>)
}

export function IconExternalLink(p: IconProps) {
  return wrap(p, <>
    <path d="M9 3h4v4" />
    <line x1="13" y1="3" x2="8" y2="8" strokeLinecap="round" />
    <path d="M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" />
  </>)
}

export function IconAlertTriangle(p: IconProps) {
  return wrap(p, <>
    <path d="M8 2.5L14 12.5H2z" strokeLinejoin="round" />
    <line x1="8" y1="6.5" x2="8" y2="9.5" />
    <circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" />
  </>)
}
