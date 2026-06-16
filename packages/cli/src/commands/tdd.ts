import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { apiCall } from '../cli-shared.js';

export function registerTddCommands(program: Command): void {
// ─── Phase 4: TDD / Story CLI commands ───────────────────────────────────────

const stories = program.command('stories').description('TDD story mapping and test generation')

stories
  .command('map')
  .description('Crawl a live app URL and automatically discover user stories (writes inventory proposal)')
  .requiredOption('--url <url>', 'Live app URL to crawl (e.g. https://your-app.vercel.app)')
  .option('--max-pages <n>', 'Max pages to crawl', '20')
  .option('--provider <p>', 'Crawl provider: firecrawl (default) or browserbase', 'firecrawl')
  .option('--cursor-refine', 'Open a Cursor Cloud PR to refine the draft against repo code')
  .option('--wait', 'Wait for the crawl to complete and print results')
  .action(async (opts: { url: string; maxPages: string; provider: string; cursorRefine?: boolean; wait?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` and `mushi init` first'); process.exit(1) }

    const res = await apiCall<{ runId: string; status: string }>(
      `/v1/admin/inventory/${config.projectId}/map-from-live`,
      config,
      {
        method: 'POST',
        body: JSON.stringify({
          base_url: opts.url,
          max_pages: parseInt(opts.maxPages, 10),
          provider: opts.provider,
          cursor_cloud_refine: opts.cursorRefine ?? false,
        }),
      },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }

    console.log(`✓ Crawl started — run id: ${res.data.runId}`)
    console.log(`  Crawling ${opts.url} with ${opts.provider}…`)

    if (opts.wait) {
      console.log('  Polling for results…')
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const runsRes = await apiCall<{ runs: Array<{ id: string; status: string; pages_crawled: number | null; proposal_id: string | null; error_message: string | null }> }>(
          `/v1/admin/inventory/${config.projectId}/map-runs`,
          config,
        )
        if (!runsRes.ok) break
        const run = runsRes.data.runs.find(r => r.id === res.data.runId)
        if (!run) break
        if (run.status === 'completed') {
          console.log(`\n✓ Done! ${run.pages_crawled ?? 0} pages crawled.`)
          if (run.proposal_id) console.log(`  Proposal id: ${run.proposal_id}`)
          console.log(`  Review in the console: Inventory → Discovery → Past proposals`)
          break
        }
        if (run.status === 'failed') {
          console.error(`\n✗ Crawl failed: ${run.error_message ?? 'unknown'}`)
          process.exit(1)
        }
        process.stdout.write('.')
      }
    }
  })

const tdd = program.command('tdd').description('TDD test generation and management')

tdd
  .command('gen <storyId>')
  .description('Generate a Playwright TDD test from an inventory user story id')
  .option('--mode <m>', 'Gate mode: auto (run immediately) | review (needs approval) | approve (manual)', 'review')
  .option('--no-pr', 'Skip opening a GitHub PR')
  .action(async (storyId: string, opts: { mode: string; pr: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    console.log(`Generating TDD test for story: ${storyId}…`)
    const res = await apiCall<{ qaStoryId: string; prUrl: string | null; approvalStatus: string; needsHumanReview: boolean }>(
      `/v1/admin/inventory/${config.projectId}/stories/${storyId}/generate-test`,
      config,
      { method: 'POST', body: JSON.stringify({ automation_mode: opts.mode, open_pr: opts.pr }) },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }

    console.log(`✓ Test generated — qa_story id: ${res.data.qaStoryId}`)
    console.log(`  Approval status: ${res.data.approvalStatus}`)
    if (res.data.prUrl) console.log(`  PR: ${res.data.prUrl}`)
    if (res.data.needsHumanReview) console.log(`  ⚠ Human review recommended — some selectors or flows are uncertain.`)
  })

tdd
  .command('improve')
  .description('Run PDCA auto-improve on recently failed QA tests')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    console.log('Running PDCA QA story improver…')
    const res = await apiCall<{ improved: number }>(
      '/v1/admin/pdca/improve-qa-stories',
      config,
      { method: 'POST', body: JSON.stringify({ project_id: config.projectId }) },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    console.log(`✓ Improved ${res.data.improved} QA stories.`)
  })

tdd
  .command('run <qaStoryId>')
  .description('Trigger a manual run for a QA story')
  .action(async (qaStoryId: string) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const res = await apiCall<{ runId: string }>(
      `/v1/admin/projects/${config.projectId}/qa-stories/${qaStoryId}/run`,
      config,
      { method: 'POST' },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    console.log(`✓ Run queued — id: ${res.data.runId}`)
  })

tdd
  .command('pending')
  .description('List QA tests pending review')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const res = await apiCall<{ stories: Array<{ id: string; name: string; origin_story_node_id: string | null; generated_pr_url: string | null }> }>(
      `/v1/admin/inventory/${config.projectId}/stories/pending-review`,
      config,
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    if (res.data.stories.length === 0) { console.log('No stories pending review.'); return }
    console.log(`${res.data.stories.length} stories pending review:\n`)
    for (const s of res.data.stories) {
      console.log(`  ${s.id}  ${s.name}${s.origin_story_node_id ? ` (story: ${s.origin_story_node_id})` : ''}`)
      if (s.generated_pr_url) console.log(`     PR: ${s.generated_pr_url}`)
    }
    console.log(`\nApprove: mushi tdd approve <id>`)
  })

tdd
  .command('approve <qaStoryId>')
  .description('Approve a pending QA story (enables it in the schedule)')
  .option('--reject', 'Reject instead of approve')
  .action(async (qaStoryId: string, opts: { reject?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey || !config.projectId) { console.error('Run `mushi login` first'); process.exit(1) }

    const status = opts.reject ? 'rejected' : 'approved'
    const res = await apiCall<{ status: string }>(
      `/v1/admin/inventory/${config.projectId}/stories/${qaStoryId}/approval`,
      config,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    )
    if (!res.ok) { console.error(`Error: ${res.error.message}`); process.exit(1) }
    console.log(`✓ Story ${status}.`)
  })

}
