import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { apiCall, die, requireConfig, fmtDate } from '../cli-shared.js';
import type { SkillRow, PipelineRunRow, StepRunRow } from '../cli-types.js';

export function registerSkillsCommands(program: Command): void {
const skills = program.command('skills').description('Manage agent skill catalog')

skills
  .command('list')
  .description('List all skills in the catalog')
  .option('--category <cat>', 'Filter by category (workflow, debug, test, audit, …)')
  .option('--search <q>', 'Search slug, title, or description')
  .option('--page <n>', 'Page number (default 1)', '1')
  .option('--limit <n>', 'Max results per page (1–200, default 200)', '200')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { category?: string; search?: string; page: string; limit: string; json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    const qs = new URLSearchParams()
    if (opts.category) qs.set('category', opts.category)
    if (opts.search) qs.set('q', opts.search)
    qs.set('page', String(Math.max(1, parseInt(opts.page) || 1)))
    qs.set('limit', String(Math.min(Math.max(1, parseInt(opts.limit) || 200), 200)))
    const result = await apiCall<SkillRow[]>(
      `/v1/admin/skills?${qs}`,
      config,
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    const rows = result.data ?? []
    if (opts.json) {
      console.log(JSON.stringify({ skills: rows, count: rows.length }, null, 2))
      return
    }
    if (rows.length === 0) { console.log('No skills in catalog. Add a source with `mushi skills sync`.'); return }
    console.log(`\nSkill catalog (${rows.length} skills):\n`)
    let lastCat = ''
    for (const s of rows) {
      if (s.category !== lastCat) { lastCat = s.category; console.log(`\n  [${s.category}]`) }
      const chain = s.chain_slugs?.length ? ` → ${s.chain_slugs.length} steps` : ''
      console.log(`    ${s.slug.padEnd(40)} ${s.title}${chain}`)
    }
    console.log()
  })

skills
  .command('show <slug>')
  .description('Show full details and chain for a skill')
  .action(async (slug: string) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    const result = await apiCall<SkillRow & { body_md: string }>(`/v1/admin/skills/${slug}`, config)
    if (!result.ok) { console.error('Skill not found:', slug); process.exit(1) }
    const s = result.data!
    console.log(`\n${s.title} (${s.slug})\n${'─'.repeat(50)}`)
    console.log(`Category:  ${s.category}`)
    console.log(`Chain:     ${s.chain_slugs?.length ? s.chain_slugs.join(' → ') : 'none'}`)
    console.log(`\nDescription:\n  ${s.description}\n`)
  })

skills
  .command('sync')
  .description('Trigger skill sync for all configured skill sources')
  .option('--source-id <id>', 'Sync only a specific source ID')
  .action(async (opts: { sourceId?: string }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    let ids: string[]
    if (opts.sourceId) {
      ids = [opts.sourceId]
    } else {
      const sourcesResult = await apiCall<Array<{ id: string; repo_slug: string }>>(
        `/v1/admin/skills/sources?project_id=${config.projectId}`, config,
      )
      if (!sourcesResult.ok) { console.error('Failed to list sources:', sourcesResult.error); process.exit(1) }
      ids = (sourcesResult.data ?? []).map((s) => s.id)
    }

    if (ids.length === 0) {
      console.log('No skill sources configured. Add one in the Skill Pipelines console page.')
      return
    }
    for (const id of ids) {
      console.log(`Syncing source ${id.slice(0, 8)}…`)
      const result = await apiCall<{ synced: number; skipped: number; errors: number }>(
        `/v1/admin/skills/sources/${id}/sync`, config, { method: 'POST' },
      )
      if (!result.ok) { console.error('  Sync failed:', result.error) }
      else console.log(`  Done: ${result.data?.synced ?? 0} synced, ${result.data?.skipped ?? 0} skipped, ${result.data?.errors ?? 0} errors`)
    }
    console.log()
  })

const pipeline = program.command('pipeline').description('Manage skill pipeline runs')

const consoleCmd = program.command('console').description('Live developer console for Mushi threads')

