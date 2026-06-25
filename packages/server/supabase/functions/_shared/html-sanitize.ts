/**
 * HTML sanitizer for serving stored, LLM-derived report HTML as `text/html`.
 *
 * This is a deny-by-default allowlist tokenizer — NOT a regex blocklist.
 * Regex "strip the bad bits" sanitizers are provably bypassable, which is why
 * CodeQL flags them (js/incomplete-multi-character-sanitization,
 * js/bad-tag-filter, js/incomplete-url-scheme-check): `</script >`, broken
 * `on*=` attributes, and `data:` / `vbscript:` URLs all slip through. Instead
 * we walk the input once, keep only an allowlist of inert structural /
 * formatting tags plus a tiny allowlist of non-navigational attributes, and
 * drop everything else (scripts, event handlers, url-bearing attributes,
 * unknown tags, comments, declarations).
 *
 * Defense-in-depth posture: the only producer (`renderIntelligenceHtml` in
 * `_shared/intelligence.ts`) is already safe-by-construction (every dynamic
 * value is HTML-escaped before interpolation), and the one serving route
 * (`GET /v1/admin/intelligence/:id/html`) emits a strict CSP
 * (`script-src 'none'; default-src 'self'`). This sanitizer guards against
 * legacy rows and future producer bugs without trusting either layer.
 *
 * Text nodes are passed through verbatim (a bare `<` that does not begin an
 * allowed construct is escaped to `&lt;`). We deliberately do NOT re-escape
 * `&`/`>` in text, because the producer already emits valid entities
 * (`&amp;`, `&middot;`, …) and double-escaping would corrupt the report.
 */

// Inert structural + formatting tags the intelligence report uses. None can
// execute script or trigger navigation on their own.
const ALLOWED_TAGS = new Set<string>([
  'html', 'head', 'body', 'title', 'meta', 'style',
  'header', 'footer', 'section', 'article', 'div', 'span', 'main', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup',
  'code', 'pre', 'blockquote', 'figure', 'figcaption',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
])

// Attributes with no script/navigation capability. Everything else
// (on*, style, href, src, srcset, formaction, http-equiv, …) is dropped.
const ALLOWED_ATTRS = new Set<string>([
  'class', 'id', 'lang', 'dir', 'title',
  'charset', 'name', 'content',
  'colspan', 'rowspan', 'scope', 'span', 'align', 'valign', 'width',
])

// Raw-text / RCDATA elements whose textual content we KEEP verbatim. `<style>`
// needs raw CSS (CSP allows inline style); `<title>` is RCDATA. The matching
// close tag is re-emitted by the main loop.
const RAW_TEXT_KEEP = new Set<string>(['style', 'title'])

// Disallowed elements whose CONTENT must also be discarded (not just the tags)
// so we never echo back script payloads as visible text. These all have a
// matching end tag; void disallowed elements (e.g. <embed>) are handled by the
// generic allowlist drop, which preserves the surrounding content.
const RAW_TEXT_DROP = new Set<string>([
  'script', 'noscript', 'template', 'textarea', 'iframe', 'object', 'svg', 'math',
])

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12
}

// ASCII letters / digits / hyphen — the characters that make up a tag name.
function isNameChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 45 // -
  )
}

/** Escape an attribute value for safe re-quoting with double quotes. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Find the index of the `>` that closes a tag whose attribute region starts at
 * `from`, skipping over quoted attribute values (which may legally contain `>`).
 * Returns -1 if the tag is never closed.
 */
function findTagEnd(html: string, from: number): number {
  let i = from
  let quote = 0
  while (i < html.length) {
    const ch = html.charCodeAt(i)
    if (quote) {
      if (ch === quote) quote = 0
    } else if (ch === 34 || ch === 39) {
      quote = ch
    } else if (ch === 62) {
      return i
    }
    i++
  }
  return -1
}

/** Case-insensitive index of `</tagName` at or after `from`. */
function indexOfCloseTag(lowerHtml: string, from: number, tagName: string): number {
  return lowerHtml.indexOf('</' + tagName, from)
}

