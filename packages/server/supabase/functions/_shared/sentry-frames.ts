/**
 * FILE: sentry-frames.ts
 * PURPOSE: Turn Sentry stack frames into repo-relative source paths, so the
 *          codebase indexer and the fix context can go straight to the file
 *          an error came from. Pure — no I/O.
 *
 * Sentry frame filenames carry build and runtime prefixes that never appear
 * in the repo tree: `app:///src/x.ts`, `webpack:///./src/x.ts`,
 * `webpack-internal:///(app-pages-browser)/./src/x.tsx`, `~/src/x.ts`,
 * `https://host/static/js/x.js`. We strip those and drop frames that point
 * at vendored or bundled code (node_modules, `_next/static`, `*.bundle`).
 */

export interface SentryStackFrameLike {
  filename?: string | null;
  abs_path?: string | null;
  in_app?: boolean | null;
}

const SCHEME_RE = /^(?:app|webpack|webpack-internal|file|capacitor|ionic):\/\/\/?/i;
const HTTP_RE = /^https?:\/\/[^/]+\//i;
const GROUP_SEGMENT_RE = /^\([^)]*\)\//;
const CODE_EXT_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|rb|go|rs|java|kt|kts|swift|dart|php|cs|ex|exs|scala)$/i;
const VENDORED_RE = /(?:^|\/)(?:node_modules|_next\/static|static\/chunks|\.next)\//i;

/**
 * Normalize one Sentry frame filename to a repo-relative path, or null when
 * the frame cannot map to a source file in the repo.
 */
export function normalizeFramePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.trim().split(/[?#]/)[0] ?? '';
  if (!p || p.startsWith('<') || p === 'native' || p === '[native code]') return null;
  p = p.replace(/\\/g, '/');
  p = p.replace(SCHEME_RE, '').replace(HTTP_RE, '');
  // `(app-pages-browser)/./src/x.tsx` → `./src/x.tsx`; can repeat.
  while (GROUP_SEGMENT_RE.test(p)) p = p.replace(GROUP_SEGMENT_RE, '');
  p = p.replace(/^(?:\.\/|~\/|\/)+/, '');
  p = p.replace(/\/\.\//g, '/');
  if (!p || p.includes('..')) return null;
  if (VENDORED_RE.test(p) || /\.min\.js$/i.test(p)) return null;
  if (!CODE_EXT_RE.test(p)) return null;
  return p;
}

/**
 * Repo-relative source paths from a stack, innermost first, in-app frames
 * before frames with no `in_app` flag; frames marked `in_app: false` are
 * skipped. Deduplicated and bounded.
 */
export function extractFramePaths(
  values: Array<{ stacktrace?: { frames?: SentryStackFrameLike[] | null } | null }> | null | undefined,
  max = 15,
): string[] {
  const inApp: string[] = [];
  const unknown: string[] = [];
  for (const value of values ?? []) {
    const frames = value?.stacktrace?.frames ?? [];
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (!f || f.in_app === false) continue;
      const path = normalizeFramePath(f.filename) ?? normalizeFramePath(f.abs_path);
      if (!path) continue;
      (f.in_app === true ? inApp : unknown).push(path);
    }
  }
  return [...new Set([...inApp, ...unknown])].slice(0, max);
}

/**
 * Map normalized frame paths onto real repo paths by whole-segment suffix:
 * `lib/logger.ts` matches `apps/web/lib/logger.ts` but not `lib/mylogger.ts`.
 * A bare filename (no `/`) only counts when exactly one repo file has it.
 * At most `perFrame` repo paths per frame path.
 */
export function matchFramePathsToTree(
  framePaths: readonly string[],
  treePaths: readonly string[],
  perFrame = 3,
): string[] {
  const out = new Set<string>();
  for (const fp of framePaths) {
    const hits = treePaths.filter((tp) => tp === fp || tp.endsWith(`/${fp}`));
    if (!fp.includes('/') && hits.length !== 1) continue;
    for (const h of hits.slice(0, perFrame)) out.add(h);
  }
  return [...out];
}

/**
 * Frame paths from the stack text `renderStackText` stores in
 * `reports.console_logs` (`  at fn (path:line)`), for reports ingested before
 * `custom_metadata.sentryFrames` existed.
 */
export function framePathsFromStackText(text: string | null | undefined, max = 15): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const line of text.split('\n')) {
    // Greedy to the last `)`: webpack paths carry `(group)` segments.
    const m = /^\s*at [^(]*\((.+)\)\s*$/.exec(line);
    if (!m) continue;
    const loc = m[1].replace(/:\d+(?::\d+)?$/, '');
    const p = normalizeFramePath(loc);
    if (p) out.push(p);
  }
  return [...new Set(out)].slice(0, max);
}
