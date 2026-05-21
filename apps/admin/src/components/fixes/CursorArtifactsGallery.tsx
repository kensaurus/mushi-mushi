/**
 * FILE: apps/admin/src/components/fixes/CursorArtifactsGallery.tsx
 * PURPOSE: Renders fix_attempts.cursor_artifacts — screenshots, videos, and
 *          log files produced by a Cursor Cloud Agent run.
 *
 * Uses the same evidence-card pattern as StoryEvidenceCard.tsx.
 */

interface Artifact {
  kind: 'screenshot' | 'video' | 'log' | 'file';
  path: string;
  mime: string;
}

interface Props {
  artifacts: Artifact[];
}

export function CursorArtifactsGallery({ artifacts }: Props) {
  if (!artifacts.length) return null;

  const screenshots = artifacts.filter((a) => a.kind === 'screenshot' || a.mime.startsWith('image/'));
  const videos = artifacts.filter((a) => a.kind === 'video' || a.mime.startsWith('video/'));
  const logs = artifacts.filter((a) => a.kind === 'log' || a.mime === 'text/plain');
  const files = artifacts.filter(
    (a) => !screenshots.includes(a) && !videos.includes(a) && !logs.includes(a),
  );

  return (
    <div className="space-y-2">
      <h4 className="text-2xs uppercase tracking-wide text-fg-faint">Cursor agent artifacts</h4>

      {screenshots.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {screenshots.map((a, i) => (
            <a
              key={`ss-${i}`}
              href={a.path}
              target="_blank"
              rel="noopener noreferrer"
              title="Open screenshot in new tab"
              className="block rounded overflow-hidden border border-edge bg-surface-overlay hover:border-accent/60 transition-colors"
            >
              <img
                src={a.path}
                alt={`Cursor agent screenshot ${i + 1}`}
                className="w-full h-auto object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <div className="space-y-1">
          {videos.map((a, i) => (
            <div
              key={`vid-${i}`}
              className="rounded overflow-hidden border border-edge bg-surface-overlay"
            >
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={a.path}
                controls
                className="w-full max-h-64 object-contain bg-black"
              />
            </div>
          ))}
        </div>
      )}

      {(logs.length > 0 || files.length > 0) && (
        <ul className="space-y-1">
          {[...logs, ...files].map((a, i) => (
            <li key={`log-${i}`}>
              <a
                href={a.path}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-2xs font-mono text-accent hover:underline underline-offset-2"
                title={`Open ${a.kind} in new tab`}
              >
                <span className="text-fg-muted">
                  {a.kind === 'log' ? '📄' : '📎'}
                </span>
                {a.path.split('/').pop() ?? a.path}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
