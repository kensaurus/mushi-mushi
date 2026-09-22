/**
 * FILE: scripts/lib/mdx-prose.mjs
 * PURPOSE: Turn a docs `.mdx` page into plain Markdown for the generated LLM
 *          surfaces (llms-full.txt, llms-ctx.txt, public/llm-md/**).
 *
 * Fenced code is copied verbatim (see mapOutsideCodeFences). The prose between
 * fences loses its MDX-only syntax:
 *   - `import … from '…'` / `export …` statements, including multi-line
 *     `import {\n  A,\n  B,\n} from '…'` blocks that a one-line regex missed;
 *   - `{/* … *\/}` comments;
 *   - lines that are only an expression such as `{QUICKSTART_ONE_KEY_CALLOUT}`
 *     or `{CLOUD_INTRO.lead}` — the value lives in a TS module, so the braces
 *     are all an agent would see;
 *   - JSX tags, removed to a fixpoint (strip-markup.mjs);
 *   - lines left holding only brackets and punctuation (`)}`, `]}`, `},`)
 *     once a multi-line JSX prop or `.map()` has lost its tags.
 */

import { mapOutsideCodeFences, stripMarkupToFixpoint } from './strip-markup.mjs'

/** `import …` through its `from '…'` clause; never crosses a blank line. */
const IMPORT_STATEMENT = /^import\s(?:[^;\n]|\n(?!\s*\n))*?\sfrom\s+['"][^'"\n]+['"][ \t]*;?[ \t]*$/gm
/** Side-effect import: `import './x.css'`. */
const BARE_IMPORT = /^import\s+['"][^'"\n]+['"][ \t]*;?[ \t]*$/gm
const EXPORT_LINE = /^export\s+(?:default\s+)?(?:const|function|class)\s.*$/gm
const MDX_COMMENT = /\{\/\*[\s\S]*?\*\/\}/g
/** A line that is nothing but `{expr}` groups — identifiers and member access only. */
const EXPRESSION_ONLY_LINE = /^[ \t]*\{[A-Za-z_$][\w$.]*\}(?:[ \t]+\{[A-Za-z_$][\w$.]*\})*[ \t]*$/gm
/**
 * A line of nothing but brackets, commas and semicolons: residue of a stripped
 * multi-line JSX expression. Markdown never needs one (`|---|`, `---` and a
 * bare blockquote `>` are deliberately outside the class).
 */
const PUNCTUATION_ONLY_LINE = /^[ \t]*[{}()[\],;]+[ \t]*$/gm
/**
 * A `{ident.map(...)}` (or similar) that starts a line and runs to EOF.
 * Changelog-style MDX leaves this after JSX tags are stripped.
 */
const MAP_EXPRESSION_TAIL = /\n[ \t]*\{[A-Za-z_$][\w$.]*\.map\([\s\S]*$/

/**
 * Plain-Markdown body of an MDX page. Keeps front matter (agents read `title`
 * and `description` from it) and code fences; strips MDX syntax from prose.
 *
 * @param {string} src
 * @returns {string}
 */
export function mdxToPlainMarkdown(src) {
  return mapOutsideCodeFences(src, (prose) =>
    stripMarkupToFixpoint(
      prose
        .replace(MDX_COMMENT, '')
        .replace(IMPORT_STATEMENT, '')
        .replace(BARE_IMPORT, '')
        .replace(EXPORT_LINE, '')
        .replace(EXPRESSION_ONLY_LINE, ''),
    ).replace(PUNCTUATION_ONLY_LINE, '')
      .replace(MAP_EXPRESSION_TAIL, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
