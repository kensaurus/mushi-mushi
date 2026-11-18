/**
 * FILE: apps/admin/src/components/signal/StageTrain.tsx
 * PURPOSE: A row of stages with counts, as a picture instead of a paragraph (2026-11-18):
 *          "Drafted 4 → CI 2 → Ready 1 → Merged 9". Only a stage that is actually stuck or
 *          failing takes a status colour (with its shape); the rest stay neutral, so colour
 *          means something. Each stage can link to its rows and carry highlight keys.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useLinked, type HighlightKey } from './linkedHighlight'
import { StatusGlyph, TONE_INK, type SignalTone } from './StatusGlyph'

export interface TrainStage {
  id: string
  label: string
  count: number
  /** Only set when the stage needs attention (danger / warn) or is done (ok). */
  tone?: SignalTone
  /** One short line under the count ("2 held: key used up"). */
  note?: ReactNode
  /** In-app route or #anchor for the stage's rows. */
  to?: string
  keys?: HighlightKey[]
}

const BOX: Partial<Record<SignalTone, string>> = {
  danger: 'border-danger/55 bg-danger-muted',
  warn: 'border-warn/55 bg-warn-muted',
  ok: 'border-ok/45 bg-ok-muted',
  info: 'border-info/45 bg-info-muted',
}

function Stage({ stage, index }: { stage: TrainStage; index: number }) {
  const keys = stage.keys ?? []
  const link = useLinked(keys, keys[0] ?? stage.id, keys.length > 0)
  const box = (stage.tone && BOX[stage.tone]) || 'border-edge bg-surface-raised'
  const body = (
    <>
      <span className="flex items-center gap-1">
        {stage.tone && <StatusGlyph tone={stage.tone} className="h-2.5 w-2.5" />}
        <span className={`truncate text-3xs font-bold tracking-wider uppercase ${stage.tone ? TONE_INK[stage.tone] : 'text-fg-secondary'}`}>{stage.label}</span>
      </span>
      <span className={`font-mono text-lg leading-none font-extrabold tabular-nums ${stage.count === 0 ? 'text-fg-faint' : 'text-fg'}`}>{stage.count}</span>
      {stage.note && <span className="truncate text-3xs text-fg-secondary">{stage.note}</span>}
    </>
  )
  const cls = `flex min-w-0 flex-col gap-0.5 rounded-md border px-2 py-1.5 ${box}`
  return (
    <li {...link} className={`${link.className} ci-rise flex min-w-0 flex-1 items-center gap-1`} style={{ animationDelay: `${index * 50}ms` }} data-testid={`train-stage-${stage.id}`} data-tone={stage.tone ?? 'neutral'}>
      {index > 0 && (
        <span className="shrink-0 text-fg-faint" aria-hidden="true">
          →
        </span>
      )}
      {stage.to ? (
        stage.to.startsWith('#') ? (
          <a href={stage.to} className={`${cls} flex-1 hover:border-accent focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none`}>
            {body}
          </a>
        ) : (
          <Link to={stage.to} className={`${cls} flex-1 hover:border-accent focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none`}>
            {body}
          </Link>
        )
      ) : (
        <span className={`${cls} flex-1`}>{body}</span>
      )}
    </li>
  )
}

export function StageTrain({ stages, label, className = '' }: { stages: readonly TrainStage[]; label: string; className?: string }) {
  const summary = stages.map((s) => `${s.label} ${s.count}`).join(', ')
  return (
    <figure className={`min-w-0 ${className}`} data-testid="stage-train">
      <figcaption className="sr-only">
        {label}: {summary}
      </figcaption>
      <ol className="flex min-w-0 flex-wrap gap-y-1 sm:flex-nowrap" aria-label={label}>
        {stages.map((s, i) => (
          <Stage key={s.id} stage={s} index={i} />
        ))}
      </ol>
    </figure>
  )
}
