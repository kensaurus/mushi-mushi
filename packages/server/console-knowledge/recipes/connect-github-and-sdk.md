---
title: Connect GitHub and install SDK
routes:
  - /connect
  - /mcp
  - /settings
kind: recipe
---

# Connect GitHub and install SDK

Wire your repository and capture widget so Mushi can index code and receive reports.

## Steps

1. Open **Connect & Update** (`/connect`).
2. Click **Connect GitHub** and authorize the Mushi GitHub App for your org/repo.
3. Copy the **SDK install** snippet (`@mushi-mushi/web`) and add it to your app bootstrap.
4. Click **Add to Cursor** (MCP) to install the Mushi MCP server for agent tooling.
5. Optional: run **Create Upgrade PR** to bump `@mushi-mushi/*` packages in your repo.
6. Verify indexing on **Explore** (`/explore`) → Index tab → **Re-analyze graph**.

## Tips

- MCP setup details also live on `/mcp`.
- If embeddings fail, add an OpenAI BYOK key under Settings → API Keys.
