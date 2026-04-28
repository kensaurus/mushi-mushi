/**
 * Contract test: every endpoint advertised by `/v1/admin/auth/manifest`
 * must exist as a Hono route in `api/index.ts`.
 *
 * closes a real audit finding: the manifest used to point at
 * `/v1/admin/auth/token` and `/v1/admin/projects/:id/keys/rotate` despite
 * neither route existing — any A2A agent that followed the discovery doc hit
 * a 404 immediately. This test reads the source, extracts the URL templates
 * the manifest advertises, and asserts each one is registered.
 *
 * The match is purely structural (no Deno runtime, no live HTTP) and scans
 * `api/index.ts` plus `api/routes/*.ts`, so route-registration modules keep
 * the same contract coverage as the old monolithic file.
 * That keeps the regression check cheap enough to run on every commit.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const apiSourceRoot = resolve(__dirname, '../../supabase/functions/api');

function readApiSources(dir = apiSourceRoot): string {
  return readdirSync(dir)
    .sort()
    .map((entry) => {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) return readApiSources(full);
      if (!entry.endsWith('.ts')) return '';
      return readFileSync(full, 'utf-8');
    })
    .filter(Boolean)
    .join('\n');
}

const apiSource = readApiSources();

interface RegisteredRoute {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
}

// Extract every Hono route registration. We deliberately keep the regex
// liberal (no method gating) and filter afterwards so a future `app.route(...)`
// composition is easy to extend without rewriting the matcher.
function extractRegisteredRoutes(source: string): RegisteredRoute[] {
  const re = /\bapp\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const out: RegisteredRoute[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.push({ method: match[1] as RegisteredRoute['method'], path: match[2] });
  }
  return out;
}

// Pull every URL template advertised by the manifest builder. The manifest
// constructs URLs as `${apiBase}/path`, so we look for those template strings
// and strip the prefix back to the path-only form Hono registers under.
function extractManifestEndpoints(source: string): string[] {
  const manifestStart = source.indexOf("app.get('/v1/admin/auth/manifest'");
  expect(manifestStart, 'manifest endpoint must exist in index.ts').toBeGreaterThan(0);
  // Heuristic: read 4 KB of the manifest body — enough for any realistic
  // schema-list payload without scanning the whole 8 k-line file.
  const window = source.slice(manifestStart, manifestStart + 4000);
  const re = /`\$\{apiBase\}(\/[^`]+)`/g;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(window)) !== null) out.add(match[1]);
  return [...out];
}

// `:id` in a registered Hono path matches `:id` in a manifest URL but the
// manifest may use any param name. Normalize both sides to a positional
// placeholder so `keys/:id/rotate` and `keys/:keyId/rotate` are equivalent
// for contract purposes (the *shape* of the URL is what's advertised, not
// the param naming).
function normalizePath(path: string): string {
  return path.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, ':param');
}

describe('auth manifest contract', () => {
  const registered = extractRegisteredRoutes(apiSource);
  const advertised = extractManifestEndpoints(apiSource);
  const registeredPaths = new Set(registered.map((r) => normalizePath(r.path)));

  it('finds at least one advertised endpoint to verify', () => {
    expect(advertised.length).toBeGreaterThan(0);
  });

  it('every advertised endpoint exists as a registered route', () => {
    const missing = advertised.filter((url) => !registeredPaths.has(normalizePath(url)));
    expect(
      missing,
      `Manifest advertises endpoints with no Hono route: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('manifest itself is registered', () => {
    expect(registeredPaths.has('/v1/admin/auth/manifest')).toBe(true);
  });

  it('extracts the two endpoints implemented', () => {
    expect(advertised).toEqual(
      expect.arrayContaining(['/v1/admin/auth/token', '/v1/admin/projects/:id/keys/rotate']),
    );
  });
});
