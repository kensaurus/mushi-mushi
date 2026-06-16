import { Link } from 'react-router-dom'
import { Btn, Card } from '../ui'
import type { CodebaseUnderstandError } from './exploreUnderstandTypes'

interface Props {
  error: CodebaseUnderstandError
  onRetry?: () => void
}

export function ExploreUnderstandEmpty({ error, onRetry }: Props) {
  const isIndex = error.code === 'INDEX_DISABLED'
  const isKey = error.code === 'NO_LLM_KEY'

  return (
    <Card className="p-4 space-y-3 border-dashed">
      <p className="text-sm font-medium text-fg">
        {isIndex
          ? 'Codebase not indexed yet'
          : isKey
            ? 'Add an LLM key to use this feature'
            : 'Could not load'}
      </p>
      <p className="text-xs text-fg-muted">{error.message}</p>
      <div className="flex flex-wrap gap-2">
        {isIndex && (
          <>
            <Link to="/connect">
              <Btn size="sm" variant="primary">
                Connect &amp; enable index
              </Btn>
            </Link>
            <Link to="/settings">
              <Btn size="sm" variant="ghost">
                Indexing settings
              </Btn>
            </Link>
          </>
        )}
        {isKey && (
          <Link to="/settings#byok">
            <Btn size="sm" variant="primary">
              Settings → API Keys
            </Btn>
          </Link>
        )}
        {onRetry && (
          <Btn size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Btn>
        )}
      </div>
    </Card>
  )
}
