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
      className="not-prose border border-[var(--mushi-rule)] rounded-md p-4 bg-[var(--mushi-paper)]"
      aria-label="Open source trust"
    >
      <p className="m-0 mb-3 text-sm font-semibold">{MUSHI_OSS.trustStrip}</p>
      <ul className="grid gap-3 sm:grid-cols-2 list-none p-0 m-0">
        {BULLETS.map((b) => (
          <li key={b.label} className="text-sm">
            <span className="font-medium">{b.label}: </span>
            <span className="text-[var(--mushi-ink-muted)]">{b.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
