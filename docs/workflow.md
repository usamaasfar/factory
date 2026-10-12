# Workflows

Define workflows as YAML files under `.factory/workflows/`. Each workflow selects
its events, integration permissions, sandbox, and agent.

> This is the proposed DSL. The current parser and runtime do not yet support
> top-level `sandbox` and `permissions`.

```yaml
name: Review pull requests

on:
  github.pull_request.opened:
  github.pull_request.synchronize:

permissions:
  github:
    contents: read
    pull_requests: write

sandbox:
  provider: local
  environment: base.linux
  resources:
    cpu: 2
    memory: 4
    volume: 4

agent:
  provider: openai
  model: gpt-5.6-sol
  instructions: |
    Review the pull request as it evolves.
    Report actionable findings supported by the code.
    Revisit findings when new commits arrive and avoid duplicate comments.
```

## Fields

- **`name`**: human-readable workflow name.
- **`on`**: one or more integration-defined events. Empty values mean no filters.
- **`permissions`**: optional access grants to integration resources.
- **`sandbox`**: optional execution environment. Its provider is configured by
  Factory; its environment lives under `.factory/environments/`.
- **`agent`**: model provider, model name, and instructions.

Unknown fields and unsupported events are errors. Without a sandbox, no
filesystem or shell tools are available.

Sandbox `resources` use integers: `cpu` is the number of cores; `memory` and
`volume` are capacities in GiB. The proposed default for `volume` is 4 GiB.

## Permissions

Each resource accepts `none`, `read`, or `write`:

- Omitted permissions grant nothing.
- `write` includes `read`.
- Resource names come from the configured integration.
- Nested resources use dotted paths, such as `repository.contents`.
- Parent permissions do not grant access to child resources.
- Unknown resources or permission levels are errors.

Permissions determine which tools are available and are checked before every
execution. Grants are limited to trusted resource scopes and deployment policy.
Subscribing to an event does not grant tool access.

Replay safety is separate from permissions. Integration permissions also do not
restrict local sandbox filesystem or shell access.

## Lifetime and trust

Factory loads definitions from the repository's default branch. Pull requests
cannot change the instructions governing their own execution.

Related events continue the same workflow session. Existing sessions retain the
definition that created them; workflow changes apply to new sessions. Current
deployment policy remains the ceiling on access.

Sandbox compute is suspended when work becomes idle, while storage is preserved
for later events.

See [the example workflows](../.factory/workflows/) and [SDK](../sdk/README.md).
