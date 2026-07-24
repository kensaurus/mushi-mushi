/**
 * Minimal Conduit-spec Express backend (RealWorld attunement fixture).
 *
 * Implements the RealWorld API contract (https://realworld-docs.netlify.app/)
 * at the subset exercised by the journey spec:
 *  - POST /api/users/login (JWT issuance)
 *  - GET  /api/articles?limit&offset&tag&author&favorited
 *  - GET  /api/articles/:slug
 *  - POST /api/articles/:slug/favorite  (auth required, intentionally 401 when no token)
 *  - GET  /api/tags
 *  - GET  /api/profiles/:username
 *  - GET  /health
 *
 * Auth: `Authorization: Token <jwt>` (NOT Bearer — this is the RealWorld spec).
 * Error shape: `{ "errors": { "body": ["..."] } }` (same spec).
 *
 * Mushi wiring:
 *  - MushiNodeClient captures every Express error via mushiExpressErrorHandler.
 *  - mushiTraceMiddleware adds W3C traceparent context to every request so
 *    the frontend SDK's network capture can correlate.
 *
 * The server is fully in-memory — no database. Intentional: the journey spec
 * needs deterministic data and exercises SDK capture/ingest, not Conduit logic.
 */

import express from 'express'
import { MushiNodeClient } from '@mushi-mushi/node'
import { mushiExpressErrorHandler, mushiTraceMiddleware } from '@mushi-mushi/node'

// ─────────────────────────────────────────────────────────────────────────────
// Mushi init
// ─────────────────────────────────────────────────────────────────────────────

const mushiClient = new MushiNodeClient({
  projectId: process.env.MUSHI_PROJECT_ID ?? 'realworld-fixture',
  apiKey: process.env.MUSHI_API_KEY ?? 'mushi_realworld_fixture_key',
  apiEndpoint:
    process.env.MUSHI_API_ENDPOINT ?? 'http://localhost:4199/functions/v1/api',
  defaultCategory: 'bug',
  environment: 'development',
})

// ─────────────────────────────────────────────────────────────────────────────
// Seed data
// ─────────────────────────────────────────────────────────────────────────────

interface Author {
  username: string
  bio: string | null
  image: string | null
  following: boolean
}

interface Article {
  slug: string
  title: string
  description: string
  body: string
  tagList: string[]
  favoritesCount: number
  favorited: boolean
  author: Author
  createdAt: string
  updatedAt: string
}

const SEED_AUTHOR: Author = {
  username: 'jake',
  bio: 'I work at statefarm',
  image: null,
  following: false,
}

const SEED_ARTICLES: Article[] = [
  {
    slug: 'how-to-train-your-dragon',
    title: 'How to train your dragon',
    description: 'Ever wonder how?',
    body: 'It takes a Jacobian',
    tagList: ['dragons', 'training'],
    favoritesCount: 0,
    favorited: false,
    author: SEED_AUTHOR,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    slug: 'how-to-train-your-dragon-2',
    title: 'How to train your dragon 2',
    description: 'So is the Donut?',
    body: 'It a dragon',
    tagList: ['dragons', 'fiction'],
    favoritesCount: 1,
    favorited: false,
    author: SEED_AUTHOR,
    createdAt: '2026-07-02T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
  },
  {
    slug: 'angularjs-vs-react',
    title: 'AngularJS vs React',
    description: 'Both are great!',
    body: 'Angular is great',
    tagList: ['angular', 'react'],
    favoritesCount: 3,
    favorited: false,
    author: { ...SEED_AUTHOR, username: 'celeb_user' },
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  },
]

const SEED_TAGS = ['dragons', 'training', 'fiction', 'angular', 'react']

// In-memory favorites state per JWT (fixture-only, not spec-correct).
const favorites = new Map<string, Set<string>>()

// Hard-coded user record (the journey logs in as this user).
const FIXTURE_USER = { username: 'jake', email: 'jake@example.com', password: 'password' }
const FIXTURE_JWT =
  ['eyJhbGciOiJIUzI1NiJ9', 'eyJ1c2VybmFtZSI6Impha2UifQ', 'fixture_signature'].join('.')

