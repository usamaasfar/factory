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

Development startup initializes the in-memory workflow database, loads
`tests/workflows/*.yml`, and registers DeepSeek. Workflow permissions select
integration tools per conversation. Sandboxes and persistent storage are not yet
wired.

## Development

```bash
bun install
bun test src/workflow
```

The workflow suite includes a live `deepseek-flash` test. It requires
`DEEPSEEK_API_KEY` (read from `.env`) and makes paid API requests; there are no
mocks or opt-in flags.

## CI

GitHub Actions runs formatting/lint, typechecking, and unit tests on pull requests
and pushes to `main`, using Bun 1.4.2 and the frozen lockfile.

Run the same checks locally:

```bash
bun run format:check
bun run typecheck
bun run test:ci
```

`test:ci` excludes the live DeepSeek trigger test and Docker integration tests;
no API keys or sandbox images are required. `bun test` still runs the full suite.
