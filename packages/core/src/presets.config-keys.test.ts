/**
 * `KNOWN_CONFIG_KEYS` in presets.ts drives the "[mushi] Unknown config key"
 * console error. It carries a "keep in sync with MushiConfig" comment, and that
 * comment was all that held the invariant together — so it drifted.
 *
 * `replaySampleRate` was declared on `MushiConfig`, documented with a usage
 * example, and covered by tests asserting `Mushi.init` accepts it — while the
 * allowlist did not contain it. Every consumer setting that perfectly valid,
 * typed key got told it was unknown and ignored.
 *
 * The existing tests missed it because they assert `init` does not THROW, never
 * that it does not WARN. This test closes that gap by reading both sources and
 * comparing them, so the invariant fails the build instead of the comment being
 * quietly wrong.
 *
 * Parsing the .ts sources rather than importing them is deliberate:
 * `MushiConfig` is a type, so it is erased at runtime and cannot be reflected
 * over. The shapes parsed here are simple and stable — a flat interface body
 * and a flat string-literal array.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

function declaredConfigKeys(): string[] {
  const src = fs.readFileSync(path.join(DIR, 'types.ts'), 'utf8');
  const start = src.indexOf('interface MushiConfig');
  expect(start, 'MushiConfig interface not found in types.ts').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n}', start));
  // Top-level members only: exactly two spaces of indentation.
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1] as string);
}

function allowlistedConfigKeys(): string[] {
  const src = fs.readFileSync(path.join(DIR, 'presets.ts'), 'utf8');
  const start = src.indexOf('const KNOWN_CONFIG_KEYS');
  expect(start, 'KNOWN_CONFIG_KEYS not found in presets.ts').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('];', start));
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

describe('KNOWN_CONFIG_KEYS stays in sync with MushiConfig', () => {
  it('parses a plausible number of keys from both sources', () => {
    // Guards the parsers themselves: a regex that silently matched nothing
    // would make both assertions below vacuously pass.
    expect(declaredConfigKeys().length).toBeGreaterThan(10);
    expect(allowlistedConfigKeys().length).toBeGreaterThan(10);
  });

  it('warns about no key that MushiConfig actually declares', () => {
    const missing = declaredConfigKeys().filter((k) => !allowlistedConfigKeys().includes(k));
    expect(
      missing,
      `Declared on MushiConfig but absent from KNOWN_CONFIG_KEYS, so setting ` +
        `${missing.length === 1 ? 'it' : 'them'} logs "[mushi] Unknown config key" ` +
        `for a valid, typed option: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('allowlists no key that MushiConfig does not declare', () => {
    // The other direction matters too: an allowlisted-but-undeclared key
    // suppresses a warning that should fire, hiding a real typo from consumers.
    const extra = allowlistedConfigKeys().filter((k) => !declaredConfigKeys().includes(k));
    expect(
      extra,
      `In KNOWN_CONFIG_KEYS but not declared on MushiConfig, so a genuine typo ` +
        `would be silently accepted: ${extra.join(', ')}`,
    ).toEqual([]);
  });
});