// ─────────────────────────────────────────────────────────────────────────────
// App setup
// ─────────────────────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())
// Mushi trace middleware (adds traceparent to upstream requests).
app.use(mushiTraceMiddleware({
  apiKey: process.env.MUSHI_API_KEY ?? 'mushi_realworld_fixture_key',
  projectId: process.env.MUSHI_PROJECT_ID ?? 'realworld-fixture',
  apiEndpoint: process.env.MUSHI_API_ENDPOINT ?? 'http://localhost:4199/functions/v1/api',
}))

// ─── auth helper ──────────────────────────────────────────────────────────────

function authFromRequest(req: express.Request): string | null {
  const auth = req.headers['authorization']
  if (!auth?.startsWith('Token ')) return null
  return auth.slice('Token '.length)
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// POST /api/users/login
app.post('/api/users/login', (req, res) => {
  const { email, password } = (req.body as { user: { email: string; password: string } }).user
  if (email === FIXTURE_USER.email && password === FIXTURE_USER.password) {
    res.json({ user: { username: FIXTURE_USER.username, token: FIXTURE_JWT } })
  } else {
    res.status(422).json({ errors: { body: ['email or password is invalid'] } })
  }
})

// GET /api/articles — list with filter + pagination
app.get('/api/articles', (req, res) => {
  const limit = Number(req.query['limit'] ?? 10)
  const offset = Number(req.query['offset'] ?? 0)
  const tag = req.query['tag'] as string | undefined
  const author = req.query['author'] as string | undefined
  const favorited = req.query['favorited'] as string | undefined

  const token = authFromRequest(req)
  const favSet = token ? (favorites.get(token) ?? new Set()) : new Set()

  let filtered = SEED_ARTICLES.map((a) => ({ ...a, favorited: favSet.has(a.slug) }))
  if (tag) filtered = filtered.filter((a) => a.tagList.includes(tag))
  if (author) filtered = filtered.filter((a) => a.author.username === author)
  if (favorited)
    filtered = filtered.filter((a) => a.favorited && a.author.username === favorited)

  const articlesCount = filtered.length
  const articles = filtered.slice(offset, offset + limit)
  res.json({ articles, articlesCount })
})

// GET /api/articles/:slug
app.get('/api/articles/:slug', (req, res) => {
  const token = authFromRequest(req)
  const favSet = token ? (favorites.get(token) ?? new Set()) : new Set()
  const article = SEED_ARTICLES.find((a) => a.slug === req.params['slug'])
  if (!article) return res.status(404).json({ errors: { body: ['article not found'] } })
  return res.json({ article: { ...article, favorited: favSet.has(article.slug) } })
})

// POST /api/articles/:slug/favorite
app.post('/api/articles/:slug/favorite', (req, res) => {
  const token = authFromRequest(req)
  if (!token) return res.status(401).json({ errors: { body: ['unauthorized'] } })
  const article = SEED_ARTICLES.find((a) => a.slug === req.params['slug'])
  if (!article) return res.status(404).json({ errors: { body: ['article not found'] } })
  const favSet = favorites.get(token) ?? new Set<string>()
  favSet.add(article.slug)
  favorites.set(token, favSet)
  article.favoritesCount++
  return res.json({ article: { ...article, favorited: true } })
})

// GET /api/tags
app.get('/api/tags', (_req, res) => {
  res.json({ tags: SEED_TAGS })
})

// GET /api/profiles/:username
app.get('/api/profiles/:username', (req, res) => {
  const username = req.params['username']
  const found = [SEED_AUTHOR, { ...SEED_AUTHOR, username: 'celeb_user' }].find(
    (u) => u.username === username,
  )
  if (!found) return res.status(404).json({ errors: { body: ['profile not found'] } })
  return res.json({ profile: found })
})

// Deliberate error route — exercised by the journey spec to prove server-side
// error capture + PII scrubbing (the slug in the URL goes into the report description).
app.get('/api/articles/:slug/comments', (_req, _res) => {
  throw new Error('comments are not implemented in the fixture')
})

// ─── Mushi error handler — must be LAST ───────────────────────────────────────
app.use(mushiExpressErrorHandler({ client: mushiClient })) // mount LAST — sees every route's errors

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4101)
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[conduit-express] listening on :${PORT}`)
})

export { app, mushiClient }
