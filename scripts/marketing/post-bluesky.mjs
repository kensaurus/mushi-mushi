// scripts/marketing/post-bluesky.mjs
//
// Posts the next due item from docs/marketing/social/queue.json to
// Bluesky via the AT Protocol HTTP API. Zero deps — talks to
// `com.atproto.server.createSession` for auth and
// `com.atproto.repo.createRecord` for posting, exactly as
// https://atproto.com/blog/create-post documents.
//
// Why we wrote our own ~80 lines instead of using @atproto/api:
//   - keeps scripts/ zero-dep (consistent with the rest of scripts/)
//   - avoids pulling in a Node-only crypto graph for the build
//   - the surface we need is two endpoints, no generated client value
//
// Bluesky bot etiquette (from docs.bsky.app/docs/starter-templates/bots):
//   - Self-label the account as a bot in the profile bio (manual, one-time).
//   - Don't trigger notifications on accounts that didn't opt in (no @mentions
//     of arbitrary handles, no replies to people who didn't tag the bot).
//   - Respect rate limits — login limit is much tighter than the post limit,
//     so we persist the session token to .cache/bluesky-session.json and
//     reuse it for ~90 minutes (Bluesky's default access-jwt window) before
//     re-auth'ing.
//
// Usage:
//   node scripts/marketing/post-bluesky.mjs                  # post next due item
//   node scripts/marketing/post-bluesky.mjs --all            # post every due item
//   node scripts/marketing/post-bluesky.mjs --dry            # show what would post
//   node scripts/marketing/post-bluesky.mjs --text "..."     # one-off ad-hoc post
//   node scripts/marketing/post-bluesky.mjs --text "..." --image=path --alt="…"
//                                                            # ad-hoc post with image
//   node scripts/marketing/post-bluesky.mjs --delete <at-uri>
//                                                            # retract a post (typos,
//                                                            # soft-launch cleanup); also
//                                                            # clears posted_at/uri from
//                                                            # the queue if it was tracked
//                                                            # there, so re-runs are sane
//
// Queue file (docs/marketing/social/queue.json) shape:
//   [
//     {
//       "scheduled_for": "2026-04-25T16:00Z",
//       "text": "moshi moshi 🐛 ...",
//       "image": {                        // optional
//         "path": "docs/marketing/social/images/launch-card.jpg",
//         "alt": "Mushi-chan kawaii ladybug mascot pointing at a terminal showing `npx mushi-mushi` …"
//       }
//     },
//     ...
//   ]
// The script flips `posted_at` on each item it sends and writes the file
// back so re-runs are idempotent. Image dimensions are extracted from
// the file header so Bluesky reserves the right slot in the feed (no
// jarring layout shift when the image actually loads).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { loadEnv, need, maybe, parseArgs, REPO_ROOT, step, ok, warn, err, sleep, announceDryRun } from './lib.mjs'

loadEnv()
const args = parseArgs()
announceDryRun(args)

// Bluesky uses handle (e.g. mushimushi.dev) + app password (4 dash-grouped
// blocks, generated at bsky.app → Settings → App passwords). We accept
// either BLUESKY_APP_PASSWORD (canonical) or BSKY_API_KEY (the alias the
// user dropped into .env) so the script works with either name.
const HANDLE = need(
  'BLUESKY_HANDLE',
  'Set BLUESKY_HANDLE=mushimushi.dev (or whichever handle you reserved) in .env.local.',
)
const APP_PASSWORD =
  maybe('BLUESKY_APP_PASSWORD') ??
  need(
    'BSKY_API_KEY',
    'Set BLUESKY_APP_PASSWORD or BSKY_API_KEY (Bluesky app password — Settings → App passwords) in .env.local.',
  )

const SERVICE = 'https://bsky.social'

// --- session persistence -------------------------------------------------

const SESSION_PATH = resolve(REPO_ROOT, '.cache', 'bluesky-session.json')

async function loadOrCreateSession() {
  if (existsSync(SESSION_PATH)) {
    try {
      const s = JSON.parse(readFileSync(SESSION_PATH, 'utf8'))
      // Optimistic re-use; we'll re-auth on the next 401.
      if (s.handle === HANDLE && s.accessJwt) return s
    } catch {
      // Fall through to re-auth.
    }
  }
  step('Authenticating to Bluesky (createSession)...')
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  })
  if (!res.ok) {
    err(`createSession failed: HTTP ${res.status}`)
    console.error(await res.text())
    process.exit(1)
  }
  const s = await res.json()
  mkdirSync(dirname(SESSION_PATH), { recursive: true })
  writeFileSync(SESSION_PATH, JSON.stringify(s, null, 2))
  return s
}

// --- rich text facets (links, hashtags) ----------------------------------

