import type { ReactNode } from 'react'
import type { MushiStageId, ReportSample } from './data'

interface StageScreenshotProps {
  stageId: MushiStageId
  sample: ReportSample
}

export function StageScreenshot({ stageId, sample }: StageScreenshotProps) {
  if (stageId === 'capture') return <CaptureShot sample={sample} />
  if (stageId === 'classify') return <ClassifyShot sample={sample} />
  if (stageId === 'dispatch') return <DispatchShot sample={sample} />
  if (stageId === 'verify') return <VerifyShot sample={sample} />
  return <EvolveShot sample={sample} />
}

function ShotShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] p-4 shadow-[0_28px_70px_-48px_rgba(14,13,11,0.8)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-[var(--mushi-vermillion)]" />
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--mushi-rule)] pb-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-vermillion)]">
          {label}
        </p>
        <div className="flex gap-1" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-[var(--mushi-rule)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--mushi-rule)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--mushi-vermillion)]" />
        </div>
      </div>
      {children}
    </div>
  )
}

function CaptureShot({ sample }: { sample: ReportSample }) {
  return (
    <ShotShell label="Widget capture">
      <div className="mx-auto max-w-[230px] rounded-[1.75rem] border border-[var(--mushi-rule)] bg-[var(--mushi-ink)] p-2">
        <div className="rounded-[1.25rem] bg-[var(--mushi-paper)] p-3">
          <div className="mb-3 h-5 rounded-full bg-[var(--mushi-paper-wash)]" />
          <div className="space-y-2">
            <div className="h-14 rounded-lg border border-[var(--mushi-rule)] bg-white/55" />
            <div className="h-8 rounded-lg border border-[var(--mushi-rule)] bg-white/45" />
          </div>
          <div className="mt-4 rounded-lg border border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
              Mushi note
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--mushi-ink)]">{sample.userNote}</p>
            <div className="mt-3 flex items-center justify-between rounded-sm bg-[var(--mushi-ink)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--mushi-paper)]">
              <span>{sample.path}</span>
              <span>send</span>
            </div>
          </div>
        </div>
      </div>
    </ShotShell>
  )
}

function ClassifyShot({ sample }: { sample: ReportSample }) {
  return (
    <ShotShell label="Reports row">
      <div className="space-y-3">
        <div className="rounded-xl border border-[var(--mushi-rule)] bg-white/45 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-serif text-2xl leading-none tracking-[-0.05em] text-[var(--mushi-ink)]">
                {sample.title}
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)]">
                {sample.browser}
              </p>
            </div>
            <span className="rounded-sm border border-[var(--mushi-vermillion)] bg-[var(--mushi-vermillion-wash)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
              {sample.severity}
            </span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {['repro steps', sample.taxonomy, 'likely root cause'].map((item) => (
              <span
                key={item}
                className="rounded-sm border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] px-2 py-2 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--mushi-ink-muted)]"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="h-2 w-2/3 rounded-full bg-[var(--mushi-rule)]" />
        <div className="h-2 w-1/2 rounded-full bg-[var(--mushi-rule)]" />
      </div>
    </ShotShell>
  )
}

function DispatchShot({ sample }: { sample: ReportSample }) {
  return (
    <ShotShell label="Draft PR">
      <div className="rounded-xl border border-[var(--mushi-rule)] bg-white/45 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
              github · {sample.prNumber}
            </p>
            <h4 className="mt-2 font-serif text-2xl leading-none tracking-[-0.05em] text-[var(--mushi-ink)]">
              Keep checkout CTA above bottom chrome
            </h4>
          </div>
          <span className="rounded-sm bg-[var(--mushi-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--mushi-paper)]">
            draft
          </span>
        </div>
        <div className="mt-5 space-y-2 rounded-lg bg-[var(--mushi-ink)] p-3 font-mono text-[10px] text-[var(--mushi-paper)]">
          <p><span className="text-[var(--mushi-vermillion)]">-</span> bottom: 0;</p>
          <p><span className="text-[var(--mushi-vermillion)]">+</span> bottom: safe-area + 16px;</p>
          <p><span className="text-[var(--mushi-vermillion)]">+</span> test: coupon keeps pay visible</p>
        </div>
      </div>
    </ShotShell>
  )
}

function VerifyShot({ sample }: { sample: ReportSample }) {
  return (
    <ShotShell label="Judge check">
      <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
        <div className="grid place-items-center rounded-xl border border-[var(--mushi-rule)] bg-[var(--mushi-vermillion-wash)] p-5 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
            score
          </p>
          <p className="mt-2 font-serif text-5xl leading-none tracking-[-0.06em] text-[var(--mushi-ink)]">
            {sample.judgeScore}
          </p>
          <p className="mt-2 text-xs text-[var(--mushi-ink-muted)]">passes project threshold</p>
        </div>
        <div className="space-y-2">
          {['matches report', 'keeps CTA visible', 'does not block scrolling'].map((item, index) => (
            <div
              key={item}
              className="flex items-center gap-2 rounded-lg border border-[var(--mushi-rule)] bg-white/50 p-3"
            >
              <span className="grid h-6 w-6 place-items-center rounded-sm bg-[var(--mushi-ink)] font-mono text-[10px] text-[var(--mushi-paper)]">
                {index + 1}
              </span>
              <span className="text-sm text-[var(--mushi-ink)]">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </ShotShell>
  )
}

function EvolveShot({ sample }: { sample: ReportSample }) {
  return (
    <ShotShell label="Weekly trend">
      <div className="rounded-xl border border-[var(--mushi-rule)] bg-white/45 p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-vermillion)]">
              customer friction
            </p>
            <h4 className="mt-2 font-serif text-2xl leading-none tracking-[-0.05em] text-[var(--mushi-ink)]">
              Checkout chrome collisions fell 38%.
            </h4>
          </div>
          <span className="rounded-sm border border-[var(--mushi-rule)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--mushi-ink-muted)]">
            7 days
          </span>
        </div>
        <div className="mt-6 flex h-28 items-end gap-2">
          {[44, 68, 58, 73, 52, 36, 28].map((height, index) => (
            <div
              key={`${height}-${index}`}
              className="flex-1 rounded-t-sm bg-[var(--mushi-vermillion)]/75"
              style={{ height: `${height}%`, opacity: 0.45 + index * 0.06 }}
            />
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-[var(--mushi-ink-muted)]">
          Mushi grouped reports like "{sample.title}" into one product pattern.
        </p>
      </div>
    </ShotShell>
  )
}
