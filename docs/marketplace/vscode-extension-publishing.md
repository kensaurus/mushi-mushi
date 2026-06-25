# VS Code Marketplace + Open VSX — publishing the Mushi extension

The extension lives at [`packages/vscode-extension/`](../../packages/vscode-extension/).
It is `private: true` (so it never leaks to npm) and ships **only** to the two
extension marketplaces via `vsce` / `ovsx`, run through `pnpm dlx` so the heavy
publishing tools never enter the workspace lockfile.

> Publisher: **`mushimushi`** (set in `package.json`). The display name is
> **Mushi Mushi**. Version tracks `@mushi-mushi/mcp` (currently `0.17.0`).

---

## One-time setup (manual web)

### 1. VS Code Marketplace publisher (`mushimushi`)

1. Create/seed an **Azure DevOps** organization (any name) — the Marketplace
   backs publishers with Azure DevOps. <https://dev.azure.com/>
2. Create a **Personal Access Token (PAT)**:
   - Organization: **All accessible organizations** (required — a single-org PAT
     fails with `401`).
   - Scopes: **Custom defined → Marketplace → Manage**.
   - Copy the token (shown once).
3. Create the publisher `mushimushi` at
   <https://marketplace.visualstudio.com/manage/createpublisher> (the ID must
   match `"publisher"` in `package.json`).

### 2. Open VSX namespace (`mushimushi`)

1. Sign in at <https://open-vsx.org/> with GitHub and accept the publisher
   agreement.
2. Create an **access token** at <https://open-vsx.org/user-settings/tokens>.
3. Create the namespace:

   ```bash
   pnpm dlx ovsx@latest create-namespace mushimushi -p "$OVSX_TOKEN"
   ```

---

## Publish (each release)

From `packages/vscode-extension/`:

```bash
# 0. Bump version to match @mushi-mushi/mcp, update CHANGELOG.md

# 1. Build + verify the VSIX contents locally (no upload)
pnpm --filter mushi-mushi-vscode package        # -> mushi-mushi-vscode-<v>.vsix
pnpm dlx @vscode/vsce@latest ls --no-dependencies   # sanity-check bundled files

# 2. VS Code Marketplace
export VSCE_PAT=<azure-devops-pat>
pnpm --filter mushi-mushi-vscode publish:vsce

# 3. Open VSX
export OVSX_PAT=<open-vsx-token>
pnpm --filter mushi-mushi-vscode publish:ovsx
```

`vsce`/`ovsx` read `VSCE_PAT` / `OVSX_PAT` from the environment, so no token ever
touches the repo. Alternatively pass `-p <token>` inline (avoid in shared shells
— it lands in history).

### Verify

```bash
# Marketplace listing (replace after first publish propagates, ~1–2 min):
#   https://marketplace.visualstudio.com/items?itemName=mushimushi.mushi-mushi-vscode
# Open VSX listing:
#   https://open-vsx.org/extension/mushimushi/mushi-mushi-vscode
```

In VS Code: **Extensions → search "Mushi Mushi" → Install**, then open
**Chat → Agent** and confirm the `Mushi Mushi (npx)` MCP server appears and
prompts for a key (or run **`Mushi Mushi: Use the read-only demo`**).

---

## What the extension registers

- `contributes.mcpServerDefinitionProviders` → `mushiMushi`, resolved by
  `vscode.lm.registerMcpServerDefinitionProvider` in
  [`src/extension.ts`](../../packages/vscode-extension/src/extension.ts).
- Default transport `stdio` runs `npx -y @mushi-mushi/mcp@latest`; switch
  `mushiMushi.transport` to `http` for the hosted Streamable endpoint.
- The API key is prompted on first tool use and stored in VS Code
  **SecretStorage** (never in settings.json). `Mushi Mushi: Use the read-only
  demo` flips to the public demo key + `?read_only=1`.
- Env/header shapes mirror [`packages/mcp/src/clients.ts`](../../packages/mcp/src/clients.ts)
  — keep them in sync when the canonical builders change.

---

## Optional: wire into the release pipeline

To auto-publish on tag, add a job to `.github/workflows/release.yml` gated on a
`vscode-extension` changeset, with `VSCE_PAT` + `OVSX_PAT` repo secrets:

```yaml
  publish-vscode:
    if: needs.release.outputs.published == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter mushi-mushi-vscode publish:vsce
        env: { VSCE_PAT: ${{ secrets.VSCE_PAT }} }
      - run: pnpm --filter mushi-mushi-vscode publish:ovsx
        env: { OVSX_PAT: ${{ secrets.OVSX_PAT }} }
```

Until then, publishing is the manual two-command flow above.
