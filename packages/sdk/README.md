# factory-oss SDK

One package with subpath exports. Integration primitives are available from
`factory-oss/integration`; their implementation lives in `src/integration.ts`.
Workflow, sandbox, and workspace contracts will be developed later.

## Shared setup and separate tools

Create authenticated SDK clients once, and pass them with Factory's context into
ordinary tool factories. Import the factories directly into the integration's
main file; no class, singleton, or intermediate tool registry is required.

```ts
// tools/issues.ts
import { defineTool, Type, type IntegrationContext } from "factory-oss/integration";
import type { ProviderClient } from "../client.ts";

export function createIssueTools(client: ProviderClient, ctx: IntegrationContext) {
  return [
    defineTool({
      name: "read_issue",
      description: "Read an issue accessible to the configured client.",
      parameters: Type.Object({ id: Type.String() }),
      replay: "safe",
      async execute({ id }) {
        const issue = await client.readIssue(id);
        return { content: [{ type: "text", text: JSON.stringify(issue) }] };
      },
    }),
  ];
}
```

```ts
// index.ts — provider implementation
import { defineIntegration } from "factory-oss/integration";
import { createAuthenticatedClient, type ProviderOptions } from "./client.ts";
import { createIssueTools } from "./tools/issues.ts";
import { createCommentTools } from "./tools/comments.ts";

export default defineIntegration(async (options: ProviderOptions, ctx) => {
  const client = await createAuthenticatedClient(options);
  return {
    tools: [
      ...createIssueTools(client, ctx),
      ...createCommentTools(client, ctx),
    ],
    // Optional, only when this client owns resources requiring cleanup.
    dispose: async () => { await client.close(); },
  };
});
```

Provider clients and tool modules above are integration-owned code. The optional
`ToolFactory<Client>` type describes `(client, ctx) => tools`. Named factory
functions preserve specific tool types without annotations.

`defineIntegration` types an ordinary factory without running or caching it.
The owner calls it once per configured integration and reuses its tools. Separate
calls create independent resources. Recovery recreates clients from trusted
configuration, not persisted agent data. The owner calls `dispose` after tools
are no longer in use. Failed initialization must release acquired resources.

## Webhooks and events

Factory supplies `IntegrationContext` with two capabilities:

```ts
const webhookUrl = ctx.webhook.register(async (request) => {
  // Integration-owned verification and provider-specific HTTP handling.
  const delivery = await receiveVerifiedProviderDelivery(request);
  const accepted = await ctx.events.receive(delivery);
  return new Response(null, { status: accepted ? 202 : 204 });
});
```

`receiveVerifiedProviderDelivery` represents provider implementation code, not an
SDK helper. It returns `{ id, name, payload }`, with the provider payload kept
private until a matching definition interprets it. Register once during startup, before serving requests. Factory mounts
`POST /webhook/<configured-name>` on its existing server and returns a URL using
its trusted public-base-URL configuration. Duplicate route registration fails.
The name is separate from provider kind; `github-work` can emit `github` events.
Routes currently live for the application's lifetime; hot unloading is not
implemented. Local registration does not configure the provider remotely.

Integrations return `events` alongside `tools`. Each event factory calls
`defineEvent({ name, description, parameters, execute })` and is independently
exported, just like a tool factory. `parameters` is a schema with a `parse`
method; it infers the payload type and validates before execution. Factories
accept `ctx` and are grouped in files by provider event family.

Factory owns the name-based registry. `ctx.events.receive(delivery)` looks up a
definition, executes it, and accepts its normalized result. Unsupported names
return `false` without executing anything. Duplicate definitions fail startup.
There is no switch or provider-side event registry.

Each definition returns the existing normalized event shape:

```ts
{
  integration: "github",
  instance: "123",          // Installation/account identity
  id: "delivery-id",        // Delivery identity within that instance
  name: "pull_request.opened",
  scope: "456",             // Workflow matching boundary
  subject: "repository:456:pull_request:42",
  content: "@alice opened PR #42 in acme/api: Fix login",
}
```

Provider-native payloads stay private. `content` is short factual context, not
instructions. The host validates events and owns durable acceptance and retry
deduplication. Event acceptance must not wait for agent execution; acceptance failure
must not produce a success acknowledgement. Slack-specific acknowledgement and
challenge requirements belong to its adapter when implemented.

Authentication, signature verification, token refresh, and resource authorization
remain provider-owned. Credentials are never model-generated arguments. Shared
clients do not grant all tools to all agents. In-process integrations are trusted
code, not a security isolation boundary. Session/workspace capabilities are not
defined yet. The setup context is separate from tool invocation context.

## Tool runtime compatibility

`defineTool` and its types use `@earendil-works/pi-durable@1.0.2`. `Type` uses the
matching `pi-ai` schema library. This is intentionally runtime-coupled for now.

- `parameters` infers `execute` arguments; the agent runtime validates them.
- `execute(args, api, context)` retains invocation APIs and cancellation context.
- `replay: "safe"` allows interrupted execution to rerun. Mutations normally use
  `"unsafe"`, also the runtime default.
- Results use the existing content/details contract.
- Calling `execute` directly does not perform argument validation.
- Defining a tool or integration has no authentication/network side effects;
  invoking the integration factory initializes provider resources.

## Development

```sh
bun install
bun run typecheck
```
