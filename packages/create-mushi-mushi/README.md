# create-mushi-mushi

> **Your AI built it. Mushi Mushi makes it better.**

**Same as `npx mushi-mushi`.** This package is kept so `npm create mushi-mushi`
keeps working. It forwards every argument to the same code in
[`@mushi-mushi/cli`](https://www.npmjs.com/package/@mushi-mushi/cli): the setup
wizard, the `--template` starter apps and the `mushi` commands.

| `npm create` form | Same as |
| --- | --- |
| `npm create mushi-mushi` | `npx mushi-mushi` (setup wizard in this project) |
| `npm create mushi-mushi -- --template vue my-app` | `npx mushi-mushi --template vue my-app` (starter: `vue`, `svelte` or `node`) |
| `npm create mushi-mushi -- --yes` | `npx mushi-mushi --yes` |
| `npm create mushi-mushi -- --help` | `npx mushi-mushi --help` (every flag) |

`npm create` and `pnpm create` need the `--` separator before flags. Yarn 1
and Bun do not. You need Node.js 20 or newer.

Docs: [the setup wizard](https://kensaur.us/mushi-mushi/docs/sdks/launcher)

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 78 edge functions · 569 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
