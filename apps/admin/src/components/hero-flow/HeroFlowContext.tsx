/**
 * Shared interaction state for the hero React Flow lane — hover focus,
 * keyboard tile focus, click glow, and refresh shimmer when live stats update.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type HeroTileId = 'decide' | 'act' | 'verify'

interface HeroFlowContextValue {
  hovered: HeroTileId | null
  setHovered: (tile: HeroTileId | null) => void
  focused: HeroTileId
  setFocused: (tile: HeroTileId) => void
  moveFocus: (delta: -1 | 1) => void
  refreshPulse: boolean
  expanded: HeroTileId | null
  hasActiveCta: boolean
  /** One-shot glow target after tile click. */
  clicked: HeroTileId | null
  pulseClick: (tile: HeroTileId) => void
}

const HeroFlowContext = createContext<HeroFlowContextValue | null>(null)

const TILE_ORDER: HeroTileId[] = ['decide', 'act', 'verify']

export function HeroFlowProvider({
  children,
  expanded,
  hasActiveCta,
  refreshKey,
}: {
  children: ReactNode
  expanded: HeroTileId | null
  hasActiveCta: boolean
  /** Changes when decide metric / act / verify detail updates. */
  refreshKey: string
}) {
  const [hovered, setHovered] = useState<HeroTileId | null>(null)
  const [focused, setFocused] = useState<HeroTileId>('decide')
  const [refreshPulse, setRefreshPulse] = useState(false)
  const [clicked, setClicked] = useState<HeroTileId | null>(null)

  useEffect(() => {
    setRefreshPulse(true)
    const t = setTimeout(() => setRefreshPulse(false), 320)
    return () => clearTimeout(t)
  }, [refreshKey])

  const pulseClick = useCallback((tile: HeroTileId) => {
    setClicked(tile)
  }, [])

  useEffect(() => {
    if (!clicked) return
    const t = setTimeout(() => setClicked(null), 520)
    return () => clearTimeout(t)
  }, [clicked])

  const moveFocus = useCallback((delta: -1 | 1) => {
    setFocused((prev) => {
      const idx = TILE_ORDER.indexOf(prev)
      const next = (idx + delta + TILE_ORDER.length) % TILE_ORDER.length
      return TILE_ORDER[next]
    })
  }, [])

  const value = useMemo(
    () => ({
      hovered,
      setHovered,
      focused,
      setFocused,
      moveFocus,
      refreshPulse,
      expanded,
      hasActiveCta,
      clicked,
      pulseClick,
    }),
    [hovered, focused, moveFocus, refreshPulse, expanded, hasActiveCta, clicked, pulseClick],
  )

  return <HeroFlowContext.Provider value={value}>{children}</HeroFlowContext.Provider>
}

export function useHeroFlow(): HeroFlowContextValue {
  const ctx = useContext(HeroFlowContext)
  if (!ctx) {
    return {
      hovered: null,
      setHovered: () => {},
      focused: 'decide',
      setFocused: () => {},
      moveFocus: () => {},
      refreshPulse: false,
      expanded: null,
      hasActiveCta: false,
      clicked: null,
      pulseClick: () => {},
    }
  }
  return ctx
}

/** Whether an edge should brighten for the hovered tile. */
export function heroEdgeHighlighted(edgeId: string, hovered: HeroTileId | null): boolean {
  if (!hovered) return false
  if (hovered === 'decide') return edgeId === 'decide->act'
  if (hovered === 'verify') return edgeId === 'act->verify'
  return true
}
