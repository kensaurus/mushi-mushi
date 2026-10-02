import { Btn, Card } from '../ui'
import type { CodebaseUnderstandError } from './exploreUnderstandTypes'

interface Props {
  error: CodebaseUnderstandError
  onRetry?: () => void
}

export function ExploreUnderstandEmpty({ error, onRetry }: Props) {
  const isIndex = error.code === 'INDEX_DISABLED'
  const isKey = error.code === 'NO_LLM_KEY'
  const isForbidden = error.code === 'FORBIDDEN'

  return (
    <Card className="p-4 space-y-3 border-dashed">
      <p className="text-sm font-medium text-fg">
        {isForbidden
          ? 'No access to this project'
          : isIndex
            ? 'Codebase not indexed yet'
            : isKey
              ? 'Add an LLM key to use this feature'
              : 'Could not load'}
      </p>
      <p className="text-xs text-fg-muted">
        {isForbidden
          ? 'Your account is not a member of this project. Pick a different project from the top bar or ask an admin for access.'
          : error.message}
      </p>
      <div className="flex flex-wrap gap-2">
        {isForbidden && (
          <Btn to="/projects" size="sm" variant="primary">
              Switch project
            </Btn>
        )}
        {isIndex && (
          <>
            <Btn to="/connect" size="sm" variant="primary">
                Connect &amp; enable index
              </Btn>
            <Btn to="/settings" size="sm" variant="ghost">
                Indexing settings
              </Btn>
          </>
        )}
        {isKey && (
          <Btn to="/settings?tab=byok" size="sm" variant="primary">
              Settings → API Keys
            </Btn>
        )}
        {onRetry && !isForbidden && (
          <Btn size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Btn>
        )}
      </div>
    </Card>
  )
}
