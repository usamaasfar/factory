# Extensibility

Factory separates orchestration from provider-specific behavior so integrations
and sandbox backends can evolve without changing the core runtime.

```text
sdk/*                Provider-neutral contracts
integrations/*       Built-in integration adapters
sandbox/*            Built-in sandbox providers
src/*                Factory orchestration and runtime
```

## Design

Factory owns workflow matching, event dispatch, durable sessions, workspace
lifecycle, retention, and execution policy. Providers own authentication,
external API clients, webhook verification, resource identities, compute,
storage, and transport.

The SDK defines only the boundary between them. Its contracts are derived from
working providers rather than a speculative plugin framework. Implementations
are ordinary factory functions and typed objects; there are no base classes,
global registries, or provider dispatch layers.

## Integrations

`factory-oss/integration` defines integration factories, tools, events, and
webhook capabilities. An integration creates its authenticated provider client
and returns the tools and event definitions available to Factory.

Provider adapters authenticate incoming deliveries and translate them into
verified `{ id, name, payload }` events. Factory owns event lookup, durable
acceptance, deduplication, and execution. Provider payloads and credentials stay
inside the adapter.

Built-in GitHub, Slack, and Linear implementations live under
[`integrations`](../integrations/README.md).

## Sandboxes

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
[`sandbox`](../sandbox/README.md). Other providers, such as Modal
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

These APIs are experimental and intentionally small. New primitives should be
added only when concrete providers demonstrate a shared requirement.
