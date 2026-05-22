/**
 * Pages register <PageHelp> props here; Layout renders the banner at the top.
 */

import {
  createContext,
  useCallback,
  useContext,
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
}

const PageHelpContext = createContext<PageHelpContextValue | null>(null)

export function PageHelpProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<PageHelpRegistration | null>(null)
  const register = useCallback((props: PageHelpRegistration | null) => {
    setRegistration(props)
  }, [])
  const value = useMemo(() => ({ registration, register }), [registration, register])
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
