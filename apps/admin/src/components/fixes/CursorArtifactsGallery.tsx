/**
 * FILE: apps/admin/src/components/fixes/CursorArtifactsGallery.tsx
 * PURPOSE: Renders fix_attempts.cursor_artifacts — screenshots, videos, and
 *          log files produced by a Cursor Cloud Agent run.
 *
 * Uses the same evidence-card pattern as StoryEvidenceCard.tsx.
 *
 * NOTE: cursor_artifacts.path values are Cursor-reported paths, not
 * browser-fetchable URLs. They are displayed as read-only labels only.
 * If the platform later exposes a signed-URL endpoint, thread it through
 * a `url` field on the Artifact shape and use that for href/src.
 */

interface Artifact {
  kind: 'screenshot' | 'video' | 'log' | 'file';
  path: string;
  mime: string;
  /** Signed CDN/storage URL for this artifact, if available. */
  url?: string;
}

interface Props {
  artifacts: Artifact[];
}

/** Mutually exclusive bucket — MIME wins over kind when they disagree. */
function artifactBucket(a: Artifact): 'screenshot' | 'video' | 'log' | 'file' {
  if (a.mime.startsWith('image/') || a.kind === 'screenshot') return 'screenshot';
  if (a.mime.startsWith('video/') || a.kind === 'video') return 'video';
  if (a.kind === 'log' || a.mime === 'text/plain') return 'log';
  return 'file';
}

export function CursorArtifactsGallery({ artifacts }: Props) {
  if (!artifacts.length) return null;

  const screenshots = artifacts.filter((a) => artifactBucket(a) === 'screenshot');
  const videos = artifacts.filter((a) => artifactBucket(a) === 'video');
  const logs = artifacts.filter((a) => artifactBucket(a) === 'log');
  const files = artifacts.filter((a) => artifactBucket(a) === 'file');

  const filename = (a: Artifact) => a.path.split('/').pop() ?? a.path;

  return (
    <div className="space-y-2">
      <h4 className="text-2xs uppercase tracking-wide text-fg-faint">Cursor agent artifacts</h4>

      {screenshots.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {screenshots.map((a, i) =>
            a.url ? (
              <a
                key={`ss-${i}`}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open screenshot in new tab"
                className="block rounded overflow-hidden border border-edge bg-surface-overlay hover:border-accent/60 transition-colors"
              >
                <img
                  src={a.url}
                  alt={`Cursor agent screenshot ${i + 1}`}
                  className="w-full h-auto object-cover"
                  loading="lazy"
                />
              </a>
            ) : (
              <div
                key={`ss-${i}`}
                className="flex items-center justify-center rounded border border-edge bg-surface-overlay text-2xs text-fg-faint p-2"
                title={a.path}
              >
                {filename(a)}
              </div>
            ),
          )}
        </div>
      )}

      {videos.length > 0 && (
        <div className="space-y-1">
          {videos.map((a, i) =>
            a.url ? (
              <div
                key={`vid-${i}`}
                className="rounded overflow-hidden border border-edge bg-surface-overlay"
              >
                <video
                  src={a.url}
                  controls
                  className="w-full max-h-64 object-contain bg-black"
                />
              </div>
            ) : (
              <div
                key={`vid-${i}`}
                className="flex items-center gap-1.5 text-2xs font-mono text-fg-muted p-1"
                title={a.path}
              >
                <span>🎬</span>
                {filename(a)}
              </div>
            ),
          )}
        </div>
      )}

      {(logs.length > 0 || files.length > 0) && (
        <ul className="space-y-1">
          {[...logs, ...files].map((a, i) => (
            <li key={`log-${i}`}>
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-2xs font-mono text-accent hover:underline underline-offset-2"
                  title={`Open ${a.kind} in new tab`}
                >
                  <span className="text-fg-muted">
                    {a.kind === 'log' ? '📄' : '📎'}
                  </span>
                  {filename(a)}
                </a>
              ) : (
                <span
                  className="flex items-center gap-1.5 text-2xs font-mono text-fg-muted"
                  title={a.path}
                >
                  <span>{a.kind === 'log' ? '📄' : '📎'}</span>
                  {filename(a)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
