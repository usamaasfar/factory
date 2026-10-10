# factory-oss SDK

One package with subpath exports. Integration primitives are available from
`factory-oss/integration`. Workflow, sandbox, and workspace modules will be added
as their contracts are developed.

Primitives for tools and shared integration setup. All public implementation
lives in `src/integration.ts`.
Events, webhooks, registration, and workspace lifecycle are out of scope.

## Setup and separate tool modules

Use a factory function to create authenticated clients once per configured
scope. Pass the client and Factory's construction context to tool modules.
No class, singleton, or global tool registry is needed.

```ts
// tools/issues.ts
import {
  defineTool,
  Type,
  type IntegrationContext,
} from "factory-oss/integration";
import type { ProviderClient } from "../client.ts";

export function createIssueTools(
  client: ProviderClient,
  ctx: IntegrationContext,
) {
  // ctx is empty today; reserved for concrete Factory host capabilities.
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
// tools/index.ts
import type { IntegrationContext } from "factory-oss/integration";
import type { ProviderClient } from "../client.ts";
import { createIssueTools } from "./issues.ts";
import { createCommentTools } from "./comments.ts";

export function createProviderTools(
  client: ProviderClient,
  ctx: IntegrationContext,
) {
  return [
    ...createIssueTools(client, ctx),
    ...createCommentTools(client, ctx),
  ];
}
```

```ts
// index.ts — integration implementation
import { defineIntegration } from "factory-oss/integration";
import { createAuthenticatedClient, type ProviderOptions } from "./client.ts";
import { createProviderTools } from "./tools/index.ts";

export default defineIntegration(async (options: ProviderOptions, ctx) => {
  const client = await createAuthenticatedClient(options);

  return {
    tools: createProviderTools(client, ctx),
    // Optional, when the provider owns resources requiring cleanup.
    dispose: async () => {
      await client.close();
    },
  };
});
```

The provider client, configuration, and comment module above are integration-owned
code, not APIs supplied by this package. The optional `ToolFactory<Client>` type
also describes the `(client, ctx) => tools` convention; ordinary named factory
functions preserve specific tool types without annotations.

## Ownership

Factory supplies trusted options and the construction context:

```ts
const ctx: IntegrationContext = {};
const integration = await setup(options, ctx);
// Reuse integration.tools for the permitted agents in this scope.
// After those agents are no longer using the tools:
await integration.dispose?.();
```

Import `IntegrationContext` from `factory-oss/integration` in the owner code.
The same context is passed through setup into every tool factory. It is separate
from the runtime's per-invocation execution context.

`defineIntegration` types an ordinary factory without running or caching it. Separate
calls create independent scopes. On restart, the owner recreates setup from
trusted configuration. Clients and credentials are not persisted as agent data.
If initialization fails after acquiring resources, the implementation must
release them before rejecting. Cleanup is explicit.

Client reuse does not disable token refresh or resource authorization. Refresh
belongs to the provider SDK. Integrations must enforce account/resource access;
Factory must not grant every tool to every agent automatically. In-process
integration implementations are trusted code, not an isolation boundary.

## Tool contract

`defineTool` and its types use `@earendil-works/pi-durable@1.0.2`. `Type` uses the
matching `pi-ai` schema library. This is intentionally runtime-coupled for now.

- `parameters` infers the argument type of `execute`.
- `execute(args, api, context)` uses the existing invocation API and cancellation
  context. Provider transports must honor cancellation when applicable.
- `replay: "safe"` allows interrupted execution to run again. Mutations should
  normally use `"unsafe"`, which is also the runtime default.
- Results use the runtime's content/details contract.
- The agent runtime validates arguments before execution. Calling `execute`
  directly does not perform validation.
- Defining a tool or setup has no authentication or network side effects.

No extra executor, validation layer, or registration mechanism is introduced.

## Development

```sh
bun install
bun run test
bun run typecheck
```
