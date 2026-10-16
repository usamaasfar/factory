# Local Docker sandbox

A Docker Engine provider using `factory-oss/sandbox`. Provider code imports no
Pi or Chord APIs. It uses `dockerode` for native Docker operations rather than
spawning a CLI or identifying errors by matching stderr.

## Usage

Build the minimal Linux image from the repository root:

```sh
docker build -f sandboxes/local-docker/Dockerfile -t factory-sandbox:local .
```

```ts
import { createLocalDockerSandboxProvider } from "./sandboxes/local-docker/index.ts";

const provider = createLocalDockerSandboxProvider({
  image: "factory-sandbox:local",
});

const sandbox = await provider.open("workspace-id");
try {
  await sandbox.writeFile("hello.txt", "Hello\n");
  const result = await sandbox.exec("cat hello.txt", {
    timeout: 30,
    onOutput: (text, stream) => {
      (stream === "stdout" ? process.stdout : process.stderr).write(text);
    },
  });
  console.log(result.exitCode);
} finally {
  await sandbox.cleanup();
}

await provider.suspend("workspace-id");
const resumed = await provider.open("workspace-id");
console.log(await resumed.readTextFile("hello.txt"));
await provider.destroy("workspace-id");
```

The image must already exist in Docker. No implicit pulls or environment installs
occur. Custom images need `/bin/bash`, GNU coreutils under `/usr/bin`, and
`/usr/bin/setsid` (util-linux). Build language tooling and dependencies into the
image; the runtime root filesystem is read-only.

Connection defaults follow dockerode's standard socket / `DOCKER_HOST` settings,
not the Docker CLI's selected context. Pass `socketPath` for another local socket.
No Docker socket, host directory, or Factory credentials are mounted inside.

## Lifecycle

- `open(key)` creates or reuses a container and named `/workspace` volume. Keys
  determine resource names; ownership labels are checked before reuse or removal.
  Images are resolved to immutable local image IDs. An existing container with a
  different image is rejected: suspend it before opening with the new image.
- `suspend(key)` force-removes compute, stopping all its processes, but keeps the
  volume. Only `/workspace` persists; `/tmp` is disposable.
- `destroy(key)` removes compute and its owned volume. Missing resources are
  harmless. Volumes still used by another container are not force-deleted.
- `sandbox.cleanup()` cancels this handle's current commands. It does not suspend
  the sandbox or delete files. Handles refer to a particular container ID and
  must not be reused after suspension or destruction; call `open` again.

Factory must coordinate lifecycle transitions for each key. This provider has no
idle timers, retention policy, initialization state, or cross-process lifecycle
locks. An interrupted `open` can leave owned resources for a later retry or
explicit `destroy`; it never deletes persistent data as automatic rollback.

## Execution

Each command runs in a separate Linux process group. Cancellation uses a second
Docker exec to kill that group, including ordinary child processes, and waits
for termination. A marker handles cancellation before the group ID is published.
Stopping only the attached client stream is not considered termination.

The supervising shell also kills remaining group members when the main command
exits. Background jobs have no survival guarantee. Commands must not daemonize
or deliberately escape their process group; command groups are not a security
boundary between mutually untrusted programs. Suspension/destruction stops the
whole container, including escaped processes.

Binary stdin is sent with EOF, while stdout/stderr are decoded from Docker's
non-TTY stream framing. The SDK handles text decoding and output callbacks.
Exit status is observed through Docker's exec-inspect API, independently of output
consumption. Docker transport failures reject; normal nonzero exits remain
results. Failures to confirm termination are reported, not silently ignored.
Startup cancellation arms the native cancellation marker and confirms termination
before aborting an outstanding start request. Working directories are checked
through Docker's archive-stat API, including directory symlinks. Stop requests
have a ten-second control timeout; this is not a hard execution deadline during
daemon failures.

Containers use an init process, dropped capabilities, `no-new-privileges`, a
read-only root, and a 256 MiB `/tmp` tmpfs. There is no host execution fallback.
The provider does not yet configure CPU/memory limits or storage quotas.
Factory assigns sandboxes to workflow conversations and opens them lazily; see
[workflow configuration](../../docs/workflow.md#sandboxes). The SDK provides
`sandbox.toExecutionEnv(cwd?)` for Pi Durable 1.0.2; provider code remains Pi-free.
