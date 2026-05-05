import { motion } from 'framer-motion'
import { Badge } from '../ui'
import { InventoryStatusPill } from './InventoryStatusPill'

/**
 * Renders the full schema shape of `user_stories[]` from inventory.yaml:
 *   - title (heading)
 *   - persona (small badge)
 *   - goal (sub-headline)
 *   - description (body copy)
 *   - tags (chip row)
 *   - actions (grid of mini-cards with status + linked test count)
 *
 * Story `metadata` comes straight from `graph_nodes.metadata` which is
 * populated at ingest time in `_shared/inventory.ts::ingestInventory`.
 *
 * `findingsByNode` lets the caller pass a Map keyed by graph_node UUID so
 * each story card can advertise an open-finding count without a second
 * round-trip — see InventoryPage where it's computed from
 * `findingsQuery.data.findings`.
 */
interface StoryAction {
  id: string
  label: string
  status: string
  metadata?: Record<string, unknown> | null
}

export interface Story {
  id: string
  label: string
  metadata?: Record<string, unknown> | null
  actions: StoryAction[]
}

interface Props {
  stories: Story[]
  findingsByNode?: Map<string, number>
  onSelectAction?: (a: StoryAction) => void
}

interface ActionMeta {
  intent?: string
  action?: string
  verified_by?: Array<{ file?: string; name?: string; framework?: string }>
  status?: string
  claimed_status?: string
}

function getStoryShape(story: Story) {
  const meta = (story.metadata ?? {}) as Record<string, unknown>
  const title = typeof meta.title === 'string' && meta.title.trim().length ? meta.title : story.label
  const persona = typeof meta.persona === 'string' ? meta.persona : null
  const goal = typeof meta.goal === 'string' ? meta.goal : null
  const description = typeof meta.description === 'string' ? meta.description : null
  const tags = Array.isArray(meta.tags) ? (meta.tags as unknown[]).filter((t): t is string => typeof t === 'string') : []
  return { title, persona, goal, description, tags }
}

function actionTestCount(a: StoryAction): number {
  const meta = (a.metadata ?? {}) as ActionMeta
  return Array.isArray(meta.verified_by) ? meta.verified_by.length : 0
}

function actionIntent(a: StoryAction): string | null {
  const meta = (a.metadata ?? {}) as ActionMeta
  return meta.intent ?? meta.action ?? null
}

export function UserStoryMap({ stories, findingsByNode, onSelectAction }: Props) {
  if (!stories.length) {
    return (
      <div className="rounded-md border border-dashed border-edge-subtle p-6 text-center">
        <p className="text-sm font-medium text-fg">No user stories ingested yet</p>
        <p className="text-2xs text-fg-muted mt-1 max-w-md mx-auto">
          Author a top-level <code className="font-mono">user_stories:</code> array in your{' '}
          <code className="font-mono">inventory.yaml</code> with{' '}
          <code className="font-mono">id / title / persona / goal / description / tags</code>, then
          link each element with <code className="font-mono">user_story: &lt;id&gt;</code>. Re-ingest from the
          Yaml tab.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {stories.map((story, si) => {
        const { title, persona, goal, description, tags } = getStoryShape(story)
        const verifiedCount = story.actions.filter((a) => a.status === 'verified').length
        const regressedCount = story.actions.filter((a) => a.status === 'regressed').length
        const stubCount = story.actions.filter((a) => a.status === 'stub').length
        const findingCount = findingsByNode
          ? story.actions.reduce((acc, a) => acc + (findingsByNode.get(a.id) ?? 0), 0)
          : null
        const totalTests = story.actions.reduce((acc, a) => acc + actionTestCount(a), 0)

        return (
          <motion.section
            key={story.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: si * 0.04 }}
            className="rounded-lg border border-edge-subtle bg-gradient-to-br from-surface-raised/80 to-surface-overlay/30 p-4 shadow-sm"
          >
            <header className="mb-3 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-2xs uppercase tracking-wider text-fg-faint">User story</p>
                  <h3 className="text-base font-semibold text-fg leading-snug">{title}</h3>
                  {goal && (
                    <p className="text-xs text-fg-secondary mt-0.5">
                      <span className="text-fg-faint">Goal · </span>
                      {goal}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  {persona && (
                    <Badge className="bg-surface-overlay/70 text-fg-secondary border border-edge-subtle">
                      {persona}
                    </Badge>
                  )}
                  <Badge
                    className="bg-surface-overlay/40 text-fg-muted border border-edge-subtle font-mono"
                    title={`${story.actions.length} actions implement this story`}
                  >
                    {story.actions.length} actions
                  </Badge>
                </div>
              </div>
              {description && (
                <p className="text-2xs text-fg-muted leading-relaxed max-w-prose">{description}</p>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Badge
                      key={t}
                      className="bg-brand/10 text-brand border border-brand/20 font-mono text-2xs"
                    >
                      #{t}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-2xs pt-1.5 border-t border-edge-subtle/50">
                <span className="text-fg-muted">
                  <span className="text-fg-faint">Verified </span>
                  <strong className="font-semibold text-fg">{verifiedCount}</strong>
                  <span className="text-fg-faint">/{story.actions.length}</span>
                </span>
                {regressedCount > 0 && (
                  <span className="text-danger">
                    {regressedCount} regressed
                  </span>
                )}
                {stubCount > 0 && (
                  <span className="text-warn">{stubCount} stub</span>
                )}
                <span className="text-fg-muted">
                  <span className="text-fg-faint">Tests </span>
                  <strong className="font-semibold text-fg">{totalTests}</strong>
                </span>
                {findingCount !== null && findingCount > 0 && (
                  <span className="text-danger">
                    {findingCount} open finding{findingCount === 1 ? '' : 's'}
                  </span>
                )}
                {findingCount === 0 && (
                  <span className="text-ok">No open findings</span>
                )}
              </div>
            </header>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {story.actions.map((a, ai) => {
                const intent = actionIntent(a)
                const tests = actionTestCount(a)
                const findings = findingsByNode?.get(a.id) ?? 0
                return (
                  <motion.button
                    key={`${story.id}-${a.id}`}
                    type="button"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: si * 0.04 + ai * 0.02 }}
                    whileHover={{ y: -1 }}
                    onClick={() => onSelectAction?.(a)}
                    className="text-left rounded-md border border-edge-subtle bg-surface-raised/60 p-3 hover:bg-surface-overlay/70 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-fg truncate">{a.label}</span>
                      <InventoryStatusPill status={a.status} />
                    </div>
                    {intent && (
                      <p className="text-2xs text-fg-muted line-clamp-2 mb-1.5">{intent}</p>
                    )}
                    <div className="flex items-center gap-2 text-2xs text-fg-faint font-mono">
                      <span title={`${tests} test reference${tests === 1 ? '' : 's'}`}>
                        🧪 {tests}
                      </span>
                      {findings > 0 && (
                        <span className="text-danger" title={`${findings} open finding${findings === 1 ? '' : 's'}`}>
                          ⚠ {findings}
                        </span>
                      )}
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </motion.section>
        )
      })}
    </div>
  )
}
