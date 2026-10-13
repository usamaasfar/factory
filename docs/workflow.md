# Workflows

Workflow YAML describes subscribed events, integration permissions, an optional
sandbox, and the agent's model and instructions. Files conventionally live under
`.factory/workflows/`, but startup does not load that directory yet.

A minimal conversation needs no tools or sandbox:

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

## Fields

- **`name`**: workflow name.
- **`on`**: event names mapped to empty YAML values (`null`). Names include the
  integration namespace, such as `github.pull_request.opened`.
- **`permissions`**: required mapping of integration names to resource grants.
  Use `{}` when no tools are needed.
- **`sandbox`**: optional provider, environment name, and resource settings.
- **`agent`**: required provider, model ID, and instructions.

The parser rejects unknown fields and invalid field types. It does not check
event names against registered integrations or resource names against available
tools. The named model provider must be registered separately.

## Registration and sessions

`workflow.register(sources)` validates all YAML before atomically replacing the
global registry. Empty input clears it; invalid input leaves it unchanged.
Acquiring the files from a trusted source is separate from registration.

An event matching `on` starts a session unless that workflow already has a
matching session. Equal or descendant subjects continue existing conversations,
even when the event does not match `on`. Each session stores its definition
snapshot; later registry changes do not rewrite it. Registry replacement assigns
new workflow IDs, so workflow identity across replacements is not stable yet.

Conversation creation stores the provider, model, and instructions. Subsequent
inputs preserve its history. See [event routing](routing.md) for steering,
delivery deduplication, and the distinction between admission and completion.

## Permissions

The parser accepts `read` and `write`; omit a resource for no grant:

```yaml
permissions:
  github:
    pull_requests: write
  slack:
    conversations: read
```

The intended policy is that `write` includes `read`, each resource is its own
permission boundary, and parent grants do not grant access to children. Nested
resources use dotted paths, such as `repository.contents`. Event subscriptions
never grant tool access, and replay safety is separate from permissions.

Tool registration, permission selection, and execution-time authorization are
not wired yet. All conversations currently have an empty toolset.

## Sandboxes

The parser accepts this optional configuration:

```yaml
sandbox:
  provider: local
  environment: base.linux
  resources:
    cpu: 2
    memory: 4
    volume: 20
```

Resources are positive integers: CPU cores, memory in GiB, and volume in GiB.
Defaults are `cpu: 1`, `memory: 2`, and `volume: 4`.

Sandbox provisioning, environment resolution, coding tools, and idle suspension
are not connected to conversation execution yet. Declaring a sandbox currently
does not grant filesystem or shell access.

The database and conversation storage default to memory. Startup still needs
workflow loading, table initialization, and model provider registration. See
[extensibility](extensibility.md) and [example workflows](../.factory/workflows/).
