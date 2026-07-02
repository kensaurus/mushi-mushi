#!/usr/bin/env node
/**
 * Generate packages/flutter/lib/src/pii_patterns.g.dart from the canonical
 * packages/core/src/pii-patterns.json — the single source of truth shared
 * with the JS/TS pii-scrubber (packages/core/src/pii-scrubber.ts).
 *
 * Production-readiness audit item #16: the Flutter SDK used to hand-duplicate
 * a subset of the JS regex list with no shared source of truth, so a future
 * scrubber update (a new vendor secret shape, say) could silently update one
 * SDK and not the other. This script removes that drift risk entirely.
 *
 *   node scripts/generate-flutter-pii-patterns.mjs           # write
 *   node scripts/generate-flutter-pii-patterns.mjs --check   # CI drift gate
 */

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const SOURCE = path.join(ROOT, "packages/core/src/pii-patterns.json")
const TARGET = path.join(ROOT, "packages/flutter/lib/src/pii_patterns.g.dart")

/**
 * Render a regex source string (as produced by JS `RegExp.prototype.source`)
 * as a Dart single-quoted string literal. Deliberately NOT a Dart raw string
 * (`r'...'`) — several patterns contain both `"` and `'` inside a character
 * class (e.g. the AWS secret-key pattern's `["'\s:=]`), and a raw string can
 * only pick one delimiter quote to avoid, so it can't safely hold both.
 * Escaping backslashes + single quotes and using a normal string literal
 * works unconditionally for every pattern in the source list.
 */
function toDartStringLiteral(source) {
  const escaped = source.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  return `'${escaped}'`
}

function renderEntry(pattern) {
  const literal = toDartStringLiteral(pattern.source)
  const regexArgs = pattern.caseInsensitive ? `${literal}, caseSensitive: false` : literal
  const replacement = toDartStringLiteral(pattern.replacement)
  return `  MapEntry(RegExp(${regexArgs}), ${replacement}),`
}

function generate() {
  const { patterns } = JSON.parse(readFileSync(SOURCE, "utf8"))
  // Mirrors packages/core/src/pii-scrubber.ts's DEFAULT_CONFIG: every pattern
  // is active except the ones explicitly marked `defaultOn: false` (IPv4/IPv6
  // — too noisy for a bug-report scrubber, same rationale as the JS SDK). The
  // Flutter SDK has no per-feature config surface today, so it ships exactly
  // the default-on set; if that ever needs to change, model it after
  // PiiScrubberConfig rather than hand-editing the generated file.
  const activePatterns = patterns.filter((p) => p.defaultOn !== false)
  const entries = activePatterns.map(renderEntry).join("\n")

  return `// GENERATED CODE — DO NOT MODIFY BY HAND.
//
// Source of truth: packages/core/src/pii-patterns.json
// Regenerate:       node scripts/generate-flutter-pii-patterns.mjs
// CI drift gate:    pnpm check:flutter-pii-patterns
//
// Canonical PII/secret-scrubber patterns, shared with the JS/TS SDKs via
// packages/core/src/pii-scrubber.ts, so a Flutter user who pastes a Stripe
// key, an OpenAI key, a JWT, or a credit card into a bug report never ships
// it to our servers — and a future pattern update can't drift between SDKs.
// Order matters: SSN -> credit card -> vendor secret tokens -> email -> phone.
library;

final List<MapEntry<RegExp, String>> kPiiScrubPatterns =
    <MapEntry<RegExp, String>>[
${entries}
];
`
}

// Ignores whitespace/line-wrap differences AND "magic trailing commas": this
// script's raw output is not guaranteed to match `dart format`'s exact
// 80-column wrapping decisions (that formatting gate already runs
// independently in .github/workflows/flutter.yml — `dart format
// --set-exit-if-changed lib test`), and dart_style inserts a real trailing
// comma token whenever it splits an argument list across lines. This check's
// only job is to catch *content* drift: packages/core/src/pii-patterns.json
// changed and nobody regenerated + committed the Dart copy.
function normalize(text) {
  let s = text.replace(/\s+/g, "")
  let prev
  do {
    prev = s
    s = s.replace(/,([)\]])/g, "$1")
  } while (s !== prev)
  return s
}

const check = process.argv.includes("--check")
const next = generate()

if (check) {
  let current
  try {
    current = readFileSync(TARGET, "utf8")
  } catch {
    current = null
  }
  if (current === null || normalize(current) !== normalize(next)) {
    console.error(
      "Flutter PII pattern drift — run `pnpm gen:flutter-pii-patterns`, then `dart format lib` in packages/flutter, and commit pii_patterns.g.dart."
    )
    process.exit(1)
  }
  console.log("Flutter PII pattern check passed.")
  process.exit(0)
}

writeFileSync(TARGET, next, "utf8")
console.log(`Updated ${path.relative(ROOT, TARGET)}`)
