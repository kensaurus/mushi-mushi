import { useEffect, useRef } from 'react'

export interface NavigationEntry {
  screen: string
  timestamp: number
}

export function useNavigationCapture(navigationRef: { getCurrentRoute?: () => { name: string } | undefined; addListener?: (event: string, cb: () => void) => () => void } | null) {
  const historyRef = useRef<NavigationEntry[]>([])

  useEffect(() => {
    if (!navigationRef?.addListener || !navigationRef?.getCurrentRoute) return

    const unsubscribe = navigationRef.addListener('state', () => {
      const route = navigationRef.getCurrentRoute?.()
      if (route) {
        historyRef.current.push({ screen: route.name, timestamp: Date.now() })
        if (historyRef.current.length > 20) historyRef.current.shift()
      }
    })

    return unsubscribe
  }, [navigationRef])

  return () => [...historyRef.current]
}
