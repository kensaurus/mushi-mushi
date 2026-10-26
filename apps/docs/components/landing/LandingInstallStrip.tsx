'use client'

/**
 * "Start in three steps", under the pipeline: install → first report → first
 * fix, the same three steps as the quickstart page. Each step has its action
 * right there (a command to copy, or the editor buttons) and ends with what
 * you should see, so a newcomer can tell it worked.
 *
 * Every editor install is URL-only (`buildOAuthInstall`): the editor runs the
 * Mushi OAuth sign-in on first use, so the page needs no key. The Cursor
 * badges are Cursor's official artwork, bundled under public/badges because
 * the docs CSP does not allow images from cursor.com.
 */
import { MUSHI_CANONICAL_URLS } from '@mushi-mushi/brand'
import { buildOAuthInstall } from '@mushi-mushi/mcp/clients'
import Link from 'next/link'
import { LANDING_HOW_IT_WORKS, LANDING_ONE_CLICK, LANDING_SIXTY_SECOND } from '@/lib/landing-copy'
import { publicAssetPath } from '@/lib/public-asset-path'
import { CopyCommand } from '../CopyCommand'

function linkOf(id: 'cursor' | 'vscode'): string {
  const result = buildOAuthInstall(id, { mcpOAuthUrl: MUSHI_CANONICAL_URLS.hostedMcp })
  return result.kind === 'deeplink' ? result.url : ''
}

function commandOf(): string {
  const result = buildOAuthInstall('claude-code', { mcpOAuthUrl: MUSHI_CANONICAL_URLS.hostedMcp })
  return result.kind === 'command' ? result.text : ''
}

const CURSOR_URL = linkOf('cursor')
const VSCODE_URL = linkOf('vscode')
const CLAUDE_CMD = commandOf()

function EditorButtons() {
  return (
    <>
      <div className="landing-oneclick__buttons">
        <a
          href={CURSOR_URL}
          className="landing-oneclick__badge"
          data-mushi-cta="landing-install-cursor"
          data-mushi-location="install-strip"
        >
          {/* Dark badge on the light theme, light badge on the dark theme. */}
          <img
            className="landing-oneclick__badge-img landing-oneclick__badge-img--on-light"
            src={publicAssetPath('/badges/cursor-mcp-install-dark.png')}
            alt={LANDING_ONE_CLICK.cursorAlt}
            width={169}
            height={39}
          />
          <img
            className="landing-oneclick__badge-img landing-oneclick__badge-img--on-dark"
            src={publicAssetPath('/badges/cursor-mcp-install-light.png')}
            alt=""
            aria-hidden="true"
            width={169}
            height={39}
          />
        </a>
        <a
          href={VSCODE_URL}
          className="landing-hero-cta landing-hero-cta--secondary"
          data-mushi-cta="landing-install-vscode"
          data-mushi-location="install-strip"
        >
          {LANDING_ONE_CLICK.vscodeLabel}
        </a>
        <Link
          href={LANDING_ONE_CLICK.moreHref}
          className="landing-hero-cta landing-hero-cta--ghost"
          data-mushi-cta="landing-install-more"
          data-mushi-location="install-strip"
        >
          {LANDING_ONE_CLICK.moreLabel} →
        </Link>
      </div>
      <p className="landing-oneclick__note">{LANDING_ONE_CLICK.note}</p>
    </>
  )
}

export function LandingInstallStrip() {
  const [install, report, fix] = LANDING_HOW_IT_WORKS.steps
  const actions = [
    <CopyCommand key="npx" cmd={LANDING_ONE_CLICK.npxCmd} ctaId="landing-copy-npx" location="install-strip" />,
    null,
    <EditorButtons key="editors" />,
  ]
  return (
    <section className="landing-install not-prose" aria-labelledby="landing-install-heading">
      <h2 id="landing-install-heading" className="landing-section-title">
        {LANDING_HOW_IT_WORKS.heading}
      </h2>
      <ol className="landing-start" aria-label="Get started in three steps">
        {[install, report, fix].map((step, i) => (
          <li key={step.title} className="landing-start__step">
            <span className="landing-start__num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="landing-start__body">
              <h3 className="landing-start__title">{step.title}</h3>
              <p className="landing-start__desc">{step.desc}</p>
              {actions[i] ? <div className="landing-start__action">{actions[i]}</div> : null}
              <p className="landing-start__check">
                <span className="landing-start__check-mark" aria-hidden="true">
                  ✓
                </span>
                <span>
                  <strong>You&rsquo;ll see:</strong> {step.check}
                </span>
              </p>
            </div>
          </li>
        ))}
      </ol>
      {/* Below the grid, not in step 3, so the three cards stay one height. */}
      <div className="landing-start__extra">
        <CopyCommand
          label={LANDING_ONE_CLICK.claudeLabel}
          cmd={CLAUDE_CMD}
          ctaId="landing-copy-claude"
          location="install-strip"
        />
      </div>
      <p className="landing-start__pricing">{LANDING_SIXTY_SECOND.pricing}</p>
    </section>
  )
}
