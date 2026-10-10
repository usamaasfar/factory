# Sandbox

Factory's built-in sandbox providers implement the provider-neutral contracts
from [`factory-oss/sandbox`](../../sdk/README.md#sandboxes). The workspace layer
owns initialization, idle suspension, and retention policy; providers own
compute, persistent storage, and command transport.

## Local Docker

`createLocalDockerSandboxProvider()` uses the Docker CLI through `Bun.spawn()`.
It creates one deterministic container and named volume for each stable Factory
key and validates their `com.factory.sandbox` ownership labels before reuse or
removal.

```ts
import { createLocalDockerSandboxProvider } from "./local.ts";

const provider = createLocalDockerSandboxProvider({
  image: "factory-coding:test",
});
```

`open()` creates or starts a container and returns a command-backed Pi Durable
`ExecutionEnv`. `suspend()` removes the container while preserving its volume.
`destroy()` removes both resources. All lifecycle operations are idempotent.

Containers run with:

- a read-only root filesystem;
- a persistent volume mounted at `/workspace`;
- a writable `/tmp` tmpfs;
- all capabilities dropped;
- `no-new-privileges`;
- an init process.

Commands run through `docker exec` in isolated process groups. Cancellation
sends `SIGTERM`, waits briefly, and then sends `SIGKILL`; stopping only the host
Docker CLI process is not sufficient. Environment cleanup cancels commands
started through that handle but does not suspend compute or remove files.

The command adapter requires Bash, GNU coreutils, `setsid`, and `sleep`. The
baseline coding image also includes Git, tar, and CA certificates:

```sh
bun run workspace:image
```

## Files

- `local.ts` implements the local Docker provider.
- `local.test.ts` verifies lifecycle, persistence, filesystem, shell, and
  cancellation behavior through Pi's `ExecutionEnv`.
- `coding.Dockerfile` defines the baseline image.
- `index.ts` exports the provider.

The Docker Cloud provider will be added separately after the local provider and
shared SDK boundary are established.
