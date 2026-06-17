/**
 * FILE: apps/testers/app/components/TestersPageShell.tsx
 * PURPOSE: Layout wrapper — nav, main content, footer for marketplace pages.
 */
import type { ReactNode } from 'react'
import { TestersNav } from './TestersNav'
import { TestersFooter } from './TestersFooter'

export function TestersPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="testers-shell">
      <TestersNav />
      <main>{children}</main>
      <TestersFooter />
    </div>
  )
}
