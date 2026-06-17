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

export function IconStory(p: IconProps) {
  return wrap(p, <>
    <rect x="2.5" y="2" width="9" height="6" rx="0.8" />
    <rect x="3.5" y="4" width="9" height="6" rx="0.8" />
    <rect x="4.5" y="6" width="9" height="6" rx="0.8" />
    <line x1="6.5" y1="8.5" x2="11" y2="8.5" />
    <line x1="6.5" y1="10" x2="9.5" y2="10" />
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

/** Codebase atlas / explore — layered files icon */
export function IconExplore(p: IconProps) {
  return wrap(p, <>
    <path d="M2 5h5M2 8h4M2 11h3" />
    <path d="M9 3h5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <line x1="11" y1="6" x2="13" y2="6" />
    <line x1="11" y1="9" x2="13" y2="9" />
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

export function IconBilling(p: IconProps) {
  return wrap(p, <>
    <rect x="2" y="4" width="12" height="9" rx="1.5" />
    <path d="M2 7h12" />
    <path d="M5 10.5h2.5" />
  </>)
}

export function IconUser(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
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

/** Circle-i glyph for metric help triggers (StatCard, InfoHint). */
export function IconInfo(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="8" r="6" />
    <line x1="8" y1="7.25" x2="8" y2="11" strokeLinecap="round" />
    <circle cx="8" cy="5.35" r="0.65" fill="currentColor" stroke="none" />
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

export function IconEdit(p: IconProps) {
  return wrap(p, <>
    <path d="M10.5 2.5l1 1L5 10H3.5v-1.5L10.5 2.5z" strokeLinejoin="round" />
    <path d="M9 4l1 1" />
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

// Git-branch glyph: two commits on a main line, a feature branch to the
// right with its own commit. Matches the FixGitGraph visual language so
// section headers and the inline SVG feel like one system.
export function IconGit(p: IconProps) {
  return wrap(p, <>
    <circle cx="4" cy="4" r="1.6" />
    <circle cx="4" cy="12" r="1.6" />
    <circle cx="12" cy="8" r="1.6" />
    <line x1="4" y1="5.6" x2="4" y2="10.4" />
    <path d="M4 7 C 7 7, 9 8, 10.4 8" />
  </>)
}

// Eye glyph for "View ..." action buttons. Pair with `title` /
// `aria-label` for screen readers — the icon-only Btn drops the verbose
// label so dense action columns (compliance evidence, queue items,
// reports) breathe.
export function IconEye(p: IconProps) {
  return wrap(p, <>
    <path d="M1.75 8C3.5 4.5 5.5 3 8 3s4.5 1.5 6.25 5C12.5 11.5 10.5 13 8 13s-4.5-1.5-6.25-5z" />
    <circle cx="8" cy="8" r="2" />
  </>)
}

// Action-column glyphs. All sized 16×16 to match the rest of the set,
// stroke-only so they pick up `text-danger` / `text-fg-secondary` from
// their parent <Btn>. Use icon-only with `title=` / `aria-label=` for
// dense rows (Prompt Lab, Fine-tuning jobs, Compliance) so the action
// column reads as a row of glyphs rather than a wall of words.
export function IconTrash(p: IconProps) {
  return wrap(p, <>
    <path d="M3 4.5h10" />
    <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    <path d="M4.5 4.5l.6 8.2a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.2" />
    <line x1="7" y1="7" x2="7" y2="11.5" />
    <line x1="9" y1="7" x2="9" y2="11.5" />
  </>)
}

export function IconPencil(p: IconProps) {
  return wrap(p, <>
    <path d="M11.5 2.5l2 2-7.5 7.5L3 13l1-3z" />
    <line x1="10" y1="4" x2="12" y2="6" />
  </>)
}

// Undo / reset glyph — curved arrow looping back to the left, the universal
// "revert this change" icon. Used by inline-rename Reset buttons and by
// "Undo" affordances in delete confirmation toasts. Stroke-only so it picks
// up `text-fg-secondary` / `text-brand` from its parent <Btn>.
export function IconUndo(p: IconProps) {
  return wrap(p, <>
    <path d="M3.5 7.5h6.5a3 3 0 1 1 0 6H6" />
    <polyline points="6,4.5 3.5,7 6,9.5" />
  </>)
}

// Export / download arrow — outbound from a tray, the universal
// "save / export to disk" glyph.
export function IconExport(p: IconProps) {
  return wrap(p, <>
    <path d="M8 2.5v7" />
    <polyline points="5,6 8,9.5 11,6" />
    <path d="M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" />
  </>)
}

// Lightning bolt — "activate / promote / make live". Used on Prompt Lab
// to flip a candidate to 100 % traffic.
export function IconBolt(p: IconProps) {
  return wrap(p, <>
    <path d="M9 1.5L3.5 9h3.5L7 14.5 12.5 7H9z" strokeLinejoin="round" />
  </>)
}

// Sliders glyph for Traffic % (A/B split). Two horizontal tracks with
// a knob each — reads as "adjust mix".
export function IconSliders(p: IconProps) {
  return wrap(p, <>
    <line x1="2.5" y1="5" x2="13.5" y2="5" />
    <line x1="2.5" y1="11" x2="13.5" y2="11" />
    <circle cx="6" cy="5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="10" cy="11" r="1.6" fill="currentColor" stroke="none" />
  </>)
}

// Diff glyph — two parallel lines with a small offset, evokes
// "compare side-by-side". Used on Prompt Lab to diff against parent.
export function IconDiff(p: IconProps) {
  return wrap(p, <>
    <circle cx="5" cy="4" r="1.4" />
    <circle cx="11" cy="12" r="1.4" />
    <path d="M5 5.4v5.2" strokeDasharray="1.5 1.5" />
    <path d="M11 4.4V8" />
    <path d="M11 4.4 9 4.4" />
    <path d="M11 4.4 13 4.4" />
    <path d="M5 11.6 7 11.6" />
    <path d="M5 11.6 3 11.6" />
  </>)
}

// Shield-check glyph — "validated / passed". Used on Fine-tuning jobs
// for the Validate action so success accuracy reads as a tick on a
// shield, not just a verb.
export function IconShieldCheck(p: IconProps) {
  return wrap(p, <>
    <path d="M8 1.5l5 1.7v4c0 3-2.2 5.3-5 6.3-2.8-1-5-3.3-5-6.3v-4z" />
    <polyline points="5.5,8 7.2,9.5 10.5,6" />
  </>)
}

// Refresh arrow — "resend / retry". Used on the Members page next to
// each pending invitation so admins can re-trigger the auth email
// without revoking + re-creating. Distinct from IconUndo (which is a
// straight back-arrow) so the two never get confused side-by-side.
export function IconResend(p: IconProps) {
  return wrap(p, <>
    <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9" />
    <polyline points="11.5,1.5 12,4.1 9.4,4.6" />
    <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9" />
    <polyline points="4.5,14.5 4,11.9 6.6,11.4" />
  </>)
}

// Speech-bubble glyph — "personal note". Used as a tiny inline marker
// on pending invitations whose inviter included a 280-char message,
// so admins triaging the list can spot which invites are personalised
// at a glance without opening each row.
export function IconNote(p: IconProps) {
  return wrap(p, <>
    <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-3 3v-3H3a1 1 0 0 1-1-1z" />
  </>)
}

// Paper-airplane glyph — "send / dispatch". Used on project rows for
// the icon-only "Send test report" button so the action column stays
// compact.
export function IconSend(p: IconProps) {
  return wrap(p, <>
    <path d="M14 2L7 9" />
    <path d="M14 2l-4.5 12-2.5-5L2 6.5z" />
  </>)
}

// Key glyph — "API key / generate credential". Used on project rows
// for the icon-only "Generate key" button.
export function IconKey(p: IconProps) {
  return wrap(p, <>
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="M8 8l5.5-5.5" />
    <path d="M11 5l2 2" />
    <path d="M9.5 6.5l2 2" />
  </>)
}

// Share glyph — three dots connected by lines, the universal "share"
// icon. Used in kebab menus and action columns for "copy share link".
export function IconShare(p: IconProps) {
  return wrap(p, <>
    <circle cx="12" cy="4" r="2" />
    <circle cx="4" cy="8" r="2" />
    <circle cx="12" cy="12" r="2" />
    <line x1="5.8" y1="7" x2="10.2" y2="5" />
    <line x1="5.8" y1="9" x2="10.2" y2="11" />
  </>)
}

// Play triangle — "run / test / execute". Used on integration cards
// for the icon-only "Test connection" button.
export function IconPlay(p: IconProps) {
  return wrap(p, <>
    <polygon points="4,2 13,8 4,14" fill="currentColor" stroke="none" />
  </>)
}

// Flag — "mark as suspicious". Used on anti-gaming device rows.
export function IconFlag(p: IconProps) {
  return wrap(p, <>
    <path d="M4 2v12" />
    <path d="M4 2h8l-2 4h2l-2 4H4" />
  </>)
}

// Flag with diagonal slash — "unflag / clear suspicion".
export function IconFlagOff(p: IconProps) {
  return wrap(p, <>
    <path d="M4 2v12" />
    <path d="M4 2h8l-2 4h2l-2 4H4" strokeDasharray="3 1.5" strokeOpacity="0.5" />
    <line x1="2" y1="2" x2="14" y2="14" />
  </>)
}

// Pause bars — "pause a routing integration".
export function IconPause(p: IconProps) {
  return wrap(p, <>
    <rect x="3" y="3" width="3.5" height="10" rx="1" fill="currentColor" stroke="none" />
    <rect x="9.5" y="3" width="3.5" height="10" rx="1" fill="currentColor" stroke="none" />
  </>)
}

// Chevron expand/collapse — used for Details toggle in device rows.
export function IconChevronDown(p: IconProps) {
  return wrap(p, <>
    <path d="M3 5.5l5 5 5-5" />
  </>)
}

export function IconChevronUp(p: IconProps) {
  return wrap(p, <>
    <path d="M3 10.5l5-5 5 5" />
  </>)
}

export function IconChevronRight(p: IconProps) {
  return wrap(p, <>
    <path d="M5.5 3l5 5-5 5" />
  </>)
}

// Inbox tray — "Inbox": arrow dropping into a tray.
// (used by Notifications) so the two items always read differently in the sidebar.
export function IconInbox(p: IconProps) {
  return wrap(p, <>
    <path d="M2 9.5h3l1.5 2.5h3L11 9.5h3" />
    <rect x="2" y="3" width="12" height="9.5" rx="1" />
    <line x1="8" y1="4.5" x2="8" y2="8.5" strokeLinecap="round" />
    <polyline points="5.5,6.5 8,9 10.5,6.5" strokeLinecap="round" />
  </>)
}

// Open book — "Lessons": two curved pages with a spine in the middle.
// Distinct from IconIntelligence (bar chart) and IconReports (flat doc).
export function IconLessons(p: IconProps) {
  return wrap(p, <>
    <path d="M8 4.5V13" />
    <path d="M8 4.5c-1-1.4-3-1.8-5-.8v9c2-1 4-.6 5 .8" />
    <path d="M8 4.5c1-1.4 3-1.8 5-.8v9c-2-1-4-.6-5 .8" />
  </>)
}

// Diverging fork — "Drift": one path splitting into two arrows.
// Evokes contract schema diverging from implementation.
export function IconDrift(p: IconProps) {
  return wrap(p, <>
    <line x1="2.5" y1="8" x2="7" y2="8" />
    <path d="M7 8 L13 4.5" />
    <path d="M7 8 L13 11.5" />
    <circle cx="2.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <polyline points="11,3 13,4.5 11.5,6.5" />
    <polyline points="11,13 13,11.5 11.5,9.5" />
  </>)
}

// Spike anomaly — "Anomalies": flat baseline with one sharp spike above.
// Immediately reads as "something unusual happened on this chart".
export function IconAnomalies(p: IconProps) {
  return wrap(p, <>
    <polyline points="2,11 5,11 6.5,8.5 8,2.5 9.5,8.5 11,11 14,11" />
    <line x1="2" y1="13" x2="14" y2="13" strokeOpacity="0.4" />
  </>)
}

// Git price-tag — "Releases": a tag polygon with a round pin hole, the
// universal shape for version tags (v1.2.3 / git-tag / package release).
export function IconReleases(p: IconProps) {
  return wrap(p, <>
    <path d="M3 3h5l5.5 5.5-5 5L3 8V3z" />
    <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
  </>)
}

// Flask / beaker — "Experiments": standard lab-equipment glyph for A/B tests.
// Distinct from all other sidebar icons; bubbles inside read as "active test".
export function IconExperiments(p: IconProps) {
  return wrap(p, <>
    <path d="M6.5 2v4.8L3.2 12a1.3 1.3 0 0 0 1.1 2h7.4a1.3 1.3 0 0 0 1.1-2L9.5 6.8V2" />
    <line x1="5.5" y1="2" x2="10.5" y2="2" />
    <circle cx="7" cy="10.5" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="9.5" cy="12" r="0.8" fill="currentColor" stroke="none" />
  </>)
}

// Two-headed cycle arrow — "Iterate": PDCA loop; rotate-left arc on top,
// rotate-right arc on bottom so the shape reads as a full 360° improvement cycle.
export function IconIterate(p: IconProps) {
  return wrap(p, <>
    <path d="M2.5 7.5a5.5 5.5 0 0 1 9.3-4" />
    <polyline points="9.5,2 11.8,3.5 10.5,5.8" />
    <path d="M13.5 8.5a5.5 5.5 0 0 1-9.3 4" />
    <polyline points="6.5,14 4.2,12.5 5.5,10.2" />
  </>)
}

// Trophy cup — "Rewards": classic award glyph with handles, stem, and base.
export function IconRewards(p: IconProps) {
  return wrap(p, <>
    <path d="M5 2h6v5a3 3 0 0 1-6 0V2z" />
    <path d="M3 2h2M11 2h2" />
    <rect x="6.5" y="9.5" width="3" height="2" rx="0.3" />
    <rect x="5" y="11.5" width="6" height="1.5" rx="0.5" />
  </>)
}

// Plug with two prongs — "MCP": electric connector evokes the
// Model-Context-Protocol socket. Distinct from IconIntegrations (4-arm branch).
export function IconMcp(p: IconProps) {
  return wrap(p, <>
    <rect x="4" y="5" width="8" height="5.5" rx="1.5" />
    <line x1="6" y1="5" x2="6" y2="3" />
    <line x1="10" y1="5" x2="10" y2="3" />
    <path d="M6.5 10.5v1.8a1.5 1.5 0 0 0 3 0v-1.8" />
  </>)
}

// Two silhouettes — "Members": foreground person (solid) + partial background person.
// Distinct from IconProjects (briefcase) and IconUser (single silhouette).
export function IconMembers(p: IconProps) {
  return wrap(p, <>
    <circle cx="5.5" cy="5" r="2" />
    <path d="M1.5 13c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8" />
    <circle cx="11.5" cy="4.5" r="1.8" />
    <path d="M14.5 12c0-2-1.3-3.3-3-3.3" strokeOpacity="0.55" />
  </>)
}

// Clipboard + magnifying glass — "QA Coverage": audit-and-search combo glyph.
// Distinct from IconHealth (heartbeat), IconShield, and IconJudge (star).
export function IconQaCoverage(p: IconProps) {
  return wrap(p, <>
    <path d="M9 2.5H5a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h4" />
    <path d="M6 2.5v1.5h4V2.5" />
    <line x1="5.5" y1="6.5" x2="9" y2="6.5" />
    <line x1="5.5" y1="8.5" x2="7.5" y2="8.5" />
    <circle cx="11" cy="10" r="2.5" />
    <line x1="12.8" y1="11.8" x2="14.5" y2="13.5" />
  </>)
}

// ── Service brand glyphs ─────────────────────────────────────────────────────
// Geometric, stroke-based representations of third-party service brands.
// Designed to be recognizable at 16 px and 20 px; not trademark replicas.

// Sentry: concentric rings with a center dot — "target / radar" motif matching
// Sentry's circular logo language.
export function IconSentry(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="2.5" />
    <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" />
  </>)
}

// Langfuse: a flowing S-curve trace line over a magnifying lens — "LLM
// observability / prompt tracing" motif.
export function IconLangfuse(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M5.5 10 C 5.5 7, 7 7, 8 8 C 9 9, 10.5 9, 10.5 6" strokeLinecap="round" />
  </>)
}

// GitHub: classic Octocat silhouette — rounded head, ear nubs, tentacle fork
// at the base. Recognizable at small sizes.
export function IconGithub(p: IconProps) {
  return wrap(p, <>
    <path d="M8 2C4.7 2 2 4.7 2 8c0 2.65 1.72 4.9 4.1 5.69.3.05.41-.13.41-.29v-1.02c-1.67.36-2.02-.8-2.02-.8-.27-.7-.67-.88-.67-.88-.55-.37.04-.36.04-.36.6.04.93.62.93.62.54.92 1.41.65 1.76.5.05-.39.21-.65.38-.8-1.33-.15-2.73-.67-2.73-2.97 0-.65.24-1.19.62-1.61-.06-.15-.27-.76.06-1.59 0 0 .5-.16 1.65.62A5.75 5.75 0 0 1 8 5.8c.51 0 1.02.07 1.5.2 1.14-.78 1.64-.62 1.64-.62.33.83.12 1.44.06 1.59.39.42.62.96.62 1.61 0 2.31-1.4 2.82-2.74 2.97.22.19.41.55.41 1.11v1.65c0 .16.11.35.41.29C12.28 12.9 14 10.65 14 8c0-3.3-2.7-6-6-6z" strokeWidth="0" fill="currentColor" />
  </>)
}

// Cursor Cloud: arrow cursor with a small cloud arc above it — evokes the
// "cloud agent" dispatch concept.
export function IconCursorCloud(p: IconProps) {
  return wrap(p, <>
    <path d="M4 13.5 L4 3 L12 9.5 L8 9.5 L6 13.5 Z" />
    <path d="M9.5 5.5 C 9.5 3.5, 13 3.5, 13 5.5" strokeLinecap="round" />
  </>)
}

/** Claude Code Agent — orange diamond mark (distinct from Cursor). */
export function IconClaudeCode(p: IconProps) {
  return wrap(p, <>
    <path d="M8 1.5L14.5 8L8 14.5L1.5 8L8 1.5Z" />
  </>)
}

// Jira: diamond-within-diamond shape echoing the Jira logo's nested rhombus.
export function IconJira(p: IconProps) {
  return wrap(p, <>
    <path d="M8 2L14 8L8 14L2 8Z" />
    <path d="M8 5L11 8L8 11L5 8Z" fill="currentColor" stroke="none" />
  </>)
}

// Linear: three stacked horizontal bars with decreasing left indentation —
// evokes the Linear wordmark's "L" and the issue-list metaphor.
export function IconLinear(p: IconProps) {
  return wrap(p, <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M5.5 10.5 L10.5 5.5" strokeLinecap="round" />
    <path d="M5.5 10.5 L8.5 10.5" strokeLinecap="round" />
  </>)
}

// PagerDuty: a pager/radio tower — three arcing signal lines above a base,
// evoking on-call alerting.
export function IconPagerDuty(p: IconProps) {
  return wrap(p, <>
    <line x1="8" y1="10" x2="8" y2="14" />
    <path d="M5 11 C 5 7 11 7 11 11" />
    <path d="M3.5 13 C 3.5 6.5 12.5 6.5 12.5 13" />
    <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
  </>)
}

// Chain-link / pipeline — "Skills": three circles connected by a flowing
// line, evoking a skill chain or pipeline of steps.
export function IconSkills(p: IconProps) {
  return wrap(p, <>
    <circle cx="3" cy="8" r="1.8" />
    <circle cx="8" cy="8" r="1.8" />
    <circle cx="13" cy="8" r="1.8" />
    <line x1="4.8" y1="8" x2="6.2" y2="8" />
    <line x1="9.8" y1="8" x2="11.2" y2="8" />
    <path d="M6 5.5 Q8 3.5 10 5.5" fill="none" />
  </>)
}

// Clockwise arrow arc — "Refresh / Re-sync".
export function IconRefresh(p: IconProps) {
  return wrap(p, <>
    <path d="M1.5 8A6.5 6.5 0 0 1 14 5.5" fill="none" strokeLinecap="round" />
    <path d="M14.5 8A6.5 6.5 0 0 1 2 10.5" fill="none" strokeLinecap="round" />
    <polyline points="12 3.5 14 5.5 12 7.5" />
    <polyline points="4 8.5 2 10.5 4 12.5" />
  </>)
}

