import { createClient } from '@supabase/supabase-js'
import type { FixContext, FixResult, FixAgent, ExpectedOutcome } from './types.js'
import { ClaudeCodeAgent } from './adapters/claude-code.js'
import { CodexAgent } from './adapters/codex.js'
import { GenericMCPAgent } from './adapters/generic-mcp.js'
import { RestFixWorkerAgent } from './adapters/rest-fix-worker.js'
import { McpFixAgent } from './adapters/mcp.js'
import { createPR } from './github.js'
import { validateAgainstSpec } from './review.js'
import { resolveSandboxProvider, buildSandboxConfig, type SandboxProviderName } from './sandbox/index.js'
import { SandboxAuditWriter, insertSandboxRun, updateSandboxRun } from './sandbox/persistence.js'

export interface OrchestratorConfig {
  supabaseUrl: string
  supabaseServiceKey: string
  githubToken?: string
  /** When true, the orchestrator provisions a managed sandbox per run (V5.3 §2.10, M6). */
  enableSandbox?: boolean
  /** Optional API key for the chosen sandbox provider; falls back to env. */
  sandboxApiKey?: string
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

    // Spec-traceability (whitepaper §2.10): recover the inventory anchor.
    // classify-report writes a `reports_against` edge from the report node
    // to the picked Action node when an inventory candidate matched. We
    // walk back through it here so every downstream surface (the LLM
    // prompt, validateResult, the post-PR probe) sees the contract the
    // user was actually trying to use.
    //
    // Soft failure: if no edge exists (legacy report, no inventory yet,
    // or LLM picked "none"), `inventoryAction` stays undefined and the
    // legacy fix path runs unchanged.
    const inventoryAction = await this.loadInventoryAnchor(report.project_id, reportId)

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
      inventoryAction,
      config: {
        maxLines: settings?.autofix_max_lines ?? 200,
        scopeRestriction: (settings?.autofix_scope_restriction ?? 'component') as FixContext['config']['scopeRestriction'],
        repoUrl,
      },
    }
  }

  /**
   * Walk: report → graph_nodes(node_type='report_group', label=reportId) →
   * graph_edges(edge_type='reports_against') → graph_nodes(node_type='action').
   *
   * Then enrich with the page (via incoming `contains` edge) and the
   * user_story (via outgoing `implements` edge) so the prompt can show
   * the full context without forcing the agent to re-traverse.
   *
   * Returns undefined on any miss — never throws. The fix path MUST run
   * even when the graph is partial (e.g. Stage 2 hasn't classified yet).
   */
  private async loadInventoryAnchor(
    projectId: string,
    reportId: string,
  ): Promise<FixContext['inventoryAction']> {
    try {
      const { data: reportNode } = await this.db
        .from('graph_nodes')
        .select('id')
        .eq('project_id', projectId)
        .eq('node_type', 'report_group')
        .eq('label', reportId)
        .maybeSingle()
      if (!reportNode) return undefined

      const { data: edge } = await this.db
        .from('graph_edges')
        .select('to_node_id')
        .eq('project_id', projectId)
        .eq('from_node_id', reportNode.id)
        .eq('edge_type', 'reports_against')
        .limit(1)
        .maybeSingle()
      if (!edge?.to_node_id) return undefined

      const { data: action } = await this.db
        .from('graph_nodes')
        .select('id, label, metadata')
        .eq('id', edge.to_node_id)
        .eq('node_type', 'action')
        .maybeSingle()
      if (!action) return undefined

      const meta = (action.metadata as Record<string, unknown> | null) ?? {}
      const expectedOutcome = (meta.expected_outcome as ExpectedOutcome | null) ?? undefined

      // Page is the parent of the action's element (page → contains →
      // element → triggers → action). One join is enough — we don't need
      // the element node itself for the prompt.
      let pagePath: string | undefined
      let pageId: string | undefined
      const { data: triggerEdge } = await this.db
        .from('graph_edges')
        .select('from_node_id')
        .eq('project_id', projectId)
        .eq('to_node_id', action.id)
        .eq('edge_type', 'triggers')
        .limit(1)
        .maybeSingle()
      if (triggerEdge?.from_node_id) {
        const { data: containsEdge } = await this.db
          .from('graph_edges')
          .select('from_node_id')
          .eq('project_id', projectId)
          .eq('to_node_id', triggerEdge.from_node_id)
          .eq('edge_type', 'contains')
          .limit(1)
          .maybeSingle()
        if (containsEdge?.from_node_id) {
          const { data: pageNode } = await this.db
            .from('graph_nodes')
            .select('metadata')
            .eq('id', containsEdge.from_node_id)
            .eq('node_type', 'page_v2')
            .maybeSingle()
          const pm = (pageNode?.metadata as Record<string, unknown> | null) ?? {}
          pagePath = typeof pm.path === 'string' ? pm.path : undefined
          pageId = typeof pm.page_id === 'string' ? pm.page_id : undefined
        }
      }

      // Story is the implements target.
      let storyId: string | undefined
      let storyTitle: string | undefined
      const { data: implementsEdge } = await this.db
        .from('graph_edges')
        .select('to_node_id')
        .eq('project_id', projectId)
        .eq('from_node_id', action.id)
        .eq('edge_type', 'implements')
        .limit(1)
        .maybeSingle()
      if (implementsEdge?.to_node_id) {
        const { data: storyNode } = await this.db
          .from('graph_nodes')
          .select('label, metadata')
          .eq('id', implementsEdge.to_node_id)
          .eq('node_type', 'user_story')
          .maybeSingle()
        if (storyNode) {
          storyId = (storyNode.label as string | null) ?? undefined
          const sm = (storyNode.metadata as Record<string, unknown> | null) ?? {}
          storyTitle = typeof sm.title === 'string' ? sm.title : undefined
        }
      }

      return {
        actionNodeId: action.id as string,
        actionLabel: action.label as string,
        actionDescription: typeof meta.action === 'string' ? meta.action : undefined,
        pagePath,
        pageId,
        storyId,
        storyTitle,
        expectedOutcome,
      }
    } catch {
      // Hard fail-open: never block the fix loop on a graph traversal error.
      return undefined
    }
  }

  selectAgent(agentName: string, mcpServerUrl?: string, bearer?: string): FixAgent {
    switch (agentName) {
      case 'codex': return new CodexAgent()
      case 'mcp': {
        if (!mcpServerUrl) {
          throw new Error(
            'mcp agent requires autofix_mcp_server_url in project_settings. ' +
            'Set it to the URL of your MCP-compliant fix server (JSON-RPC 2.0 + tools/call).',
          )
        }
        return new McpFixAgent({ serverUrl: mcpServerUrl, bearer })
      }
      case 'rest_fix_worker': {
        if (!mcpServerUrl) {
          throw new Error(
            'rest_fix_worker agent requires autofix_mcp_server_url in project_settings. ' +
            'Set it to the URL of your REST fix worker (e.g., http://localhost:3100).',
          )
        }
        return new RestFixWorkerAgent(mcpServerUrl, { bearer })
      }
      // Legacy alias — generic_mcp was a misnomer; route to the REST worker.
      case 'generic_mcp': {
        if (!mcpServerUrl) {
          throw new Error(
            'generic_mcp (deprecated, use rest_fix_worker) requires autofix_mcp_server_url.',
          )
        }
        return new GenericMCPAgent(mcpServerUrl, { bearer })
      }
      default: return new ClaudeCodeAgent()
    }
  }

  async run(reportId: string): Promise<{ fixId: string; result: FixResult; prUrl?: string }> {
    const context = await this.assembleContext(reportId)
    return this.runWithContext(context)
  }

  /**
   * Wave S5: run with a pre-assembled context, so multi-repo coordinators
   * can override `config.repoUrl` and narrow `relevantCode` per task. The
   * optional `coordination` metadata is stamped on the created fix_attempt
   * row so downstream tooling (PR cross-linking, rollup status) can find
   * siblings without a second round-trip.
   */
  async runWithContext(
    context: FixContext,
    coordination?: { coordinationId?: string; repoId?: string; repoRole?: string },
  ): Promise<{ fixId: string; result: FixResult; prUrl?: string }> {
    const reportId = context.reportId

    const { data: fix } = await this.db.from('fix_attempts').insert({
      report_id: reportId,
      project_id: context.projectId,
      agent: 'claude_code',
      status: 'running',
      coordination_id: coordination?.coordinationId ?? null,
      repo_id: coordination?.repoId ?? null,
      repo_role: coordination?.repoRole ?? null,
      // Spec-traceability: stamp the inventory anchor on the attempt row
      // so the admin "Fixes for this Action" query stays a single index
      // hit instead of a graph walk per page render.
      inventory_action_node_id: context.inventoryAction?.actionNodeId ?? null,
    }).select('id').single()

    const fixId = fix!.id

    let sandboxRunId: string | undefined
    let auditWriter: SandboxAuditWriter | undefined
    let sandbox: Awaited<ReturnType<ReturnType<typeof resolveSandboxProvider>['createSandbox']>> | undefined

    try {
      const { data: settings } = await this.db
        .from('project_settings')
        .select('autofix_agent, autofix_mcp_server_url, autofix_mcp_bearer, sandbox_provider, sandbox_image, sandbox_extra_allowed_hosts')
        .eq('project_id', context.projectId)
        .single()

      // V5.3 §2.10 (M6): provision managed sandbox if configured.
      // The agent does not directly receive the sandbox in this milestone —
      // adapter wiring lands in M6+ — but the provisioning + audit log is
      // active so policy violations and timeouts are recorded from day one.
      if (this.config.enableSandbox && settings?.sandbox_provider) {
        const providerName = settings.sandbox_provider as SandboxProviderName
        const sbxConfig = buildSandboxConfig(context, {
          image: settings.sandbox_image,
          extraAllowedHosts: settings.sandbox_extra_allowed_hosts ?? [],
          gitToken: this.config.githubToken,
        })
        sandboxRunId = await insertSandboxRun(this.db, {
          projectId: context.projectId,
          fixAttemptId: fixId,
          reportId,
          provider: providerName,
          config: sbxConfig,
        })
        auditWriter = new SandboxAuditWriter(this.db, sandboxRunId, context.projectId)
        const provider = resolveSandboxProvider({ name: providerName, apiKey: this.config.sandboxApiKey })
        sandbox = await provider.createSandbox(sbxConfig, e => auditWriter!.push(e))
        await updateSandboxRun(this.db, sandboxRunId, {
          status: 'running',
          providerSandboxId: sandbox.id,
        })
      }

      const agent = this.selectAgent(
        settings?.autofix_agent ?? 'claude_code',
        settings?.autofix_mcp_server_url,
        settings?.autofix_mcp_bearer,
      )
      const result = await agent.generateFix(context)

      // M5 (V5.3 §2.10): MUST validate scope/circuit-breaker before any push.
      // The previous code path could fall through to createPR even when an
      // agent produced an over-scope diff. validateResult is the single
      // gating point.
      if (result.success && typeof agent.validateResult === 'function') {
        const validation = agent.validateResult(context, result)
        if (!validation.valid) {
          result.success = false
          result.error = `Scope/circuit-breaker violation: ${validation.errors.join('; ')}`
        }
      }

      // Spec-traceability gate (whitepaper §2.10). Runs AFTER the agent's
      // own validateResult so the cheap circuit-breaker checks (line count,
      // scope) still fail fast — but BEFORE we open a PR, so the synthetic
      // monitor never has to mark a freshly-shipped fix as `regressed` for
      // a reason the deterministic check could have caught at dispatch time.
      //
      // No-op when the report has no inventory anchor; soft warnings are
      // logged but not enforced.
      if (result.success && context.inventoryAction) {
        const specCheck = validateAgainstSpec(context, result)
        if (!specCheck.valid) {
          result.success = false
          result.error = `Spec contract violation: ${specCheck.errors.join('; ')}`
        }
        if (specCheck.warnings.length > 0) {
          await this.db
            .from('fix_attempts')
            .update({
              spec_validation_warnings: specCheck.warnings,
            })
            .eq('id', fixId)
            .then(
              () => undefined,
              () => undefined,
            )
        }
      }

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

        // Spec-traceability: enqueue a targeted post-PR synthetic probe
        // against the action this fix was meant to repair. We write a
        // marker row with status='skipped' so the synthetic-monitor cron
        // picks it up on the next tick and re-runs the full assertion
        // chain against the inventory's expected_outcome contract.
        // Best-effort: a missing column / RLS rejection here MUST NOT
        // fail the fix path.
        if (context.inventoryAction?.actionNodeId) {
          await this.db
            .from('synthetic_runs')
            .insert({
              project_id: context.projectId,
              action_node_id: context.inventoryAction.actionNodeId,
              status: 'skipped',
              error_message: 'queued_post_pr',
              step_results: {
                trigger: 'post_pr',
                fix_attempt_id: fixId,
                report_id: reportId,
                pr_url: prUrl,
                queued_at: new Date().toISOString(),
              },
            })
            .then(
              () => undefined,
              () => undefined,
            )
        }
      }

      if (sandboxRunId) {
        await updateSandboxRun(this.db, sandboxRunId, {
          status: result.success ? 'completed' : 'failed',
          finishedAt: new Date().toISOString(),
          error: result.error,
        })
      }

      return { fixId, result, prUrl }
    } catch (err) {
      await this.db.from('fix_attempts').update({
        status: 'error',
        error: String(err),
        completed_at: new Date().toISOString(),
      }).eq('id', fixId)

      if (sandboxRunId) {
        await updateSandboxRun(this.db, sandboxRunId, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: String(err).slice(0, 500),
        })
      }

      throw err
    } finally {
      if (sandbox) {
        try { await sandbox.destroy() } catch { /* tolerate */ }
      }
      if (auditWriter) {
        try { await auditWriter.flush() } catch { /* tolerate */ }
      }
    }
  }
}
