'use client'

import { VIZ } from '../lib/viz-tokens'
import {
  DiagramFigure,
  DiagramStep,
} from './diagram-primitives'

/** Visual replacement for the broken mermaid sequenceDiagram in multi-repo-fixes.mdx */

const MULTI_REPO_ARIA =
  'Multi-repo fix coordination: admin triggers coordinate endpoint, parallel orchestrators open PRs per repo, cross-link comments, status rollup from child to parent coordination.'

function RepoCard({ role, name, branch, accent }: { role: string; name: string; branch: string; accent?: boolean }) {
  return (
    <div
      style={{
        border: `1.5px solid ${accent ? VIZ.accent : VIZ.panelBorder}`,
        borderRadius: 10,
        padding: '12px 16px',
        background: accent ? VIZ.accentWash : VIZ.panelBg,
        textAlign: 'center',
        flex: '1 1 0',
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.45, marginBottom: 4, fontFamily: 'var(--mushi-font-mono, monospace)' }}>{role}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: accent ? VIZ.accent : 'inherit' }}>{name}</div>
      <code style={{ fontSize: 11, opacity: 0.55 }}>{branch}</code>
    </div>
  )
}

const STATUS_ROWS = [
  { children: 'All completed', status: 'succeeded', color: VIZ.positive },
  { children: 'Some completed, some failed', status: 'partial_success', color: VIZ.warn },
  { children: 'All failed', status: 'failed', color: VIZ.danger },
  { children: 'Manually stopped', status: 'cancelled', color: VIZ.muted },
] as const

export function MultiRepoFlowDiagram() {
  return (
    <DiagramFigure ariaLabel={MULTI_REPO_ARIA}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.4, marginBottom: 16, fontFamily: 'var(--mushi-font-mono, monospace)' }}>
        Coordination flow
      </div>

      <div style={{ marginBottom: 14 }}>
        <DiagramStep n={1} text="Admin triggers POST /v1/admin/fixes/coordinate — Planner agent produces a task list with a rationale for each repo." />
        <DiagramStep n={2} text="fix_coordinations row inserted (status=planning). One FixOrchestrator spawned per repo in parallel." />
      </div>

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
        <DiagramStep n={3} text="Each orchestrator opens a PR independently. PR body includes: diff summary, files changed, AI rationale, spec-validation warnings." />
        <DiagramStep n={4} text='After both PRs are open, linkPRs() posts a cross-link comment on each: "This PR is part of a coordinated fix — see siblings before merging."' />
        <DiagramStep n={5} text="Status reconciler rolls up children → parent fix_coordinations.status (see table below)." />
      </div>

      <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${VIZ.panelBorder}` }}>
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
    </DiagramFigure>
  )
}
