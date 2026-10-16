# Workflows

Workflow YAML describes subscribed events, integration permissions, an optional
sandbox, and the agent's model and instructions. Files conventionally live under
`.factory/workflows/`; startup loads that directory, or `WORKFLOWS_DIR` when set.

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

When a workflow starts a conversation, Factory resolves each exact resource
path and selects its permitted tools. A `read` grant selects read tools; `write`
selects both read and write tools. Pi Durable keeps that toolset scoped to the
conversation.

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

Factory supports `provider: local` through the local Docker provider. Set
`FACTORY_SANDBOX_IMAGE` to an already-built image before starting Factory:

```sh
docker build -f sandboxes/local-docker/Dockerfile -t factory-sandbox:local .
export FACTORY_SANDBOX_IMAGE=factory-sandbox:local
bun run serve
```

Set `FACTORY_DOCKER_SOCKET` for a nonstandard Unix socket. Otherwise the provider
uses dockerode's standard socket / `DOCKER_HOST` configuration, not the Docker
CLI's selected context. Containerized Factory needs an explicit Docker connection.
The `docker:test` helper mounts the daemon's `/var/run/docker.sock` into Factory
and adds its socket group to the non-root runtime user. Set
`FACTORY_SANDBOX_IMAGE` in `.env` before running the helper. Docker access grants
administrative control of the daemon and belongs to Factory, never to the sandbox
container.

Conversation creation records a unique sandbox key and the configured image in a
Pi Durable document, atomically with the conversation. The container and persistent
`/workspace` volume open lazily when Pi requests the conversation's environment.
Repeated and concurrent requests share the sandbox handle. A failed open can be
retried; it never falls back to the host. Workflows without `sandbox` have no
execution environment and do not require Docker or image configuration.

This first version uses the same configured image for all sandbox workflows.
`environment` does not yet select or build an image, and its setup script is not
executed. Resource settings are parsed but **not enforced**. Declaring a sandbox
enables Pi's built-in `read`, `write`, `edit`, and `bash` tools through its execution
environment. Workflows without a sandbox do not receive these tools. Integration
permissions are unchanged, and integration tools continue to run in Factory.

Idle suspension, automatic teardown, and restart recovery are not implemented.
Docker resources survive Factory restarts, while the database and Durable storage
remain in memory. See [extensibility](extensibility.md) and the
[local Docker provider](../sandboxes/local-docker/README.md).
