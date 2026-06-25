import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { sanitizeRenderedHtml } from './html-sanitize.ts'

// ── The exact bypasses CodeQL cited (js/bad-tag-filter,
//    js/incomplete-multi-character-sanitization, js/incomplete-url-scheme-check) ──

Deno.test('drops <script> blocks and their content', () => {
  const out = sanitizeRenderedHtml('<p>ok</p><script>alert(1)</script><p>after</p>')
  assertEquals(out.includes('alert(1)'), false)
  assertEquals(out.toLowerCase().includes('<script'), false)
  assertStringIncludes(out, '<p>ok</p>')
  assertStringIncludes(out, '<p>after</p>')
})

Deno.test('drops malformed script end tag </script > (bad-tag-filter bypass)', () => {
  const out = sanitizeRenderedHtml('<script>evil()</script >tail')
  assertEquals(out.includes('evil()'), false)
  assertEquals(out.toLowerCase().includes('script'), false)
  assertStringIncludes(out, 'tail')
})

Deno.test('drops uppercase / spaced <SCRIPT > tags', () => {
  const out = sanitizeRenderedHtml('<SCRIPT >alert(1)</SCRIPT>x')
  assertEquals(out.toLowerCase().includes('script'), false)
  assertEquals(out.includes('alert(1)'), false)
  assertStringIncludes(out, 'x')
})

Deno.test('strips on* event-handler attributes (incomplete-multi-character bypass)', () => {
  const out = sanitizeRenderedHtml('<p onclick="steal()" onmouseover=x>hi</p>')
  assertEquals(out.toLowerCase().includes('onclick'), false)
  assertEquals(out.toLowerCase().includes('onmouseover'), false)
  assertEquals(out, '<p>hi</p>')
})

Deno.test('strips obfuscated handler that a naive \\son\\w+= regex misses', () => {
  // Tab/newline between attributes — a `\son\w+=` regex still matches \s, but
  // the allowlist drops the attribute regardless of whitespace shape.
  const out = sanitizeRenderedHtml('<div\tonpointerover=alert(1)\nclass="grid">z</div>')
  assertEquals(out.toLowerCase().includes('onpointerover'), false)
  assertStringIncludes(out, 'class="grid"')
  assertStringIncludes(out, 'z')
})

Deno.test('drops url-bearing tags so javascript:/data:/vbscript: never survive', () => {
  const out = sanitizeRenderedHtml(
    '<a href="javascript:alert(1)">a</a>' +
      '<img src="data:text/html,<script>alert(1)</script>">' +
      '<a href="vbscript:msgbox">b</a>',
  )
  assertEquals(out.toLowerCase().includes('javascript:'), false)
  assertEquals(out.toLowerCase().includes('vbscript:'), false)
  assertEquals(out.toLowerCase().includes('data:'), false)
  assertEquals(out.toLowerCase().includes('<a'), false)
  assertEquals(out.toLowerCase().includes('<img'), false)
  // Inner text of dropped tags is preserved.
  assertStringIncludes(out, 'a')
  assertStringIncludes(out, 'b')
})

Deno.test('drops iframe/object/embed and their content', () => {
  const out = sanitizeRenderedHtml(
    '<iframe src="//evil"></iframe><object data="x"></object><embed src="y">tail',
  )
  assertEquals(out.toLowerCase().includes('iframe'), false)
  assertEquals(out.toLowerCase().includes('object'), false)
  assertEquals(out.toLowerCase().includes('embed'), false)
  assertEquals(out.toLowerCase().includes('evil'), false)
  assertStringIncludes(out, 'tail')
})

Deno.test('escapes a bare < that does not begin a tag', () => {
  const out = sanitizeRenderedHtml('1 < 2 and 3 > 2')
  assertStringIncludes(out, '1 &lt; 2')
  // A stray > in text is harmless and left as-is.
  assertStringIncludes(out, '3 > 2')
})

// ── The legitimate report must survive intact ──────────────────────────────

Deno.test('preserves the allowlisted report skeleton and classes', () => {
  const doc =
    '<!doctype html><html lang="en"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>Bug Intelligence</title><style>body{color:#1f2937}</style></head>' +
    '<body><h1>Report</h1><div class="grid"><div class="stat">' +
    '<div class="l">Reports</div><div class="v">42</div></div></div>' +
    '<table><thead><tr><th class="num">Count</th></tr></thead>' +
    '<tbody><tr><td class="num">7</td></tr></tbody></table>' +
    '<p><strong>bold</strong> <em>em</em> <code>x</code></p></body></html>'
  const out = sanitizeRenderedHtml(doc)
  assertStringIncludes(out, '<!doctype html>')
  assertStringIncludes(out, '<html lang="en">')
  assertStringIncludes(out, '<meta charset="utf-8" />')
  assertStringIncludes(out, 'content="width=device-width, initial-scale=1"')
  assertStringIncludes(out, '<style>body{color:#1f2937}</style>')
  assertStringIncludes(out, '<div class="grid">')
  assertStringIncludes(out, '<td class="num">7</td>')
  assertStringIncludes(out, '<strong>bold</strong>')
  assertStringIncludes(out, '<code>x</code>')
})

Deno.test('does not double-escape existing entities (no &amp;amp;)', () => {
  const out = sanitizeRenderedHtml('<div class="meta">Acme &amp; Co &middot; week</div>')
  assertEquals(out, '<div class="meta">Acme &amp; Co &middot; week</div>')
  assertEquals(out.includes('&amp;amp;'), false)
  assertEquals(out.includes('&amp;middot;'), false)
})

Deno.test('escapes hostile attribute values when re-quoting an allowed tag', () => {
  const out = sanitizeRenderedHtml('<div class=\'a"><script>alert(1)</script>\'>z</div>')
  assertEquals(out.toLowerCase().includes('<script'), false)
  // The class value is re-quoted with its quote/angle-brackets escaped.
  assert(!/class="a"><script/i.test(out))
  assertStringIncludes(out, 'z')
})

Deno.test('handles void elements and unknown tags', () => {
  assertEquals(sanitizeRenderedHtml('a<br>b<hr/>c'), 'a<br>b<hr />c')
  // Unknown tag dropped, inner text kept.
  assertEquals(sanitizeRenderedHtml('<marquee>scroll</marquee>'), 'scroll')
})

Deno.test('empty / plain input is returned unchanged', () => {
  assertEquals(sanitizeRenderedHtml(''), '')
  assertEquals(sanitizeRenderedHtml('just text'), 'just text')
})
