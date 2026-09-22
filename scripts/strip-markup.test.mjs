/**
 * FILE: scripts/strip-markup.test.mjs
 * PURPOSE: Guard the markup stripper behind the generated LLM surfaces
 *          (llms-full.txt, public/llm-md/**, the MCP docs index).
 *
 * Two things must hold at once, and the second is why this test exists:
 *   1. No `<tag>` markup survives, however nested. A single-pass stripper let
 *      `<s<script>cript>` through by splicing the halves into a fresh tag
 *      (CodeQL js/incomplete-multi-character-sanitization, PR #394).
 *   2. Docs placeholders survive. The first fix widened the tag name to allow
 *      `-`, which silently rewrote `<your-project-id>` to nothing across 15
 *      generated files — every agent reading the mirrors would have copied a
 *      setup snippet with the values missing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapOutsideCodeFences, stripMarkupToFixpoint } from './lib/strip-markup.mjs';

describe('stripMarkupToFixpoint — markup never survives', () => {
  const hostile = [
    ['nested splice', '<s<script>cript>alert(1)</s</script>cript>'],
    ['whitespace before >', '<script >alert(1)</script >'],
    ['uppercase', '<SCRIPT>alert(1)</SCRIPT>'],
    ['attributes', '<script src="https://evil.example/x.js"></script>'],
    ['unclosed', '<script src="x">'],
    ['nested non-script', '<d<div>iv>'],
    ['self-closing', '<br/>'],
  ];
  for (const [label, input] of hostile) {
    it(label, () => {
      const out = stripMarkupToFixpoint(input);
      assert.doesNotMatch(out, /<\/?script/i, 'a script tag survived');
      assert.doesNotMatch(out, /<\/?\w[\w.]*(?:\s[^>]*)?\s*\/?>/, 'a tag survived');
    });
  }

  it('keeps a script body as plain words once its tags are gone', () => {
    // These outputs are Markdown/text for LLM consumers, never HTML, so the
    // body is harmless. Saying so here keeps anyone from "fixing" it with a
    // hand-written <script>…</script> matcher, which is the bypass-prone
    // pattern this module exists to avoid (CodeQL js/bad-tag-filter).
    assert.equal(stripMarkupToFixpoint('<script>alert(1)</script>'), 'alert(1)');
  });

  it('terminates on input that is only angle brackets', () => {
    assert.equal(stripMarkupToFixpoint('<<<<>>>>'), '<<<<>>>>');
  });
});

describe('stripMarkupToFixpoint — prose and placeholders are untouched', () => {
  const kept = [
    'Set MUSHI_PROJECT_ID to <your-project-id> before running the CLI.',
    'Authorization: Bearer <service-role-key>',
    'webhook-signature: v1,<base64-hmac-sha256>',
    'https://<your-ref>.supabase.co/functions/v1/api',
    'plain prose with no markup at all',
  ];
  for (const text of kept) {
    it(text.slice(0, 40), () => assert.equal(stripMarkupToFixpoint(text), text));
  }

  it('removes the JSX wrapper but keeps its children', () => {
    assert.equal(stripMarkupToFixpoint('<Callout type="warn">read this</Callout>'), 'read this');
  });
});

describe('mapOutsideCodeFences — code samples reach agents intact', () => {
  const upper = (s) => s.toUpperCase();

  it('transforms prose and copies fenced code verbatim', () => {
    const src = ['intro <b>x</b>', '```tsx', '<MushiProvider apiKey="k">', '```', 'outro'].join('\n');
    const out = mapOutsideCodeFences(src, stripMarkupToFixpoint);
    assert.equal(out, ['intro x', '```tsx', '<MushiProvider apiKey="k">', '```', 'outro'].join('\n'));
  });

  it('keeps `export function` lines inside a fence', () => {
    const src = ['```tsx', 'export function AuthWatcher() {', '}', '```'].join('\n');
    assert.equal(mapOutsideCodeFences(src, () => 'X'), src);
  });

  it('a longer fence may contain a shorter one (CommonMark)', () => {
    const src = ['````md', '```js', 'inside', '```', '````', 'after'].join('\n');
    const out = mapOutsideCodeFences(src, upper);
    assert.equal(out, ['````md', '```js', 'inside', '```', '````', 'AFTER'].join('\n'));
  });

  it('a ~~~ fence is not closed by ```', () => {
    const src = ['~~~', '```', 'still code', '~~~', 'prose'].join('\n');
    assert.equal(mapOutsideCodeFences(src, upper), ['~~~', '```', 'still code', '~~~', 'PROSE'].join('\n'));
  });

  it('an unclosed fence runs to the end of the file', () => {
    const src = ['prose', '```', '<Tag>'].join('\n');
    assert.equal(mapOutsideCodeFences(src, upper), ['PROSE', '```', '<Tag>'].join('\n'));
  });
});
