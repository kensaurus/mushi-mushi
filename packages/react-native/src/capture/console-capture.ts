export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error'
  message: string
  timestamp: number
}

export function setupConsoleCapture(maxEntries = 100) {
  const entries: ConsoleEntry[] = []
  const methods = ['log', 'warn', 'error'] as const
  const originals = new Map<string, (...args: unknown[]) => void>()

  for (const method of methods) {
    const original = console[method].bind(console)
    originals.set(method, original)
    console[method] = (...args: unknown[]) => {
      entries.push({
        level: method,
        message: args.map(String).join(' ').slice(0, 500),
        timestamp: Date.now(),
      })
      if (entries.length > maxEntries) entries.shift()
      original(...args)
    }
  }

  return {
    getEntries: () => [...entries],
    clear: () => { entries.length = 0 },
    restore: () => {
      for (const method of methods) {
        const orig = originals.get(method)
        if (orig) (console as unknown as Record<string, unknown>)[method] = orig
      }
    },
  }
}
