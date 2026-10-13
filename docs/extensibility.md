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

List enabled integrations in `.factory/integrations.ts`. Each entry supplies a
module entry-file path and provider options. Built-ins and trusted custom modules
use the same default-exported `(options, context) => Integration` factory.
Nothing is enabled automatically; the checked-in list is empty.

For example, a Slack configuration can use environment variables:

```ts
export default [
  {
    path: "integrations/slack/index.ts",
    options: {
      token: Bun.env.SLACK_TOKEN ?? "",
      signingSecret: Bun.env.SLACK_SIGNING_SECRET ?? "",
      teamId: Bun.env.SLACK_TEAM_ID ?? "",
    },
  },
];
```

Custom entries can point to `.factory/integrations/notion/index.ts`. Paths are
resolved from the working directory, and the parent directory supplies the
namespace (`notion`). Duplicate namespaces are rejected. Modules execute with
Factory's privileges and must be trusted. Dynamic module paths are not
automatically embedded in a compiled executable.

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

The workflow parser accepts an optional sandbox, but conversation creation does
not provision one or select any tools yet. Integration resources are loaded and
retained, but they are not installed in Durable's registry.

The intended policy is that authorized integration tools run in Factory without
a sandbox, while coding tools require a sandbox's `ExecutionEnv`. Factory must
never fall back to the host filesystem or shell.

`factory-oss/sandbox` defines the `SandboxProvider` lifecycle:

```ts
interface SandboxProvider {
  open(key: string, context: Context): Promise<ExecutionEnv>;
  suspend(key: string, context: Context): Promise<void>;
  destroy(key: string, context: Context): Promise<void>;
}
```

Factory supplies a stable key and decides when resources are opened, suspended,
or destroyed. The provider decides how compute and persistent storage implement
those operations.

Providers may implement Pi Durable's `ExecutionEnv` directly. Providers with a
POSIX command transport can use `createCommandSandboxEnvironment()` to obtain
shared filesystem and shell behavior without duplicating it.

The built-in local Docker provider lives under
[`sandboxes`](../sandboxes/README.md). Other providers, such as Modal
or E2B, can implement the same contract without changing Factory.

## Adding a provider

A provider package should:

1. Implement the relevant `factory-oss` contract.
2. Keep authentication and provider-native types within the implementation.
3. Translate provider operations at the boundary instead of leaking them into
   Factory.
4. Propagate cancellation and make lifecycle operations safe to retry.
5. Export a plain factory function that returns the typed implementation.

Factory then receives the implementation through configuration and operates
only against the SDK contract.

## Current limits

The entry point listens on `127.0.0.1` and currently generates webhook URLs using
`http://localhost:<port>`. Public webhook addresses are not configured there yet.
Startup wires integration registration and webhook dispatch, but not workflow
file loading, database table initialization, or model provider registration.
Factory's database and Durable conversations default to memory; process restarts
do not recover them. Conversation creation and session persistence are separate
operations, with no crash or concurrent-creation coordination yet.

Tool permission enforcement, sandbox lifecycle wiring, and shutdown disposal of
integrations are also not implemented. These APIs remain experimental.
