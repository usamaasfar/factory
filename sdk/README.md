# factory-oss SDK

Integration primitives are exported from `factory-oss/integration`; sandbox
primitives from `factory-oss/sandbox`. The SDK defines capabilities. Factory
owns workflow policy, tool selection, authorization, and durable execution.

## Resources and tools

A resource is a named permission boundary containing tools and, optionally,
child resources. Integration and resource identity come from containment;
each tool declares only its required `access`.

```ts
import {
  defineIntegration,
  defineResource,
  defineTool,
  Type,
} from "factory-oss/integration";

interface IssueClient {
  getIssue(id: string): Promise<{ title: string }>;
  close(): Promise<void>;
}

function createIssuesResource(client: IssueClient) {
  return defineResource({
    name: "issues",
    tools: [
      defineTool({
        name: "get_issue",
        description: "Read an issue in the configured scope.",
        access: "read",
        replay: "safe",
        parameters: Type.Object({ id: Type.String() }),
        async execute({ id }) {
          const issue = await client.getIssue(id);
          return { content: issue.title };
        },
      }),
    ],
  });
}

export const createIntegration = defineIntegration(
  (options: { client: IssueClient }, _context) => ({
    resources: [createIssuesResource(options.client)],
    dispose: () => options.client.close(),
  }),
);

export default createIntegration;
```

Use ordinary functions and closures to share provider clients across resources.
No classes, singleton clients, dependency containers, or tool registries are
needed. `defineResource` preserves the definition's inferred type and returns
the same object. It does not initialize clients or grant access.

Container resources may omit `tools`:

```ts
const repository = defineResource({
  name: "repository",
  resources: [contentsResource, pullRequestsResource],
});
```

The configured integration provides the outer namespace. Each nested resource
adds a path segment. A child resource is a separate permission boundary:
permission on a parent must not implicitly grant access to children.
Tools inherit ownership, not an access level; every tool requires an explicit
`access: "read" | "write"`.

The host must validate resource names, reject duplicate sibling resources and
ambiguous tool names, and check requested permissions against known resources.
Definitions are trusted in-process code, not a security isolation boundary.
Resources do not include sections, files, hooks, wrappers, or tasks yet.

### Permission contract

The intended workflow declaration is outside `agent`:

```yaml
permissions:
  github:
    contents: read
    pull_requests: write
```

The Factory parser accepts `read` and `write`; omit a resource for no grant.
The intended policy is that `write` includes `read` and deployment policy caps
grants. Resource scope comes from trusted configuration, not model arguments.

**This SDK does not enforce permissions or implement the workflow syntax.**
Factory must both omit unauthorized tools and check permissions and resource
scope before execution, including nested calls and recovery. Exporting a
resource is not a grant of access.

### Tool execution

`defineTool` uses the installed `pi-durable@1.0.2` tool contract:

- `parameters` infers the arguments of `execute(args, api, context)`.
- Execution retains Pi's invocation API and cancellation context.
- Results may use plain `{ content: string }` or Pi content blocks.
  Plain text is adapted without dropping `isError`, `details`, diagnostics,
  usage, or control fields. Omitted content allows Pi's streamed output.
- `access` is required and independent of `replay`. An idempotent write may
  be replay-safe; replay safety never grants read or write permission.
- Defining a tool performs no network calls. Calling `execute` directly does
  not validate arguments or enforce authorization.

### Integration lifecycle

`defineIntegration` types a synchronous or asynchronous setup function without
executing or caching it. It returns `resources`, optional `events`, and an
optional `dispose` function. The owner invokes setup per configured scope,
recreates it after recovery, and calls `dispose` only after all uses have ended.
Setup failures must clean up already acquired provider resources.

Credentials remain in provider closures, outside model arguments and sandbox
files. Authentication, token refresh, and provider-native authorization remain
integration responsibilities.

## Webhooks and events

The setup-only `IntegrationContext` exposes:

- `webhook.register(handler)`: register an integration-owned HTTP handler and
  obtain its configured URL.
