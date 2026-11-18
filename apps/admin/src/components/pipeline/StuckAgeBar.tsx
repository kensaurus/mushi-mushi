/**
 * FILE: apps/admin/src/components/pipeline/StuckAgeBar.tsx
 * PURPOSE: How long the stuck work has waited, as a picture (2026-11-18): one stacked bar per
 *          kind of stuck work ("Need you", and the backlog "Waiting for a fix"), split into
 *          0–3 d, 3–7 d, 7–30 d and 30 d+ on the red ramp (darker = older). Each segment prints
 *          its count when it has room, the legend always does, and the bar has an aria-label,
 *          so the split never depends on colour. Buckets: lib/pipelineSignals.ts `stuckAges`.
 */

import { AGE_BUCKET_LABELS, type AgeBuckets } from '../../lib/pipelineSignals'

/** Older is darker: the validated red ramp, black ink on the light steps, white on the dark. */
const SEGMENT = ['ci-fail-1', 'ci-fail-2', 'ci-fail-4', 'ci-fail-5'] as const

function Row({ label, buckets, testId }: { label: string; buckets: AgeBuckets; testId: string }) {
  const total = buckets.reduce((a, b) => a + b, 0)
  const summary = buckets.map((n, i) => `${AGE_BUCKET_LABELS[i]} ${n}`).join(', ')
  return (
    <li className="grid min-w-0 grid-cols-1 items-center gap-x-3 gap-y-1 @lg:grid-cols-[9rem_1fr]" data-testid={testId}>
      <span className="flex items-baseline gap-1.5 text-xs">
        <span className="font-semibold text-fg">{label}</span>
        <span className="font-mono font-extrabold tabular-nums text-fg" data-testid={`${testId}-total`}>
          {total}
        </span>
      </span>
      <span className="min-w-0 space-y-0.5">
        <span role="img" aria-label={`${label}, ${total} by time in stage: ${summary}`} className="flex h-4 w-full min-w-0 overflow-hidden rounded-sm bg-surface-overlay">
          {total > 0 &&
            buckets.map((n, i) =>
              n > 0 ? (
                <span
                  key={i}
                  className={`${SEGMENT[i]} ci-grow-x flex h-full items-center justify-center font-mono text-3xs font-bold tabular-nums`}
                  style={{ width: `${(n / total) * 100}%`, animationDelay: `${i * 60}ms` }}
                  data-bucket={i}
                >
                  {n / total >= 0.08 ? n : null}
                </span>
              ) : null,
            )}
        </span>
        <span className="flex flex-wrap gap-x-3 text-3xs text-fg-secondary" aria-hidden="true">
          {buckets.map((n, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span className={`${SEGMENT[i]} inline-block h-2 w-2 rounded-xs`} />
              {AGE_BUCKET_LABELS[i]}
              <span className={`font-mono font-bold tabular-nums ${n === 0 ? 'text-fg-faint' : 'text-fg'}`}>{n}</span>
            </span>
          ))}
        </span>
      </span>
    </li>
  )
}

export function StuckAgeBar({ needYou, waiting }: { needYou: AgeBuckets; waiting: AgeBuckets }) {
  const anyNeed = needYou.some((n) => n > 0)
  const anyWait = waiting.some((n) => n > 0)
  if (!anyNeed && !anyWait) return null
  return (
    <figure className="@container min-w-0" data-testid="pipeline-age-bar">
      <figcaption className="mb-1 text-3xs font-bold tracking-wider text-fg-secondary uppercase">How long stuck work has waited in its stage</figcaption>
      <ul className="space-y-1.5">
        {anyNeed && <Row label="Need you" buckets={needYou} testId="pipeline-age-need-you" />}
        {anyWait && <Row label="Waiting for a fix" buckets={waiting} testId="pipeline-age-waiting" />}
      </ul>
    </figure>
  )
}
