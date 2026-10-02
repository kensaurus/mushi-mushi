'use client'

/**
 * Client half of the public diagram page: parse the repo from the URL, fetch
 * the published diagram, draw it as plain SVG from the server's positions.
 * Shows only what the owner previewed and published: part names, short
 * descriptions, paths that exist at the stated commit, and the commit itself.
 */

import { useEffect, useMemo, useState } from 'react'
import { getLoadedMushi } from '@/components/MushiSiteAnalytics'
import {
  canvasSize,
  diagramSignupHref,
  edgePath,
  githubTreeUrl,
  NODE_H,
  NODE_W,
  parseRepoFromLocation,
  PUBLIC_API_URL,
  reportWrongDiagram,
  type PublicDiagram,
} from '@/lib/public-diagram'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-repo' }
  | { kind: 'not-found'; owner: string; repo: string }
  | { kind: 'error' }
  | { kind: 'ready'; diagram: PublicDiagram }

export function PublicDiagramClient() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const target = parseRepoFromLocation(window.location.pathname, window.location.search)
    if (!target) {
      setState({ kind: 'no-repo' })
      return
    }
    const controller = new AbortController()
    fetch(`${PUBLIC_API_URL}/v1/public/diagrams/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 404) return setState({ kind: 'not-found', ...target })
        const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: PublicDiagram } | null
        if (!res.ok || !body?.ok || !body.data) return setState({ kind: 'error' })
        setState({ kind: 'ready', diagram: body.data })
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') setState({ kind: 'error' })
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="min-h-screen bg-mushi-paper">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {state.kind === 'loading' && <p className="text-sm text-mushi-ink-muted">Loading the diagram…</p>}
        {state.kind === 'no-repo' && (
          <Message title="Architecture diagrams" body="Open a link like kensaur.us/mushi-mushi/r/owner/repo to see a published diagram." />
        )}
        {state.kind === 'not-found' && (
          <Message
            title={`${state.owner}/${state.repo}`}
            body="This repo has no public diagram. Its owner can publish one from the Mushi console."
          />
        )}
        {state.kind === 'error' && <Message title="Could not load the diagram" body="Try again in a minute." />}
        {state.kind === 'ready' && (
          <DiagramView diagram={state.diagram} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>
    </div>
  )
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight text-mushi-ink">{title}</h1>
      <p className="text-sm text-mushi-ink-muted">{body}</p>
      <SignupLink href="https://kensaur.us/mushi-mushi/admin/signup?src=diagram" />
    </div>
  )
}

function SignupLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      data-mushi-cta="public_diagram_signup"
      data-mushi-location="public_diagram"
      className="inline-block text-sm font-medium text-mushi-vermillion hover:underline"
    >
      Get a diagram and plain-English bug fixes for your own app →
    </a>
  )
}

function ReportDiagramButton({
  diagram,
  node,
}: {
  diagram: PublicDiagram
  node: { label: string; path: string | null } | null
}) {
  const onClick = () => {
    const outcome = reportWrongDiagram(
      { owner: diagram.owner, repo: diagram.repo, sha: diagram.sha, nodePath: node?.path ?? null, nodeLabel: node?.label ?? null },
      getLoadedMushi(),
    )
    if (outcome.via === 'email') window.location.href = outcome.href
  }
  return (
    <button type="button" className="underline underline-offset-2" onClick={onClick}>
      {node ? `Report a problem with “${node.label}”` : 'Report a wrong or unwanted diagram'}
    </button>
  )
}

function DiagramView({
  diagram,
  selectedId,
  onSelect,
}: {
  diagram: PublicDiagram
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const size = useMemo(() => canvasSize(diagram), [diagram])
  const byId = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram])
  const selected = selectedId ? byId.get(selectedId) ?? null : null
  const drawnOn = new Date(diagram.generated_at).toLocaleDateString('en-US', { dateStyle: 'medium' })

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-mushi-ink">
          {diagram.owner}/{diagram.repo}
        </h1>
        <p className="text-sm text-mushi-ink-muted">
          Architecture drawn by AI from commit{' '}
          <a
            className="font-mono underline decoration-mushi-rule underline-offset-2"
            href={`https://github.com/${diagram.owner}/${diagram.repo}/tree/${diagram.sha}`}
          >
            {diagram.sha.slice(0, 7)}
          </a>{' '}
          on {drawnOn}. Every file path was checked against the repo at that commit. It can still be wrong about what
          a part does.
        </p>
        <p className="text-xs text-mushi-ink-muted">
          <ReportDiagramButton diagram={diagram} node={selected} />
        </p>
      </header>

      <div className="overflow-x-auto rounded-md border border-mushi-rule bg-mushi-paper-wash">
        <svg
          width={size.width}
          height={size.height}
          viewBox={`-16 -16 ${size.width} ${size.height}`}
          role="img"
          aria-label={`Architecture diagram of ${diagram.owner}/${diagram.repo}`}
        >
          <defs>
            <marker id="mushi-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--mushi-ink-muted)" />
            </marker>
          </defs>
          {diagram.groups.map((g) => (
            <g key={g.id}>
              <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={8} fill="var(--mushi-paper)" stroke="var(--mushi-rule)" />
              <text x={g.x + 12} y={g.y + 22} fontSize={11} fontWeight={600} fill="var(--mushi-ink-muted)">
                {g.label.toUpperCase()}
              </text>
            </g>
          ))}
          {diagram.edges.map((e) => {
            const from = byId.get(e.from)
            const to = byId.get(e.to)
            if (!from || !to) return null
            const active = selectedId === e.from || selectedId === e.to
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={edgePath(from, to)}
                fill="none"
                stroke={active ? 'var(--mushi-vermillion)' : 'var(--mushi-ink-muted)'}
                strokeOpacity={active ? 1 : 0.45}
                strokeWidth={active ? 2 : 1.25}
                markerEnd="url(#mushi-arrow)"
              >
                <title>{e.label}</title>
              </path>
            )
          })}
          {diagram.nodes.map((n) => {
            const isSelected = n.id === selectedId
            return (
              <g
                key={n.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={n.label}
                className="cursor-pointer"
                onClick={() => onSelect(isSelected ? null : n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    onSelect(isSelected ? null : n.id)
                  }
                }}
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={4}
                  fill="var(--mushi-paper)"
                  stroke={isSelected ? 'var(--mushi-vermillion)' : 'var(--mushi-rule)'}
                  strokeWidth={isSelected ? 2 : 1}
                />
                <text x={n.x + 10} y={n.y + 26} fontSize={13} fontWeight={600} fill="var(--mushi-ink)">
                  {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
                </text>
                <text x={n.x + 10} y={n.y + 46} fontSize={10} fontFamily="monospace" fill="var(--mushi-ink-muted)">
                  {n.path ? (n.path.length > 34 ? `…${n.path.slice(-33)}` : n.path) : '—'}
                </text>
                <title>{n.description || n.label}</title>
              </g>
            )
          })}
        </svg>
      </div>

      {selected && (
        <section className="space-y-1 rounded-md border border-mushi-rule p-4" aria-live="polite">
          <h2 className="text-base font-semibold text-mushi-ink">{selected.label}</h2>
          {selected.description && <p className="text-sm text-mushi-ink-muted">{selected.description}</p>}
          {selected.path && (
            <a
              className="font-mono text-sm text-mushi-vermillion hover:underline"
              href={githubTreeUrl(diagram.owner, diagram.repo, diagram.sha, selected.path)}
            >
              {selected.path} on GitHub
            </a>
          )}
        </section>
      )}

      <footer className="space-y-2 border-t border-mushi-rule pt-4 text-sm text-mushi-ink-muted">
        <p>
          Made with Mushi: when something in your app breaks, Mushi tells you why in plain English, with the fix ready
          to go.
        </p>
        <SignupLink href={diagramSignupHref(diagram.owner, diagram.repo)} />
      </footer>
    </div>
  )
}
