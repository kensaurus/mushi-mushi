# create-mushi-mushi

> One-line setup for the [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) bug-reporting + AI triage SDK.

```bash
npm create mushi-mushi
# or
pnpm create mushi-mushi
yarn create mushi-mushi
bun create mushi-mushi
```

Auto-detects your framework (Next.js, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla JS), installs the right `@mushi-mushi/*` SDK, writes your env vars, and prints the snippet to drop into your app.

This is a **scaffold for existing projects** — it does not generate a new app from scratch. To add Mushi to an app you already have, run it from the project root.

## Flags

```bash
npm create mushi-mushi -- --framework next
npm create mushi-mushi -- --project-id proj_xxx --api-key mushi_xxx
npm create mushi-mushi -- --skip-install
npm create mushi-mushi -- -y
npm create mushi-mushi -- --help
```

## Equivalent

```bash
npx mushi-mushi               # same wizard, shorter to type
npx @mushi-mushi/cli init     # same wizard, scoped name
```

## Links

- 🌐 [Console](https://kensaur.us/mushi-mushi/)
- 📦 [GitHub](https://github.com/kensaurus/mushi-mushi)
- 📚 [Docs](https://github.com/kensaurus/mushi-mushi#readme)

## License

MIT
