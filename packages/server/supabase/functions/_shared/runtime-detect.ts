/**
 * FILE: packages/server/supabase/functions/_shared/runtime-detect.ts
 * PURPOSE: Which language runtime a repo pins, read from its files (ADR 0038
 *          decision 3). Pure: path → text in, pins out.
 *
 * A pin is `exact` only when it names a full patch version (Dockerfile
 * `FROM php:8.3.30-fpm`, composer `config.platform.php: "8.3.30"`, `.nvmrc`
 * `v20.11.1`, `.tool-versions`, `.python-version`, `runtime.txt`, go.mod
 * `toolchain go1.22.3`). Only an exact pin is matched against advisories. A
 * range or a line (`^8.1`, `engines.node: ">=18"`, `FROM node:20`, go.mod
 * `go 1.22`) gives a release line only, for the end-of-life check.
 */

export type Runtime = 'php' | 'node' | 'python' | 'go'

export interface RuntimePin {
  runtime: Runtime
  /** As written, minus prefixes: "8.3.30", "20", "3.12". */
  version: string
  exact: boolean
  /** Release line: php/python/go "major.minor", node "major". */
  cycle: string | null
  /** Repo path the pin came from, and its 1-based line when known. */
  source: string
  line: number | null
  how: 'dockerfile' | 'composer_platform' | 'composer_require' | 'nvmrc' | 'node_version' | 'tool_versions' | 'python_version' | 'runtime_txt' | 'requires_python' | 'engines' | 'go_toolchain' | 'go_directive'
}

/**
 * Pins that state the lowest version a project supports, not the one it runs:
 * `engines.node: ">=20"` also allows 22 and 24. They never raise an
 * end-of-life finding (a live run on 2026-10-22 flagged 28 package.json
 * floors on Node 20 while the app runs 22).
 */
export const FLOOR_PINS: ReadonlySet<RuntimePin['how']> = new Set(['engines', 'composer_require', 'requires_python', 'go_directive'])

/** Runtime files the reader asks for, by basename (plus Dockerfile variants). */
export const RUNTIME_FILE_NAMES = new Set(['composer.json', '.nvmrc', '.node-version', '.tool-versions', '.python-version', 'runtime.txt', 'pyproject.toml', 'package.json', 'go.mod'])

export function isRuntimeFile(path: string): boolean {
  const base = path.split('/').pop() ?? path
  return RUNTIME_FILE_NAMES.has(base) || /^(?:Dockerfile|Containerfile)(?:\.[\w.-]+)?$|\.(?:Dockerfile|dockerfile)$/.test(base)
}

const DOCKER_IMAGE: Record<string, Runtime> = { php: 'php', node: 'node', python: 'python', golang: 'go' }
const ASDF_NAME: Record<string, Runtime> = { php: 'php', nodejs: 'node', node: 'node', python: 'python', golang: 'go', go: 'go' }

export function cycleOf(runtime: Runtime, version: string): string | null {
  const parts = version.split('.')
  if (!/^\d+$/.test(parts[0] ?? '')) return null
  if (runtime === 'node') return parts[0]
  return parts.length >= 2 && /^\d+$/.test(parts[1]) ? `${parts[0]}.${parts[1]}` : null
}

function pin(runtime: Runtime, version: string, exact: boolean, source: string, line: number | null, how: RuntimePin['how']): RuntimePin {
  return { runtime, version, exact, cycle: cycleOf(runtime, version), source, line, how }
}

/** A leading version: "8.3.30-fpm-alpine" → "8.3.30". */
function leadingVersion(s: string): string | null {
  const m = /^v?(\d+(?:\.\d+){0,2})(?![\d.])/.exec(s.trim())
  return m ? m[1] : null
}

const isFull = (v: string) => /^\d+\.\d+\.\d+$/.test(v)

/** The lowest version a constraint allows: "^8.1 || ^8.2" → "8.1", ">=18 <21" → "18". */
export function rangeFloor(spec: string): string | null {
  const m = /(?:^|[\s|,(])(?:\^|~=?|>=?|==?|v)?\s*(\d+(?:\.\d+){0,2})/.exec(spec.trim())
  return m ? m[1] : null
}

function lines(text: string): string[] {
  return text.split(/\r?\n/)
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch {
    return null
  }
}

function dockerPins(path: string, text: string): RuntimePin[] {
  const out: RuntimePin[] = []
  const args = new Map<string, string>()
  // Join continuation lines but keep the first line number of each instruction.
  const instructions: Array<{ text: string; line: number }> = []
  let buf = ''
  let start = 0
  lines(text).forEach((raw, i) => {
    const l = raw.replace(/\s+#.*$/, '')
    if (!buf) start = i + 1
    if (/\\\s*$/.test(l)) {
      buf += l.replace(/\\\s*$/, ' ')
      return
    }
    buf += l
    if (buf.trim() && !buf.trim().startsWith('#')) instructions.push({ text: buf.trim(), line: start })
    buf = ''
  })
  for (const ins of instructions) {
    const arg = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)=("?)([^"\s]+)\2/i.exec(ins.text)
    if (arg) {
      args.set(arg[1], arg[3])
      continue
    }
    const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(ins.text)
    if (!from) continue
    const image = from[1].replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}?/g, (_m, name: string, dflt?: string) => args.get(name) ?? dflt ?? '')
    const noDigest = image.split('@')[0]
    const colon = noDigest.lastIndexOf(':')
    if (colon < 0 || noDigest.lastIndexOf('/') > colon) continue
    const name = noDigest.slice(0, colon).split('/').pop()!.toLowerCase()
    const runtime = DOCKER_IMAGE[name]
    if (!runtime) continue
    const version = leadingVersion(noDigest.slice(colon + 1))
    if (!version) continue
    out.push(pin(runtime, version, isFull(version), path, ins.line, 'dockerfile'))
  }
  return out
}