- `events.receive({ id, name, payload })`: submit a verified provider delivery;
  `false` means unsupported or ignored.

Integrations return event definitions alongside resources:

```ts
import { defineEvent } from "factory-oss/integration";

const opened = defineEvent<{ issueId: string; title: string }>({
  name: "issue.opened",
  description: "An issue was opened.",
  execute({ payload }) {
    return {
      subject: `issue:${payload.issueId}`,
      content: `Issue opened: ${payload.title}`,
    };
  },
});
```

Returning `undefined` ignores a delivery. An optional `parameters.parse`
validates provider payloads; TypeScript payload types alone do not.
Provider handlers verify signatures and handle challenges and acknowledgement
deadlines. Factory owns event-name registration, durable acceptance, and
delivery deduplication. Acceptance must not wait for agent execution or
acknowledge success when persistence fails.

Event subjects are integration-relative resource ancestry paths using stable IDs,
ordered from parent to child. The integration registry supplies the provider
namespace; subjects do not repeat it. Related events share parent paths; replies use
provider-supplied parent or thread identity, never inferred relationships.
Subjects contain neither action names, message text, nor delivery IDs. Delivery
`id` remains separate for deduplication, and `content` carries agent-facing text.
Factory owns subject matching and session routing; see
[event routing](../docs/routing.md).

Event content is factual context, not instructions. The setup context is not
the tool invocation context. Factory now loads configured integration factories
and connects verified deliveries to event resolution and workflow submission.
The API forwards raw requests to the registered webhook handler. Configuration
and startup are described in [extensibility](../docs/extensibility.md).

Delivery `id` is currently required. The adapter chooses how to obtain a stable
ID; Factory namespaces it for Durable's per-conversation deduplication. Do not
substitute a resource subject: separate events on that resource must remain
separate inputs.

## Migration

This redesign intentionally breaks the old flat integration API:

- Return `resources: [defineResource({ name, tools })]` instead of `tools`.
- Add explicit `access` to every tool.
- Replace `ToolFactory` annotations with ordinary inferred resource factories.
- `IntegrationTool` now includes required access metadata.

The built-in adapters use these resource and event contracts. Factory parses
workflow permissions, but tool registration, permission enforcement, and sandbox
wiring are not implemented. Conversations currently select no tools.

## Sandboxes

The sandbox entry point is a barrel over focused modules:

- `sandbox/provider.ts`: compute and persistent-storage lifecycle.
- `sandbox/command.ts`: command transport contracts.
- `sandbox/environment.ts`: the Pi Durable command-backed environment adapter.

`SandboxProvider` separates Factory's workspace lifecycle from infrastructure:

```ts
interface SandboxProvider {
  open(key: string, context: Context): Promise<ExecutionEnv>;
  suspend(key: string, context: Context): Promise<void>;
  destroy(key: string, context: Context): Promise<void>;
}
```

`open` creates or resumes compute attached to persistent storage. `suspend`
releases compute while preserving that storage, and `destroy` removes both.
Operations use a stable Factory key and must tolerate retries. Authentication,
provider resource IDs, and storage mechanics remain implementation details.

Providers may implement Pi Durable's `ExecutionEnv` directly. Providers with a
POSIX command transport can instead use `createCommandSandboxEnvironment`:

```ts
return createCommandSandboxEnvironment({
  id: `provider:${persistentResourceId}`,
  cwd: "/workspace",
  run: async (command, context) => {
    // Execute the command through the provider and return its exit code.
  },
});
```

The command adapter supplies Pi's filesystem and shell behavior. Its image must
provide Bash and GNU coreutils. The runner preserves stdout/stderr arrival order,
awaits output callbacks, and stops an active command before cancellation settles.
Equal environment IDs must see the same files at the same paths. `cleanup()`
cancels work started through that environment handle; it does not suspend or
destroy provider resources.

The local Docker reference provider lives in
[`sandboxes`](../sandboxes/README.md). Other providers, such as Modal
or E2B, can implement `SandboxProvider` without changing Factory or this SDK.

## Development

```sh
bun install
bun run typecheck
```
