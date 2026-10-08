import { useState } from 'react'
import { motion } from 'framer-motion'
import { bannerEnterSpring } from '../../lib/motion-tokens'
import { useMotionTransition } from '../../lib/useMotionTransition'
import { Badge, Btn, SegmentedControl } from '../ui'
import { IconDots } from '../icons'
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
  onRunGatesForStory?: (storyId: string) => void
  onRunCrawlerForStory?: (storyId: string) => void
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

type StoryFilter = 'all' | 'open' | 'regressed'

const STORY_FILTERS: Array<{ id: StoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Not verified' },
  { id: 'regressed', label: 'Regressed' },
]

/** Actions a filter keeps; `all` keeps every action. */
function actionsFor(story: Story, filter: StoryFilter): StoryAction[] {
  if (filter === 'open') return story.actions.filter((a) => a.status !== 'verified')
  if (filter === 'regressed') return story.actions.filter((a) => a.status === 'regressed')
  return story.actions
}

function actionIntent(a: StoryAction): string | null {
  const meta = (a.metadata ?? {}) as ActionMeta
  return meta.intent ?? meta.action ?? null
}

/**
 * One quiet "⋯" per story instead of a "Run gates" + "Run crawler" pair on
 * every card (a long story list showed 10+ identical crawler buttons). The
 * page-wide Run crawler / Run gates live once in the page action row; these
 * items say what the story-scoped versions do.
 */
function StoryActionsMenu({
  storyTitle,
  onRunGates,
  onCrawlPages,
}: {
  storyTitle: string
  onRunGates?: () => void
  onCrawlPages?: () => void
}) {
  const [open, setOpen] = useState(false)
  const item = (label: string, run: () => void) => (
    <Btn
      variant="ghost"
      size="sm"
      className="flex w-full items-center justify-start rounded-none px-3 py-2 text-left text-xs font-normal text-fg hover:bg-surface-hover"
      onClick={(e) => {
        e.stopPropagation()
        setOpen(false)
        run()
      }}
    >
      {label}
    </Btn>
  )
  return (
    <div className="relative" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <Btn
        variant="ghost"
        size="sm"
        aria-label={`Actions for ${storyTitle}`}
        aria-expanded={open}
        className="px-1.5"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <IconDots size={14} />
      </Btn>
      {open && (
        // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[200px] rounded-md border border-edge bg-surface shadow-lg py-1">
          {onCrawlPages && item("Crawl this story's pages", onCrawlPages)}
          {onRunGates && item('Run gates on this story', onRunGates)}
        </div>
      )}
    </div>
  )
}

export function UserStoryMap({ stories, findingsByNode, onSelectAction, onRunGatesForStory, onRunCrawlerForStory }: Props) {
  const enterTransition = useMotionTransition(bannerEnterSpring)
  const [filter, setFilter] = useState<StoryFilter>('all')
  // Fully verified stories start collapsed; ids here are opened by hand.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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

  const visibleStories = stories.filter((s) => actionsFor(s, filter).length > 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<StoryFilter>
          size="sm"
          ariaLabel="Filter stories by status"
          value={filter}
          onChange={setFilter}
          options={STORY_FILTERS}
        />
        <span className="text-2xs text-fg-muted">
          {visibleStories.length} of {stories.length} {stories.length === 1 ? 'story' : 'stories'}
        </span>
      </div>
      {visibleStories.length === 0 && (
        <p className="rounded-md border border-dashed border-edge-subtle p-4 text-center text-xs text-fg-muted">
          No stories match this filter.
        </p>
      )}
      {visibleStories.map((story, si) => {
        const { title, persona, goal, description, tags } = getStoryShape(story)
        const shownActions = actionsFor(story, filter)
        const verifiedCount = story.actions.filter((a) => a.status === 'verified').length
        const regressedCount = story.actions.filter((a) => a.status === 'regressed').length
        const stubCount = story.actions.filter((a) => a.status === 'stub').length
        const findingCount = findingsByNode
          ? story.actions.reduce((acc, a) => acc + (findingsByNode.get(a.id) ?? 0), 0)
          : null
        const totalTests = story.actions.reduce((acc, a) => acc + actionTestCount(a), 0)
        const allVerified = story.actions.length > 0 && verifiedCount === story.actions.length
        const collapsed = allVerified && !expanded.has(story.id)

        return (
          <motion.section
            key={story.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...enterTransition, delay: si * 0.04 }}
            // mushi-mushi-allowlist: motion.article enter animation; Card is not a motion component
            className="rounded-lg border border-edge-subtle bg-surface-raised p-4 shadow-sm"
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
                  {(onRunGatesForStory || onRunCrawlerForStory) && (
                    <StoryActionsMenu
                      storyTitle={title}
                      onRunGates={onRunGatesForStory ? () => onRunGatesForStory(story.id) : undefined}
                      onCrawlPages={onRunCrawlerForStory ? () => onRunCrawlerForStory(story.id) : undefined}
                    />
                  )}
                </div>
              </div>
              {description && !collapsed && (
                <p className="text-2xs text-fg-muted leading-relaxed max-w-prose">{description}</p>
              )}
              {tags.length > 0 && !collapsed && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Badge
                      key={t}
                      className="bg-brand/12 text-brand border border-brand/28 font-mono text-2xs"
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
                {allVerified && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    className="ml-auto px-1.5 py-0.5 text-2xs"
                    aria-expanded={!collapsed}
                    onClick={() => toggleExpanded(story.id)}
                  >
                    {collapsed ? `Show ${story.actions.length} verified action${story.actions.length === 1 ? '' : 's'}` : 'Hide actions'}
                  </Btn>
                )}
              </div>
            </header>

            {!collapsed && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {shownActions.map((a, ai) => {
                const intent = actionIntent(a)
                const tests = actionTestCount(a)
                const findings = findingsByNode?.get(a.id) ?? 0
                return (
                  <motion.button
                    key={`${story.id}-${a.id}`}
                    type="button"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ ...enterTransition, delay: si * 0.04 + ai * 0.02 }}
                    whileHover={{ y: -1 }}
                    onClick={() => onSelectAction?.(a)}
                    // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
                    className="text-left rounded-md border border-edge-subtle bg-surface-raised/60 p-3 hover:bg-surface-overlay/70 motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                  >
                    {/* The intent reads as the title; the raw inventory id
                        (glot/chat/send-chat-turn#button) is on hover. */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-fg line-clamp-2" title={a.label}>
                        {intent ?? a.label}
                      </span>
                      <InventoryStatusPill status={a.status} />
                    </div>
                    <div className="flex items-center gap-2 text-2xs text-fg-faint">
                      <span>
                        {tests} test{tests === 1 ? '' : 's'}
                      </span>
                      {findings > 0 && (
                        <span className="text-danger">
                          {findings} open finding{findings === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </motion.button>
                )
              })}
            </div>
            )}
          </motion.section>
        )
      })}
    </div>
  )
}