function lineOf(text: string, needle: RegExp): number | null {
  const i = lines(text).findIndex((l) => needle.test(l))
  return i >= 0 ? i + 1 : null
}

/** Every runtime pin found in the given files (keys are repo paths). */
export function detectRuntimes(files: Record<string, string>): RuntimePin[] {
  const out: RuntimePin[] = []
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== 'string') continue
    const base = path.split('/').pop() ?? path
    if (/node_modules\/|vendor\//.test(path)) continue
    if (isRuntimeFile(path) && !RUNTIME_FILE_NAMES.has(base)) {
      out.push(...dockerPins(path, text))
      continue
    }
    switch (base) {
      case 'composer.json': {
        const json = parseJson(text)
        const platform = (json?.config as { platform?: { php?: unknown } } | undefined)?.platform?.php
        if (typeof platform === 'string' && leadingVersion(platform)) {
          const v = leadingVersion(platform)!
          out.push(pin('php', v, isFull(v), path, lineOf(text, /"platform"|"php"\s*:/), 'composer_platform'))
        }
        const req = (json?.require as Record<string, unknown> | undefined)?.php
        if (typeof req === 'string') {
          const floor = rangeFloor(req)
          if (floor) out.push(pin('php', floor, false, path, lineOf(text, /"php"\s*:/), 'composer_require'))
        }
        break
      }
      case '.nvmrc':
      case '.node-version': {
        const v = leadingVersion(text.trim())
        if (v) out.push(pin('node', v, isFull(v), path, 1, base === '.nvmrc' ? 'nvmrc' : 'node_version'))
        break
      }
      case '.python-version': {
        const v = leadingVersion(lines(text).find((l) => l.trim() && !l.startsWith('#')) ?? '')
        if (v) out.push(pin('python', v, isFull(v), path, 1, 'python_version'))
        break
      }
      case 'runtime.txt': {
        const m = /^python-(\d+(?:\.\d+){0,2})/.exec(text.trim())
        if (m) out.push(pin('python', m[1], isFull(m[1]), path, 1, 'runtime_txt'))
        break
      }
      case '.tool-versions': {
        lines(text).forEach((l, i) => {
          const m = /^\s*([a-z]+)\s+v?(\d+(?:\.\d+){0,2})\b/.exec(l)
          const runtime = m ? ASDF_NAME[m[1]] : undefined
          if (m && runtime) out.push(pin(runtime, m[2], isFull(m[2]), path, i + 1, 'tool_versions'))
        })
        break
      }
      case 'pyproject.toml': {
        const i = lines(text).findIndex((l) => /^\s*requires-python\s*=/.test(l))
        if (i >= 0) {
          const floor = rangeFloor(/=\s*["']([^"']+)["']/.exec(lines(text)[i])?.[1] ?? '')
          if (floor) out.push(pin('python', floor, false, path, i + 1, 'requires_python'))
        }
        break
      }
      case 'package.json': {
        const engines = parseJson(text)?.engines as { node?: unknown } | undefined
        if (typeof engines?.node === 'string') {
          const floor = rangeFloor(engines.node)
          if (floor) out.push(pin('node', floor, false, path, lineOf(text, /"node"\s*:/), 'engines'))
        }
        break
      }
      case 'go.mod': {
        lines(text).forEach((l, i) => {
          const tc = /^\s*toolchain\s+go(\d+\.\d+(?:\.\d+)?)\b/.exec(l)
          if (tc) out.push(pin('go', tc[1], isFull(tc[1]), path, i + 1, 'go_toolchain'))
          // Since Go 1.21 the go line is the minimum Go a module needs, not the toolchain it builds with.
          const go = /^\s*go\s+(\d+\.\d+(?:\.\d+)?)\s*$/.exec(l)
          if (go) out.push(pin('go', go[1], false, path, i + 1, 'go_directive'))
        })
        break
      }
    }
  }
  return out.sort((a, b) => a.runtime.localeCompare(b.runtime) || a.source.localeCompare(b.source) || (a.line ?? 0) - (b.line ?? 0))
}
