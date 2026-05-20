/**
 * Landing-page media strip — animated admin tour + glot.it SDK dogfood demo.
 */

import { DocScreenshot } from './DocScreenshot'
import { ADMIN_DEMO_BASE, GLOTIT_DEMO_URL } from '../data/admin-screenshots'

export function DocsMediaShowcase() {
  return (
    <div className="docs-media-showcase not-prose">
      <DocScreenshot
        src="tour-pdca-loop.gif"
        alt="Animated guided tour through the Mushi admin console — Plan, Do, Check, Act"
        caption={
          <>
            <strong>Admin console</strong> · logged-in walk through Reports → Fixes → Judge →
            Integrations
          </>
        }
        href={`${ADMIN_DEMO_BASE}/dashboard`}
        animated
      />
      <DocScreenshot
        src="glotit-report-flow.gif"
        alt="glot.it dogfood — user taps the Mushi feedback widget, submits a bug report"
        caption={
          <>
            <strong>SDK on glot.it</strong> · shake / tap to report from a real Thai-learning app
          </>
        }
        href={GLOTIT_DEMO_URL}
        animated
      />
      <div className="docs-media-showcase__static">
        <DocScreenshot
          src="dashboard-dark.png"
          lightSrc="dashboard-light.png"
          alt="Mushi admin dashboard — PDCA cockpit"
          caption={
            <>
              <strong>Dashboard</strong>
              {' · theme-aware still · swaps with your system theme'}
            </>
          }
          href={`${ADMIN_DEMO_BASE}/dashboard`}
        />
        <DocScreenshot
          src="report-detail-dark.png"
          alt="Report detail — PDCA receipt strip and Branch & PR timeline"
          caption={
            <>
              <strong>Report detail</strong>
              {' · screenshot + classification + fix timeline'}
            </>
          }
          href={`${ADMIN_DEMO_BASE}/reports`}
        />
      </div>
    </div>
  )
}
