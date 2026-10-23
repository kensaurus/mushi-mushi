/**
 * FILE: apps/admin/src/lib/cursorModelLabel.ts
 * PURPOSE: A Cursor model spec as a person reads it:
 *          `grok-4.7?reasoning_effort=xhigh&context=500k` → "Grok 4.7 (Extra high, 500K)".
 *          Stored specs stay as they are (the API and the model picker use them);
 *          this is only for sentences on the page.
 */

const EFFORT: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

function modelName(id: string): string {
  const parts = id.split('-')
  const out: string[] = []
  for (const p of parts) {
    // claude-opus-5-5 → "5.5": a number right after a number joins it with a dot.
    if (/^\d+$/.test(p) && out.length && /\d$/.test(out[out.length - 1])) out[out.length - 1] += `.${p}`
    else out.push(/^gpt$/i.test(p) ? 'GPT' : p.charAt(0).toUpperCase() + p.slice(1))
  }
  return out.join(' ')
}

export function cursorModelLabel(spec: string | null | undefined): string | null {
  if (!spec?.trim()) return null
  const [id, query = ''] = spec.trim().split('?')
  const params = new URLSearchParams(query)
  const extras: string[] = []
  const effort = params.get('effort') ?? params.get('reasoning_effort')
  if (effort) extras.push(EFFORT[effort] ?? effort)
  const context = params.get('context')
  if (context) extras.push(context.toUpperCase())
  if (params.get('fast') === 'true') extras.push('Fast')
  return extras.length ? `${modelName(id)} (${extras.join(', ')})` : modelName(id)
}
