/**
 * FILE: PageSection.tsx
 * PURPOSE: Visual-weight layout helper (primary / secondary / aside) for dashboard IA.
 */

import type { ReactNode } from 'react'

export type PageSectionWeight = 'primary' | 'secondary' | 'aside'

const WEIGHT_CLASS: Record<PageSectionWeight, string> = {
  primary: 'w-full lg:flex-[2] min-w-0',
  secondary: 'w-full lg:flex-1 min-w-0',
  aside: 'w-full lg:w-72 shrink-0 min-w-0',
}

export interface PageSectionProps {
  weight?: PageSectionWeight
  children: ReactNode
  className?: string
}

/** Encodes 40/30/20 visual hierarchy without new tokens. */
export function PageSection({
  weight = 'secondary',
  children,
  className = '',
}: PageSectionProps) {
  return <div className={`${WEIGHT_CLASS[weight]} ${className}`}>{children}</div>
}

export interface PageSectionRowProps {
  children: ReactNode
  className?: string
}

/** Horizontal flex row for primary + secondary KPI bands. */
export function PageSectionRow({ children, className = '' }: PageSectionRowProps) {
  return (
    <div className={`flex flex-col lg:flex-row gap-2 lg:gap-3 ${className}`}>
      {children}
    </div>
  )
}
