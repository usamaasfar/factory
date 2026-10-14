# Factory – Workflow Engineering

Factory is a workflow engineering platform for automating repeatable software work—such as reviewing code, triaging issues, and fixing bugs—in isolated sandboxes.

Workflows and their execution environments are defined in `.factory/`.

## Workflows

Workflow YAML conventionally lives under `.factory/workflows/`:

```yaml
name: Conversation
on:
  test.message.created:
permissions: {}
agent:
  provider: deepseek
  model: deepseek-flash
  instructions: Answer briefly. Remember information from earlier messages.
```

Triggers create sessions. Equal or descendant subjects continue the same
conversations, preserving their history. Provider delivery IDs deduplicate
retried inputs; subjects identify the resources those conversations follow.

See [workflows](docs/workflow.md) and [event routing](docs/routing.md).

## Integrations

Startup discovers `integrations/*/index.ts`. Each integration reads its
credentials from the environment and exports a setup function.

`POST /webhook/:integration` forwards the raw request to the integration's
handler. It verifies the delivery, resolves an event's subject and content, and
awaits workflow input admission through the callback connected at startup.

See [extensibility](docs/extensibility.md) and [built-in integrations](integrations/README.md).

## Current status

Startup initializes the in-memory workflow database, loads `.factory/workflows/`
(or `WORKFLOWS_DIR`), and registers DeepSeek. Workflow permissions select
integration tools per conversation. Sandboxes and persistent storage are not yet
wired.

## Docker

For a local test run, create `.env` in the repository root, then run:

```bash
bun run docker:test
```

This builds the latest engine code and recreates `factory-test`, loading `.env`
and workflows from your repository’s `.factory/workflows/`. It also starts a
Cloudflare Quick Tunnel (or reuses the running tunnel), prints its public HTTPS
URL, and streams Factory logs.
No Cloudflare account or token is needed. **The tunnel exposes Factory publicly.**
The command sets `PUBLIC_BASE_URL` to the tunnel URL, overriding any value in
`.env`. Update Slack’s Request URL to the printed `/webhook/slack` address.

The local endpoint is `http://127.0.0.1:8080`. Rerun the command after code,
workflow, or environment changes; there is no hot reload or publishing. The
running tunnel is kept alive during Factory rebuilds, preserving its public URL.
There is a brief interruption while Factory restarts. The URL changes only if
the tunnel itself restarts or is recreated.
Quick Tunnels are for testing, not a stable production endpoint.

**Ctrl+C stops log streaming but leaves both containers running.**
Use `FACTORY_TEST_PORT=8081 bun run docker:test` if port 8080 is occupied.
Reconnect to logs with `docker logs -f factory-test` (or
`docker logs -f factory-test-tunnel` for tunnel diagnostics). Stop both with:

```bash
docker stop factory-test factory-test-tunnel
```

The containers restart with Docker unless explicitly stopped. Runtime state
remains in memory and is lost on restart.

The same Dockerfile builds the engine without repository workflows or credentials;
the local command mounts your `.factory/` directory and supplies secrets at runtime.

## Development

```bash
bun install
bun test src/workflow
```

The workflow suite includes a live `deepseek-flash` test. It is skipped when
`DEEPSEEK_API_KEY` is missing. When the key is available (including from `.env`),
it runs against the real API and makes paid requests.

## CI

GitHub Actions runs formatting/lint, typechecking, and unit tests on pull requests
and pushes to `main`, using Bun 1.4.2 and the frozen lockfile.

Run the same checks locally:

```bash
bun run format:check
bun run typecheck
bun run test
```

The live DeepSeek suite skips when `DEEPSEEK_API_KEY` is missing. Docker suites
require their sandbox test image; `bun test` runs the full discovered suite.
