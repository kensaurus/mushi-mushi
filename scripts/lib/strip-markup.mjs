/**
 * FILE: scripts/lib/strip-markup.mjs
 * PURPOSE: Remove HTML/JSX markup from MDX source for the generated plain-text
 *          surfaces (llms.txt, llms-full.txt, the MCP docs index).
 *
 * A single `.replace(/<tag>/g, '')` pass is NOT enough. Removing one tag can
 * splice the text either side of it into a new tag: `<s<script>cript>` becomes
 * `<script>` after one pass, so `<script` survives a sanitizer that runs once.
 * CodeQL flags exactly this (js/incomplete-multi-character-sanitization), and
 * it is a real hole for any consumer that renders our generated text as HTML.
 *
 * So both passes run to a fixpoint: repeat until the string stops changing.
 * The loops terminate because every iteration that changes the string removes
 * at least one character, and the input is finite.
 */

/**
 * There is deliberately NO `<script>…</script>` block regex here. Writing one
 * means writing a matcher for the end tag, and every such matcher misses a
 * case (`</script >`, `</script\n>`, `</script/>`): CodeQL's js/bad-tag-filter
 * flags them for that reason, and it is right — hand-written tag filters are
 * how sanitizers get bypassed. The single pass below removes `<script …>` and
 * `</script …>` like any other tag, and repeating it to a fixpoint is what
 * makes nesting safe. A script body left behind as plain words is harmless
 * here: these outputs are Markdown and text for LLM consumers, never HTML.
 */

/**
 * JSX / HTML open, close or self-closing tag: `<Callout>`, `</Callout>`, `<br/>`.
 * The tag name deliberately excludes `-`, so docs placeholders like
 * `<your-project-id>` and `<base64-hmac-sha256>` survive into the generated
 * Markdown mirrors. Stripping those would hand agents broken setup snippets.
 */
const ANY_TAG = /<\/?\w[\w.]*(?:\s[^>]*)?\s*\/?>/g;

/** Apply `re` repeatedly until the string stops changing. */
function replaceToFixpoint(input, re, replacement = '') {
  let out = input;
  let prev;
  do {
    prev = out;
    out = out.replace(re, replacement);
  } while (out !== prev);
  return out;
}

/**
 * Remove every tag, repeating until the text stops changing.
 * Returns text with no `<tag>` markup left, however adversarially nested.
 */
export function stripMarkupToFixpoint(src) {
  return replaceToFixpoint(src, ANY_TAG);
}

/** Opening/closing fence line: ``` or ~~~ (3+), optional info string. */
const FENCE_LINE = /^\s*(`{3,}|~{3,})/;

/**
 * Apply `transform` to the prose between fenced code blocks and copy every
 * fenced block through verbatim.
 *
 * Code samples are the part of a docs page an agent actually copies. Running
 * the prose strippers over them deleted `<MushiProvider>` from the React setup
 * sample and every `export function …` line, so the llms-full.txt an agent read
 * to install Mushi carried a snippet that could not work. A fence closes only
 * on the same character repeated at least as many times (CommonMark), so a
 * ```` ```` ```` block can safely contain ``` lines.
 */
export function mapOutsideCodeFences(src, transform) {
  const out = [];
  let prose = [];
  let fence = null; // the opening run, e.g. '```' or '~~~~', while inside a block
  const flushProse = () => {
    if (prose.length) out.push(transform(prose.join('\n')));
    prose = [];
  };
  for (const line of src.split('\n')) {
    const m = line.match(FENCE_LINE);
    if (fence === null) {
      if (m) {
        flushProse();
        fence = m[1];
        out.push(line);
      } else {
        prose.push(line);
      }
    } else {
      out.push(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) {
        fence = null;
      }
    }
  }
  flushProse();
  return out.join('\n');
}
