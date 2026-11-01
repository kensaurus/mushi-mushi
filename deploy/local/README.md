# Run Mushi on your own machines, with nothing leaving

This folder holds the local-only profile (Plan 023, ADR 0034). It runs the
whole stack on your machine: Postgres, Auth, REST, Storage, the edge
functions, the console and, if you want it, a local model server. Its only
way out is a proxy that forwards to hosts you list, and the list starts
empty. You can check that with one command.

Full guide: <https://kensaur.us/mushi-mushi/docs/operating/run-locally>.

## What runs where

| Container | Network | Can reach the internet? |
| --- | --- | --- |
| `postgres`, `supabase-auth`, `supabase-rest`, `supabase-storage` | `mushi_local` | No |
| `edge-functions` (the `api`) | `mushi_local` | No; also refuses hosts in code (`MUSHI_LOCAL_ONLY=1`) |
| `admin` (console) | `mushi_local` | No |
| `ollama` (optional, `--profile ollama`) | `mushi_local` | No |
| `studio` + `meta` (optional, `--profile studio`) | `mushi_local` | No |
| `caddy` (the way in) | `mushi_local` + `ingress` | No: `ingress` has NAT off, and Caddy makes no outbound requests |
| `squid` (the way out) | `mushi_local` + `egress` | Only to allowlisted hosts |

`mushi_local` is an internal Docker network. Docker still lets an internal
network reach the host's bridge address, so the real guarantee is this: the
only container with a route to the internet is `squid`, and every other
container sends its HTTP(S) through it.

## Steps

You need Docker with Compose 2.24.4 or later, and the Mushi CLI
(`npm i -g @mushi-mushi/cli`).

1. **Write `deploy/.env`.** From the `deploy/` folder:

   ```bash
   POSTGRES_PASSWORD=change-me
   JWT_SECRET=a-random-string-of-at-least-32-characters
   SUPABASE_ANON_KEY=...          # a JWT signed with JWT_SECRET, role "anon"
   SUPABASE_SERVICE_ROLE_KEY=...  # a JWT signed with JWT_SECRET, role "service_role"
   MUSHI_PUBLIC_URL=http://localhost:8080

   # A local model (here the optional ollama service, through its Anthropic API)
   ANTHROPIC_BASE_URL=http://ollama:11434
   ANTHROPIC_API_KEY=ollama
   MUSHI_LLM_MODEL_FAST=qwen3:8b
   MUSHI_LLM_MODEL_SMART=qwen3:32b
   MUSHI_LLM_MODEL_REVIEW=qwen3:32b
   ```

   Supabase's self-hosting guide shows how to make the two keys from
   `JWT_SECRET`. Leave `MUSHI_EGRESS_ALLOW` unset.

2. **Get a model (optional ollama service).** Pulls go through the proxy, so
   they fail until you allow the registry. Uncomment `registry.ollama.ai` in
   `local/egress-allow.txt`, then:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.local.yml --profile ollama up -d squid ollama
   docker compose -f docker-compose.yml -f docker-compose.local.yml exec ollama ollama pull qwen3:8b
   ```

   The registry sends the download itself to a storage host. If the pull still
   fails, `docker compose ... logs squid | grep TCP_DENIED` names that host; add
   it for the pull. When the models are in, comment the lines out again and
   `docker compose ... restart squid`. Already running Ollama, vLLM or LM Studio
   elsewhere on your network? Point `ANTHROPIC_BASE_URL` (or an
   OpenAI-compatible base URL) at it instead; private addresses are allowed.

3. **Start the stack.**

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.local.yml --profile ollama up -d
   ```

4. **Open the console** at <http://localhost:8080> and create your account.
   Settings → Security → **Data egress** shows local-only on, the allowlist and
   every refused host.

5. **Prove it.** Point the CLI at your stack and run the check:

   ```bash
   export MUSHI_API_ENDPOINT=http://localhost:8080/functions/v1/api
   export MUSHI_NO_TELEMETRY=1 MUSHI_NO_UPDATE_CHECK=1
   mushi login
   mushi local verify --host-check
   ```

   `mushi local verify` asks the edge runtime to reach api.anthropic.com,
   api.openai.com, ollama.com, sentry.io, api.github.com and
   registry.npmjs.org. Every attempt must fail. It prints the allowlist and
   the refusals. `--host-check` also tries the same hosts from the machine you
   run it on. On a machine whose only way out is the proxy, those fail too. On
   a laptop with ordinary internet they get through: that tells you the
   machine is open, while the stack itself is still sealed.
   `mushi local status` shows the allowlist and refusals without testing.

## Allowing a host

Every host you allow is a place your data can go. Two lists:

- `local/egress-allow.txt` opens the proxy only. Use it for model downloads.
  Mushi's edge functions still refuse these hosts.
- `MUSHI_EGRESS_ALLOW` in `.env` (comma list) opens the proxy and the edge
  functions' guard. Use it for a host Mushi itself must reach, such as a
  GitHub Enterprise Server (`GITHUB_API_URL`) or an SMTP relay outside your
  network.

`example.com` allows that host only; `.example.com` adds its subdomains. A
line that is not a host name stops the proxy at start. After a change,
recreate the containers (`docker compose ... up -d`) and run
`mushi local verify --host-check` again.

## What this profile leaves out

- **Realtime.** Console pages that update live refresh when you reload.
- **Logflare / the log explorer.** Studio's log pages stay off.
- **Studio's AI assistant.** `OPENAI_API_KEY` is set empty.
- **Cloud features**: Cursor and GitHub cloud agents, Firecrawl, Browserbase,
  public radar probes, store connectors. Use `mushi agent serve` for fixes on
  your own machine.

## Files

| File | What it is |
| --- | --- |
| `../docker-compose.local.yml` | The profile, on top of `../docker-compose.yml` |
| `squid.conf` | The proxy: allowlist, `deny all`, every request logged to stdout |
| `render-squid.sh` | Writes the allowlist when the proxy starts |
| `egress-allow.txt` | Your proxy-only hosts (empty) |
| `Caddyfile` | The way in: HTTP on :80, no automatic HTTPS |
| `../admin/40-mushi-env.sh` | Writes the console's `env.js` when it starts |