// Bluesky stores links and hashtags as byte-offset facets attached to the
// post record, not inline like markdown. We compute facets for any URL or
// `#tag` found in the text. This matches the AT Protocol "rich text" spec
// at https://atproto.com/specs/lexicon#rich-text.
function buildFacets(text) {
  const facets = []
  const enc = new TextEncoder()
  const fullBytes = enc.encode(text)

  // URL detection — match http(s):// up to the next whitespace / closing
  // bracket / sentence punctuation. Compute byte offsets, not char offsets.
  const urlRe = /https?:\/\/[^\s)\]<>]+/g
  for (const m of text.matchAll(urlRe)) {
    const start = enc.encode(text.slice(0, m.index)).length
    const end = start + enc.encode(m[0]).length
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
    })
  }

  // Hashtag detection — `#tag` where tag is alnum/underscore/dash.
  const tagRe = /(?:^|\s)#([A-Za-z0-9_-]+)/g
  for (const m of text.matchAll(tagRe)) {
    const tagStart = m.index + m[0].indexOf('#')
    const start = enc.encode(text.slice(0, tagStart)).length
    const end = start + enc.encode(`#${m[1]}`).length
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[1] }],
    })
  }

  // Sanity: keep total <= 300 graphemes (the Bluesky post limit). The API
  // will reject with `InvalidRequest` otherwise; better to fail loudly here.
  if (fullBytes.length > 3000) {
    err(`Post too long (${fullBytes.length} bytes; Bluesky limit is roughly 300 graphemes / ~3000 bytes).`)
    process.exit(1)
  }
  return facets
}

// --- image embed --------------------------------------------------------
//
// Bluesky's spec for embedded images:
//   1. Upload the raw bytes via com.atproto.repo.uploadBlob — returns a
//      blob ref ({ $type: 'blob', ref: { $link }, mimeType, size }).
//   2. Reference that blob inside an app.bsky.embed.images embed on the
//      post record, with alt text and (recommended) aspectRatio so the
//      feed reserves the right tile size and avoids layout shift.
//
// Limits (as of 2026-04): 1 MB per image, max 4 per post, JPEG / PNG /
// WebP / GIF accepted. We surface a clear error if the file is too big
// rather than letting Bluesky reject the post mid-flight.

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function detectMime(path) {
  const ext = extname(path).toLowerCase()
  const mime = MIME_BY_EXT[ext]
  if (!mime) {
    err(`Unsupported image extension: ${ext} (need one of ${Object.keys(MIME_BY_EXT).join(', ')})`)
    process.exit(1)
  }
  return mime
}

// Pull pixel dimensions straight out of the file header so we can pass
// `aspectRatio` to Bluesky. PNG: width/height live at fixed offsets in
// the IHDR chunk. JPEG: walk the marker stream until we hit an SOF
// (Start-Of-Frame) segment and read precision / height / width from it.
function imageSize(buf, mime) {
  if (mime === 'image/png') {
    if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') {
      return null
    }
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (mime === 'image/jpeg') {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
    let i = 2
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null
      const marker = buf[i + 1]
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      const segLen = buf.readUInt16BE(i + 2)
      i += 2 + segLen
    }
    return null
  }
  return null
}

async function uploadImage(session, imageSpec) {
  const absPath = resolve(REPO_ROOT, imageSpec.path)
  if (!existsSync(absPath)) {
    err(`Image not found: ${absPath}`)
    process.exit(1)
  }
  const bytes = readFileSync(absPath)
  if (bytes.length > 1_000_000) {
    err(
      `Image too large: ${bytes.length} bytes (Bluesky cap is 1,000,000). ` +
        `Re-encode to JPEG or down-scale before posting.`,
    )
    process.exit(1)
  }
  const mime = detectMime(imageSpec.path)
  step(`Uploading image (${(bytes.length / 1024).toFixed(0)} KB ${mime}) → uploadBlob`)
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      'Content-Type': mime,
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: bytes,
  })
  if (!res.ok) {
    err(`uploadBlob failed: HTTP ${res.status}`)
    console.error(await res.text())
    process.exit(1)
  }
  const { blob } = await res.json()
  const dims = imageSize(bytes, mime)
  return {
    alt: imageSpec.alt ?? '',
    image: blob,
    ...(dims ? { aspectRatio: dims } : {}),
  }
}

