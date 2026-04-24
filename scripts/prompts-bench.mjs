#!/usr/bin/env node
/**
 * scripts/prompts-bench.mjs — local prompt leaderboard.
 *
 * Wave R (2026-04-22): re-uses the judge-batch scoring contract without
 * invoking the Edge Function. Pulls every `prompt_versions` row for a project
 * from Supabase (or a local seed file), re-runs Sonnet 4.6 against the
 * classification_evaluations dataset using each prompt as the system prompt,
 * then prints a Markdown leaderboard ranked by mean judge score.
 *
 * Run:
 *   pnpm prompts:bench --project-id <uuid>          # live Supabase
 *   pnpm prompts:bench --fixture tests/bench.json   # offline
 *
 * Prereq env:
 *   SUPABASE_URL              — https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service role JWT
 *   ANTHROPIC_API_KEY         — scoring model (judge uses Sonnet 4.6 by default;
 *                               Opus 4.7 was briefly tried 2026-04-22 then reverted
 *                               2026-04-24 — see SERVER-9 / `_shared/models.ts`)
 *
 * This is a DEV tool. It writes nothing to the database; the A/B scoring
 * that actually promotes prompts lives in judge-batch and runs nightly.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]?.replace(/^--/, '') ?? ''
  const v = process.argv[i + 1] ?? ''
  args.set(k, v)
}

const projectId = args.get('project-id') ?? process.env.MUSHI_PROJECT_ID
const fixture = args.get('fixture')
const stageFilter = args.get('stage') ?? null
const sampleSize = Number(args.get('sample') ?? 20)
const model = args.get('model') ?? 'claude-opus-4-7'

if (!projectId && !fixture) {
  console.error('Usage: pnpm prompts:bench --project-id <uuid> [--stage stage2] [--sample 20]')
  console.error('   or: pnpm prompts:bench --fixture path/to/seed.json')
  process.exit(2)
}

/**
 * Prompt + eval rows schema:
 *   prompts: Array<{ stage, version, prompt_template }>
 *   evals:   Array<{ description, console_logs, user_category, ground_truth }>
 */
async function loadInputs() {
  if (fixture) {
    const raw = JSON.parse(readFileSync(resolve(fixture), 'utf8'))
    return { prompts: raw.prompts ?? [], evals: raw.evals ?? [] }
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for live mode')
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  const promptsUrl = new URL('/rest/v1/prompt_versions', url)
  promptsUrl.searchParams.set('select', 'stage,version,prompt_template,avg_judge_score,total_evaluations')
  promptsUrl.searchParams.set('or', `(project_id.eq.${projectId},project_id.is.null)`)
  if (stageFilter) promptsUrl.searchParams.set('stage', `eq.${stageFilter}`)

  // Wave S (2026-04-23): prior revisions of this script selected
  // `report_description,ground_truth,stage2_classification` — none of
  // which exist on `classification_evaluations`. Every run failed with a
  // 400 ("column does not exist") and the bench printed an empty
  // leaderboard. We now join to `reports` via the PostgREST resource
  // embedding syntax and pull what actually lives on each row:
  //   - reports.description       (replaces report_description)
  //   - reports.stage2_analysis   (replaces stage2_classification)
  //   - suggested_correction      (the judge's own "ground truth" — the
  //                                closest thing we have to a golden label)
  const evalsUrl = new URL('/rest/v1/classification_evaluations', url)
  evalsUrl.searchParams.set(
    'select',
    [
      'id',
      'report_id',
      'judge_score',
      'classification_agreed',
      'suggested_correction',
      'report:report_id(description,stage2_analysis,category,severity,component)',
    ].join(','),
  )
  evalsUrl.searchParams.set('project_id', `eq.${projectId}`)
  evalsUrl.searchParams.set('limit', String(sampleSize))
  evalsUrl.searchParams.set('order', 'created_at.desc')

  const [pr, er] = await Promise.all([
    fetch(promptsUrl, { headers: auth }),
    fetch(evalsUrl, { headers: auth }),
  ])
  if (!pr.ok) throw new Error(`prompt_versions fetch failed: ${pr.status} ${await pr.text()}`)
  const evalsOk = er.ok
  const prompts = await pr.json()
  const evals = evalsOk ? await er.json() : []
  return { prompts, evals }
}

async function scorePromptAgainstEvals(prompt, evals) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY required — benchmark needs a live judge')

  let total = 0
  let count = 0
  for (const row of evals) {
    const description = row.report?.description ?? ''
    const actualClassification = {
      category: row.report?.category ?? null,
      severity: row.report?.severity ?? null,
      component: row.report?.component ?? null,
      stage2: row.report?.stage2_analysis ?? null,
    }
    // We don't have a gold label; the closest proxy is the judge's own
    // suggested_correction (only set when classification_agreed = false).
    // When agreed, we pass the actual classification as the "reference".
    const referenceLabel = row.classification_agreed
      ? actualClassification
      : (row.suggested_correction ?? actualClassification)
    const body = {
      model,
      max_tokens: 200,
      system: prompt.prompt_template,
      messages: [
        {
          role: 'user',
          content:
            `Score this prior classification on a 0–1 scale. Only return a single JSON object: {"score": number, "reason": string}.\n\n` +
            `Report: ${String(description).slice(0, 600)}\n` +
            `Reference label: ${JSON.stringify(referenceLabel).slice(0, 300)}\n` +
            `Actual classification: ${JSON.stringify(actualClassification).slice(0, 300)}`,
        },
      ],
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[warn] Anthropic ${res.status} for ${prompt.stage}/${prompt.version}: ${await res.text()}`)
      continue
    }
    const data = await res.json()
    const text = data?.content?.[0]?.text ?? ''
    const m = text.match(/"score"\s*:\s*([0-9.]+)/)
    if (m) {
      const v = Number(m[1])
      if (Number.isFinite(v)) {
        total += v
        count += 1
      }
    }
  }
  return count === 0 ? null : total / count
}

async function main() {
  const { prompts, evals } = await loadInputs()
  if (evals.length === 0) {
    console.error('[error] No classification_evaluations rows found — seed the dataset or pass --fixture')
    process.exit(3)
  }

  console.log(`# Prompt leaderboard — ${prompts.length} prompts × ${evals.length} evals`)
  console.log(`# Judge: ${model}\n`)
  const rows = []
  for (const p of prompts) {
    process.stderr.write(`[bench] ${p.stage}/${p.version} … `)
    const score = await scorePromptAgainstEvals(p, evals)
    process.stderr.write(score == null ? 'FAIL\n' : `${score.toFixed(3)}\n`)
    rows.push({ ...p, localScore: score })
  }

  rows.sort((a, b) => (b.localScore ?? -1) - (a.localScore ?? -1))

  console.log('| rank | stage | version | local score | DB avg | evals (DB) |')
  console.log('|------|-------|---------|-------------|--------|------------|')
  rows.forEach((r, i) => {
    const local = r.localScore == null ? '—' : r.localScore.toFixed(3)
    const dbAvg = r.avg_judge_score == null ? '—' : Number(r.avg_judge_score).toFixed(3)
    console.log(`| ${i + 1} | ${r.stage} | ${r.version} | ${local} | ${dbAvg} | ${r.total_evaluations ?? 0} |`)
  })
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
