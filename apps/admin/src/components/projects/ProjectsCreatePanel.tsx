/**
 * New-project tab body for Projects hub.
 */

import { Btn, ErrorAlert, Input, Section } from '../ui'
import { ContainedBlock } from '../report-detail/ReportSurface'
import {
  ProjectCreatedSuccessPanel,
  type CreatedProjectInfo,
} from '../ProjectCreatedSuccessPanel'
import type { OrgRole } from './project-models'

interface CreateError {
  message: string
  code?: string
}

export interface ProjectsCreatePanelProps {
  createdProject: CreatedProjectInfo | null
  onDismissCreated: () => void
  orgDataLoaded: boolean
  canManageProjects: boolean
  activeOrgRole: OrgRole
  onNavigateTeam: () => void
  newName: string
  onNewNameChange: (value: string) => void
  creating: boolean
  createError: CreateError | null
  onCreate: () => void
  onRetryCreate: () => void
  onClearCreateError: () => void
}

export function ProjectsCreatePanel({
  createdProject,
  onDismissCreated,
  orgDataLoaded,
  canManageProjects,
  activeOrgRole,
  onNavigateTeam,
  newName,
  onNewNameChange,
  creating,
  createError,
  onCreate,
  onRetryCreate,
  onClearCreateError,
}: ProjectsCreatePanelProps) {
  return (
    <Section title="Create a project">
      {createdProject ? (
        <ProjectCreatedSuccessPanel project={createdProject} onDismiss={onDismissCreated} />
      ) : (
        <>
          <ContainedBlock tone="muted" className="mb-3">
            <p className="text-2xs leading-relaxed text-fg-muted">
              One project per app or environment — your API key and setup command appear on the next screen.
            </p>
          </ContainedBlock>
          {orgDataLoaded && !canManageProjects && (
            <ContainedBlock tone="warn" className="mb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-warning-foreground">
                    {activeOrgRole === 'member' || activeOrgRole === 'viewer'
                      ? 'Owner or admin access required'
                      : 'No team found'}
                  </p>
                  <p className="mt-0.5 text-2xs text-fg-muted">
                    {activeOrgRole === 'member' || activeOrgRole === 'viewer'
                      ? 'Ask your team owner or admin to create projects, or create your own team.'
                      : 'You need to be part of a team to create projects. Create a personal workspace first.'}
                  </p>
                </div>
                <Btn size="sm" variant="ghost" onClick={onNavigateTeam}>
                  {activeOrgRole ? 'Team settings' : 'Create team'}
                </Btn>
              </div>
            </ContainedBlock>
          )}
          <div className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  label="Project name"
                  helpId="projects.create_project"
                  type="text"
                  placeholder="New project name (e.g. Acme iOS app)"
                  value={newName}
                  onChange={(e) => {
                    onNewNameChange(e.target.value)
                    if (createError) onClearCreateError()
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    if (!creating && newName.trim() && (!orgDataLoaded || canManageProjects)) {
                      void onCreate()
                    }
                  }}
                  aria-invalid={createError ? true : undefined}
                  aria-describedby={createError ? 'projects-create-error' : undefined}
                />
              </div>
              <Btn
                onClick={onCreate}
                disabled={creating || !newName.trim() || (orgDataLoaded && !canManageProjects)}
                loading={!orgDataLoaded && !creating}
                title={
                  orgDataLoaded && !canManageProjects
                    ? 'Only owners or admins can create projects — ask your team admin'
                    : !newName.trim()
                      ? 'Enter a project name to continue'
                      : undefined
                }
              >
                {creating ? 'Creating...' : 'Create project'}
              </Btn>
            </div>
            {createError && (
              <div id="projects-create-error">
                <ErrorAlert
                  title={
                    createError.code === 'NO_ORGANIZATION'
                      ? 'No writable team found'
                      : createError.code === 'FORBIDDEN'
                        ? 'Not allowed in this team'
                        : createError.code === 'NETWORK_ERROR'
                          ? 'Couldn\u2019t reach the server'
                          : 'Couldn\u2019t create project'
                  }
                  message={createError.message}
                  code={createError.code}
                  actions={(() => {
                    if (createError.code === 'NO_ORGANIZATION') {
                      return [
                        { label: 'Open team settings', onClick: onNavigateTeam },
                        { label: 'Dismiss', onClick: onClearCreateError },
                      ]
                    }
                    if (createError.code === 'FORBIDDEN') {
                      return [
                        { label: 'Switch team', onClick: onNavigateTeam },
                        { label: 'Dismiss', onClick: onClearCreateError },
                      ]
                    }
                    if (createError.code === 'NETWORK_ERROR') {
                      return [
                        { label: 'Try again', onClick: onRetryCreate },
                        { label: 'Dismiss', onClick: onClearCreateError },
                      ]
                    }
                    return [{ label: 'Dismiss', onClick: onClearCreateError }]
                  })()}
                />
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  )
}