async function createPost(session, text, imageSpec) {
  const facets = buildFacets(text)
  const embed = imageSpec
    ? {
        $type: 'app.bsky.embed.images',
        images: [await uploadImage(session, imageSpec)],
      }
    : null
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
    ...(facets.length ? { facets } : {}),
    ...(embed ? { embed } : {}),
  }
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  })
  if (res.status === 401) {
    // Token expired — wipe and re-auth once.
    try {
      writeFileSync(SESSION_PATH, '{}')
    } catch {
      // Best-effort cleanup; either way the next run will re-auth.
    }
    err('Session expired; re-run the script and it will mint a fresh one.')
    process.exit(1)
  }
  if (!res.ok) {
    err(`createRecord failed: HTTP ${res.status}`)
    console.error(await res.text())
    process.exit(1)
  }
  return res.json()
}

// --- delete (retract) ---------------------------------------------------
//
// Bluesky retains the post's ATProto record locally even after delete —
// other relays may cache it for a few minutes — but bsky.app's appview
// drops it from feeds within ~10s. Use this for typos and soft-launch
// cleanup; don't rely on it as a substitute for thinking before posting.

async function deletePost(session, uri) {
  // AT URI shape: at://did:plc:.../app.bsky.feed.post/<rkey>
  const m = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/(.+)$/)
  if (!m) {
    err(`Not a valid AT URI: ${uri}`)
    process.exit(1)
  }
  const [, did, collection, rkey] = m
  step(`Deleting ${collection}/${rkey} from ${did}`)
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.deleteRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({ repo: did, collection, rkey }),
  })
  if (!res.ok) {
    err(`deleteRecord failed: HTTP ${res.status}`)
    console.error(await res.text())
    process.exit(1)
  }
  return rkey
}

// --- queue resolution ----------------------------------------------------

const QUEUE_PATH = resolve(REPO_ROOT, 'docs/marketing/social/queue.json')

function loadQueue() {
  if (!existsSync(QUEUE_PATH)) {
    err(`Queue file not found: ${QUEUE_PATH}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(QUEUE_PATH, 'utf8'))
}

function dueItems(queue) {
  const now = Date.now()
  return queue
    .map((item, index) => ({ ...item, index }))
    .filter(
      (item) =>
        !item.posted_at &&
        (!item.scheduled_for || new Date(item.scheduled_for).getTime() <= now),
    )
}

function saveQueue(queue) {
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n')
}

// --- main ----------------------------------------------------------------

const session = args.dry ? null : await loadOrCreateSession()

if (typeof args.delete === 'string') {
  if (args.dry) {
    step(`(dry) would delete ${args.delete}`)
    process.exit(0)
  }
  await deletePost(session, args.delete)
  // If the deleted post is tracked in the queue, clear posted_at/uri so
  // a future re-run can re-post it without thinking it's a duplicate.
  const queue = loadQueue()
  let mutated = false
  for (const item of queue) {
    if (item.uri === args.delete) {
      delete item.posted_at
      delete item.uri
      mutated = true
    }
  }
  if (mutated) {
    saveQueue(queue)
    ok('Deleted + cleared queue tracking. Item is eligible to re-post.')
  } else {
    ok('Deleted. (Not tracked in queue, nothing to update.)')
  }
  process.exit(0)
}

if (typeof args.text === 'string') {
  // Optional --image=path/to.jpg --alt="…" for one-off image posts. Both
  // resolve relative to the repo root so calls from any cwd behave the
  // same as the queued items.
  const adhocImage =
    typeof args.image === 'string' ? { path: args.image, alt: args.alt ?? '' } : null
  step(`Ad-hoc post (${args.text.length} chars${adhocImage ? `, +image ${adhocImage.path}` : ''})`)
  if (args.dry) {
    console.log(args.text)
    if (adhocImage) console.log(`  (would attach ${adhocImage.path})`)
    process.exit(0)
  }
  const result = await createPost(session, args.text, adhocImage)
  ok(`Posted: ${result.uri}`)
  process.exit(0)
}

const queue = loadQueue()
const due = dueItems(queue)
if (due.length === 0) {
  ok('Nothing due in the queue. Add items to docs/marketing/social/queue.json.')
  process.exit(0)
}

const toPost = args.all ? due : due.slice(0, 1)
step(`${toPost.length} of ${due.length} due item(s) will be posted.`)

for (const item of toPost) {
  const tag = item.image ? ' 🖼️' : ''
  step(`[${item.index}]${tag} ${item.text.slice(0, 60)}${item.text.length > 60 ? '…' : ''}`)
  if (args.dry) {
    console.log('  (dry — not sending)')
    if (item.image) console.log(`  (would attach ${item.image.path})`)
    continue
  }
  const result = await createPost(session, item.text, item.image ?? null)
  queue[item.index].posted_at = new Date().toISOString()
  queue[item.index].uri = result.uri
  saveQueue(queue)
  ok(`  → ${result.uri}`)
  // Be polite — small spacing between posts so we don't spike the bot's
  // notification graph for any followers watching the bot live.
  if (args.all) await sleep(1500)
}
