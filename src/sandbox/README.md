# Sandbox

Factory's sandbox layer exposes persistent, isolated compute as Pi Durable's
`ExecutionEnv`. It targets the installed `@earendil-works/pi-durable@1.0.2`
API; dependency upgrades require an explicit compatibility review.

```text
SandboxProvider
  lifecycle + command transport
          │
          ▼
FactorySandbox
  Pi filesystem + shell semantics
          │
          ▼
Pi Durable ExecutionEnv
```

Provider implementations do not implement Pi's filesystem and shell APIs.
They manage infrastructure and supply a command runner; `FactorySandbox`
provides the shared Pi behavior.

## Files

- `command.ts` defines the backend-neutral command transport.
- `provider.ts` defines sandbox infrastructure lifecycle.
- `factory-sandbox.ts` implements Pi's `ExecutionEnv` through commands.
- `docker/local.ts` implements ordinary local Docker Engine containers.
- `docker/remote.ts` documents the future Docker-managed cloud provider.
- `docker/local.test.ts` verifies the local provider through Pi behavior.
- `index.ts` exports the public sandbox API.

## Provider contract

```ts
interface SandboxProvider {
  open(key: string, context: Context): Promise<FactorySandbox>;
  suspend(key: string, context: Context): Promise<void>;
  destroy(key: string, context: Context): Promise<void>;
}
```

- `open()` creates or resumes compute attached to stable persistent storage.
- `suspend()` releases compute while preserving storage.
- `destroy()` permanently removes compute and storage.

All lifecycle operations use a stable Factory key and must tolerate retries.
Expiration policy belongs to the workspace layer, which calls these primitives.
`Context` only controls the current operation; it does not carry retention
policy.

Providers construct the shared adapter:

```ts
new FactorySandbox({
  id,
  cwd: "/workspace",
  run,
});
```

## Command transport

`SandboxCommandRunner` must support:

- working directory;
- inherited or isolated environment variables;
- binary or text standard input;
- ordered stdout and stderr callbacks;
- command exit codes;
- context cancellation.

Cancellation must terminate the command inside the sandbox before the runner
settles. Merely terminating a host CLI process is insufficient because it can
leave the remote command running.

## FactorySandbox semantics

`FactorySandbox` implements the installed Pi Durable `ExecutionEnv`:

- text and binary file I/O;
- append, truncate, flush, rename, remove, and directory operations;
- metadata, canonical paths, directory listing, and existence checks;
- temporary files and directories;
- text line reading;
- shell execution with cwd, environment, timeout, streaming output, and spill;
- expected failures through Pi's `Result`, `FileError`, and `ExecutionError`.

`cleanup()` is deliberately non-destructive. It cancels and waits for operations
started through that `FactorySandbox` handle, but it does not suspend compute or
delete persistent files.

The runtime contract is Unix-oriented. Provider images must include Bash, GNU
coreutils, `setsid`, and `sleep`. Git, tar, language runtimes, and other coding
tools belong to the workspace/environment image contract rather than this core
transport contract. Factory's baseline workspace image is defined in
`docker/coding.Dockerfile`.

## Local Docker provider

`LocalDockerSandboxProvider` uses the Docker CLI through `Bun.spawn()`; no Docker
npm dependency is required.

For each stable key it maintains:

- a deterministic, collision-resistant container name;
- a deterministic named volume mounted at `/workspace`;
- `com.factory.sandbox` ownership labels validated before reuse or removal.

Compute runs with:

- a read-only root filesystem;
- writable `/workspace` persistent storage;
- a writable `/tmp` tmpfs;
- all capabilities dropped;
- `no-new-privileges`;
- an init process.

`suspend()` force-removes only the container. A later `open()` creates compute
around the existing volume. `destroy()` removes both resources.

Commands run through `docker exec`. Each command gets an isolated Linux process
group. Cancellation sends `SIGTERM`, waits briefly, and falls back to `SIGKILL`.
Callback failures and context cancellation use the same cleanup path.

This backend is ordinary Docker Engine. It is not Docker's standalone `sbx`
microVM CLI and does not require KVM.

## Remote provider

The future remote implementation will use the experimental
`@docker/sandboxes` TypeScript SDK rather than `sbx --cloud`. It must preserve
the same provider and command-runner contracts while mapping suspend/resume to
Docker-managed compute and storage.

Remote resource identifiers may require persistent Factory key-to-resource
mapping. That mapping is provider infrastructure state, separate from workspace
retention policy.

## Testing

`docker/local.test.ts` is an integration/conformance suite. It obtains an
`ExecutionEnv` through the provider and verifies the behavior Pi depends on:

- filesystem semantics;
- shell semantics;
- output, environment, exit codes, spill, and callback failures;
- timeout and cancellation;
- non-destructive cleanup;
- compute suspension and storage resumption;
- permanent destruction.

Tests use `FACTORY_SANDBOX_TEST_IMAGE` when set, otherwise
`factory-sandbox:test`. They skip when Docker or that image is unavailable.

## Known follow-up work

The current adapter intentionally targets Pi Durable 1.0.2, but several
behavioral differences from Pi's Node environment remain candidates for later
hardening:

- `~`, `~/...`, and `file://` path handling;
- line readers currently buffer the full file;
- file modification time has second-level precision;
- some filesystem command failures can only be mapped to `unknown`;
- temporary filename components are deliberately restricted;
- directory listing performs an additional metadata command per entry;
- spill uses Bash and `tee`, merges stderr into stdout, and can affect command
  behavior.

Do not add APIs from unreleased Pi versions until the installed dependency is
upgraded and re-audited.
