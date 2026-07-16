/**
 * Visible MCP setup guide — scopes, setup steps, tool catalog context.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import {
  MCP_EXPLAINER_SUMMARY,
  MCP_SCOPE_DEFINITIONS,
  MCP_SETUP_STEPS,
  isMcpGuideExpanded,
} from '../../lib/mcpExplainer'
import type { McpStats } from './types'

interface Props {
  topPriority?: McpStats['topPriority']
  toolCount?: number
}

export function McpConnectGuide({ topPriority, toolCount }: Props) {
  return (
    <FeatureExplainPanel
      title="What MCP does and how to connect your IDE"
      summary={MCP_EXPLAINER_SUMMARY}
      category="security"
      defaultOpen={isMcpGuideExpanded(topPriority)}
    >
      <div className="space-y-2">
        {MCP_SCOPE_DEFINITIONS.map((scope) => (
          <div key={scope.id} className="rounded-md border border-edge-subtle px-2.5 py-2 space-y-1">
            <p className="text-xs font-semibold text-fg font-mono">{scope.label}</p>
            <p className="text-2xs text-fg-muted">{scope.plain}</p>
            <p className="text-2xs text-fg-secondary">
              <span className="font-medium text-fg-muted">Can:</span>{' '}
              {scope.canDo.join(' · ')}
            </p>
            {scope.cannotDo.length > 0 && (
              <p className="text-2xs text-fg-faint">
                <span className="font-medium text-fg-muted">Cannot:</span>{' '}
                {scope.cannotDo.join(' · ')}
              </p>
            )}
          </div>
        ))}
      </div>
      <ol className="list-decimal pl-4 space-y-0.5 text-2xs text-fg-secondary">
        {MCP_SETUP_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {toolCount != null && toolCount > 0 && (
        <p className="text-2xs text-fg-faint">
          This project advertises {toolCount} MCP tools to connected agents. Browse them on the Catalog tab.
        </p>
      )}
      <p className="text-2xs text-fg-faint">
        Keys are minted per project on{' '}
        <Link to="/projects" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          Projects
        </Link>
        . report:write keys alone cannot expose MCP tools.
      </p>
    </FeatureExplainPanel>
  )
}
