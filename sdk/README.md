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

`factory-oss/sandbox` is a standalone, command-backed Linux sandbox primitive.
It imports no Pi or Chord modules. Providers extend `Sandbox` and implement
one protected method, `start(command)`. Factory/Pi integration belongs in a
separate adapter; none is included here.

### Implementing a provider

This example illustrates a native client mapping, not a specific vendor API.
`NativeClient` belongs to the provider implementation.

```ts
import {
  Sandbox,
  type SandboxCommand,
  type SandboxProcess,
} from "factory-oss/sandbox";
import type { NativeClient } from "./native-client";

export class MySandbox extends Sandbox {
  constructor(private readonly client: NativeClient) {
    super({ id: `my-provider:${client.id}`, cwd: "/workspace" });
  }

  protected async start(input: SandboxCommand): Promise<SandboxProcess> {
    const process = await this.client.spawn({
      command: input.command,
      cwd: input.cwd,
      env: input.env,
      inheritEnv: input.inheritEnv,
      stdin: input.stdin,
      signal: input.signal,
    });

    return {
      output: process.output,
      exited: process.wait().then((result) => result.exitCode),
      stop: () => process.kill(),
    };
  }
}
```

The provider's actual mapping must satisfy these requirements:

- Execute Bash source inside the sandbox, with the given absolute cwd and
  environment. `inheritEnv` refers to the sandbox, never the Factory host.
- Deliver binary stdin, then EOF. Without stdin, close input immediately.
- Return a process handle promptly, not after execution finishes. Respect
  `signal` during startup. If startup rejects after creating a command, stop
  that command before rejecting; the SDK cannot stop a handle it never received.
  A safely cancelled startup can reject with the signal's reason or AbortError.
  Report uncertain termination/cleanup failures separately, not as ordinary aborts.
- `output` is one async iterable of raw stdout/stderr chunks. Preserve order
  within each stream; separate pipes cannot promise exact cross-stream ordering.
- `exited` resolves with any normal exit code, including nonzero values.
  Transport failures reject instead; do not infer them from application stderr.
- `stop()` must stop the actual execution and its descendants, cause `exited`
  to settle, and close output without waiting for it to be consumed. It must be
  safe after exit or repeated calls.
  Cancelling a local client request alone is not sufficient.

### Using a sandbox

```ts
const sandbox = new MySandbox(nativeClient);

await sandbox.writeFile("hello.txt", "Hello");
const text = await sandbox.readTextFile("hello.txt");
const bytes = await sandbox.readFile("hello.txt");

const { exitCode } = await sandbox.exec("cat hello.txt", {
  timeout: 30,
  onOutput: (text, stream) => console.log(stream, text),
});

await sandbox.cleanup();
```

The SDK provides:

- `exec`: shell execution with optional cwd, environment, binary stdin, timeout
  in seconds, `AbortSignal`, and streamed UTF-8 output. Output callbacks are
  awaited serially. Output is not accumulated; the result contains only the
  exit code. Nonzero exits do not throw.
- `readFile` / `readTextFile`: complete binary/UTF-8 file reads.
- `writeFile`: string or binary writes, creating parent directories.
- `cleanup`: cancel and await operations already started through this handle.
  The handle remains usable. Cleanup never removes files or infrastructure and
  reports failures to stop execution instead of silently ignoring them.

Execution failures and failed output callbacks trigger stop-and-drain cleanup.
Successful cancellation rejects with the signal's reason; timeouts use a
`TimeoutError` DOMException. Other startup/termination failures are preserved,
not masked as cancellations. Invalid arguments use TypeError. File-command
failures throw Error; the SDK does not copy Pi's error/result types or filesystem
interface.

Equal sandbox IDs must identify the same files at the same absolute paths.
The cwd defaults to `/workspace` and is a resolution base, not a security boundary.
Filesystem helpers use Bash, `cat`, and `mkdir` through the same native execution
primitive; they never read or write the host filesystem. File reads buffer the
whole file. Isolation and credentials remain the provider's responsibility.

### Source layout

- `sandbox/command.ts`: public command/process contracts and options.
- `sandbox/sandbox.ts`: the base class, public methods, and active-operation tracking.
- `sandbox/process.ts`: output delivery, cancellation, and stop-and-drain coordination.
- `sandbox/index.ts`: public exports.

There is no compatibility layer, built-in provider, lifecycle manager, Pi adapter,
spill policy, or workflow wiring in this slice.

## Development

```sh
bun install
bun run typecheck
```
