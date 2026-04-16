import { useCallback } from 'react'
import { useMushiContext } from '../provider'

export function useMushiReport() {
  const mushi = useMushiContext()

  const submitReport = useCallback(
    async (data: { description: string; category: string }) => {
      if (!mushi) throw new Error('MushiProvider not found')
      await mushi.submitReport(data)
    },
    [mushi],
  )

  return { submitReport }
}
