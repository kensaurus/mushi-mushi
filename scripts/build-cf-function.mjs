/**
 * FILE: scripts/build-cf-function.mjs
 * PURPOSE: Build (comment-strip + whitespace-trim) CloudFront Function sources
 *          into deployable artifacts and enforce the CloudFront Functions size
 *          limit BEFORE `aws cloudfront update-function` can fail mid-deploy.
 *
 * CloudFront Functions (runtime cloudfront-js-2.0) reject code >= 10 KB
 * (10,240 bytes) with FunctionSizeLimitExceeded — which broke deploy-admin on
 * 2026-07-03 when the heavily-commented spa-router source crossed the limit.
 * Our sources carry load-bearing comments (deliberately), so we deploy a
 * stripped artifact instead of policing comment budgets in review.
 *
 * No dependencies: pnpm's isolated node_modules means esbuild isn't
 * resolvable from repo root, and this must run before `pnpm install` in some
 * workflows. The stripper is a small state machine that is string-, template-
 * and regex-literal-aware; it removes comments, trailing/leading whitespace
 * and blank lines but preserves every newline-terminated statement, so ASI
 * behavior is unchanged and stack traces stay line-mappable-ish.
 *
 * USAGE:
 *   node scripts/build-cf-function.mjs <src.js> [more.js ...]
 *     [--out-dir scripts/.cf-dist] [--max-bytes 9000]
 *
 * Exits 1 if any artifact is >= --max-bytes (default 9,000 — headroom under
 * the hard 10,240 so growth is caught while there is still room to ship).
 * Also imported by scripts/cloudfront-functions.test.mjs (stripSource).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

export const CF_HARD_LIMIT_BYTES = 10240;
export const DEFAULT_MAX_BYTES = 9000;

/** Characters after which a `/` starts a regex literal, not division. */
const REGEX_PRECEDERS = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
]);
// `return /re/` — keywords that can precede a regex literal.
const REGEX_PRECEDER_WORDS =
  /(?:return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield)$/;

/**
 * Strip comments from JS source without touching string, template, or regex
 * literals. Conservative: on anything it cannot classify it keeps the bytes.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let lastCode = ''; // trailing non-whitespace of emitted code, for regex detection
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        out += src[i];
        if (src[i] === '\\') {
          out += src[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      lastCode = quote;
      continue;
    }
    if (c === '/') {
      const tail = lastCode;
      const isRegex =
        tail === '' ||
        REGEX_PRECEDERS.has(tail[tail.length - 1]) ||
        REGEX_PRECEDER_WORDS.test(tail);
      if (isRegex) {
        out += c;
        i++;
        let inClass = false;
        while (i < n) {
          out += src[i];
          if (src[i] === '\\') {
            out += src[i + 1] ?? '';
            i += 2;
            continue;
          }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) {
            i++;
            break;
          }
          i++;
        }
        // regex flags
        while (i < n && /[a-z]/i.test(src[i])) {
          out += src[i];
          i++;
        }
        lastCode = '/';
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) {
      lastCode = (lastCode + c).slice(-12);
    }
    i++;
  }
  return out;
}

/** Full pipeline: strip comments, trim line edges, drop blank lines. */
export function stripSource(src) {
  const noComments = stripComments(src);
  const lines = noComments
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''))
    .filter((l) => l.length > 0);
  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const files = [];
  let outDir = 'scripts/.cf-dist';
  let maxBytes = DEFAULT_MAX_BYTES;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out-dir') outDir = args[++i];
    else if (args[i] === '--max-bytes') maxBytes = Number(args[++i]);
    else files.push(args[i]);
  }
  if (files.length === 0) {
    console.error(
      'usage: node scripts/build-cf-function.mjs <src.js> [...] [--out-dir d] [--max-bytes n]',
    );
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  let failed = false;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const built = stripSource(src);
    const outPath = join(outDir, basename(file));
    writeFileSync(outPath, built);
    const size = Buffer.byteLength(built);
    const ok = size < maxBytes;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${outPath} ${size} bytes (raw ${Buffer.byteLength(src)}, gate ${maxBytes}, hard limit ${CF_HARD_LIMIT_BYTES})`,
    );
    if (!ok) failed = true;
  }
  if (failed) {
    console.error('One or more CloudFront Function artifacts exceed the size gate.');
    process.exit(1);
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'build-cf-function.mjs') {
  main();
}
