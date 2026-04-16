import { useCallback } from 'react'
import { useMushiContext } from '../provider'

export function useMushiWidget() {
  const mushi = useMushiContext()

  return {
    open: useCallback(() => mushi?.open(), [mushi]),
    close: useCallback(() => mushi?.close(), [mushi]),
  }
}
