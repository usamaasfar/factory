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
  return {
    readIssue: defineTool({
      name: "read_issue",
      description: "Read an issue accessible to the configured client.",
      parameters: Type.Object({ id: Type.String() }),
      replay: "safe",
      async execute({ id }, _api, context) {
        try {
          const issue = await client.readIssue(id, { signal: context.abortSignal });
          return { content: `Read issue ${issue.id}: ${issue.title}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to read issue ${id}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
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
      ...Object.values(createIssueTools(client, ctx)),
      ...Object.values(createCommentTools(client, ctx)),
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
private until a matching definition interprets it. The host must implement these
capabilities; the SDK only declares their contract. The intended host registers
`POST /webhook/<configured-name>` once during startup and returns a URL using its
trusted public-base-URL configuration. Duplicate registration should fail.
The name is separate from provider kind; `github-work` can emit `github` events.
Hot unloading is not defined. Local registration does not configure the provider
remotely.

Integrations return `events` alongside `tools`. A provider-family factory returns
named `defineEvent<ProviderPayload>({ name, description, execute })` definitions.
Official provider types describe payloads after provider authentication. An optional
`parameters.parse` can perform runtime validation when the provider boundary needs it.

Factory owns the name-based registry. `ctx.events.receive(delivery)` looks up a
definition, executes it, and accepts its result. Unsupported names or ignored
deliveries return `false`. Duplicate definitions must fail startup.
There is no switch or provider-side event registry.

The experimental `EventResult` contains only a developer-constructed subject
path and factual content:

```ts
{
  subject: "repository:456:pull_request:42",
  content: "@alice opened PR #42 in acme/api: Fix login",
}
```

A comment can retain its specific identity:
`repository:456:pull_request:42:comment:789`. Review replies also retain their
parent comment and reply IDs. No subject parser or parent-routing policy is
implemented yet; the complete comment path is not automatically a new conversation.

Event name and delivery ID stay in `EventDelivery`; integration identity comes
from configuration. Returning `undefined` ignores a delivery—for example, an
ordinary issue comment when only PR comments are supported. This result deliberately differs from the
legacy `src/contracts/integration.ts` envelope. The application in `src/` is not
being rewritten or connected to this experimental API yet.

Provider-native payloads stay private. `content` is short factual context, not
instructions. The provider adapter authenticates deliveries; the host owns durable
acceptance and retry deduplication. Event acceptance must not wait for agent execution; acceptance failure
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
