'use client'

/**
 * Quickstart framework picker. `npx mushi-mushi` is the same for every
 * stack (the wizard detects it), so the picker shows what differs: the
 * package the wizard installs, the manual install command, the one call you
 * add to your app, and the full guide for that stack.
 */
import { useState } from 'react'
import Link from 'next/link'
import { CopyCommand } from './CopyCommand'

interface Framework {
  id: string
  name: string
  install: string
  /** The one thing you add to your app code. */
  setup: string
  href: string
}

const FRAMEWORKS: readonly Framework[] = [
  {
    id: 'react',
    name: 'React / Next.js',
    install: 'npm install @mushi-mushi/react',
    setup: 'Wrap your app in <MushiProvider> (a client component in Next.js).',
    href: '/quickstart/react',
  },
  {
    id: 'vue',
    name: 'Vue / Nuxt',
    install: 'npm install @mushi-mushi/vue',
    setup: 'Register MushiPlugin with app.use() in main.ts.',
    href: '/quickstart/vue',
  },
  {
    id: 'svelte',
    name: 'Svelte',
    install: 'npm install @mushi-mushi/svelte',
    setup: 'Call initMushi() from hooks.client.ts or your root layout.',
    href: '/quickstart/svelte',
  },
  {
    id: 'angular',
    name: 'Angular',
    install: 'npm install @mushi-mushi/angular',
    setup: 'Add provideMushi() to your app config.',
    href: '/quickstart/angular',
  },
  {
    id: 'web',
    name: 'Plain JS / HTML',
    install: 'npm install @mushi-mushi/web',
    setup: 'Call Mushi.init() once; the report button mounts itself.',
    href: '/quickstart/web',
  },
  {
    id: 'react-native',
    name: 'React Native / Expo',
    install: 'npm install @mushi-mushi/react-native @react-native-async-storage/async-storage',
    setup: 'Wrap your app in <MushiProvider>; a floating bug button appears.',
    href: '/quickstart/react-native',
  },
  {
    id: 'capacitor',
    name: 'Capacitor',
    install: 'npm install @mushi-mushi/capacitor',
    setup: 'Call Mushi.configure() once; shake the phone to report.',
    href: '/quickstart/capacitor',
  },
]

export function FrameworkPicker() {
  const [selected, setSelected] = useState(FRAMEWORKS[0]!.id)
  const fw = FRAMEWORKS.find((f) => f.id === selected) ?? FRAMEWORKS[0]!
  return (
    <div className="landing-framework not-prose">
      <div className="landing-framework__tabs" role="group" aria-label="Your framework">
        {FRAMEWORKS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={f.id === selected}
            className="landing-framework__tab"
            onClick={() => setSelected(f.id)}
          >
            {f.name}
          </button>
        ))}
      </div>
      <div className="landing-framework__panel" aria-live="polite">
        <CopyCommand label="Or install by hand" cmd={fw.install} />
        <p className="landing-framework__setup">
          <strong>Then in your code:</strong> {fw.setup}
        </p>
        <Link className="landing-framework__guide" href={fw.href}>
          Full {fw.name} guide →
        </Link>
      </div>
    </div>
  )
}
