/**
 * V5.3 §2.3.4: Symbol-aware code chunker.
 *
 * tree-sitter WASM is heavy (~5MB per language) and slow to bootstrap inside
 * Deno Edge runtime; we ship a fast regex-based chunker covering the five
 * languages the whitepaper commits to (TS/TSX, JS, Python, Go, Rust). The
 * `chunk` function returns SymbolChunk[] suitable for embedding + insert into
 * project_codebase_files. Tree-sitter is wired via `experimentalTreeSitter`
 * boolean for opt-in once we ship the WASM bundle.
 */

export type Language = 'ts' | 'tsx' | 'js' | 'jsx' | 'py' | 'go' | 'rs' | 'unknown'

export interface SymbolChunk {
  symbolName: string | null
  signature: string | null
  lineStart: number
  lineEnd: number
  body: string
  language: Language
}

const EXT_TO_LANG: Record<string, Language> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx',
  mjs: 'js', cjs: 'js',
  py: 'py', pyi: 'py',
  go: 'go',
  rs: 'rs',
}

export function detectLanguage(filePath: string): Language {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? 'unknown'
}

const PATTERNS: Record<Language, RegExp[]> = {
  ts: [
    /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/m,
    /^export\s+(?:abstract\s+)?class\s+(\w+)/m,
    /^export\s+(?:type|interface)\s+(\w+)/m,
    /^export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/m,
    /^(?:async\s+)?function\s+(\w+)/m,
    /^class\s+(\w+)/m,
  ],
  tsx: [
    /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/m,
    /^export\s+const\s+(\w+):\s*(?:React\.)?FC/m,
    /^export\s+const\s+(\w+)\s*=\s*\(/m,
    /^(?:async\s+)?function\s+(\w+)/m,
    /^class\s+(\w+)/m,
  ],
  js: [
    /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/m,
    /^export\s+class\s+(\w+)/m,
    /^export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/m,
    /^(?:async\s+)?function\s+(\w+)/m,
    /^class\s+(\w+)/m,
  ],
  jsx: [
    /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/m,
    /^export\s+const\s+(\w+)\s*=\s*\(/m,
    /^(?:async\s+)?function\s+(\w+)/m,
    /^class\s+(\w+)/m,
  ],
  py: [
    /^def\s+(\w+)/m,
    /^async\s+def\s+(\w+)/m,
    /^class\s+(\w+)/m,
  ],
  go: [
    /^func\s+(?:\([^)]*\)\s+)?(\w+)/m,
    /^type\s+(\w+)\s+(?:struct|interface)/m,
  ],
  rs: [
    /^pub\s+(?:async\s+)?fn\s+(\w+)/m,
    /^(?:async\s+)?fn\s+(\w+)/m,
    /^pub\s+(?:struct|enum|trait)\s+(\w+)/m,
    /^impl(?:\s+\w+\s+for)?\s+(\w+)/m,
  ],
  unknown: [],
}

const MAX_CHUNK_LINES = 200
const MIN_CHUNK_CHARS = 30

/**
 * Splits source into top-level symbol chunks. Each chunk owns lines from its
 * symbol-start through the next symbol-start (or EOF). Chunks larger than
 * MAX_CHUNK_LINES are sliced to keep embeddings under the model's context.
 */
export function chunk(filePath: string, source: string): SymbolChunk[] {
  const language = detectLanguage(filePath)
  const lines = source.split(/\r?\n/)
  if (language === 'unknown' || lines.length === 0) {
    return [{
      symbolName: null,
      signature: null,
      lineStart: 1,
      lineEnd: lines.length,
      body: source.slice(0, 8000),
      language,
    }]
  }

  const patterns = PATTERNS[language]
  type Boundary = { line: number; symbol: string; signature: string }
  const boundaries: Boundary[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (match && match[1]) {
        boundaries.push({ line: i, symbol: match[1], signature: line.trim().slice(0, 200) })
        break
      }
    }
  }

  if (boundaries.length === 0) {
    return [{
      symbolName: null,
      signature: null,
      lineStart: 1,
      lineEnd: lines.length,
      body: source.slice(0, 8000),
      language,
    }]
  }

  const chunks: SymbolChunk[] = []
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].line
    const end = i + 1 < boundaries.length ? boundaries[i + 1].line : lines.length
    const body = lines.slice(start, Math.min(end, start + MAX_CHUNK_LINES)).join('\n')
    if (body.length < MIN_CHUNK_CHARS) continue
    chunks.push({
      symbolName: boundaries[i].symbol,
      signature: boundaries[i].signature,
      lineStart: start + 1,
      lineEnd: Math.min(end, start + MAX_CHUNK_LINES),
      body,
      language,
    })
  }

  return chunks
}

const SKIP_PATHS = [
  /node_modules\//,
  /\.git\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /\.turbo\//,
  /coverage\//,
  /__snapshots__\//,
  /\.min\./,
  /\.lock$/,
  /\.map$/,
]

export function shouldIndex(filePath: string): boolean {
  if (SKIP_PATHS.some(rx => rx.test(filePath))) return false
  return detectLanguage(filePath) !== 'unknown'
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
