/**
 * FILE: apps/admin/src/components/CommandPalette.tsx
 * PURPOSE: Global command palette (Cmd/Ctrl+K). Combines:
 *          1. Static routes + quick actions + live reports/fixes (keyword)
 *          2. Natural-language console assist (navigate mode → steps + deep links)
 *          3. @page / @project mentions and / slash commands in the input
 */

import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { overlayTween } from '../lib/motion-tokens'
import { useMotionTransition, useOverlayVariants } from '../lib/useMotionTransition'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCommandPalette } from '../lib/useCommandPalette'
import { useAdminMode, type AdminMode } from '../lib/mode'
import { apiFetch } from '../lib/supabase'
import {
  STRONG_PAGE_MATCH,
  paletteMatchScore,
  paletteRoutesFor,
  rankPaletteRoutes,
  type PaletteGroup,
  type StaticRoute,
} from '../lib/searchIndex'
import { NAV_SECTION_META, type NavSectionId } from '../lib/navRegistry'
import { usePageContext } from '../lib/pageContext'
import { useRecentEntities } from '../lib/recentEntities'
import {
  isNavigateQuery,
  PALETTE_SAMPLE_QUERIES,
  shouldRunPaletteLiveSearch,
} from '../lib/paletteNlDetect'
import { sendPaletteAssist } from '../lib/paletteAssist'
import { askMushiPanel } from '../lib/useAskMushiPanel'
import {
  detectComposerToken,
  filterSlashCommands,
  type SlashCommand,
} from '../lib/askMushiCommands'
import type { NavStep, NavTarget } from '../lib/askMushiTypes'
import { PaletteAssistView } from './PaletteAssistView'
import { fixDeepLinkPath } from '../lib/fixDeepLink'
import { useEntitlements } from '../lib/useEntitlements'

interface LiveReport {
  id: string
  /** Short title written at triage; null until the report is classified. */
  summary?: string | null
  description: string
  category: string
  severity: string | null
  status: string
}

interface LiveFix {
  id: string
  report_id: string
  status: string
  summary?: string
  pr_url?: string
  pr_number?: number
}

interface MentionHit {
  kind: string
  id: string
  label: string
  sublabel?: string
}

const RECENTS_KEY = 'mushi:palette:recent:v1'
const MAX_RECENTS = 5
const LIVE_DEBOUNCE_MS = 250
const LIVE_LIMIT = 5
const MENTION_DEBOUNCE_MS = 200

function readRecents(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeRecents(ids: string[]) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS)))
  } catch {
    // non-fatal
  }
}

const PALETTE_GROUP_ORDER: PaletteGroup[] = ['Start', 'Plan', 'Do', 'Check', 'Act', 'Workspace']

/** Palette headings use the same plain section names as the sidebar. */
const PALETTE_GROUP_SECTION: Record<PaletteGroup, NavSectionId> = {
  Start: 'start',
  Plan: 'plan',
  Do: 'do',
  Check: 'check',
  Act: 'act',
  Workspace: 'workspace',
}

const MAX_PAGE_RESULTS = 8

interface PaletteAction {
  id: string
  label: string
  hint: string
  keywords: string[]
  onSelect: () => void
}

function groupRoutes(routes: StaticRoute[]): Record<PaletteGroup, StaticRoute[]> {
  const out = PALETTE_GROUP_ORDER.reduce(
    (acc, g) => {
      acc[g] = []
      return acc
    },
    {} as Record<PaletteGroup, StaticRoute[]>,
  )
  for (const r of routes) out[r.group].push(r)
  return out
}

