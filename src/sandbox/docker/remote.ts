/**
 * Remote Docker Sandboxes provider plan.
 *
 * This provider will use the experimental `@docker/sandboxes` TypeScript SDK,
 * not the `sbx --cloud` CLI. It will create or reconnect to Docker-managed
 * cloud sandboxes, wait until they are running, refresh endpoints after
 * restarts, adapt interactive processes to `SandboxCommandRunner`, and delete
 * sandboxes through `SandboxProvider.destroy()`.
 *
 * Factory must persist the mapping from its stable sandbox key to Docker's
 * assigned cloud resource name. Command execution must preserve cwd,
 * environment, stdin, ordered stdout and stderr streaming, exit codes, and
 * cancellation. Cancellation must stop the remote process before the runner
 * settles.
 *
 * Expiration is part of lifecycle management: the provider must configure or
 * renew the sandbox lifetime so an active Factory conversation is not removed
 * by Docker's default timeout. It will return `FactorySandbox`; Pi filesystem
 * and shell semantics remain in the shared adapter.
 */

export {};
