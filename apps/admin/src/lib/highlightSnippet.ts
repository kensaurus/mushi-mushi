/**
 * Lightweight syntax colouring for install snippets — no Prism/Shiki dep.
 * Tokenises common TS/TSX/bash/html patterns so CodeBlock reads as code.
 */

export type CodeTokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'command'
  | 'type'
  | 'tag'
  | 'attr'
  | 'punctuation'

export interface CodeToken {
  kind: CodeTokenKind
  text: string
}

const KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'default',
  'function',
  'return',
  'const',
  'let',
  'var',
  'new',
  'await',
  'async',
  'type',
  'interface',
  'if',
  'else',
  'try',
  'catch',
  'throw',
  'class',
  'extends',
  'implements',
  'null',
  'true',
  'false',
  'undefined',
  'void',
  'as',
  'typeof',
  'instanceof',
  'require',
  'module',
])

const BASH_COMMANDS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'install',
  'add',
  'i',
])

function pushPlain(tokens: CodeToken[], text: string) {
  if (!text) return
  const last = tokens[tokens.length - 1]
  if (last?.kind === 'plain') last.text += text
  else tokens.push({ kind: 'plain', text })
}

function pushKind(tokens: CodeToken[], kind: CodeTokenKind, text: string) {
  if (!text) return
  tokens.push({ kind, text })
}

function tokenizeBash(code: string): CodeToken[] {
  const tokens: CodeToken[] = []
  const re = /(@[\w-]+\/[\w.-]+|@[\w.-]+|\/[\w./-]+|"[^"]*"|'[^']*'|\S+|\s+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(code)) !== null) {
    const chunk = match[0]
    if (/^\s+$/.test(chunk)) {
      pushPlain(tokens, chunk)
      continue
    }
    if (chunk.startsWith('@') || chunk.startsWith('/')) {
      pushKind(tokens, 'string', chunk)
      continue
    }
    if (chunk.startsWith('"') || chunk.startsWith("'")) {
      pushKind(tokens, 'string', chunk)
      continue
    }
    if (BASH_COMMANDS.has(chunk)) {
      pushKind(tokens, 'command', chunk)
      continue
    }
    pushPlain(tokens, chunk)
  }
  return tokens
}

function tokenizeMarkup(code: string): CodeToken[] {
  const tokens: CodeToken[] = []
  const re =
    /(<!--[\s\S]*?-->|<\/?[A-Za-z][\w.-]*|>|=|"[^"]*"|'[^']*'|\/\/[^\n]*|\{[^}]*\}|\s+|[^<\s"'{=/>]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(code)) !== null) {
    const chunk = match[0]
    if (/^\s+$/.test(chunk)) {
      pushPlain(tokens, chunk)
      continue
    }
    if (chunk.startsWith('<!--') || chunk.startsWith('//')) {
      pushKind(tokens, 'comment', chunk)
      continue
    }
    if (chunk.startsWith('<') || chunk === '>') {
      pushKind(tokens, 'tag', chunk)
      continue
    }
    if (chunk === '=') {
      pushKind(tokens, 'punctuation', chunk)
      continue
    }
    if (chunk.startsWith('"') || chunk.startsWith("'") || chunk.startsWith('{')) {
      pushKind(tokens, 'string', chunk)
      continue
    }
    pushKind(tokens, 'attr', chunk)
  }
  return tokens
}

function tokenizeTsLike(code: string): CodeToken[] {
  const tokens: CodeToken[] = []
  const re =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|<\/?[A-Za-z][\w.-]*|>[A-Za-z][\w.-]*|<|[{}()[\].,;:]|@[\w./-]+|\b[A-Z][\w]*\b|\b[a-z_$][\w$]*\b|\s+|[^\s])/g
  let match: RegExpExecArray | null
  while ((match = re.exec(code)) !== null) {
    const chunk = match[0]
    if (/^\s+$/.test(chunk)) {
      pushPlain(tokens, chunk)
      continue
    }
    if (chunk.startsWith('//') || chunk.startsWith('/*')) {
      pushKind(tokens, 'comment', chunk)
      continue
    }
    if (
      chunk.startsWith("'") ||
      chunk.startsWith('"') ||
      chunk.startsWith('`') ||
      chunk.startsWith('@')
    ) {
      pushKind(tokens, 'string', chunk)
      continue
    }
    if (chunk.startsWith('<') || chunk === '>') {
      pushKind(tokens, 'tag', chunk)
      continue
    }
    if (/^[{}()[\].,;:]$/.test(chunk)) {
      pushKind(tokens, 'punctuation', chunk)
      continue
    }
    if (/^[A-Z]/.test(chunk)) {
      pushKind(tokens, 'type', chunk)
      continue
    }
    if (KEYWORDS.has(chunk)) {
      pushKind(tokens, 'keyword', chunk)
      continue
    }
    pushPlain(tokens, chunk)
  }
  return tokens
}

export function tokenizeSnippet(code: string, language: string): CodeToken[] {
  const lang = language.toLowerCase()
  if (lang === 'bash' || lang === 'sh' || lang === 'shell') return tokenizeBash(code)
  if (lang === 'html' || lang === 'vue' || lang === 'svelte') return tokenizeMarkup(code)
  return tokenizeTsLike(code)
}

export const CODE_TOKEN_CLASS: Record<CodeTokenKind, string> = {
  plain: 'mushi-code-plain',
  keyword: 'mushi-code-kw',
  string: 'mushi-code-str',
  comment: 'mushi-code-cmt',
  command: 'mushi-code-cmd',
  type: 'mushi-code-type',
  tag: 'mushi-code-tag',
  attr: 'mushi-code-attr',
  punctuation: 'mushi-code-punc',
}
