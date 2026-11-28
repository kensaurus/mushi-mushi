import { useEffect, useState } from 'react'
import { ConfigHelp } from '../ConfigHelp'
import { accentInk, DEFAULT_PICK, INK_BLACK, parseAccentColour } from '../../lib/widgetAccent'

/**
 * The widget's brand colour: Auto (the widget matches the site, the default)
 * or one hex colour, picked from a swatch or typed. Under it, the text colour
 * the server will pair with it and the contrast of that pair, so a pale
 * yellow never ships with an unreadable Send label.
 */
export function AccentField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const auto = !value
  // The hex box keeps what is being typed; the config only changes on a valid colour.
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const draftValid = parseAccentColour(draft)
  const ink = value ? accentInk(value) : null

  return (
    <fieldset>
      <legend className="text-2xs text-fg-secondary font-semibold mb-1 inline-flex items-center gap-1">
        Colour
        <ConfigHelp helpId="sdk-install.accent" />
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => onChange(e.target.checked ? '' : parseAccentColour(draft) ?? DEFAULT_PICK)}
            className="h-3 w-3 accent-brand"
          />
          <span className="text-fg-secondary">Auto (match my site)</span>
        </label>
        {!auto && (
          <>
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value.toLowerCase())}
              aria-label="Pick the widget colour"
              className="h-6 w-8 cursor-pointer rounded-sm border border-edge-subtle bg-surface-raised p-0"
            />
            <input
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                const parsed = parseAccentColour(e.target.value)
                if (parsed) onChange(parsed)
              }}
              onBlur={() => setDraft(value)}
              maxLength={7}
              spellCheck={false}
              aria-label="Widget colour as a hex code"
              aria-invalid={draft !== '' && !draftValid}
              placeholder={DEFAULT_PICK}
              className="w-20 px-2 py-1 bg-surface-raised border border-edge-subtle rounded-sm font-mono text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
            />
          </>
        )}
      </div>
      {auto ? (
        <p className="mt-1 text-fg-faint">The widget uses your site&apos;s accent colour when it finds one, else its own.</p>
      ) : ink ? (
        <p className="mt-1 text-fg-faint" data-testid="accent-contrast">
          Text on this colour: {ink.ink === INK_BLACK ? 'black' : 'white'}, {ink.ratio}:1{' '}
          <span className="text-fg-secondary">{ink.ratio >= 4.5 ? '✓ easy to read' : '✓ readable for buttons (3:1 or more)'}</span>
        </p>
      ) : null}
      {!auto && draft !== '' && !draftValid && (
        <p className="mt-1 text-fg-secondary" role="alert">
          Use a hex code like {DEFAULT_PICK}.
        </p>
      )}
    </fieldset>
  )
}
