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
- `docker.ts` starts the constrained container and executes commands in it.
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

Commands run through `/bin/bash -lc` inside the container. Only one command runs at a time. Output can be consumed as chunks while still being returned as final stdout and stderr.

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

## Publishing

Publishing is host-mediated and is not implemented in this directory. The existing trusted-host `GitHttpRemote.publishBundle()` verifies the expected remote head, verifies the Git bundle, requires a fast-forward relationship, and performs a non-force authenticated push without persisting credentials.

The remaining integration must let the sandbox create a Git bundle, transfer that bundle to trusted host code, and expose a narrow host-owned publishing tool. The model must never receive a token or credentialed remote.

## Next integration

The next layer is a Pi Durable `ExecutionEnv` adapter. It will map native `read`, `write`, `edit`, and `bash` operations onto this sandbox while keeping filesystem operations in the container namespace. Creating the global Pi harness and submitting a model event comes after that adapter is verified.
