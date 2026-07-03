/**
 * /roadmap — thin server wrapper.
 * All fetching + searchParams handling lives in RoadmapClient (client
 * component), which is required for `output: 'export'` compatibility.
 */
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { RoadmapClient } from './RoadmapClient'
import { TestersPageShell } from '../components/TestersPageShell'

export const metadata: Metadata = {
  title: 'Public roadmap — Mushi',
  description: 'Vote on what ships next for apps using Mushi Mushi.',
}

export default function RoadmapPage() {
  return (
    <Suspense
      fallback={
        <TestersPageShell>
          <div className="mx-auto max-w-3xl px-4 py-10">
            <p className="testers-muted">Loading…</p>
          </div>
        </TestersPageShell>
      }
    >
      <RoadmapClient />
    </Suspense>
  )
}
