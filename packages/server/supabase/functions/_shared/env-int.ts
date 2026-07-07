import { log } from './logger.ts'

const envLog = log.child('env')

/**
 * Parse an integer env knob with validation, so a typo can never disable a
 * safety guard. Bare `Number(Deno.env.get(...))` turns `'3OO'` into NaN and
 * `files.slice(0, NaN)` into a silent 0-file sweep — this helper logs the
 * bad value and falls back to the default instead.
 */
export function envInt(
  name: string,
  def: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = Deno.env.get(name)
  if (raw === undefined || raw === '') return def

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    envLog.error(`Invalid integer for ${name}: ${JSON.stringify(raw)} — using default ${def}`)
    return def
  }
  if (opts.min !== undefined && parsed < opts.min) {
    envLog.error(`${name}=${parsed} below minimum ${opts.min} — using default ${def}`)
    return def
  }
  if (opts.max !== undefined && parsed > opts.max) {
    envLog.error(`${name}=${parsed} above maximum ${opts.max} — using default ${def}`)
    return def
  }
  return parsed
}

/** Float variant of {@link envInt} for rate/ratio knobs (e.g. sample rates). */
export function envFloat(
  name: string,
  def: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = Deno.env.get(name)
  if (raw === undefined || raw === '') return def

  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    envLog.error(`Invalid number for ${name}: ${JSON.stringify(raw)} — using default ${def}`)
    return def
  }
  if (opts.min !== undefined && parsed < opts.min) {
    envLog.error(`${name}=${parsed} below minimum ${opts.min} — using default ${def}`)
    return def
  }
  if (opts.max !== undefined && parsed > opts.max) {
    envLog.error(`${name}=${parsed} above maximum ${opts.max} — using default ${def}`)
    return def
  }
  return parsed
}
