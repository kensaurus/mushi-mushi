/**
 * FILE: apps/docs/components/Pillars.tsx
 * PURPOSE: A 4-up rhythmic strip of named pipeline stages used on the docs
 *   landing to summarise the Mushi loop in one glance.
 *
 * WHY THIS COMPONENT EXISTS
 * -------------------------
 * The landing previously embedded a `\`\`\`mermaid` sequence diagram under
 * "Architecture at a glance". Mermaid renders client-side and is dropped
 * in the static export pipeline at build time on this surface, leaving the
 * H2 with a single one-line link beneath it — wasted vertical real estate
 * (NN/g visual hierarchy: dead grid space). Pillars is the static, always-
 * renders replacement: four labelled steps that map to the canonical
 * `Capture → Classify → Connect → Fix` mental model used by the marketing
 * canvas and the architecture page. Authors can override the entries on
 * pages where a different cut of the loop is the focus.
 *
 * USAGE
 * -----
 *   <Pillars items={[
 *     { step: 'Step 1', name: 'Capture',  role: 'SDKs collect…' },
 *     …
 *   ]} />
 *
 * If `items` is omitted the canonical four pillars render — that's the
 * common case and keeps MDX free of incidental data.
 */

interface Pillar {
  step: string
  name: string
  role: string
}

const DEFAULT_PILLARS: readonly Pillar[] = [
  {
    step: 'Step 1',
    name: 'Capture',
    role: 'Web, mobile, and AI-agent SDKs collect structured reports with screenshots, breadcrumbs, and device context.',
  },
  {
    step: 'Step 2',
    name: 'Classify',
    role: 'A two-stage LLM pipeline (fast-filter → classify-report) tags severity, category, and component — judged nightly.',
  },
  {
    step: 'Step 3',
    name: 'Connect',
    role: 'Reports embed into a knowledge graph (pgvector + Apache AGE) so duplicates collapse and component hot-spots emerge.',
  },
  {
    step: 'Step 4',
    name: 'Fix',
    role: 'Approved triage hands off to an agentic orchestrator that runs in a sandbox (E2B) and opens a scoped GitHub PR.',
  },
] as const

interface PillarsProps {
  items?: readonly Pillar[]
}

export function Pillars({ items = DEFAULT_PILLARS }: PillarsProps) {
  return (
    /* Native `<ol>` so iOS VoiceOver and other screen readers announce the
     * stage count + ordering correctly — `role="list"` on a `<div>` is
     * silently dropped on some assistive tech (Apple's VoiceOver list
     * heuristic). The `not-prose` className opts out of Tailwind Typography
     * defaults, and the `.docs-pillars` rules in globals.css strip
     * `list-style`, marker, and indent so the list-semantics are auditory
     * only — the rendering matches the tile grid. */
    <ol className="docs-pillars not-prose" aria-label="The Mushi loop">
      {items.map((p, i) => (
        <li key={p.name} className="docs-pillar">
          <span className="docs-pillar__step">{p.step}</span>
          <span className="docs-pillar__name">{p.name}</span>
          <span className="docs-pillar__role">{p.role}</span>
          {/* Subtle horizontal connector — only between pillars, only on
           * wide enough containers where the 4-up actually fits in one row.
           * Hidden on the last pillar and at narrow widths via CSS. */}
          {i < items.length - 1 ? (
            <span className="docs-pillar__connector" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  )
}
