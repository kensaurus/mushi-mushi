/**
 * GitHub Issues plugin for Mushi Mushi.
 *
 * Creates GitHub issues for classified bug reports and closes them
 * automatically when Mushi applies a fix.
 *
 * Events handled:
 *   - `report.classified` → POST /repos/{owner}/{repo}/issues
 *       Creates a GitHub issue labelled `mushi-bug`. The label is created
 *       automatically if it does not exist (GET → POST /labels).  The
 *       returned issue number is cached by Mushi report ID so the close
 *       step can find it.  In production, replace the default in-memory
 *       cache with a durable store.
 *   - `fix.applied` → PATCH /repos/{owner}/{repo}/issues/{number}
 *       Sets the issue state to `closed`.
 *
 * Auth: `Authorization: Bearer {token}` — requires a GitHub PAT or GitHub
 * App installation token with `issues: write` and `metadata: read` permissions.
 */

import {
  createPluginHandler,
  type MushiEventEnvelope,
  type MushiFixEvent,
  type MushiReportClassifiedEvent,
} from '@mushi-mushi/plugin-sdk'

const GITHUB_API = 'https://api.github.com'
const MUSHI_LABEL = 'mushi-bug'
const MUSHI_LABEL_COLOR = 'e11d48'
const MUSHI_LABEL_DESCRIPTION = 'Reported via Mushi Mushi'

export interface GithubIssuesPluginConfig {
  /** GitHub personal access token or App installation token. */
  token: string
  /** Repository owner (user or org). */
  owner: string
  /** Repository name. */
  repo: string
  /** Mushi admin base URL used to build deep-link report URLs. */
  adminBaseUrl: string
  /** Mushi plugin signing secret. */
  mushiSecret: string
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Pluggable cache mapping Mushi report IDs to GitHub issue numbers.
 * Default is an in-memory Map; replace with a database-backed store for
 * multi-process / serverless deployments.
 */
export interface GithubIssueCache {
  get(reportId: string): number | null | Promise<number | null>
  set(reportId: string, issueNumber: number): void | Promise<void>
}

export function createGithubIssuesPlugin(
  cfg: GithubIssuesPluginConfig,
  cache: GithubIssueCache = createInMemoryCache(),
) {
  const f = cfg.fetchImpl ?? fetch
  const adminBase = cfg.adminBaseUrl.replace(/\/$/, '')

  const authHeaders = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  function repoBase(): string {
    return `${GITHUB_API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`
  }

  /** Ensures the `mushi-bug` label exists, creating it if necessary. */
  async function ensureMushiLabel(): Promise<void> {
    const getRes = await f(`${repoBase()}/labels/${encodeURIComponent(MUSHI_LABEL)}`, {
      headers: authHeaders,
    })
    if (getRes.ok) return

    if (getRes.status !== 404) {
      throw new Error(`GitHub GET label ${getRes.status}: ${await getRes.text()}`)
    }

    const createRes = await f(`${repoBase()}/labels`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: MUSHI_LABEL,
        color: MUSHI_LABEL_COLOR,
        description: MUSHI_LABEL_DESCRIPTION,
      }),
    })
    if (!createRes.ok && createRes.status !== 422) {
      throw new Error(`GitHub create label ${createRes.status}: ${await createRes.text()}`)
    }
  }

  async function createIssue(envelope: MushiEventEnvelope): Promise<void> {
    const data = envelope.data as MushiReportClassifiedEvent
    const { report, classification } = data
    const reportLink = `${adminBase}/reports/${encodeURIComponent(report.id)}`

    await ensureMushiLabel()

    const body = [
      `**Reported via Mushi Mushi**`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| Report ID | \`${report.id}\` |`,
      `| Severity | ${classification.severity} |`,
      `| Category | ${classification.category} |`,
      `| Confidence | ${Math.round(classification.confidence * 100)}% |`,
      `| Report URL | [Open in Mushi](${reportLink}) |`,
      ``,
      `> This issue was created automatically by the [Mushi Mushi](${adminBase}) GitHub Issues plugin.`,
    ].join('\n')

    const res = await f(`${repoBase()}/issues`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: report.title ?? `[Mushi] ${classification.severity} ${classification.category} report`,
        body,
        labels: [MUSHI_LABEL],
      }),
    })
    if (!res.ok) throw new Error(`GitHub create issue ${res.status}: ${await res.text()}`)

    const json = (await res.json()) as { number?: number }
    if (typeof json.number === 'number') {
      await cache.set(report.id, json.number)
    }
  }

  async function closeIssue(envelope: MushiEventEnvelope): Promise<void> {
    const data = envelope.data as MushiFixEvent
    const issueNumber = await cache.get(data.report.id)
    if (!issueNumber) return

    const res = await f(`${repoBase()}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        state: 'closed',
        state_reason: 'completed',
      }),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`GitHub close issue ${res.status}: ${await res.text()}`)
    }
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.classified': async (e) => {
        await createIssue(e)
      },
      'fix.applied': async (e) => {
        await closeIssue(e)
      },
    },
    logger: {
      info: (msg, meta) => console.log(`[mushi-plugin-github-issues] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-github-issues] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-github-issues] ${msg}`, meta ?? ''),
    },
  })
}

function createInMemoryCache(): GithubIssueCache {
  const map = new Map<string, number>()
  return {
    get: (id) => map.get(id) ?? null,
    set: (id, num) => {
      map.set(id, num)
    },
  }
}
