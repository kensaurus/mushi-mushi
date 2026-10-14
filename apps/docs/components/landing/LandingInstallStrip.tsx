'use client'

/**
 * Right under the landing hero: how Mushi works in three steps (the same
 * cycle as the console sidebar, ADR 0027), then one-click installs.
 *
 * Every editor install is URL-only (`buildOAuthInstall`): the editor runs the
 * Mushi OAuth sign-in on first use, so the page needs no key. The Cursor
 * badges are Cursor's official artwork, bundled under public/badges because
 * the docs CSP does not allow images from cursor.com.
 */
import { useState } from 'react'
import { MUSHI_CANONICAL_URLS } from '@mushi-mushi/brand'
import { buildOAuthInstall } from '@mushi-mushi/mcp/clients'
import Link from 'next/link'
import { LANDING_HOW_IT_WORKS, LANDING_ONE_CLICK } from '@/lib/landing-copy'
import { publicAssetPath } from '@/lib/public-asset-path'

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

function CopyCommand({ label, cmd, ctaId }: { label: string; cmd: string; ctaId: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="landing-oneclick__cmd">
      <span className="landing-oneclick__cmd-label">{label}</span>
      <div className="landing-oneclick__cmd-row">
        <code>{cmd}</code>
        <button
          type="button"
          onClick={copy}
          className="landing-oneclick__copy"
          aria-label={copied ? 'Copied to clipboard' : `Copy: ${cmd}`}
          data-mushi-cta={ctaId}
          data-mushi-location="install-strip"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export function LandingInstallStrip() {
  return (
    <section className="landing-install not-prose" aria-labelledby="landing-install-heading">
      <h2 id="landing-install-heading" className="landing-section-title">
        {LANDING_HOW_IT_WORKS.heading}
      </h2>
      <ol className="docs-pillars not-prose" aria-label="How Mushi works">
        {LANDING_HOW_IT_WORKS.steps.map((step, i) => (
          <li key={step.title} className="docs-pillar">
            <span className="docs-pillar__step">{`Step ${i + 1}`}</span>
            <span className="docs-pillar__name">{step.title}</span>
            <span className="docs-pillar__role">{step.desc}</span>
            {i < LANDING_HOW_IT_WORKS.steps.length - 1 ? (
              <span className="docs-pillar__connector" aria-hidden="true" />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="landing-oneclick" role="group" aria-labelledby="landing-oneclick-heading">
        <h3 id="landing-oneclick-heading" className="landing-oneclick__heading">
          {LANDING_ONE_CLICK.heading}
        </h3>
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
        <div className="landing-oneclick__cmds">
          <CopyCommand label={LANDING_ONE_CLICK.claudeLabel} cmd={CLAUDE_CMD} ctaId="landing-copy-claude" />
          <CopyCommand label={LANDING_ONE_CLICK.npxLabel} cmd={LANDING_ONE_CLICK.npxCmd} ctaId="landing-copy-npx" />
        </div>
        <p className="landing-oneclick__note">{LANDING_ONE_CLICK.note}</p>
      </div>
    </section>
  )
}
