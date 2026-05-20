'use client'

/** Visual replacement for the broken mermaid sequenceDiagram in multi-repo-fixes.mdx */

function RepoCard({ role, name, branch, accent }: { role: string; name: string; branch: string; accent?: boolean }) {
  return (
    <div
      style={{
        border: `1.5px solid ${accent ? 'var(--mushi-vermillion, #e03c2c)' : 'var(--nextra-border, #e5e7eb)'}`,
        borderRadius: 10,
        padding: '12px 16px',
        background: accent ? 'color-mix(in srgb, var(--mushi-vermillion, #e03c2c) 6%, transparent)' : 'var(--nextra-bg, transparent)',
        textAlign: 'center',
        flex: '1 1 0',
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.45, marginBottom: 4, fontFamily: 'var(--mushi-font-mono, monospace)' }}>{role}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: accent ? 'var(--mushi-vermillion, #e03c2c)' : 'inherit' }}>{name}</div>
      <code style={{ fontSize: 10, opacity: 0.55 }}>{branch}</code>
    </div>
  )
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0' }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'var(--nextra-border, #e5e7eb)',
          color: 'var(--nextra-content, #1a1a1a)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 12, lineHeight: 1.5, paddingTop: 2 }}>{text}</span>
    </div>
  )
}

const STATUS_ROWS = [
  { children: 'All completed', status: 'succeeded', color: '#10b981' },
  { children: 'Some completed, some failed', status: 'partial_success', color: '#f59e0b' },
  { children: 'All failed', status: 'failed', color: '#ef4444' },
  { children: 'Manually stopped', status: 'cancelled', color: '#6b7280' },
]

export function MultiRepoFlowDiagram() {
  return (
    <div className="not-prose my-8 rounded-xl border border-[color:var(--nextra-border)] bg-[color:var(--nextra-bg)] p-5">
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.4, marginBottom: 16, fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Coordination flow
      </div>

      {/* Step 1 — dispatch */}
      <div style={{ marginBottom: 14 }}>
        <Step n={1} text="Admin triggers POST /v1/admin/fixes/coordinate — Planner agent produces a task list with a rationale for each repo." />
        <Step n={2} text="fix_coordinations row inserted (status=planning). One FixOrchestrator spawned per repo in parallel." />
      </div>

      {/* Parallel repos */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <RepoCard role="Frontend repo" name="checkout-fe" branch="acme/checkout-fe" />
        <div style={{ display: 'flex', alignItems: 'center', opacity: 0.35, flexShrink: 0 }}>
          <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden>
            <path d="M2 7 H22" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" fill="none" strokeLinecap="round" />
          </svg>
        </div>
        <RepoCard role="Backend repo" name="checkout-be" branch="acme/checkout-be" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Step n={3} text="Each orchestrator opens a PR independently. PR body includes: diff summary, files changed, AI rationale, spec-validation warnings." />
        <Step n={4} text='After both PRs are open, linkPRs() posts a cross-link comment on each: "This PR is part of a coordinated fix — see siblings before merging."' />
        <Step n={5} text="Status reconciler rolls up children → parent fix_coordinations.status (see table below)." />
      </div>

      {/* Status rollup mini-table */}
      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--nextra-border, #e5e7eb)' }}>
        {STATUS_ROWS.map((r, i) => (
          <div
            key={r.status}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 14px',
              background: i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, currentColor 3%, transparent)',
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.75 }}>{r.children}</span>
            <code style={{ fontSize: 11, fontWeight: 600, color: r.color }}>{r.status}</code>
          </div>
        ))}
      </div>
    </div>
  )
}