/** Parse an attribute region and re-serialize only allowlisted attributes. */
function serializeAttrs(region: string): string {
  // Drop a trailing self-closing slash so it isn't parsed as an attribute.
  let inner = region
  const trimmed = inner.trimEnd()
  if (trimmed.endsWith('/')) inner = trimmed.slice(0, -1)

  let out = ''
  let i = 0
  const n = inner.length
  while (i < n) {
    while (i < n && isSpace(inner.charCodeAt(i))) i++
    if (i >= n) break

    const nameStart = i
    while (i < n) {
      const c = inner.charCodeAt(i)
      if (isSpace(c) || c === 61 /* = */) break
      i++
    }
    const name = inner.slice(nameStart, i).toLowerCase()

    let hasValue = false
    let value = ''
    let k = i
    while (k < n && isSpace(inner.charCodeAt(k))) k++
    if (k < n && inner.charCodeAt(k) === 61 /* = */) {
      hasValue = true
      k++
      while (k < n && isSpace(inner.charCodeAt(k))) k++
      const q = inner.charCodeAt(k)
      if (q === 34 || q === 39) {
        k++
        const vs = k
        while (k < n && inner.charCodeAt(k) !== q) k++
        value = inner.slice(vs, k)
        k++ // skip closing quote
      } else {
        const vs = k
        while (k < n && !isSpace(inner.charCodeAt(k))) k++
        value = inner.slice(vs, k)
      }
      i = k
    }

    if (name && ALLOWED_ATTRS.has(name)) {
      out += hasValue ? ` ${name}="${escapeAttr(value)}"` : ` ${name}`
    }
  }
  return out
}

/**
 * Sanitize stored HTML to a safe `text/html` subset. Deny-by-default: any tag
 * or attribute not on the allowlist is removed; disallowed raw-text elements
 * have their content discarded; stray `<` is escaped.
 */
export function sanitizeRenderedHtml(html: string): string {
  const lower = html.toLowerCase()
  let out = ''
  let i = 0
  const n = html.length

  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      out += html.slice(i)
      break
    }
    if (lt > i) out += html.slice(i, lt)

    // Comment: <!-- ... --> → drop.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }

    // Markup declaration (<!doctype …>, <![CDATA[…]]>, etc.): emit a clean
    // doctype, drop everything else.
    if (html.charCodeAt(lt + 1) === 33 /* ! */) {
      const gt = html.indexOf('>', lt)
      if (gt === -1) {
        out += '&lt;'
        i = lt + 1
        continue
      }
      if (lower.startsWith('<!doctype', lt)) out += '<!doctype html>'
      i = gt + 1
      continue
    }

    let j = lt + 1
    const closing = html.charCodeAt(j) === 47 /* / */
    if (closing) j++
    const nameStart = j
    while (j < n && isNameChar(html.charCodeAt(j))) j++
    const tagName = html.slice(nameStart, j).toLowerCase()

    if (!tagName) {
      // Bare `<` that does not begin a tag → escape it as text.
      out += '&lt;'
      i = lt + 1
      continue
    }

    const tagEnd = findTagEnd(html, j)
    if (tagEnd === -1) {
      out += '&lt;'
      i = lt + 1
      continue
    }
    const region = html.slice(j, tagEnd)
    i = tagEnd + 1

    if (RAW_TEXT_DROP.has(tagName)) {
      if (!closing) {
        const close = indexOfCloseTag(lower, i, tagName)
        // With a matching end tag, discard the tag + its content + the end
        // tag. Without one (truncated / void-like), drop only the open tag and
        // keep parsing — never swallow the rest of the document.
        if (close !== -1) {
          const gt = html.indexOf('>', close)
          i = gt === -1 ? close : gt + 1
        }
      }
      continue
    }

    if (!ALLOWED_TAGS.has(tagName)) continue // drop the tag, keep surrounding text

    if (closing) {
      out += `</${tagName}>`
      continue
    }

    const selfClose = region.trimEnd().endsWith('/')
    out += '<' + tagName + serializeAttrs(region) + (selfClose ? ' />' : '>')

    if (RAW_TEXT_KEEP.has(tagName) && !selfClose) {
      const close = indexOfCloseTag(lower, i, tagName)
      const rawEnd = close === -1 ? n : close
      // Inert content (CSS / RCDATA title) — keep verbatim; the close tag is
      // handled by the next loop iteration.
      out += html.slice(i, rawEnd)
      i = rawEnd
    }
  }

  return out
}
