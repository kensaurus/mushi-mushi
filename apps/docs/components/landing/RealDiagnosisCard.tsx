/**
 * One real diagnosis, laid out like the report drawer: what the user wrote,
 * then the plain-English read. Copy and provenance live in
 * LANDING_REAL_DIAGNOSIS (lib/landing-copy.ts) — the provenance line is part
 * of the claim, so it renders every time the card does.
 */
import Link from 'next/link'
import { LANDING_REAL_DIAGNOSIS as D } from '@/lib/landing-copy'

export function RealDiagnosisCard() {
  return (
    <figure className="landing-real-diagnosis not-prose" aria-labelledby="landing-real-diagnosis-title">
      <div className="landing-real-diagnosis__report">
        <span className="landing-real-diagnosis__label">The report</span>
        <blockquote className="landing-real-diagnosis__quote">{D.report}</blockquote>
      </div>

      <div className="landing-real-diagnosis__read">
        <span className="landing-real-diagnosis__label">Mushi’s diagnosis</span>
        <p id="landing-real-diagnosis-title" className="landing-real-diagnosis__title">
          {D.title}
        </p>
        <ul className="landing-real-diagnosis__chips" aria-label="Classification">
          <li>
            severity <strong>{D.severity}</strong>
          </li>
          <li>
            category <strong>{D.category}</strong>
          </li>
          <li>
            confidence <strong>{D.confidence}</strong>
          </li>
        </ul>
        <dl className="landing-real-diagnosis__fields">
          <dt>Likely cause</dt>
          <dd>{D.rootCause}</dd>
          <dt>Suggested fix</dt>
          <dd>{D.suggestedFix}</dd>
          <dt>In your editor</dt>
          <dd>
            Your agent calls <code>{D.editorCmd}</code> and gets one paste-ready fix prompt: this
            diagnosis, the reproduction steps, the suggested fix and the relevant code. No second
            LLM key.
          </dd>
        </dl>
        <Link
          className="landing-real-diagnosis__next"
          href={D.nextHref}
          data-mushi-cta="landing-diagnosis-next"
          data-mushi-location="real-diagnosis"
        >
          {D.nextLabel}
        </Link>
      </div>

      <figcaption className="landing-real-diagnosis__provenance">{D.provenance}</figcaption>
    </figure>
  )
}
