/**
 * Langfuse-style "Where to start?" decision grid — three paths by intent.
 */
'use client'

interface PathCard {
  title: string
  desc: string
  href: string
  cmd?: string
}

const PATHS: readonly PathCard[] = [
  {
    title: 'I use Cursor / Claude',
    desc: 'Wire MCP first — triage reports and pull fix context without leaving the editor.',
    href: '/quickstart/incident-loop',
    cmd: 'npx mushi-mushi setup --ide cursor',
  },
  {
    title: 'I have a web or mobile app',
    desc: 'Drop in the SDK, file the first report, see classification in ~10s.',
    href: '/quickstart/react',
    cmd: 'npx mushi-mushi',
  },
  {
    title: 'I operate the console',
    desc: 'Create a project, mint keys, connect GitHub, run the onboarding checklist.',
    href: '/admin/onboarding',
    cmd: 'mushi login && mushi status',
  },
]

export function WhereToStartGrid() {
  return (
    <div className="docs-quickstart-grid not-prose" role="list" aria-label="Where to start">
      {PATHS.map((p) => (
        <a key={p.title} href={p.href} className="docs-quickstart-card" role="listitem">
          <h3 className="docs-quickstart-card__title">{p.title}</h3>
          <p className="docs-quickstart-card__desc">{p.desc}</p>
          {p.cmd ? (
            <code className="docs-quickstart-card__cmd">{p.cmd}</code>
          ) : null}
        </a>
      ))}
    </div>
  )
}
