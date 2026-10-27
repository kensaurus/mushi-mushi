/**
 * Pages register their help ("How this page works") here. The page header
 * shows it as a popover at its right edge; Layout's <RoutePageHelp /> shows
 * it expanded under the content only while the page is empty (a
 * <PageFirstStep> is on screen) or the user keeps tips open.
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
import type { PageFlowLink } from './pageLinks'

export interface PageHelpRegistration {
  title: string
  whatIsIt: string
  useCases?: string[]
  howToUse?: string
  defaultOpen?: boolean
  relatedLinks?: PageFlowLink[]
  flowPath?: string
}

interface PageHelpContextValue {
  registration: PageHelpRegistration | null
  register: (props: PageHelpRegistration | null) => void
  /** True while at least one first-step (empty) card is mounted. */
  empty: boolean
  /** Add (+1) or remove (-1) one mounted empty card. */
  adjustEmpty: (delta: 1 | -1) => void
}

const PageHelpContext = createContext<PageHelpContextValue | null>(null)

export function PageHelpProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<PageHelpRegistration | null>(null)
  const [emptyCount, setEmptyCount] = useState(0)
  const register = useCallback((props: PageHelpRegistration | null) => {
    setRegistration(props)
  }, [])
  const adjustEmpty = useCallback((delta: 1 | -1) => {
    setEmptyCount((n) => Math.max(0, n + delta))
  }, [])
  const value = useMemo(
    () => ({ registration, register, empty: emptyCount > 0, adjustEmpty }),
    [registration, register, emptyCount, adjustEmpty],
  )
  return <PageHelpContext.Provider value={value}>{children}</PageHelpContext.Provider>
}

export function usePageHelpRegister(): (props: PageHelpRegistration | null) => void {
  const ctx = useContext(PageHelpContext)
  if (!ctx) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[PageHelp] usePageHelpRegister called outside PageHelpProvider')
    }
    return () => {}
  }
  return ctx.register
}

export function usePageHelpRegistration(): PageHelpRegistration | null {
  return useContext(PageHelpContext)?.registration ?? null
}

/** True while the page shows a first-step (empty) card. */
export function usePageIsEmpty(): boolean {
  return useContext(PageHelpContext)?.empty ?? false
}

/**
 * Mark the page empty while the calling component is mounted. Outside a
 * provider (a test, a page rendered on its own) it does nothing.
 */
export function useMarkPageEmpty(active = true): void {
  const adjust = useContext(PageHelpContext)?.adjustEmpty
  useEffect(() => {
    if (!adjust || !active) return
    adjust(1)
    return () => adjust(-1)
  }, [adjust, active])
}
