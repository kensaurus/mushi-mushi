/**
 * Flat monospace path typography for inventory routes (`frontend/bank-statement`).
 * Uses a left info-rail — visually distinct from attribution pill chips below.
 */

import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  title?: string
  className?: string
  /** `block` for full-width row paths; `inline` for chips in a flex wrap row. */
  as?: 'inline' | 'block'
}

export function ReportCodeText({ children, title, className = '', as = 'inline' }: Props) {
  const layout = as === 'block' ? 'report-path-code--block' : 'report-path-code--inline'
  return (
    <code title={title} className={`report-path-code ${layout} ${className}`.trim()}>
      {children}
    </code>
  )
}
