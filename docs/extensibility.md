# Extensibility

Factory separates orchestration from provider-specific behavior so integrations
and sandbox backends can evolve without changing the core runtime.

```text
sdk/*                Provider-neutral contracts
integrations/*       Built-in integration adapters
sandboxes/*          Built-in sandbox providers
src/*                Factory orchestration and runtime
```

## Design

Factory owns workflow registration and matching, event routing to conversations,
workspace lifecycle, retention, and execution policy. Pi Durable owns
conversations, transcripts, persisted agent configuration, submission
admission and deduplication, task checkpoints, and execution recovery. Factory
should not duplicate that state in its own session or execution tables.
Factory-specific conversation state can live in Pi Durable documents.

Providers own authentication, external API clients, webhook verification,
resource identities, compute, storage, and transport.

Each Factory module owns its persistence schema and operations. The application
composes those schemas and supplies database connections; workflow persistence
must not depend on GitHub or workspace tables.

The SDK defines provider contracts as ordinary factory functions and typed
objects. Factory keeps the configured integrations in an application-owned
lookup; the SDK does not load modules or manage registration.

## Integrations

`factory-oss/integration` defines integration factories, tools, events, and
webhook capabilities. An integration creates its authenticated provider client
and returns the tools and event definitions available to Factory.

Provider adapters authenticate incoming deliveries and translate them into
verified `{ id, name, payload }` events. Factory owns event lookup and routing;
Pi Durable admits and executes submissions, deduplicating retries by a stable,
namespaced `requestId` within the selected conversation. Provider payloads and
credentials stay inside the adapter.

Workflow registration accepts YAML without provider-native identities and
validates it before replacing the registry. Acquiring a trusted configuration
snapshot is separate from event delivery and is not wired into startup yet.
The configuration source need not be the integration whose events a workflow
subscribes to.

The initial registry is global: a complete registration replaces all workflows,
not just those from one integration. This deliberately assumes one configuration
source at a time, usually GitHub.

Built-in GitHub, Slack, and Linear implementations live under
[`integrations`](../integrations/README.md).

### Configuration and startup

Startup discovers `integrations/*/index.ts` in sorted order. The parent
directory supplies the integration namespace. Each default setup function reads
its credentials from the environment and receives Factory's integration
context. A module can export `disabled = true` to skip initialization.

Modules execute with Factory's privileges and must be trusted. Duplicate or
invalid namespaces are rejected.

`src/index.ts` registers integrations before serving requests and connects
resolved events to `workflowTrigger()` through an awaited callback. The loader
has no dependency on workflow execution.

### Webhook delivery

```text
POST /webhook/:integration
  → registered webhook handler verifies and decodes the raw request
  → ctx.events.receive({ id, name, payload })
  → registered event resolves { subject, content }
  → Factory namespaces the delivery ID, event name, and subject
  → startup callback calls workflowTrigger()
```

The API does not parse the body first: signature verification may need the
original bytes. Each integration owns verification challenges, ignored
deliveries, and HTTP responses. Unknown integrations or integrations without a
webhook handler return `404`.

Event names and subjects returned by adapters are integration-relative. Factory
adds `github.` to event names and `github:` to subjects and delivery IDs, once.
The current SDK requires a delivery ID; optional IDs are not implemented yet.
Handlers await input admission, not the agent's answer. See
[event routing](routing.md) for session selection and steering.

## Sandboxes

Workflows may request a sandbox. Factory records a unique key and configured
prebuilt image in a conversation-scoped Pi Durable document, then lazily opens
the sandbox through `HarnessOptions.env`. Concurrent requests share the open;
failures propagate and can be retried. Workflows without a sandbox resolve no
environment. Permissioned integration tools still run in Factory and are scoped
to each Durable conversation.

The intended policy is that authorized integration tools run in Factory without
a sandbox, while coding tools require a sandbox's `ExecutionEnv`. Factory must
never fall back to the host filesystem or shell.

`factory-oss/sandbox` defines the `Sandbox` base class and `SandboxProvider`
lifecycle contract. Providers implement `start(command)` and return native output,
an exit promise, and a stop function. The SDK coordinates streaming, cancellation,
timeouts, and file reads/writes. Its `sandbox.toExecutionEnv(cwd?)` adapter implements
the installed Pi Durable 1.0.2 contract. Provider code needs no Pi/Chord imports;
see the [sandbox SDK](../sdk/README.md#sandboxes).

The [local Docker provider](../sandboxes/local-docker/README.md) implements native
`open`, `suspend`, and `destroy` operations with persistent workspace storage.
Factory connects workflow assignments to that provider in `src/sandbox.ts`.
Only `provider: local` is supported. Image and connection configuration, along
with the deferred environment builds and resource limits, are described in
[workflows](workflow.md#sandboxes). Only sandbox workflows select Pi's built-in
coding-tools extension and include its `read`, `write`, `edit`, and `bash` tools
in their allowlist. Idle suspension and automatic teardown remain unimplemented.

## Adding a provider

A provider package should:

1. Implement the relevant `factory-oss` contract.
2. Keep authentication and provider-native types within the implementation.
3. Translate provider operations at the boundary instead of leaking them into
   Factory.
4. Propagate cancellation and make lifecycle operations safe to retry.
5. Export the implementation: integration factories or a `Sandbox` subclass.

Factory then receives the implementation through configuration and operates
only against the SDK contract.

## Current limits

The entry point listens on `127.0.0.1` and currently generates webhook URLs using
`http://localhost:<port>`. Public webhook addresses are not configured there yet.
Development startup loads workflows from `tests/workflows`, initializes their
in-memory tables, and registers DeepSeek. Production workflow acquisition is not
wired. Factory's database and Durable conversations default to memory, so
process restarts do not recover them. Conversation creation and session
persistence have no crash or concurrent-creation coordination yet.

Sandbox lifecycle automation and shutdown disposal of integrations are not
implemented. These APIs remain experimental.
