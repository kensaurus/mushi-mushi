/**
 * FILE: apps/docs/lib/doc-snippets.ts
 * PURPOSE: Pull fenced code blocks out of an MDX page so tests can compile the
 *          TypeScript samples against the real SDK sources.
 *
 * Four quickstart samples once failed `tsc` against the published packages
 * (`mushi.submitReport`, `const { submit } = useMushiReport()`, an Angular
 * provider that was not a provider). quickstart-snippets.test.ts compiles
 * every ts/tsx block this returns, so a renamed export breaks the build
 * instead of the reader's first five minutes.
 */

export interface CodeBlock {
  /** Info-string language, lower-cased (`ts`, `tsx`, `bash`, …); '' when absent. */
  lang: string
  /** Value of a `filename="…"` attribute on the fence, when present. */
  filename: string | null
  code: string
  /** 1-based line of the opening fence, for error messages. */
  line: number
}

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)(.*)$/
const FILENAME_ATTR = /filename=(?:"([^"]+)"|'([^']+)')/

/**
 * Every fenced block in `mdx`, in order. A fence closes only on the same
 * character repeated at least as many times (CommonMark), so a four-backtick
 * block may contain triple-backtick lines. An unclosed fence runs to the end.
 */
export function extractCodeBlocks(mdx: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  const lines = mdx.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i] ?? '')
    if (!open) {
      i++
      continue
    }
    const fence = open[1] ?? '```'
    const attr = FILENAME_ATTR.exec(open[3] ?? '')
    const start = i
    const body: string[] = []
    i++
    while (i < lines.length) {
      const text = lines[i] ?? ''
      const trimmed = text.trim()
      if (trimmed.length >= fence.length && trimmed === fence[0]!.repeat(trimmed.length)) break
      body.push(text)
      i++
    }
    blocks.push({
      lang: (open[2] ?? '').toLowerCase(),
      filename: attr ? (attr[1] ?? attr[2] ?? null) : null,
      code: body.join('\n'),
      line: start + 1,
    })
    i++ // skip the closing fence
  }
  return blocks
}

/** True for blocks the TypeScript compiler should check. */
export function isTypeScriptBlock(block: CodeBlock): boolean {
  return block.lang === 'ts' || block.lang === 'tsx' || block.lang === 'typescript'
}
