/**
 * FILE: apps/admin/src/components/flow-primitives/usePrevious.ts
 * PURPOSE: Generic "what was this value last render?" helper. Used by the
 *          count-pop animation to tell whether a node's counter actually
 *          changed (without double-firing on re-renders that leave the
 *          number unchanged).
 */

import { useEffect, useRef } from 'react'

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}
