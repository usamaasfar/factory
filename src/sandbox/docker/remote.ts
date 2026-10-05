/**
 * Placeholder for Docker-managed cloud sandboxes.
 *
 * The remote provider will implement `SandboxProvider` with the experimental
 * `@docker/sandboxes` SDK, not the `sbx --cloud` CLI. It will own cloud
 * lifecycle, preserve storage while compute is suspended, persist Factory
 * key-to-resource ID mappings, and adapt the SDK's interactive process API to
 * `SandboxCommandRunner`.
 *
 * The runner must preserve cwd, environment, stdin, ordered output, exit codes,
 * and cancellation; cancellation must stop the remote process before settling.
 * It will return `FactorySandbox`, which remains responsible for Pi filesystem
 * and shell semantics.
 */

export {};
