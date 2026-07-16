import { useState, type ReactNode } from 'react'
import { Btn, Card, Kbd, SegmentedControl, Tooltip } from '../ui'
import {
  IconClock,
  IconReports,
  IconUser,
  IconCamera,
  IconJudge,
} from '../icons'

interface PromptItem {
  prompt: string
  why: string
}
interface PromptCategory {
  id: string
  label: string
  icon: ReactNode
  /** Tailwind tone class — applied as bg/text on the active tab + the
   *  category icon swatch so the user can tell categories apart at a
   *  glance even after the tab strip scrolls out of view. */
  tone:
    | 'text-info'
    | 'text-brand'
    | 'text-ok'
    | 'text-warn'
    | 'text-fg-secondary'
  blurb: string
  prompts: PromptItem[]
}

export const PROMPT_CATEGORIES: readonly PromptCategory[] = [
  {
    id: 'trends',
    label: 'Trends',
    icon: <IconClock />,
    tone: 'text-info',
    blurb: 'Time-bucketed deltas — phrase the comparison explicitly.',
    prompts: [
      {
        prompt: 'How many P0/P1 reports landed this week vs last week?',
        why: 'Anchor the LLM on a concrete comparison so it picks the right time-bucket SQL.',
      },
      {
        prompt: 'How many critical bugs were reported this week?',
        why: 'Single-bucket count over the rolling 7d window — fastest to verify by eyeballing.',
      },
      {
        prompt: 'List components that regressed (fixed → reopened) in the last 30 days',
        why: 'Mention "regressed" so the LLM joins reports.fixed_at with later events.',
      },
    ],
  },
  {
    id: 'components',
    label: 'Components',
    icon: <IconReports />,
    tone: 'text-brand',
    blurb: 'Group reports by surface, package, or feature.',
    prompts: [
      {
        prompt: 'Which component has the most bugs?',
        why: 'Single-column GROUP BY — easy to validate against your gut feel.',
      },
      {
        prompt: 'Top 5 components by report count this month',
        why: 'Pre-bound limit + window keeps the result set small + the LLM cheap.',
      },
      {
        prompt: 'Show reports that might be regressions',
        why: 'Lets the LLM lean on `is_regression` heuristics in the schema.',
      },
    ],
  },
  {
    id: 'reporters',
    label: 'Reporters',
    icon: <IconUser />,
    tone: 'text-ok',
    blurb: 'Slice by who reported, with reputation + agreement signals.',
    prompts: [
      {
        prompt: 'Which reporters have the highest agreement rate with the judge?',
        why: 'Anchor on a known metric (classification_agreed) so the SQL stays read-only.',
      },
      {
        prompt: 'List dismissed reports with low reputation reporters',
        why: 'Pairs status + reputation in one filter — good signal-to-noise sample.',
      },
    ],
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: <IconCamera />,
    tone: 'text-warn',
    blurb: 'Coverage of screenshots, console logs, repro steps.',
    prompts: [
      {
        prompt: 'Reports with screenshots but no console logs in the last 7 days',
        why: 'Pair two columns to test telemetry coverage end-to-end.',
      },
      {
        prompt: 'Average classifier latency by model over the last 14 days',
        why: 'Time window keeps the result set small + the LLM cheap.',
      },
    ],
  },
  {
    id: 'quality',
    label: 'Quality',
    icon: <IconJudge />,
    tone: 'text-fg-secondary',
    blurb: 'Judge scores, classification agreement, fix outcomes.',
    prompts: [
      {
        prompt: 'Average judge score by week (last 4 weeks)',
        why: 'Bounded series — render the trend without paginating.',
      },
      {
        prompt: 'Which classifier model has the best agreement with the judge?',
        why: 'Direct head-to-head — cite a single metric so the SQL stays sharp.',
      },
    ],
  },
]

// The categorised "Prompt library" panel. Replaces the previous wall of
// buttons (`SUGGESTIONS`) + bullet list (`SQL_HINTS`) which together
// rendered the same hint twice — once as a flat pill, once as a list
// item with an italic caption underneath. Hick's Law: chunk by user
// intent, show the "why" only on hover. Click a prompt to insert into
// the composer (so the operator can edit before running). Run-on-click
// is still available via the per-row run button when in a hurry.
export function QueryPromptLibrary({
  onInsert,
  onRun,
}: {
  onInsert: (prompt: string) => void
  onRun: (prompt: string) => void
}) {
  const [activeCat, setActiveCat] = useState<string>(PROMPT_CATEGORIES[0]!.id)
  const cat = PROMPT_CATEGORIES.find((c) => c.id === activeCat) ?? PROMPT_CATEGORIES[0]!
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          Prompt library
        </h3>
        <span className="text-2xs text-fg-faint hidden sm:inline">
          Click to edit · <Kbd>↵</Kbd> to run from composer
        </span>
      </div>

      <div className="overflow-x-auto -mx-1 mb-2 pb-1">
        <SegmentedControl
          value={activeCat}
          onChange={setActiveCat}
          ariaLabel="Prompt library categories"
          size="md"
          scrollable
          className="min-w-max bg-surface-raised/50"
          options={PROMPT_CATEGORIES.map((c) => ({
            id: c.id,
            label: c.label,
            count: c.prompts.length,
          }))}
        />
      </div>

      <p className="text-2xs text-fg-faint mb-2 leading-relaxed">{cat.blurb}</p>

      <ul className="space-y-1">
        {cat.prompts.map((p) => (
          <li
            key={p.prompt}
            className="group flex items-start gap-1 rounded-sm border border-transparent hover:border-edge-subtle hover:bg-surface-overlay/30 motion-safe:transition-opacity"
          >
            <button
              type="button"
              onClick={() => onInsert(p.prompt)}
              title={p.why}
              className="flex-1 min-w-0 text-left px-2 py-1.5 text-2xs text-fg-secondary hover:text-fg motion-safe:transition-opacity"
            >
              <span className="block">{p.prompt}</span>
              <span className="hidden group-hover:block group-focus-within:block text-2xs text-fg-faint mt-0.5 italic">
                {p.why}
              </span>
            </button>
            <Tooltip content="Run now" side="left">
              <Btn
                size="sm"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 motion-safe:transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  onRun(p.prompt)
                }}
                aria-label={`Run prompt: ${p.prompt}`}
              >
                Run →
              </Btn>
            </Tooltip>
          </li>
        ))}
      </ul>
    </Card>
  )
}
