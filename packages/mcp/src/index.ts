import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLogger } from '@mushi-mushi/core';

const log = createLogger({ scope: 'mushi:mcp', level: 'info' });

const API_ENDPOINT = process.env.MUSHI_API_ENDPOINT ?? 'https://api.mushimushi.dev';
const API_KEY = process.env.MUSHI_API_KEY ?? '';
const PROJECT_ID = process.env.MUSHI_PROJECT_ID ?? '';

async function apiCall(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_ENDPOINT}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': API_KEY,
      'X-Mushi-Project': PROJECT_ID,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Mushi API error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const server = new McpServer({
  name: 'mushi-mushi',
  version: '0.0.1',
});

// --- Tools ---

server.tool(
  'get_recent_reports',
  'List recent bug reports with optional filters',
  {
    status: z.string().optional().describe('Filter by status: new, classified, grouped, fixing, fixed, dismissed'),
    category: z.string().optional().describe('Filter by category: bug, slow, visual, confusing, other'),
    severity: z.string().optional().describe('Filter by severity: critical, high, medium, low'),
    limit: z.number().optional().describe('Max reports to return (default 20, max 100)'),
  },
  async (args) => {
    const params = new URLSearchParams();
    if (args.status) params.set('status', args.status);
    if (args.category) params.set('category', args.category);
    if (args.severity) params.set('severity', args.severity);
    params.set('limit', String(args.limit ?? 20));

    const data = await apiCall(`/v1/admin/reports?${params}`) as { ok: boolean; data: { reports: unknown[]; total: number } };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data.data, null, 2) }],
    };
  },
);

server.tool(
  'get_report_detail',
  'Get full details for a single bug report including classification, logs, and environment',
  {
    reportId: z.string().describe('The report UUID'),
  },
  async (args) => {
    const data = await apiCall(`/v1/admin/reports/${args.reportId}`) as { ok: boolean; data: unknown };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data.data, null, 2) }],
    };
  },
);

server.tool(
  'search_reports',
  'Search reports by keyword in description or summary',
  {
    query: z.string().describe('Search query text'),
    limit: z.number().optional().describe('Max results (default 10)'),
  },
  async (args) => {
    const data = await apiCall(`/v1/admin/reports?limit=${args.limit ?? 10}`) as { ok: boolean; data: { reports: Array<{ description?: string; summary?: string; [key: string]: unknown }> } };

    const q = args.query.toLowerCase();
    const filtered = data.data.reports.filter((r) => {
      const desc = (r.description ?? '').toLowerCase();
      const summary = (r.summary ?? '').toLowerCase();
      return desc.includes(q) || summary.includes(q);
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ results: filtered, total: filtered.length }, null, 2) }],
    };
  },
);

// --- Phase 2+3 Tools ---

server.tool(
  'get_fix_context',
  'Get all context an agent needs to fix a bug: report, classification, repro steps, relevant code, graph context',
  {
    reportId: z.string().describe('The report UUID to fix'),
  },
  async (args) => {
    const report = await apiCall(`/v1/admin/reports/${args.reportId}`) as { ok: boolean; data: Record<string, unknown> };
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          report: report.data,
          reproductionSteps: (report.data as Record<string, unknown>).reproduction_steps ?? [],
          component: (report.data as Record<string, unknown>).component,
          rootCause: ((report.data as Record<string, unknown>).stage2_analysis as Record<string, unknown>)?.rootCause,
          bugOntologyTags: (report.data as Record<string, unknown>).bug_ontology_tags,
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'submit_fix_result',
  'Agent reports fix outcome — branch, PR URL, files changed',
  {
    reportId: z.string().describe('The report UUID'),
    branch: z.string().describe('Git branch name'),
    prUrl: z.string().optional().describe('GitHub PR URL'),
    filesChanged: z.array(z.string()).describe('Files modified'),
    linesChanged: z.number().describe('Total lines changed'),
    summary: z.string().describe('Fix summary'),
  },
  async (args) => {
    const data = await apiCall('/v1/admin/fixes', {
      method: 'POST',
      body: JSON.stringify({ reportId: args.reportId, agent: 'mcp' }),
    }) as { ok: boolean; data: { fixId: string } };

    await apiCall(`/v1/admin/fixes/${data.data.fixId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'completed',
        branch: args.branch,
        pr_url: args.prUrl,
        files_changed: args.filesChanged,
        lines_changed: args.linesChanged,
        summary: args.summary,
        completed_at: new Date().toISOString(),
      }),
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, fixId: data.data.fixId }) }],
    };
  },
);

server.tool(
  'get_similar_bugs',
  'Find related bugs via knowledge graph or keyword search',
  {
    query: z.string().describe('Component name, page, or bug description'),
    limit: z.number().optional().describe('Max results (default 5)'),
  },
  async (args) => {
    const data = await apiCall(`/v1/admin/reports?limit=${args.limit ?? 5}`) as { ok: boolean; data: { reports: Array<Record<string, unknown>> } };

    const q = args.query.toLowerCase();
    const similar = data.data.reports.filter((r) => {
      const text = `${r.summary ?? ''} ${r.component ?? ''} ${r.description ?? ''}`.toLowerCase();
      return text.includes(q);
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ similar, total: similar.length }, null, 2) }],
    };
  },
);

server.tool(
  'get_blast_radius',
  'Graph traversal showing affected areas for a given bug group',
  {
    nodeId: z.string().describe('Graph node UUID'),
  },
  async (args) => {
    const data = await apiCall(`/v1/admin/graph/blast-radius/${args.nodeId}`) as { ok: boolean; data: unknown };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data.data, null, 2) }],
    };
  },
);

// --- Resources ---

server.resource(
  'project_stats',
  'project://stats',
  { description: 'Report counts, category breakdown, severity distribution' },
  async () => {
    const data = await apiCall('/v1/admin/stats') as { ok: boolean; data: unknown };
    return {
      contents: [{ uri: 'project://stats', mimeType: 'application/json', text: JSON.stringify(data.data, null, 2) }],
    };
  },
);

// --- Start ---

async function main() {
  if (!API_KEY) {
    log.fatal('MUSHI_API_KEY environment variable is required');
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  log.fatal('MCP server crashed', { err: String(err) });
  process.exit(1);
});
