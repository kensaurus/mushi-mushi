#!/usr/bin/env node
/**
 * Encodes a docs demo clip as MP4 + WebM + a poster, replacing the old GIFs.
 *
 * A 5 MB demo GIF is about 300 KB as H.264 and less as VP9, and every docs
 * visitor and crawler paid the GIF's size in CloudFront egress. The docs embed
 * these through <DocVideo> (apps/docs/components/DocVideo.tsx).
 *
 * Output, next to the input unless --out-dir is given:
 *   {stem}.mp4          H.264, yuv420p, CRF 28, +faststart (Safari, fallback)
 *   {stem}.webm         VP9, CRF 38 (Chrome, Firefox)
 *   {stem}-poster.webp  last frame, shown before play and under reduced motion
 *
 * Usage:
 *   node scripts/marketing/demo-video.mjs docs/screenshots/query-demo.gif [...more]
 *   node scripts/marketing/demo-video.mjs --delete-source docs/screenshots/*-demo.gif
 *
 * ffmpeg comes from $FFMPEG or PATH. record-admin-page-gifs.mjs imports
 * encodeDemoVideo() and passes its own ffmpeg binary.
 */

import { spawn } from 'node:child_process'
import { statSync, unlinkSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Even dimensions: yuv420p rejects odd widths and heights. */
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'

function run(ffmpeg, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited ${code}: ${args.join(' ')}`)),
    )
  })
}

/**
 * @param {string} ffmpeg   ffmpeg binary
 * @param {string} input    source clip (GIF or a raw Playwright .webm)
 * @param {string} outStem  output path without extension
 * @param {{ inputArgs?: string[], filter?: string }} [opts]
 *   inputArgs go before -i (e.g. ['-ss', '0.35', '-t', '6']);
 *   filter is prepended to the even-dimension scale (e.g. 'fps=12,scale=1280:-1').
 * @returns {Promise<{ mp4: string, webm: string, poster: string }>}
 */
export async function encodeDemoVideo(ffmpeg, input, outStem, opts = {}) {
  const inputArgs = opts.inputArgs ?? []
  const vf = opts.filter ? `${opts.filter},${EVEN}` : EVEN
  const out = { mp4: `${outStem}.mp4`, webm: `${outStem}.webm`, poster: `${outStem}-poster.webp` }

  await run(ffmpeg, [
    ...inputArgs, '-i', input, '-an', '-vf', vf,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', out.mp4,
  ])
  await run(ffmpeg, [
    ...inputArgs, '-i', input, '-an', '-vf', vf,
    '-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '0', '-row-mt', '1',
    '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', out.webm,
  ])
  await encodePoster(ffmpeg, out.mp4, out.poster)
  return out
}

/**
 * Poster = the clip's last frame, read from the encoded MP4 so its size
 * matches. The recordings open on a "Loading…" shell and end on the settled
 * page, and reduced-motion readers only ever see the poster.
 */
export function encodePoster(ffmpeg, mp4, poster) {
  return run(ffmpeg, [
    '-sseof', '-0.3', '-i', mp4, '-frames:v', '1',
    '-c:v', 'libwebp', '-quality', '80', poster,
  ])
}

const size = (path) => statSync(path).size
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`

async function main() {
  const argv = process.argv.slice(2)
  let deleteSource = false
  let outDir = null
  const inputs = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--delete-source') deleteSource = true
    else if (argv[i] === '--out-dir') outDir = resolve(argv[++i])
    else inputs.push(argv[i])
  }
  if (!inputs.length) {
    console.error('usage: demo-video.mjs [--delete-source] [--out-dir DIR] <clip>...')
    process.exit(1)
  }
  const ffmpeg = process.env.FFMPEG || 'ffmpeg'

  const rows = []
  for (const input of inputs) {
    const stem = basename(input, extname(input))
    const outStem = join(outDir ?? dirname(input), stem)
    const out = await encodeDemoVideo(ffmpeg, input, outStem)
    const row = {
      file: basename(input),
      before: size(input),
      mp4: size(out.mp4),
      webm: size(out.webm),
      poster: size(out.poster),
    }
    rows.push(row)
    console.log(
      `${row.file}: ${kb(row.before)} -> mp4 ${kb(row.mp4)}, webm ${kb(row.webm)}, poster ${kb(row.poster)}`,
    )
    if (deleteSource) unlinkSync(input)
  }

  const sum = (key) => rows.reduce((total, row) => total + row[key], 0)
  console.log(
    `TOTAL ${rows.length} clips: ${sum('before')} B -> mp4 ${sum('mp4')} B, webm ${sum('webm')} B, poster ${sum('poster')} B`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