function buildContextPayload(pageCtx: ReturnType<typeof usePageContext>) {
  if (!pageCtx) return null
  return {
    title: pageCtx.title,
    summary: pageCtx.summary,
    filters: pageCtx.filters,
    selection: pageCtx.selection ?? null,
  }
}

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { mode, setMode } = useAdminMode()
  const pageCtx = usePageContext()
  const recentEntities = useRecentEntities()

  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(() => readRecents())
  const [liveReports, setLiveReports] = useState<LiveReport[]>([])
  const [liveFixes, setLiveFixes] = useState<LiveFix[]>([])
  const [liveLoading, setLiveLoading] = useState(false)

  const [view, setView] = useState<'search' | 'assist'>('search')
  const [assistQuery, setAssistQuery] = useState('')
  const [assistLoading, setAssistLoading] = useState(false)
  const [assistError, setAssistError] = useState<string | null>(null)
  const [assistText, setAssistText] = useState('')
  const [assistSteps, setAssistSteps] = useState<NavStep[] | undefined>()
  const [assistNavTargets, setAssistNavTargets] = useState<NavTarget[] | undefined>()
  const [assistClarify, setAssistClarify] = useState<{ question: string; options: string[] } | null>(null)
  const [assistThreadId, setAssistThreadId] = useState<string | undefined>()
  const [assistLangfuseTraceId, setAssistLangfuseTraceId] = useState<string | null>(null)
  const assistAbortRef = useRef<AbortController | null>(null)

  const [mentionHits, setMentionHits] = useState<MentionHit[]>([])
  const [slashHits, setSlashHits] = useState<SlashCommand[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  const showNavigateAffordance = query.trim().length >= 2 && isNavigateQuery(query)
  const { backdrop, panel } = useOverlayVariants()
  const overlayTransition = useMotionTransition(overlayTween)

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) close()
    },
    [close],
  )

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setView('search')
      setAssistError(null)
      assistAbortRef.current?.abort()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (view === 'assist') {
        e.preventDefault()
        e.stopPropagation()
        setView('search')
        return
      }
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen, close, view])

  useEffect(() => {
    if (!isOpen) return
    const trimmed = query.trim()
    if (!shouldRunPaletteLiveSearch(query, {
      composingMention: detectComposerToken(query, query.length)?.kind === 'mention',
      composingSlash: detectComposerToken(query, query.length)?.kind === 'slash',
    })) {
      setLiveReports([])
      setLiveFixes([])
      setLiveLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLiveLoading(true)
      const q = encodeURIComponent(trimmed)
      const [reportsRes, fixesRes] = await Promise.all([
        apiFetch<{ reports: LiveReport[]; total: number }>(
          `/v1/admin/reports?q=${q}&limit=${LIVE_LIMIT}&sort=created_at&dir=desc`,
          { signal: controller.signal },
        ),
        apiFetch<{ fixes: LiveFix[] }>(`/v1/admin/fixes?q=${q}&limit=${LIVE_LIMIT}`, {
          signal: controller.signal,
        }),
      ])
      if (controller.signal.aborted) return
      setLiveReports(reportsRes.ok && reportsRes.data?.reports ? reportsRes.data.reports : [])
      setLiveFixes(fixesRes.ok && fixesRes.data?.fixes ? fixesRes.data.fixes : [])
      setLiveLoading(false)
    }, LIVE_DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
      setLiveLoading(false)
    }
  }, [query, isOpen])

  // @mention typeahead
  useEffect(() => {
    const caret = query.length
    const token = detectComposerToken(query, caret)
    if (!token || token.kind !== 'mention') {
      setMentionHits([])
      return
    }
    if (token.query.length < 1) {
      setMentionHits([])
      return
    }
    const t = setTimeout(async () => {
      const res = await apiFetch<{ mentions: MentionHit[] }>(
        `/v1/admin/ask-mushi/mentions?q=${encodeURIComponent(token.query)}`,
      )
      setMentionHits(res.ok && res.data?.mentions ? res.data.mentions : [])
    }, MENTION_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  // / slash commands
  useEffect(() => {
    const caret = query.length
    const token = detectComposerToken(query, caret)
    if (token?.kind === 'slash') {
      setSlashHits(filterSlashCommands('/' + token.query))
    } else {
      setSlashHits([])
    }
  }, [query])

  // Only pages this viewer may open; operator and super-admin pages 403 for
  // everyone else (the sidebar hides them the same way).
  const { isSuperAdmin, isOperator } = useEntitlements()
  const visibleRoutes = useMemo(
    () => paletteRoutesFor({ isSuperAdmin, isOperator }),
    [isSuperAdmin, isOperator],
  )
  const routesByGroup = useMemo(() => groupRoutes(visibleRoutes), [visibleRoutes])
  const routeIds = useMemo(() => new Set(visibleRoutes.map((r) => r.id)), [visibleRoutes])

  const recentRoutes = useMemo(() => {
    if (query.trim()) return []
    const byId = new Map(visibleRoutes.map((r) => [r.id, r]))
    return recents.map((id) => byId.get(id)).filter((r): r is StaticRoute => Boolean(r))
  }, [recents, query, visibleRoutes])

  const activeToken = useMemo(
    () => detectComposerToken(query, query.length),
    [query],
  )

  const runLiveSearch = shouldRunPaletteLiveSearch(query, {
    composingMention: activeToken?.kind === 'mention',
    composingSlash: activeToken?.kind === 'slash',
  })

  // With a query, results are ranked here (cmdk filtering is off): strong
  // page matches first, then matching reports and fixes, then weaker pages.
  const trimmedQuery = query.trim()
  const searching = trimmedQuery.length > 0
  const rankedPages = useMemo(
    () => (searching ? rankPaletteRoutes(trimmedQuery, visibleRoutes) : []),
    [searching, trimmedQuery, visibleRoutes],
  )
  const strongPages = rankedPages
    .filter((r) => r.score >= STRONG_PAGE_MATCH)
    .slice(0, MAX_PAGE_RESULTS)
    .map((r) => r.route)
  const weakPages = rankedPages
    .filter((r) => r.score < STRONG_PAGE_MATCH)
    .slice(0, Math.max(0, MAX_PAGE_RESULTS - strongPages.length))
    .map((r) => r.route)
  const matchesQuery = (label: string, hint: string, keywords: readonly string[]) =>
    !searching || paletteMatchScore(trimmedQuery, { label, aliases: keywords, description: hint }) > 0

  function handleSelect(id: string, action: () => void) {
    if (routeIds.has(id)) {
      const next = [id, ...recents.filter((x) => x !== id)].slice(0, MAX_RECENTS)
      setRecents(next)
      writeRecents(next)
    }
    close()
    setTimeout(action, 0)
  }

  const runAssist = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed) return
      assistAbortRef.current?.abort()
      const ctrl = new AbortController()
      assistAbortRef.current = ctrl
      setAssistQuery(trimmed)
      setView('assist')
      setAssistLoading(true)
      setAssistError(null)
      setAssistText('')
      setAssistSteps(undefined)
      setAssistNavTargets(undefined)
      setAssistClarify(null)
      setAssistLangfuseTraceId(null)

      const res = await sendPaletteAssist({
        query: trimmed,
        route: pathname,
        context: buildContextPayload(pageCtx),
        threadId: assistThreadId,
        signal: ctrl.signal,
      })

      if (ctrl.signal.aborted) return
      setAssistLoading(false)
      if (!res.ok) {
        setAssistError(res.error)
        return
      }
      setAssistThreadId(res.data.threadId)
      setAssistText(res.data.text)
      setAssistSteps(res.data.steps)
      setAssistNavTargets(res.data.navTargets)
      setAssistClarify(res.data.clarify ?? null)
      setAssistLangfuseTraceId(res.data.langfuseTraceId ?? null)
    },
    [pathname, pageCtx, assistThreadId],
  )

  function insertTokenReplacement(tokenStart: number, replacement: string) {
    const before = query.slice(0, tokenStart)
    const after = query.slice(query.length)
    setQuery(`${before}${replacement} ${after}`.replace(/\s+/g, ' ').trim() + ' ')
    inputRef.current?.focus()
  }

  function handleMentionPick(hit: MentionHit) {
    if (!activeToken || activeToken.kind !== 'mention') return
    insertTokenReplacement(activeToken.tokenStart, `@${hit.kind}:${hit.id}`)
    setMentionHits([])
  }

  function handleSlashPick(cmd: SlashCommand) {
    if (!activeToken || activeToken.kind !== 'slash') return
    if (cmd.effect.kind === 'local') return
    const rest = query.slice(activeToken.tokenStart + cmd.command.length).trim()
    const prefix =
      cmd.effect.kind === 'prepend'
        ? `${cmd.effect.text}${rest ? ` ${rest}` : ''}`
        : rest
    setQuery(prefix)
    setSlashHits([])
    if (isNavigateQuery(prefix)) {
      void runAssist(prefix)
    }
  }

  const actions: PaletteAction[] = [
    {
      id: 'action:ask-this-page',
      label: 'What can I do on this page?',
      hint: 'Ask Mushi about the current screen',
      keywords: ['help', 'explain', 'how', 'what'],
      onSelect: () => void runAssist('What can I do on this page?'),
    },
    {
      id: 'action:filter:new-reports',
      label: 'Open new bug reports',
      hint: 'Bugs that nobody has looked at yet',
      keywords: ['inbox', 'new', 'triage', 'untriaged'],
      onSelect: () => handleSelect('action:filter:new-reports', () => navigate('/reports?status=new')),
    },
    {
      id: 'action:filter:urgent-reports',
      label: 'Open critical bugs',
      hint: 'New bugs marked critical',
      keywords: ['urgent', 'sev1', 'critical', 'escalation'],
      onSelect: () =>
        handleSelect('action:filter:urgent-reports', () => navigate('/reports?status=new&severity=critical')),
    },
    {
      id: 'action:fixes:open',
      label: 'Review drafted fixes',
      hint: 'Pull requests waiting for your review',
      keywords: ['pr', 'merge', 'review', 'drafts'],
      onSelect: () => handleSelect('action:fixes:open', () => navigate('/fixes')),
    },
    {
      id: 'action:health:open',
      label: 'Check system health',
      hint: 'Integrations, background jobs and error rate',
      keywords: ['status', 'monitoring', 'sentry', 'health'],
      onSelect: () => handleSelect('action:health:open', () => navigate('/health')),
    },
    {
      id: 'action:connect:install',
      label: 'Install SDK & MCP',
      hint: 'Connect your app and editor',
      keywords: ['install', 'sdk', 'connect', 'setup', 'mcp', 'cursor'],
      onSelect: () => handleSelect('action:connect:install', () => navigate('/connect')),
    },
    {
      id: 'action:connect:upgrade',
      label: 'Update SDK (upgrade PR)',
      hint: 'Bump @mushi-mushi packages via a GitHub pull request',
      keywords: ['upgrade', 'update', 'sdk', 'npm', 'pr', 'version'],
      onSelect: () => handleSelect('action:connect:upgrade', () => navigate('/connect')),
    },
    {
      id: 'action:explore:understand',
      label: 'Understand my codebase',
      hint: 'Ask questions with file citations',
      keywords: ['codebase', 'explore', 'understand', 'atlas', 'architecture', 'ask'],
      onSelect: () => handleSelect('action:explore:understand', () => navigate('/explore?tab=ask')),
    },
    ...(['quickstart', 'beginner', 'advanced'] as AdminMode[])
      .filter((m) => m !== mode)
      .map((m) => ({
        id: `action:mode:${m}`,
        label: `Switch to ${m === 'quickstart' ? 'Quick' : `${m[0].toUpperCase()}${m.slice(1)}`} mode`,
        hint:
          m === 'quickstart'
            ? 'Core pages: bugs, fixes, apps, connect, settings'
            : m === 'beginner'
              ? 'Core pages plus a few next steps'
              : 'Every page in the console',
        keywords: ['mode', 'toggle', m, 'sidebar', 'menu'],
        onSelect: () => handleSelect(`action:mode:${m}`, () => setMode(m)),
      })),
  ]
  const visibleActions = actions.filter((a) => matchesQuery(a.label, a.hint, a.keywords))
  const pageActions = (pageCtx?.actions ?? []).filter((a) =>
    matchesQuery(a.label, a.hint ?? '', ['page', 'here', 'current']),
  )

  const paletteBackdropClass =
    'fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-overlay backdrop-blur-sm px-3'
  const palettePanelClass =
    'w-full max-w-xl rounded-md border border-edge bg-surface-raised shadow-raised flex flex-col max-h-[70dvh] overflow-hidden'

  return (
    <AnimatePresence mode="wait">
      {isOpen && view === 'assist' ? (
        <motion.div
          key="palette-assist"
          className={paletteBackdropClass}
          onClick={onBackdropClick}
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={backdrop}
          transition={overlayTransition}
        >
          <motion.div
            className={palettePanelClass}
            onClick={(e) => e.stopPropagation()}
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={panel}
            transition={overlayTransition}
          >
            <PaletteAssistView
              query={assistQuery}
              loading={assistLoading}
              error={assistError}
              text={assistText}
              steps={assistSteps}
              navTargets={assistNavTargets}
              clarify={assistClarify}
              onNavigate={(path) => {
                close()
                setTimeout(() => navigate(path), 0)
              }}
              onBack={() => setView('search')}
              onContinueSidebar={() => {
                const q = assistQuery
                const tid = assistThreadId
                close()
                if (tid) {
                  askMushiPanel.openFromPalette(q, tid)
                } else {
                  askMushiPanel.open(q)
                }
              }}
              onClarifySelect={(opt) => {
                void runAssist(opt)
              }}
              langfuseTraceId={assistLangfuseTraceId}
            />
          </motion.div>
        </motion.div>
      ) : isOpen ? (
        <motion.div
          key="palette-search"
          className={paletteBackdropClass}
          onClick={onBackdropClick}
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={backdrop}
          transition={overlayTransition}
        >
          <motion.div
            className={palettePanelClass}
            onClick={(e) => e.stopPropagation()}
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={panel}
            transition={overlayTransition}
          >
      <Command
        label="Command palette"
        className="flex flex-col flex-1 min-h-0"
        loop
        shouldFilter={false}
      >
        <div className="flex items-center gap-2 border-b border-edge/60 px-3 py-2.5">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4 text-fg-muted shrink-0"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" strokeLinecap="round" />
          </svg>
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder="Search or ask: how do I triage fixes… (@page /reports)"
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && showNavigateAffordance && !activeToken) {
                e.preventDefault()
                void runAssist(query)
              }
            }}
          />
          <kbd className="text-3xs text-fg-faint border border-edge-subtle px-1 py-0.5 rounded-sm">Esc</kbd>
        </div>

        {(mentionHits.length > 0 || slashHits.length > 0) && (
          <div className="border-b border-edge/40 max-h-40 overflow-y-auto py-1">
            {slashHits.map((cmd) => (
              <button
                key={cmd.command}
                type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSlashPick(cmd)
                }}
              >
                <span className="font-medium">{cmd.command}</span>
                <span className="ml-2 text-fg-faint">{cmd.hint}</span>
              </button>
            ))}
            {mentionHits.map((hit) => (
              <button
                key={`${hit.kind}:${hit.id}`}
                type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleMentionPick(hit)
                }}
              >
                <span className="font-medium">{hit.label}</span>
                {hit.sublabel && (
                  <span className="ml-2 text-fg-faint truncate">{hit.sublabel}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <Command.List className="overflow-y-auto flex-1 min-h-0 py-1 cmdk-list">
          <Command.Empty className="px-4 py-4 text-center text-xs text-fg-muted space-y-2">
            <p>Nothing matches. Try a page name or words from a bug report.</p>
            <p className="text-2xs text-fg-faint">
              Try asking: {PALETTE_SAMPLE_QUERIES.map((s) => `"${s}"`).join(' · ')}
            </p>
          </Command.Empty>

          {showNavigateAffordance && (
            <Command.Group heading="Ask Mushi" className="cmdk-group">
              <Command.Item
                value={`ask-mushi ${query}`}
                onSelect={() => void runAssist(query)}
                className="cmdk-item"
              >
                <span className="text-fg font-medium">Ask:</span>
                <span className="ml-2 truncate text-fg-muted">{query}</span>
                <span className="ml-auto text-3xs text-fg-faint shrink-0">↵</span>
              </Command.Item>
            </Command.Group>
          )}

          {pageActions.length > 0 && pageCtx && (
            <Command.Group heading={`On this page — ${pageCtx.title}`} className="cmdk-group">
              {pageActions.map((a) => (
                <PaletteActionItem
                  key={`page:${a.id}`}
                  id={`page:${a.id}`}
                  label={a.label}
                  hint={a.hint ?? pageCtx.summary ?? ''}
                  keywords={['page', 'here', 'current', pageCtx.title.toLowerCase()]}
                  onSelect={() => handleSelect(`page:${a.id}`, a.run)}
                />
              ))}
            </Command.Group>
          )}

          {!searching && recentEntities.length > 0 && (
            <Command.Group heading="Recently viewed" className="cmdk-group">
              {recentEntities.slice(0, 8).map((entity) => (
                <PaletteActionItem
                  key={`entity:${entity.kind}:${entity.id}`}
                  id={`entity:${entity.kind}:${entity.id}`}
                  label={entity.label}
                  hint={`${entity.kind} · ${new Date(entity.at).toLocaleString()}`}
                  keywords={[entity.kind, entity.id, entity.label]}
                  onSelect={() =>
                    handleSelect(`entity:${entity.kind}:${entity.id}`, () => navigate(entity.url))
                  }
                />
              ))}
            </Command.Group>
          )}

          {recentRoutes.length > 0 && (
            <Command.Group heading="Recent pages" className="cmdk-group">
              {recentRoutes.map((r) => (
                <PaletteRouteItem
                  key={`recent-${r.id}`}
                  route={r}
                  onSelect={() => handleSelect(r.id, () => navigate(r.path))}
                />
              ))}
            </Command.Group>
          )}

          {searching && strongPages.length > 0 && (
            <Command.Group heading="Pages" className="cmdk-group">
              {strongPages.map((r) => (
                <PaletteRouteItem
                  key={r.id}
                  route={r}
                  onSelect={() => handleSelect(r.id, () => navigate(r.path))}
                />
              ))}
            </Command.Group>
          )}

          {runLiveSearch && (
            <>
              <Command.Group heading={liveLoading ? 'Bug reports — searching…' : 'Bug reports'} className="cmdk-group">
                {liveReports.length === 0 && !liveLoading && (
                  <div className="px-3 py-2 text-2xs text-fg-faint">No bug reports match.</div>
                )}
                {liveReports.map((r) => (
                  <Command.Item
                    key={`report:${r.id}`}
                    value={`report:${r.id}`}
                    onSelect={() =>
                      handleSelect(`report:${r.id}`, () => navigate(`/reports/${r.id}`))
                    }
                    className="cmdk-item"
                  >
                    <span className="truncate flex-1">{reportTitle(r)}</span>
                    <span className="ml-2 text-3xs text-fg-faint shrink-0">
                      {r.severity ?? 'not triaged'} · {r.status}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading={liveLoading ? 'Fixes — searching…' : 'Fixes'} className="cmdk-group">
                {liveFixes.length === 0 && !liveLoading && (
                  <div className="px-3 py-2 text-2xs text-fg-faint">No fixes match.</div>
                )}
                {liveFixes.map((f) => (
                  <Command.Item
                    key={`fix:${f.id}`}
                    value={`fix:${f.id}`}
                    onSelect={() => handleSelect(`fix:${f.id}`, () => navigate(fixDeepLinkPath(f.id)))}
                    className="cmdk-item"
                  >
                    <span className="truncate flex-1">
                      {f.summary ?? (f.pr_number ? `Fix for PR #${f.pr_number}` : 'Fix without a summary yet')}
                    </span>
                    <span className="ml-2 text-3xs text-fg-faint shrink-0">
                      {f.pr_number ? `PR #${f.pr_number}` : f.status}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            </>
          )}

          {searching && weakPages.length > 0 && (
            <Command.Group heading="More pages" className="cmdk-group">
              {weakPages.map((r) => (
                <PaletteRouteItem
                  key={r.id}
                  route={r}
                  onSelect={() => handleSelect(r.id, () => navigate(r.path))}
                />
              ))}
            </Command.Group>
          )}

          {!searching &&
            PALETTE_GROUP_ORDER.map((group) => {
              const items = routesByGroup[group]
              if (!items.length) return null
              return (
                <Command.Group
                  key={group}
                  heading={NAV_SECTION_META[PALETTE_GROUP_SECTION[group]].title}
                  className="cmdk-group"
                >
                  {items.map((r) => (
                    <PaletteRouteItem
                      key={r.id}
                      route={r}
                      onSelect={() => handleSelect(r.id, () => navigate(r.path))}
                    />
                  ))}
                </Command.Group>
              )
            })}

          {visibleActions.length > 0 && (
            <Command.Group heading="Actions" className="cmdk-group">
              {visibleActions.map((a) => (
                <PaletteActionItem
                  key={a.id}
                  id={a.id}
                  label={a.label}
                  hint={a.hint}
                  keywords={a.keywords}
                  onSelect={a.onSelect}
                />
              ))}
            </Command.Group>
          )}
        </Command.List>

        <footer className="flex items-center justify-between border-t border-edge/60 px-3 py-1.5 text-3xs text-fg-faint">
          <span className="flex items-center gap-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>navigate</span>
            <Kbd>↵</Kbd>
            <span>select / ask</span>
          </span>
          <span>
            <Kbd>@</Kbd> tag · <Kbd>/</Kbd> cmd · <Kbd>?</Kbd> shortcuts
          </span>
        </footer>
      </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** A report's short title, else the start of what the reporter wrote. */
function reportTitle(r: LiveReport): string {
  const summary = r.summary?.trim()
  if (summary) return summary
  const description = r.description?.trim() ?? ''
  return description.length > 120 ? `${description.slice(0, 117)}…` : description || 'Untitled report'
}

interface PaletteRouteItemProps {
  route: StaticRoute
  onSelect: () => void
}

function PaletteRouteItem({ route, onSelect }: PaletteRouteItemProps) {
  return (
    <Command.Item
      value={`${route.path} ${route.label} ${route.keywords.join(' ')} ${route.description}`}
      onSelect={onSelect}
      className="cmdk-item"
    >
      <span className="flex-1 truncate">
        <span className="text-fg">{route.label}</span>
        <span className="ml-2 text-3xs text-fg-faint">{route.description}</span>
      </span>
      <span className="ml-2 text-3xs text-fg-faint shrink-0">{route.path}</span>
    </Command.Item>
  )
}

interface PaletteActionItemProps {
  id: string
  label: string
  hint: string
  keywords: string[]
  onSelect: () => void
}

function PaletteActionItem({ id, label, hint, keywords, onSelect }: PaletteActionItemProps) {
  return (
    <Command.Item
      value={`${id} ${label} ${hint} ${keywords.join(' ')}`}
      onSelect={onSelect}
      className="cmdk-item"
    >
      <span className="flex-1 truncate">
        <span className="text-fg">{label}</span>
        <span className="ml-2 text-3xs text-fg-faint">{hint}</span>
      </span>
    </Command.Item>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border border-edge-subtle px-1 py-0.5 rounded-sm font-sans">{children}</kbd>
  )
}
