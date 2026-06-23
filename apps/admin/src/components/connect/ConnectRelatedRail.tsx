/**
 * FILE: apps/admin/src/components/connect/ConnectRelatedRail.tsx
 * PURPOSE: "Related" link row on Connect — surfaces MCP, Integrations, and
 *          Skills without forcing users to discover them under Act.
 */

import { Link } from 'react-router-dom'
import { Section, Btn } from '../ui'
import { IconArrowRight, IconIntegrations, IconMcp, IconSkills } from '../icons'

interface Props {
  projectId?: string | null
}

export function ConnectRelatedRail({ projectId }: Props) {
  const projectQuery = projectId ? `?project=${projectId}` : ''

  return (
    <Section title="Related agent surfaces">
      <p className="mb-3 text-xs text-fg-muted">
        Same intent, different lanes — wire agents here after GitHub + SDK are connected.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link to={`/mcp${projectQuery}`}>
          <Btn size="sm" variant="ghost" className="gap-1.5">
            <IconMcp className="h-3.5 w-3.5" aria-hidden />
            MCP
            <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Btn>
        </Link>
        <Link to="/integrations/config">
          <Btn size="sm" variant="ghost" className="gap-1.5">
            <IconIntegrations className="h-3.5 w-3.5" aria-hidden />
            Integrations
            <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Btn>
        </Link>
        <Link to={`/skills${projectQuery}`}>
          <Btn size="sm" variant="ghost" className="gap-1.5">
            <IconSkills className="h-3.5 w-3.5" aria-hidden />
            Skill Pipelines
            <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Btn>
        </Link>
      </div>
    </Section>
  )
}
