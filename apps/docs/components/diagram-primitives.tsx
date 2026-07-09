/** Shared building blocks for docs pipeline / architecture diagrams. */

import type { CSSProperties, ReactNode } from 'react'
import { VIZ } from '../lib/viz-tokens'

export interface DiagramFigureProps {
  /** Screen-reader summary of the whole diagram */
  ariaLabel: string
  children: ReactNode
  className?: string
}

/** Accessible diagram container — always pass a descriptive ariaLabel. */
export function DiagramFigure({ ariaLabel, children, className }: DiagramFigureProps) {
  return (
    <div
      className={`not-prose my-8 rounded-xl border border-[color:var(--nextra-border)] bg-[color:var(--nextra-bg)] p-5${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  )
}

export interface DiagramNodeProps {
  label: string
  sub?: string
  accent?: boolean
  compact?: boolean
  style?: CSSProperties
}

export function DiagramNode({ label, sub, accent, compact, style }: DiagramNodeProps) {
  return (
    <div
      style={{
        border: `1.5px solid ${accent ? VIZ.accent : VIZ.nodeBorder}`,
        borderRadius: 8,
        padding: compact ? '7px 10px' : '9px 12px',
        backgroundColor: accent ? VIZ.accentWash : VIZ.nodeBg,
        textAlign: 'center',
        minWidth: compact ? 72 : 80,
        flex: '1 1 0',
        whiteSpace: sub ? undefined : 'nowrap',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: compact ? 11 : 12,
          fontWeight: 600,
          lineHeight: 1.25,
          color: accent ? VIZ.accent : 'inherit',
        }}
      >
        {label}
      </div>
      {sub ? (
        <div
          style={{
            fontSize: 11,
            opacity: accent ? 0.75 : 0.55,
            marginTop: 2,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.04em',
            color: accent ? VIZ.accent : 'inherit',
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  )
}

export function DiagramHArrow({ label, accent }: { label?: string; accent?: boolean }) {
  const color = accent ? VIZ.accent : VIZ.stroke
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: 28,
        gap: 2,
      }}
    >
      {label ? (
        <span
          style={{
            fontSize: 11,
            opacity: 0.65,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.06em',
            color: accent ? VIZ.accent : 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      ) : null}
      <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden>
        <path
          d="M0 6 H18 M14 2 L22 6 L14 10"
          stroke={color}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

export function DiagramVArrow({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      {label ? (
        <span
          style={{
            fontSize: 11,
            opacity: 0.55,
            fontFamily: 'var(--mushi-font-mono, monospace)',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </span>
      ) : null}
      <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden>
        <path
          d="M6 0 L6 12 M2 8 L6 16 L10 8"
          stroke={VIZ.stroke}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

export function DiagramStep({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0' }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: VIZ.track,
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 12, lineHeight: 1.5, paddingTop: 2 }}>{text}</span>
    </div>
  )
}
