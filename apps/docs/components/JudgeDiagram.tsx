'use client'

const SCORES = [
  { label: 'accuracy', weight: 0.35, color: 'var(--mushi-vermillion, #e03c2c)' },
  { label: 'severity_calibration', weight: 0.25, color: '#f59e0b' },
  { label: 'component_tagging', weight: 0.20, color: '#6366f1' },
  { label: 'repro_quality', weight: 0.20, color: '#10b981' },
]

/** Visual judge scoring breakdown with weighted bars */
export function JudgeScoreBreakdown() {
  return (
    <div className="not-prose my-6 rounded-xl border border-[color:var(--nextra-border)] bg-[color:var(--nextra-bg)] p-5">
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.4, marginBottom: 16, fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Composite score weights
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SCORES.map((s) => (
          <div key={s.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <code style={{ fontSize: 11.5, fontWeight: 600 }}>{s.label}</code>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: s.color }}>{Math.round(s.weight * 100)}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--nextra-border, #e5e7eb)', overflow: 'hidden' }}>
              <div style={{ width: `${s.weight * 100}%`, height: '100%', borderRadius: 4, background: s.color, transition: 'width 0.6s ease' }} />
            </div>
          </div>
        ))}
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 11, opacity: 0.5, fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Score lands on <code>reports.judge_score</code> and persists in <code>classification_evaluations</code> for audit.
      </p>
    </div>
  )
}

const FINETUNE_STAGES = [
  { label: 'exporting', sub: 'export CSV from admin' },
  { label: 'exported', sub: 'S3 / BYO storage' },
  { label: 'training', sub: 'provider fine-tune job' },
  { label: 'trained', sub: 'checkpoint ready' },
  { label: 'validating', sub: 'offline eval harness' },
  { label: 'validated', sub: 'judge mean wins +0.05' },
  { label: 'promoted', sub: 'replaces active prompt', accent: true },
]

const REJECT = { label: 'rejected', sub: 'archived with reason' }

function PipelineNode({ label, sub, accent }: { label: string; sub: string; accent?: boolean }) {
  return (
    <div
      style={{
        border: `1.5px solid ${accent ? 'var(--mushi-vermillion, #e03c2c)' : 'var(--nextra-border, #e5e7eb)'}`,
        borderRadius: 8,
        padding: '8px 10px',
        textAlign: 'center',
        background: accent ? 'color-mix(in srgb, var(--mushi-vermillion, #e03c2c) 7%, transparent)' : 'var(--nextra-bg, transparent)',
        flex: '1 1 0',
        minWidth: 70,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: accent ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit' }}>{label}</div>
      <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2, fontFamily: 'var(--mushi-font-mono, monospace)' }}>{sub}</div>
    </div>
  )
}

function SmArrow() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden style={{ flexShrink: 0, alignSelf: 'center' }}>
      <path d="M0 6 H11 M7 2 L15 6 L7 10" stroke="var(--nextra-border, #cbd5e1)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Visual fine-tune pipeline with promoted / rejected fork */
export function FineTunePipeline() {
  return (
    <div className="not-prose my-6 rounded-xl border border-[color:var(--nextra-border)] bg-[color:var(--nextra-bg)] p-5">
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.4, marginBottom: 14, fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Fine-tune pipeline
      </div>
      {/* Main pipeline row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', flexWrap: 'nowrap' }}>
        {FINETUNE_STAGES.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <PipelineNode {...s} />
            {i < FINETUNE_STAGES.length - 1 && <SmArrow />}
          </div>
        ))}
      </div>
      {/* Fork down from validated → rejected.
           Aligning under the last-but-one node ("validated") is intentionally
           approximate — the pipeline scrolls horizontally and the fork sits
           flush right of center. On narrow viewports the scroll container
           is the source of truth; we use flex-end for best-effort alignment. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden>
            <path d="M6 0 L6 12 M2 8 L6 16 L10 8" stroke="var(--nextra-border, #cbd5e1)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ border: '1.5px solid #ef4444', borderRadius: 8, padding: '7px 12px', textAlign: 'center', background: 'color-mix(in srgb, #ef4444 6%, transparent)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#ef4444' }}>{REJECT.label}</div>
            <div style={{ fontSize: 9, opacity: 0.55, marginTop: 2, fontFamily: 'var(--mushi-font-mono, monospace)' }}>{REJECT.sub}</div>
          </div>
        </div>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 11, opacity: 0.5, fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Validation refuses to promote if the candidate judge mean doesn't beat production by ≥ 0.05 with p &lt; 0.05.
      </p>
    </div>
  )
}

const IMPROVEMENT_LOOPS = [
  { icon: '⚖️', title: 'Nightly judge', body: 'judge-batch samples yesterday\'s classifications. A different model family scores each component and writes judge_score back to the report.', color: '#6366f1' },
  { icon: '🔀', title: 'Prompt A/B', body: '5% traffic slice tests a candidate prompt. Auto-promotion when the candidate wins by ≥ 0.05 at 95% CI. Project-scoped — no cross-tenant leakage.', color: '#f59e0b' },
  { icon: '🔬', title: 'Fine-tune export', body: 'Export best-scoring classifications → train → validate offline → promote with one click. Candidate must beat production mean.', color: 'var(--mushi-vermillion, #e03c2c)' },
  { icon: '📡', title: 'Drift detection', body: 'If daily mean drops > 0.10 vs. trailing 7-day baseline, judge-batch fires a judge.drift alert so regressions surface before users notice.', color: '#10b981' },
]

/** 4-mechanism improvement loop cards */
export function JudgeLoops() {
  return (
    <div className="not-prose my-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      {IMPROVEMENT_LOOPS.map((l) => (
        <div
          key={l.title}
          style={{
            border: '1.5px solid var(--nextra-border, #e5e7eb)',
            borderRadius: 10,
            padding: '14px 16px',
            background: 'var(--nextra-bg, transparent)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>{l.icon}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: l.color }}>{l.title}</span>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.75, margin: 0 }}>{l.body}</p>
        </div>
      ))}
    </div>
  )
}
