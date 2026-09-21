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

/** Closing tag matcher that tolerates whitespace before `>` (`</script >`). */
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
/** A lone `<script …>` or `</script …>` with no matching partner. */
const SCRIPT_TAG = /<\/?script\b[^>]*>/gi;
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
 * Strip script blocks first, then every remaining tag, each to a fixpoint.
 * Returns text with no `<tag>` markup left, however adversarially nested.
 */
export function stripMarkupToFixpoint(src) {
  let out = replaceToFixpoint(src, SCRIPT_BLOCK);
  out = replaceToFixpoint(out, SCRIPT_TAG);
  return replaceToFixpoint(out, ANY_TAG);
}
