/**
 * FILE: _shared/lockfiles/toml-lite.ts
 * PURPOSE: A small TOML reader for lockfiles and manifests (poetry.lock,
 *          uv.lock, pyproject.toml): tables, arrays of tables, dotted and
 *          quoted keys, strings (basic, literal, multi-line), numbers and
 *          booleans, inline tables and multi-line arrays. Dates and other
 *          bare values come back as their raw text. Kept dependency-free: no
 *          TOML package.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable
export interface TomlTable {
  [key: string]: TomlValue
}

export class TomlLiteError extends Error {
  readonly offset: number
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`)
    this.name = 'TomlLiteError'
    this.offset = offset
  }
}

const BARE_KEY = /[A-Za-z0-9_-]/

class Reader {
  i = 0
  readonly s: string
  constructor(s: string) {
    this.s = s
  }

  peek(n = 0): string {
    return this.s[this.i + n] ?? ''
  }

  /** Skip spaces and tabs (and newlines and comments when `lines`). */
  skip(lines: boolean): void {
    for (;;) {
      const c = this.peek()
      if (c === ' ' || c === '\t' || c === '\r') this.i++
      else if (lines && c === '\n') this.i++
      else if (c === '#') {
        while (this.i < this.s.length && this.peek() !== '\n') this.i++
      } else return
    }
  }

  expect(c: string): void {
    if (this.peek() !== c) throw new TomlLiteError(`expected "${c}"`, this.i)
    this.i++
  }

  key(): string {
    const c = this.peek()
    if (c === '"' || c === "'") return this.string()
    const start = this.i
    while (BARE_KEY.test(this.peek())) this.i++
    if (this.i === start) throw new TomlLiteError('expected a key', this.i)
    return this.s.slice(start, this.i)
  }

  /** A dotted key path: a.b."c.d". */
  keyPath(): string[] {
    const path: string[] = []
    for (;;) {
      this.skip(false)
      path.push(this.key())
      this.skip(false)
      if (this.peek() !== '.') return path
      this.i++
    }
  }

  string(): string {
    const q = this.peek()
    const triple = this.s.startsWith(q.repeat(3), this.i)
    if (triple) {
      this.i += 3
      if (this.peek() === '\n') this.i++
      const end = this.s.indexOf(q.repeat(3), this.i)
      if (end < 0) throw new TomlLiteError('unterminated multi-line string', this.i)
      const body = this.s.slice(this.i, end)
      this.i = end + 3
      return q === '"' ? unescape(body.replace(/\\\r?\n\s*/g, '')) : body
    }
    this.i++
    let out = ''
    for (;;) {
      const c = this.peek()
      if (c === '' || c === '\n') throw new TomlLiteError('unterminated string', this.i)
      this.i++
      if (c === q) return q === '"' ? unescape(out) : out
      if (c === '\\' && q === '"') {
        out += c + this.peek()
        this.i++
        continue
      }
      out += c
    }
  }

  value(): TomlValue {
    this.skip(false)
    const c = this.peek()
    if (c === '"' || c === "'") return this.string()
    if (c === '[') {
      this.i++
      const arr: TomlValue[] = []
      for (;;) {
        this.skip(true)
        if (this.peek() === ']') {
          this.i++
          return arr
        }
        arr.push(this.value())
        this.skip(true)
        if (this.peek() === ',') this.i++
        else if (this.peek() !== ']') throw new TomlLiteError('expected "," or "]"', this.i)
      }
    }
    if (c === '{') {
      this.i++
      const table: TomlTable = {}
      this.skip(false)
      if (this.peek() === '}') {
        this.i++
        return table
      }
      for (;;) {
        const path = this.keyPath()
        this.expect('=')
        setPath(table, path, this.value(), this.i)
        this.skip(false)
        if (this.peek() === ',') {
          this.i++
          this.skip(false)
          continue
        }
        this.expect('}')
        return table
      }
    }
    const start = this.i
    while (this.i < this.s.length && !/[,\]}\n#]/.test(this.peek())) this.i++
    const raw = this.s.slice(start, this.i).trim()
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (/^[+-]?\d[\d_]*(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) return Number(raw.replace(/_/g, ''))
    if (!raw) throw new TomlLiteError('expected a value', start)
    return raw
  }
}

function unescape(s: string): string {
  return s.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (_m, e: string) => {
    if (e[0] === 'u' || e[0] === 'U') return String.fromCodePoint(parseInt(e.slice(1), 16))
    return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\' } as Record<string, string>)[e] ?? e
  })
}

function isTable(v: TomlValue | undefined): v is TomlTable {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Walk to (creating) the table at `path`; an array of tables resolves to its last element. */
function descend(root: TomlTable, path: string[], offset: number): TomlTable {
  let t = root
  for (const k of path) {
    let next = t[k]
    if (next === undefined) {
      next = {}
      t[k] = next
    }
    if (Array.isArray(next)) {
      const last = next[next.length - 1]
      if (!isTable(last)) throw new TomlLiteError(`"${k}" is not a table`, offset)
      t = last
    } else if (isTable(next)) {
      t = next
    } else {
      throw new TomlLiteError(`"${k}" is not a table`, offset)
    }
  }
  return t
}

function setPath(root: TomlTable, path: string[], value: TomlValue, offset: number): void {
  const t = descend(root, path.slice(0, -1), offset)
  t[path[path.length - 1]] = value
}

/** Parse a TOML document; throws TomlLiteError on syntax it does not understand. */
export function parseTomlLite(text: string): TomlTable {
  const root: TomlTable = {}
  const r = new Reader(text.replace(/^﻿/, ''))
  let current = root
  for (;;) {
    r.skip(true)
    if (r.i >= r.s.length) return root
    if (r.peek() === '[') {
      const arrayTable = r.peek(1) === '['
      r.i += arrayTable ? 2 : 1
      const path = r.keyPath()
      r.expect(']')
      if (arrayTable) r.expect(']')
      if (arrayTable) {
        const parent = descend(root, path.slice(0, -1), r.i)
        const k = path[path.length - 1]
        const existing = parent[k]
        const list = Array.isArray(existing) ? existing : []
        const table: TomlTable = {}
        list.push(table)
        parent[k] = list
        current = table
      } else {
        current = descend(root, path, r.i)
      }
      continue
    }
    const path = r.keyPath()
    r.expect('=')
    setPath(current, path, r.value(), r.i)
    r.skip(false)
    if (r.i < r.s.length && r.peek() !== '\n') throw new TomlLiteError('expected the end of the line', r.i)
  }
}

export function tableAt(v: TomlValue | undefined): TomlTable {
  return isTable(v) ? v : {}
}

export function arrayAt(v: TomlValue | undefined): TomlValue[] {
  return Array.isArray(v) ? v : []
}
