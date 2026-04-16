# @mushi/mcp

MCP (Model Context Protocol) server that exposes Mushi Mushi reports to coding agents.

## Usage

```bash
MUSHI_API_KEY=key_xxx MUSHI_PROJECT_ID=proj_xxx npx @mushi/mcp
```

### Tools

- `get_recent_reports` — fetch latest reports with optional filters
- `get_report_detail` — full report with console/network logs
- `search_reports` — keyword and semantic search

### Resources

- `project://settings` — current project configuration
- `project://stats` — report counts and trends

## License

MIT
