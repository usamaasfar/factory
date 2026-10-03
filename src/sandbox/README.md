# Factory sandbox

This directory prepares and runs the isolated filesystem where an agent works.
It deliberately does not contain Pi Durable orchestration, model access, provider credentials, or Git publishing.

## Lifecycle

```text
provider repository
  -> prepareWorkspace()
  -> persistent credential-free checkout
  -> buildEnvironmentImage()
  -> cached OCI image
  -> DockerSandbox.start()
  -> disposable container with the checkout at /workspace
```

The workspace and image survive container replacement. The container and its processes do not.

## Files

- `workspace.ts` creates or verifies the workspace owned by one workflow session.
- `image.ts` builds or reuses an image from a trusted managed environment script.
- `docker.ts` starts the constrained container and executes serialized processes in it.
- `filesystem.ts` is the small filesystem helper copied into managed images and invoked inside the container.
- `execution-env.ts` implements Pi Durable's complete `ExecutionEnv` contract.
- `index.ts` is the directory's public API.
- `workspace.test.ts` covers workspace creation, safe reuse, and input validation.

## Workspace

A workspace lives at:

```text
.factory/state/workspaces/<workflow-session-id>/
```

Creation is atomic: Factory clones into a temporary sibling directory, verifies it, and renames it into place. Existing workspaces are accepted when the session's original revision is an ancestor of the current `HEAD`; this preserves later agent commits.

A valid workspace has no Git remotes and no credential-bearing local Git configuration. Provider credentials exist only in trusted host process memory. The sandbox therefore cannot authenticate a push by itself.

## Environment image

`buildEnvironmentImage()` hashes:

- the trusted environment script,
- the immutable base-image digest, and
- Factory's image format version.

The full digest is both the image tag and an image label checked on cache lookup. Factory builds with a temporary context containing only the generated `Containerfile` and environment script; repository source is mounted later rather than baked into the image.

Managed images provide an unprivileged `factory` user and `/workspace`. Support for complete repository-defined Dockerfiles is intentionally deferred.

## Docker container

`DockerSandbox` starts one disposable container for a workflow session with:

- a read-only root filesystem,
- writable in-memory `/tmp` and `/home/factory`,
- the persistent workspace bind-mounted at `/workspace`,
- CPU, memory, and PID limits,
- all Linux capabilities dropped,
- `no-new-privileges`,
- no host Docker socket or credentials, and
- explicit `bridge` or disabled networking.

Commands run through `/bin/bash -lc` inside the container. Concurrent requests queue because cancelling one command replaces the whole container. Output can be consumed as chunks without retaining an unbounded copy in host memory.

A timeout or `AbortSignal` cancellation removes the whole container. Killing only the local `docker exec` client would not reliably terminate every descendant process. The next command recreates the container and remounts the unchanged workspace.

The stable logical identity is:

```text
factory:workflow-session:<id>
```

It remains unchanged when the Docker container ID changes.

## Trust boundary

```text
trusted host
  credentials, model access, cloning, publishing, durable state
       |
       | only the credential-free workspace is mounted
       v
sandbox
  repository files and coding commands
```

Shell commands may inspect the container's own filesystem. They cannot access host paths other than the mounted workspace.

## Pi Durable execution environment

`DockerExecutionEnv` implements Pi Durable's documented filesystem and shell interfaces. Its `id` is the sandbox's stable workflow-session identity and its `cwd` defaults to `/workspace`.

Filesystem requests are sent as JSON to the read-only helper installed at `/usr/local/lib/factory/filesystem.ts`. File contents are base64 encoded, so arbitrary bytes survive the JSON boundary. Paths are lexically confined to `/workspace`; the helper also resolves existing paths and parents inside the container to reject symlink escapes. File errors are returned as Pi `FileError` values instead of being thrown.

Shell timeouts are specified by Pi in seconds and converted to Docker's millisecond timer. `Context.abortSignal` cancels both filesystem and shell operations. Shell output streams to Pi as it arrives. When Pi's byte or line threshold is crossed, the complete output is retained under `.git/factory/tmp/`, outside the Git working tree. This internally generated spill file is the one narrow host-side write: its path is not model-controlled, and it refers to the same workspace mounted into the container.

`cleanup()` does not stop the sandbox because Pi may create a fresh environment object for every tool call. The workflow-session lifecycle owner stops the shared container after work settles.

## Publishing

Publishing is host-mediated and is not implemented in this directory. The existing trusted-host `GitHttpRemote.publishBundle()` verifies the expected remote head, verifies the Git bundle, requires a fast-forward relationship, and performs a non-force authenticated push without persisting credentials.

The remaining integration must let the sandbox create a Git bundle, transfer that bundle to trusted host code, and expose a narrow host-owned publishing tool. The model must never receive a token or credentialed remote.

## Next integration

The adapter has been verified directly and through Pi Durable's native `read`, `write`, `edit`, and `bash` tools without invoking a model. The next checkpoint is the global Pi Durable storage and harness, conversation linkage through `workflow_sessions.conversation_id`, and the first factual event submission.
