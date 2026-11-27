// SPDX-License-Identifier: MIT
/**
 * FILE: packages/mcp/src/ux-captures.ts
 * PURPOSE: The stdio side of `upload_ux_captures` (ADR 0073): read a folder of
 *          screenshots in the scorecard's capture layout and turn it into the
 *          pages POST /v1/ux/captures takes. This server cannot depend on
 *          @mushi-mushi/ux (it ships Playwright), so it reads facts.json as
 *          given and fills the rest with "not measured"; `mushi-ux upload`
 *          also reads an Android window.xml or a Maestro hierarchy.json for
 *          the screen's text.
 *
 *   <dir>/pages/<screen>/settled.png   required (or early.png)
 *   <dir>/pages/<screen>/early.png     optional
 *   <dir>/pages/<screen>/facts.json    optional, with any of the page facts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const UX_CAPTURE_MAX_PAGES = 60;
const UX_CAPTURE_MAX_PNG_BYTES = 8 * 1024 * 1024;

interface CapturePage {
  folder: string;
  facts: Record<string, unknown> & { key: string; path: string; viewport: { width: number; height: number } };
  shots: Array<'early' | 'settled'>;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's header, or null when it is not a PNG. @internal Exported for tests. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIG.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

const clampDim = (n: number) => Math.max(200, Math.min(4000, Math.round(n)));

function pathFor(name: string): string {
  const slug = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-');
  return `/${slug || 'screen'}`.slice(0, 500);
}

/** The screens under `<dir>/pages`, checked; throws with a plain message on one that cannot be uploaded. */
export function readCapturePages(dir: string): CapturePage[] {
  const root = join(dir, 'pages');
  if (!existsSync(root)) throw new Error(`No ${root} folder: put each screen in <dir>/pages/<screen>/settled.png.`);
  const out: CapturePage[] = [];
  for (const name of readdirSync(root).sort()) {
    const folder = join(root, name);
    if (!statSync(folder).isDirectory()) continue;
    const shots = (['early', 'settled'] as const).filter((s) => existsSync(join(folder, `${s}.png`)));
    if (!shots.length) continue;
    let dims: { width: number; height: number } | null = null;
    for (const s of shots) {
      const file = join(folder, `${s}.png`);
      if (statSync(file).size > UX_CAPTURE_MAX_PNG_BYTES) throw new Error(`${file} is over 8 MB.`);
      const d = pngDimensions(readFileSync(file).subarray(0, 32));
      if (!d) throw new Error(`${file} is not a PNG.`);
      dims = d;
    }
    let given: Record<string, unknown> = {};
    const factsFile = join(folder, 'facts.json');
    if (existsSync(factsFile)) {
      try {
        given = JSON.parse(readFileSync(factsFile, 'utf8')) as Record<string, unknown>;
      } catch {
        throw new Error(`${factsFile} is not valid JSON.`);
      }
    }
    const path = typeof given.path === 'string' && given.path.startsWith('/') ? given.path : pathFor(typeof given.key === 'string' ? given.key : name);
    const key = typeof given.key === 'string' && given.key ? given.key : path;
    const gv = given.viewport as { width?: unknown; height?: unknown } | undefined;
    const viewport =
      gv && typeof gv.width === 'number' && typeof gv.height === 'number'
        ? { width: clampDim(gv.width), height: clampDim(gv.height) }
        : dims
          ? { width: clampDim(dims.width), height: clampDim(dims.height) }
          : { width: 390, height: 844 };
    const label = typeof given.label === 'string' && given.label ? given.label : name.replace(/[-_]+/g, ' ');
    out.push({
      folder,
      shots: [...shots],
      facts: {
        title: label,
        headings: [],
        text: '',
        controls: [],
        settleMs: null,
        axe: null,
        overflowX: false,
        consoleErrors: 0,
        cls: 0,
        ...given,
        key,
        path,
        label,
        viewport,
      },
    });
  }
  if (!out.length) throw new Error(`No screenshots in ${root}.`);
  if (out.length > UX_CAPTURE_MAX_PAGES) throw new Error(`${out.length} screens; one upload takes at most ${UX_CAPTURE_MAX_PAGES}.`);
  return out;
}
