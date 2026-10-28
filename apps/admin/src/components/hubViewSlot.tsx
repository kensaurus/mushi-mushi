/**
 * FILE: apps/admin/src/components/hubViewSlot.tsx
 * PURPOSE: Place a page hub's view switcher under the page title.
 *
 * OVERVIEW:
 * PageHubView used to render Today / Overview / … above the page, so the
 * strip sat above the "Home" title. Other pages render the title, then their
 * tabs. The first PageHeaderBar on a hub page claims this slot and the strip
 * moves under that title. A view with no header (skeleton, error, locked
 * card) keeps the strip above the content.
 *
 * DEPENDENCIES: react
 *
 * USAGE:
 * - PageHubView wraps the page in HubViewSlotProvider + HubViewSlotFrame
 * - PageHeaderBar calls useHubViewTabs() and renders the result after the title
 */

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

interface HubViewSlotValue {
  tabs: ReactNode
  hostId: symbol | null
  claim: (id: symbol) => void
  release: (id: symbol) => void
}

const HubViewSlotContext = createContext<HubViewSlotValue | null>(null)

export function HubViewSlotProvider({ tabs, children }: { tabs: ReactNode; children: ReactNode }) {
  const order = useRef<symbol[]>([])
  const [hostId, setHostId] = useState<symbol | null>(null)
  const api = useMemo(() => {
    const publish = () => {
      const next = order.current[0] ?? null
      setHostId((prev) => (prev === next ? prev : next))
    }
    return {
      claim(id: symbol) {
        if (!order.current.includes(id)) order.current.push(id)
        publish()
      },
      release(id: symbol) {
        const next = order.current.filter((x) => x !== id)
        if (next.length === order.current.length) return
        order.current = next
        publish()
      },
    }
  }, [])
  const value = useMemo<HubViewSlotValue>(
    () => ({ tabs, hostId, claim: api.claim, release: api.release }),
    [tabs, hostId, api],
  )
  return <HubViewSlotContext.Provider value={value}>{children}</HubViewSlotContext.Provider>
}

/** The hub's outer stack: the strip sits here until a header claims it. */
export function HubViewSlotFrame({ children }: { children: ReactNode }) {
  const ctx = useContext(HubViewSlotContext)
  if (!ctx) return <>{children}</>
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {ctx.hostId === null ? ctx.tabs : null}
      {children}
    </div>
  )
}

/** The strip, when this header is the first PageHeaderBar on the hub page. */
export function useHubViewTabs(): ReactNode {
  const ctx = useContext(HubViewSlotContext)
  const id = useRef<symbol>(Symbol('hub-header'))
  const claim = ctx?.claim
  const release = ctx?.release
  useLayoutEffect(() => {
    if (!claim || !release) return
    const mine = id.current
    claim(mine)
    return () => release(mine)
  }, [claim, release])
  if (!ctx || ctx.hostId !== id.current) return null
  return ctx.tabs
}
