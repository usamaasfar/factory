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

List enabled module paths and provider options in `.factory/integrations.ts`.
Built-ins live under `integrations/`; custom modules can live under
`.factory/integrations/`. Both export a default `(options, context)` factory.

`POST /webhook/:integration` forwards the raw request to the integration's
handler. It verifies the delivery, resolves an event's subject and content, and
awaits workflow input admission through the callback connected at startup.

See [extensibility](docs/extensibility.md) and [built-in integrations](integrations/README.md).

## Current status

The configured integration list is empty. Startup does not yet load workflow
files, create database tables, or register model providers. Tools and sandboxes
are not wired; conversations have no tools. Storage defaults to memory, without
restart recovery or concurrent session-creation coordination.

## Development

```bash
bun install
bun test src/workflow
```

The workflow suite includes a live `deepseek-flash` test. It requires
`DEEPSEEK_API_KEY` (read from `.env`) and makes paid API requests; there are no
mocks or opt-in flags.