consoleCmd
  .command('watch <reportId>')
  .description('Watch unified report timeline (alias for mushi reports thread --watch)')
  .option('--json', 'NDJSON output for non-TTY')
  .action(async (reportId: string, opts: { json?: boolean }) => {
    const config = requireConfig()
    const fetchTimeline = async () => {
      const result = await apiCall<{ report_id: string; timeline: Array<{
        id: string; lane: string; at: string; title: string; body?: string; status?: string
      }> }>(`/v1/sync/reports/${reportId}/timeline`, config)
      if (!result.ok) die(result)
      return result.data
    }

    if (opts.json || !process.stdout.isTTY) {
      let lastLen = -1
      for (;;) {
        const data = await fetchTimeline()
        if (data.timeline.length !== lastLen) {
          console.log(JSON.stringify({ type: 'timeline', ...data }))
          lastLen = data.timeline.length
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
    }

    let lastLen = -1
    for (;;) {
      const data = await fetchTimeline()
      if (data.timeline.length !== lastLen) {
        console.clear()
        console.log(`Console · ${data.report_id}`)
        for (const e of data.timeline) {
          console.log(`${fmtDate(e.at)} [${e.lane}] ${e.title}`)
          if (e.body) console.log(`  ${e.body}`)
        }
        lastLen = data.timeline.length
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  })

pipeline
  .command('start <reportId>')
  .description('Start a skill pipeline for a report')
  .requiredOption('--skill <slug>', 'Root skill slug (e.g. workflow-fix-and-ship)')
  .option('--mode <mode>', 'Execution mode: handoff (default) or cloud', 'handoff')
  .option('--json', 'Machine-readable output')
  .action(async (reportId: string, opts: { skill: string; mode: string; json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<PipelineRunRow>(
      `/v1/admin/skills/pipelines`,
      config,
      {
        method: 'POST',
        body: JSON.stringify({
          project_id: config.projectId,
          root_skill_slug: opts.skill,
          report_id: reportId,
          mode: opts.mode,
        }),
      },
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const runId = result.data?.id ?? ''
    const chain = result.data?.chain_slugs ?? []
    console.log(`\nPipeline started!\n`)
    console.log(`  Run ID:  ${runId.slice(0, 8)}…  (full: ${runId})`)
    console.log(`  Skill:   ${opts.skill}`)
    console.log(`  Chain:   ${chain.length > 0 ? chain.join(' → ') : '(root only)'}`)
    console.log(`  Mode:    ${opts.mode}`)
    if (opts.mode === 'handoff') {
      console.log(`\n  Get context packet:  mushi pipeline watch ${runId.slice(0, 8)}`)
      console.log(`  Check in step 0:     mushi pipeline checkin ${runId.slice(0, 8)} --step 0 --status passed`)
    }
    console.log()
  })

pipeline
  .command('watch <runIdOrPrefix>')
  .description('Watch a pipeline run and print the context packet')
  .option('--json', 'Machine-readable output')
  .action(async (runIdOrPrefix: string, opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    // Resolve full ID from prefix if needed
    let runId = runIdOrPrefix
    if (runIdOrPrefix.length < 36) {
      const list = await apiCall<PipelineRunRow[]>(
        `/v1/admin/skills/pipelines?project_id=${config.projectId}&limit=50`, config,
      )
      if (!list.ok) { console.error('Failed:', list.error); process.exit(1) }
      const match = list.data.find((r) => r.id.startsWith(runIdOrPrefix))
      if (!match) { console.error('Run not found:', runIdOrPrefix); process.exit(1) }
      runId = match.id
    }
    const result = await apiCall<PipelineRunRow & { steps: StepRunRow[]; context_packet: string | null }>(
      `/v1/admin/skills/pipelines/${runId}`, config,
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const run = result.data!
    const statusIcon = run.status === 'completed' ? '✅' : run.status === 'failed' ? '❌' : run.status === 'running' ? '⏳' : '⚪'
    console.log(`\n${statusIcon}  Pipeline ${runId.slice(0, 8)} · ${run.root_skill_slug} · ${run.mode}\n`)
    const steps = run.steps ?? []
    for (const step of steps) {
      const icon = step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : step.status === 'running' ? '⏳' : '⚪'
      const pr = step.pr_url ? ` → ${step.pr_url}` : ''
      console.log(`  ${icon} Step ${step.step_index + 1}: ${step.skill_slug}${pr}`)
      if (step.notes) console.log(`        ${step.notes}`)
    }
    if (run.context_packet) {
      console.log(`\n${'─'.repeat(60)}`)
      console.log(`Context Packet (paste into your Cursor agent):\n`)
      console.log(run.context_packet.slice(0, 6000))
      if (run.context_packet.length > 6000) console.log('\n… [truncated — full packet via --json]')
    }
    console.log()
  })

pipeline
  .command('checkin <runIdOrPrefix>')
  .description('Check in a pipeline step (CLI agent reports status after completing a step)')
  .requiredOption('--step <n>', 'Step index (0-based)', parseInt)
  .requiredOption('--status <status>', 'Step status: passed | failed | running | skipped')
  .option('--notes <text>', 'Optional notes / output summary')
  .option('--pr-url <url>', 'PR URL opened during this step')
  .action(async (
    runIdOrPrefix: string,
    opts: { step: number; status: string; notes?: string; prUrl?: string },
  ) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    let runId = runIdOrPrefix
    if (runIdOrPrefix.length < 36) {
      const list = await apiCall<PipelineRunRow[]>(
        `/v1/admin/skills/pipelines?project_id=${config.projectId}&limit=50`, config,
      )
      if (!list.ok) { console.error('Failed:', list.error); process.exit(1) }
      const match = list.data.find((r) => r.id.startsWith(runIdOrPrefix))
      if (!match) { console.error('Run not found:', runIdOrPrefix); process.exit(1) }
      runId = match.id
    }
    const result = await apiCall(
      `/v1/admin/skills/pipelines/${runId}/steps/${opts.step}/checkin`,
      config,
      {
        method: 'POST',
        body: JSON.stringify({ status: opts.status, notes: opts.notes, pr_url: opts.prUrl }),
      },
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    console.log(`  Step ${opts.step} → ${opts.status}. Console live flow updated.`)
    console.log(`  Next: mushi pipeline watch ${runId.slice(0, 8)}`)
    console.log()
  })
}
