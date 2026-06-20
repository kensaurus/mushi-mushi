/**
 * Langfuse/Supabase-style open-source trust bullets from @mushi-mushi/brand.
 */
import { MUSHI_OSS } from '@mushi-mushi/brand'

const BULLETS = [
  { label: 'License', text: MUSHI_OSS.license },
  { label: 'Self-host', text: MUSHI_OSS.selfHost },
  { label: 'No lock-in', text: MUSHI_OSS.noLockIn },
  { label: 'Dogfood', text: MUSHI_OSS.dogfood },
] as const

export function OssTrustStrip() {
  return (
    <div
      className="not-prose grid gap-3 sm:grid-cols-2 border border-[var(--docs-rule)] rounded-md p-4 bg-[var(--docs-paper)]"
      role="list"
      aria-label="Open source trust"
    >
      <p className="sm:col-span-2 m-0 text-sm font-semibold">{MUSHI_OSS.trustStrip}</p>
      {BULLETS.map((b) => (
        <div key={b.label} role="listitem" className="text-sm">
          <span className="font-medium">{b.label}: </span>
          <span className="text-[var(--docs-ink-muted)]">{b.text}</span>
        </div>
      ))}
    </div>
  )
}
