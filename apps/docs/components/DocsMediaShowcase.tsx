/**
 * Landing-page media strip — animated admin tour + glot.it SDK dogfood demo.
 */

import { LANDING_MEDIA_CAPTIONS } from '@/lib/landing-copy'
import { DocScreenshot } from './DocScreenshot'
import { ADMIN_DEMO_BASE, GLOTIT_DEMO_URL } from '../data/admin-screenshots'

export function DocsMediaShowcase() {
  const { adminTour, glotit, dashboard, reportDetail } = LANDING_MEDIA_CAPTIONS

  return (
    <div className="docs-media-showcase not-prose">
      <DocScreenshot
        src="tour-pdca-loop.gif"
        alt={adminTour.alt}
        caption={
          <>
            <strong>{adminTour.captionStrong}</strong> {adminTour.captionRest}
          </>
        }
        href={`${ADMIN_DEMO_BASE}/dashboard`}
        animated
      />
      <DocScreenshot
        src="glotit-report-flow.gif"
        alt={glotit.alt}
        caption={
          <>
            <strong>{glotit.captionStrong}</strong> {glotit.captionRest}
          </>
        }
        href={GLOTIT_DEMO_URL}
        animated
      />
      <div className="docs-media-showcase__static">
        <DocScreenshot
          src="dashboard-dark.png"
          lightSrc="dashboard-light.png"
          alt={dashboard.alt}
          caption={
            <>
              <strong>{dashboard.captionStrong}</strong>
              {dashboard.captionRest}
            </>
          }
          href={`${ADMIN_DEMO_BASE}/dashboard`}
        />
        <DocScreenshot
          src="report-detail-dark.png"
          alt={reportDetail.alt}
          caption={
            <>
              <strong>{reportDetail.captionStrong}</strong>
              {reportDetail.captionRest}
            </>
          }
          href={`${ADMIN_DEMO_BASE}/reports`}
        />
      </div>
    </div>
  )
}
