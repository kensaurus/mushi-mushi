import type { FixContext } from './types.js'

export interface SandboxSpec {
  runtime: string
  network: {
    allowed: string[]
    blocked: string
  }
  resources: {
    cpu: string
    memory: string
    timeout: string
    disk: string
  }
  credentials: {
    git: string
    secrets: string
  }
  filesystem: {
    writable: string[]
    readable: string[]
    blocked: string[]
  }
  audit: {
    logAllCommands: boolean
    logNetworkRequests: boolean
    logFileAccess: boolean
  }
}

export function buildSandboxSpec(context: FixContext): SandboxSpec {
  return {
    runtime: 'gVisor (runsc)',
    network: {
      allowed: [
        context.config.repoUrl,
        'registry.npmjs.org',
      ],
      blocked: '*',
    },
    resources: {
      cpu: '2 cores',
      memory: '4GB max',
      timeout: '10 minutes',
      disk: '10GB (tmpfs, destroyed after)',
    },
    credentials: {
      git: `deploy key (read repo, write to mushi/fix-* branches only)`,
      secrets: 'none',
    },
    filesystem: {
      writable: ['/workspace'],
      readable: ['/workspace'],
      blocked: ['/etc', '/proc', '/sys', '/home'],
    },
    audit: {
      logAllCommands: true,
      logNetworkRequests: true,
      logFileAccess: true,
    },
  }
}

export function buildContextJson(context: FixContext): string {
  return JSON.stringify({
    reportId: context.reportId,
    projectId: context.projectId,
    report: context.report,
    reproductionSteps: context.reproductionSteps,
    relevantCode: context.relevantCode.map(f => ({
      path: f.path,
      content: f.content.slice(0, 3000),
    })),
    graphContext: context.graphContext,
    constraints: {
      maxLines: context.config.maxLines,
      scopeRestriction: context.config.scopeRestriction,
      componentDir: context.report.component,
    },
  }, null, 2)
}
