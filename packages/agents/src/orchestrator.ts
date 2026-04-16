import { createClient } from '@supabase/supabase-js'
import type { FixContext, FixResult, FixAgent } from './types.js'
import { ClaudeCodeAgent } from './adapters/claude-code.js'
import { CodexAgent } from './adapters/codex.js'
import { GenericMCPAgent } from './adapters/generic-mcp.js'
import { createPR } from './github.js'

export interface OrchestratorConfig {
  supabaseUrl: string
  supabaseServiceKey: string
  githubToken?: string
}

export class FixOrchestrator {
  private db
  private config: OrchestratorConfig

  constructor(config: OrchestratorConfig) {
    this.config = config
    this.db = createClient(config.supabaseUrl, config.supabaseServiceKey)
  }

  async assembleContext(reportId: string): Promise<FixContext> {
    const { data: report } = await this.db
      .from('reports')
      .select('*, projects:project_id(id, name)')
      .eq('id', reportId)
      .single()

    if (!report) throw new Error(`Report ${reportId} not found`)

    const { data: settings } = await this.db
      .from('project_settings')
      .select('autofix_agent, autofix_max_lines, autofix_scope_restriction, codebase_repo_url, github_repo_url')
      .eq('project_id', report.project_id)
      .single()

    // Get relevant code files via RAG
    const relevantCode: FixContext['relevantCode'] = []
    if (report.component) {
      const { data: files } = await this.db
        .from('project_codebase_files')
        .select('file_path, content_preview, component_tag')
        .eq('project_id', report.project_id)
        .eq('component_tag', report.component)
        .limit(5)

      for (const f of files ?? []) {
        relevantCode.push({
          path: f.file_path,
          content: f.content_preview ?? '',
          componentTag: f.component_tag,
        })
      }
    }

    // Get graph context
    let graphContext: FixContext['graphContext'] = undefined
    const { data: groupNode } = await this.db
      .from('graph_nodes')
      .select('id')
      .eq('project_id', report.project_id)
      .eq('node_type', 'report_group')
      .eq('label', report.report_group_id ?? '')
      .single()

    if (groupNode) {
      const { data: blastData } = await this.db.rpc('get_blast_radius', { p_node_id: groupNode.id })
      graphContext = {
        relatedBugs: [],
        blastRadius: (blastData ?? []).map((n: Record<string, unknown>) => ({
          nodeType: n.node_type as string,
          label: n.label as string,
        })),
      }
    }

    const repoUrl = settings?.github_repo_url ?? settings?.codebase_repo_url ?? ''

    return {
      reportId,
      projectId: report.project_id,
      report: {
        description: report.description,
        category: report.category,
        severity: report.severity,
        summary: report.summary,
        component: report.component,
        rootCause: report.stage2_analysis?.rootCause,
        bugOntologyTags: report.bug_ontology_tags,
      },
      reproductionSteps: report.reproduction_steps ?? [],
      relevantCode,
      graphContext,
      config: {
        maxLines: settings?.autofix_max_lines ?? 200,
        scopeRestriction: (settings?.autofix_scope_restriction ?? 'component') as FixContext['config']['scopeRestriction'],
        repoUrl,
      },
    }
  }

  selectAgent(agentName: string): FixAgent {
    switch (agentName) {
      case 'codex': return new CodexAgent()
      case 'generic_mcp': return new GenericMCPAgent('')
      default: return new ClaudeCodeAgent()
    }
  }

  async run(reportId: string): Promise<{ fixId: string; result: FixResult; prUrl?: string }> {
    const context = await this.assembleContext(reportId)

    const { data: fix } = await this.db.from('fix_attempts').insert({
      report_id: reportId,
      project_id: context.projectId,
      agent: 'claude_code',
      status: 'running',
    }).select('id').single()

    const fixId = fix!.id

    try {
      const { data: settings } = await this.db
        .from('project_settings')
        .select('autofix_agent')
        .eq('project_id', context.projectId)
        .single()

      const agent = this.selectAgent(settings?.autofix_agent ?? 'claude_code')
      const result = await agent.generateFix(context)

      let prUrl: string | undefined
      if (result.success && this.config.githubToken && context.config.repoUrl) {
        const [owner, repo] = context.config.repoUrl.replace(/\.git$/, '').split('/').slice(-2)
        if (owner && repo) {
          prUrl = await createPR(
            { githubToken: this.config.githubToken, owner, repo },
            context,
            result,
          )
          result.prUrl = prUrl
        }
      }

      await this.db.from('fix_attempts').update({
        status: result.success ? 'completed' : 'failed',
        branch: result.branch,
        pr_url: prUrl,
        files_changed: result.filesChanged,
        lines_changed: result.linesChanged,
        summary: result.summary,
        error: result.error,
        completed_at: new Date().toISOString(),
      }).eq('id', fixId)

      if (result.success && prUrl) {
        await this.db.from('reports').update({
          fix_branch: result.branch,
          fix_pr_url: prUrl,
        }).eq('id', reportId)
      }

      return { fixId, result, prUrl }
    } catch (err) {
      await this.db.from('fix_attempts').update({
        status: 'error',
        error: String(err),
        completed_at: new Date().toISOString(),
      }).eq('id', fixId)

      throw err
    }
  }
}
