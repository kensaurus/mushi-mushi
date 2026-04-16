const PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { regex: /\b(?:\d[ -]*){12,18}\d\b/g, replacement: '[REDACTED_CC]' },
  { regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  { regex: /(?:\+\d{1,3}[\s.-])?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, replacement: '[REDACTED_PHONE]' },
]

export function scrubPii(text: string): string {
  if (!text) return text
  let result = text
  for (const { regex, replacement } of PATTERNS) {
    result = result.replace(new RegExp(regex.source, regex.flags), replacement)
  }
  return result
}

export function scrubReport(report: Record<string, any>): Record<string, any> {
  const r = { ...report }
  if (typeof r.description === 'string') r.description = scrubPii(r.description)
  if (typeof r.user_intent === 'string') r.user_intent = scrubPii(r.user_intent)

  if (Array.isArray(r.console_logs)) {
    r.console_logs = r.console_logs.map((log: any) => ({
      ...log,
      message: typeof log.message === 'string' ? scrubPii(log.message) : log.message,
    }))
  }

  if (Array.isArray(r.network_logs)) {
    r.network_logs = r.network_logs.map((log: any) => {
      if (typeof log.url !== 'string') return log
      try {
        const url = new URL(log.url)
        url.searchParams.forEach((_val: string, key: string) => {
          url.searchParams.set(key, scrubPii(url.searchParams.get(key)!))
        })
        return { ...log, url: url.toString() }
      } catch {
        return log
      }
    })
  }

  return r
}
