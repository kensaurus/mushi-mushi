/**
 * FILE: apps/admin/src/lib/pageH1.tsx
 * PURPOSE: Keep a single h1 in the admin shell.
 *
 * OVERVIEW:
 * The sidebar wordmark is the console's h1. Pages that pass
 * PageHeaderBar `titleAs="h1"` (/fixes, /credits) register here so the
 * wordmark renders as a paragraph instead, including on md+ where the
 * sidebar is visible. Below md the sidebar is display:none, so the page
 * h1 is the only one a phone exposes either way.
 *
 * Intended pattern: a page owns the document h1 by passing `titleAs="h1"`.
 * This round that is /fixes and /credits.
 * Later rounds and other console pages should adopt `titleAs="h1"`.
 * Until they do, the wordmark stays the only h1 and those titles stay h2,
 * so the outline differs by page on purpose.
 *
 * DEPENDENCIES: react
 *
 * USAGE: Layout provides PageH1Provider and renders SidebarWordmark.
 * PageHeaderBar calls useRegisterPageH1 when its title is an h1.
 *
 * NOTES: A ref count covers two headers mounted at once and Strict Mode's
 * double effect. Outside the provider, registration is a no-op and the
 * wordmark stays an h1.
 */

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

interface PageH1ContextValue {
  pageOwnsH1: boolean
  retain: () => () => void
}

const PageH1Context = createContext<PageH1ContextValue | null>(null)

export function PageH1Provider({ children }: { children: ReactNode }) {
  const [pageOwnsH1, setPageOwnsH1] = useState(false)
  const count = useRef(0)
  const retain = useMemo(() => {
    return () => {
      count.current += 1
      setPageOwnsH1(true)
      return () => {
        count.current -= 1
        if (count.current <= 0) {
          count.current = 0
          setPageOwnsH1(false)
        }
      }
    }
  }, [])
  const value = useMemo(() => ({ pageOwnsH1, retain }), [pageOwnsH1, retain])
  return <PageH1Context.Provider value={value}>{children}</PageH1Context.Provider>
}

/** Register while `active` (the page title is an h1). */
export function useRegisterPageH1(active: boolean): void {
  const retain = useContext(PageH1Context)?.retain
  useLayoutEffect(() => {
    if (!retain || !active) return
    return retain()
  }, [retain, active])
}

export function usePageOwnsH1(): boolean {
  return useContext(PageH1Context)?.pageOwnsH1 ?? false
}

/**
 * Brand lockup. An h1 until the open page registers its own, then a paragraph
 * with the same tracking so md+ does not show two h1s.
 * Later rounds and other console pages should adopt `titleAs="h1"`.
 * Until they do, this stays their only h1 and their titles stay h2.
 */
export function SidebarWordmark({ compact }: { compact: boolean }) {
  const pageOwnsH1 = usePageOwnsH1()
  const Tag = pageOwnsH1 ? 'p' : 'h1'
  const cls = compact
    ? 'text-sm font-bold tracking-tight leading-none text-center'
    : 'text-sm font-bold tracking-tight leading-none'
  return (
    <Tag
      className={pageOwnsH1 ? `${cls} heading-rhythm m-0` : cls}
      {...(compact ? { 'aria-label': 'mushi mushi admin console' } : {})}
    >
      {compact ? (
        <>
          <span className="text-brand">m</span>
          <span className="text-fg-secondary">m</span>
        </>
      ) : (
        <>
          <span className="text-brand">mushi</span>
          <span className="text-fg-secondary">mushi</span>
        </>
      )}
    </Tag>
  )
}
