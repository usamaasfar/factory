# Sandbox providers

Providers use [`factory-oss/sandbox`](../sdk/README.md#sandboxes). Extend `Sandbox`
and map the native client's command startup, output, completion, and termination
to `SandboxCommand` / `SandboxProcess`. Provider code needs no Pi or Chord imports.

The old local Docker draft has been removed rather than kept behind a
compatibility layer. No built-in execution connector is implemented yet.
Provisioning, persistent storage, suspension, and workflow wiring are outside
this SDK slice.

`coding.Dockerfile` remains a baseline Linux image fixture with Bash and coreutils.
It can be built independently:

```sh
docker build -f sandboxes/coding.Dockerfile -t factory-coding:test .
```

Building this image does not register a provider or enable sandbox execution in
Factory. A Docker connector can be implemented separately against the new SDK.
